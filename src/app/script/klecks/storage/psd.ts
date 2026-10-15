import { hasUnchangedPsdBackground } from './psd-background';
import { createCanvas } from '../../bb/base/create-canvas';
import { BlendMode, Layer, Psd } from 'ag-psd/dist/psd';
import { TKlProject, TKlPsd, TKlPsdError, TKlPsdLayer, TMixMode } from '../kl-types';
import { LANG } from '../../language/language';
import { MAX_LAYERS } from '../canvas/kl-canvas';
import { BB } from '../../bb/bb';
import { randomUuid } from '../../bb/base/base';

let kl2PsdMap: Record<TMixMode, BlendMode>;
let psd2KlMap: Record<BlendMode, TMixMode>;

function init(): void {
    if (kl2PsdMap) {
        return;
    }
    kl2PsdMap = {
        'source-over': 'normal',

        darken: 'darken',
        multiply: 'multiply',
        'color-burn': 'color burn',
        'linear-burn': 'linear burn',
        'linear-dodge': 'linear dodge',
        'linear-light': 'linear light',
        'vivid-light': 'vivid light',
        'pin-light': 'pin light',
        'hard-mix': 'hard mix',
        'darker-color': 'darker color',
        'lighter-color': 'lighter color',
        subtract: 'subtract',
        divide: 'divide',

        lighten: 'lighten',
        screen: 'screen',
        'color-dodge': 'color dodge',

        overlay: 'overlay',
        'soft-light': 'soft light',
        'hard-light': 'hard light',

        difference: 'difference',
        exclusion: 'exclusion',

        hue: 'hue',
        saturation: 'saturation',
        color: 'color',
        luminosity: 'luminosity',
    };
    psd2KlMap = Object.fromEntries(Object.entries(kl2PsdMap).map((a) => a.reverse()));
}

export function blendPsdToKl(str: BlendMode): TMixMode {
    init();
    return psd2KlMap[str];
}

export function blendKlToPsd(str: TMixMode): BlendMode {
    init();
    return kl2PsdMap[str];
}

/**
 * Converts ag-psd object into something that KlCanvas can represent
 * @param psdObj
 */
export function psdToKlPsd(psdObj: Psd): TKlPsd {
    if (!psdObj.canvas) {
        throw new Error('psdObj.canvas undefined');
    }
    const result: TKlPsd = {
        type: 'psd',
        canvas: psdObj.canvas,
        width: psdObj.width,
        height: psdObj.height,
    };

    function addWarning(warningStr: TKlPsdError): void {
        result.warningArr ??= [];
        if (result.warningArr.includes(warningStr)) {
            return;
        }
        result.warningArr.push(warningStr);
    }

    function getMixModeStr(blendMode: BlendMode): TMixMode {
        let mixModeStr: TMixMode = blendPsdToKl(blendMode);
        if (!mixModeStr) {
            addWarning('blend-mode');
            mixModeStr = 'source-over';
        }
        return mixModeStr;
    }

    if (psdObj.bitsPerChannel !== 8) {
        addWarning('bits-per-channel');
    }

    if (!psdObj.children) {
        result.error = true;
        return result;
    }

    if (hasUnchangedPsdBackground(psdObj)) {
        result.background = 'white';
        psdObj = { ...psdObj, children: psdObj.children.slice(1) };
    }

    // A folder is a real layer in Klecks. Count it even though its image is only a placeholder.
    function countLayers(children: Layer[]): number {
        return children.reduce(
            (count, item) => count + (item.adjustment ? 0 : 1 + countLayers(item.children ?? [])),
            0,
        );
    }
    if (countLayers(psdObj.children ?? []) > MAX_LAYERS) {
        result.error = true;
        return result;
    }

    result.layers = [];
    type TMask = NonNullable<Layer['mask']>;
    const preparedMaskMap = new WeakMap<TMask, HTMLCanvasElement>();
    function getPreparedMask(mask: TMask): HTMLCanvasElement {
        const cached = preparedMaskMap.get(mask);
        if (cached) {
            return cached;
        }
        if (!mask.canvas) {
            throw new Error('PSD mask canvas undefined');
        }
        const canvas = createCanvas(result.width, result.height);
        const ctx = BB.ctx(canvas);
        if ((mask.defaultColor ?? 255) !== 0) {
            ctx.fillStyle = '#fff';
            ctx.fillRect(0, 0, canvas.width, canvas.height);
        }
        const maskData = BB.ctx(mask.canvas).getImageData(
            0,
            0,
            mask.canvas.width,
            mask.canvas.height,
        );
        for (let i = 0; i < maskData.data.length; i += 4) {
            const alpha = maskData.data[i];
            maskData.data[i] = 255;
            maskData.data[i + 1] = 255;
            maskData.data[i + 2] = 255;
            maskData.data[i + 3] = alpha;
        }
        ctx.putImageData(maskData, mask.left ?? 0, mask.top ?? 0);
        preparedMaskMap.set(mask, canvas);
        return canvas;
    }

    function applyMask(canvas: HTMLCanvasElement, mask: TMask): void {
        if (mask.disabled) {
            return;
        }
        const ctx = BB.ctx(canvas);
        ctx.save();
        ctx.globalCompositeOperation = 'destination-in';
        ctx.drawImage(getPreparedMask(mask), 0, 0);
        ctx.restore();
    }

    // ag-psd stores siblings bottom-to-top. Postorder keeps each folder after its children.
    function convertChildren(
        children: Layer[],
        parentGroupId: string | null,
        ancestorMasks: TMask[],
    ): void {
        for (const item of children) {
            if (item.adjustment) {
                addWarning('adjustment');
                continue;
            }
            if (item.effects) {
                addWarning('layer-effect');
            }
            if (item.mask || item.vectorMask) {
                addWarning('mask');
            }

            if (item.children) {
                const groupId = randomUuid();
                convertChildren(
                    item.children,
                    groupId,
                    item.mask && !item.mask.disabled
                        ? [...ancestorMasks, item.mask]
                        : ancestorMasks,
                );
                result.layers!.push({
                    name: item.name ?? '',
                    isVisible: !item.hidden,
                    opacity: item.opacity ?? 1,
                    mixModeStr:
                        item.blendMode === 'pass through'
                            ? 'source-over'
                            : getMixModeStr(item.blendMode ?? 'normal'),
                    hasClipping: !!item.clipping,
                    groupId,
                    parentGroupId,
                    isExpanded: item.opened !== false,
                    isPassThrough: item.blendMode === 'pass through',
                    image: createCanvas(1, 1),
                });
                continue;
            }

            const canvas = createCanvas(result.width, result.height);
            if (item.canvas) {
                BB.ctx(canvas).drawImage(item.canvas, item.left ?? 0, item.top ?? 0);
            }
            if (item.mask) {
                applyMask(canvas, item.mask);
            }
            for (const mask of ancestorMasks) {
                applyMask(canvas, mask);
            }
            result.layers!.push({
                name: item.name ?? '',
                isVisible: !item.hidden,
                opacity: item.opacity ?? 1,
                mixModeStr: getMixModeStr(item.blendMode ?? 'normal'),
                hasClipping: !!item.clipping,
                parentGroupId,
                image: canvas,
            });
        }
    }

    convertChildren(psdObj.children ?? [], null, []);

    return result;
}

export function klPsdToKlProject(klPsd: TKlPsd): TKlProject {
    // only share references to Canvas elements
    const result: TKlProject = {
        projectId: randomUuid(),
        width: klPsd.width,
        height: klPsd.height,
        layers: [],
        background: klPsd.layers ? (klPsd.background ?? 'transparent') : 'transparent',
    };
    if (klPsd.layers) {
        result.layers = klPsd.layers.map((item) => {
            return {
                name: item.name,
                isVisible: item.isVisible,
                opacity: item.opacity,
                mixModeStr: item.mixModeStr,
                hasClipping: item.hasClipping,
                groupId: item.groupId,
                parentGroupId: item.parentGroupId,
                isExpanded: item.isExpanded,
                isPassThrough: item.isPassThrough,
                image: item.image,
            };
        });
    } else {
        // flattened
        result.layers = [
            {
                name: LANG('background'),
                isVisible: true,
                opacity: 1,
                mixModeStr: 'source-over',
                hasClipping: false,
                image: klPsd.canvas,
            },
        ];
    }
    return result;
}
