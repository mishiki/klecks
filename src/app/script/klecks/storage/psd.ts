import { hasUnchangedPsdBackground } from './psd-background';
import { createCanvas } from '../../bb/base/create-canvas';
import { BlendMode, Layer, Psd } from 'ag-psd/dist/psd';
import { TKlProject, TKlPsd, TKlPsdError, TKlPsdLayer, TMixMode } from '../kl-types';
import { LANG, LANGUAGE_STRINGS } from '../../language/language';
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

    // Folders and adjustment placeholders are real layers in Klecks.
    function countLayers(children: Layer[]): number {
        return children.reduce(
            (count, item) => count + 1 + countLayers(item.children ?? []),
            0,
        );
    }
    if (countLayers(psdObj.children ?? []) > MAX_LAYERS) {
        result.error = true;
        return result;
    }

    result.layers = [];
    function getPreparedMask(mask: NonNullable<Layer['mask']>, layer: Layer): HTMLCanvasElement {
        const canvas = createCanvas(result.width, result.height);
        const ctx = BB.ctx(canvas);
        const defaultColor = mask.defaultColor ?? 255;
        ctx.fillStyle = `rgb(${defaultColor}, ${defaultColor}, ${defaultColor})`;
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        const source = mask.canvas
            ? BB.ctx(mask.canvas).getImageData(0, 0, mask.canvas.width, mask.canvas.height)
            : mask.imageData;
        if (source) {
            const normalized = ctx.createImageData(source.width, source.height);
            for (let i = 0; i < source.data.length; i += 4) {
                const value = source.data[i];
                normalized.data[i] = value;
                normalized.data[i + 1] = value;
                normalized.data[i + 2] = value;
                normalized.data[i + 3] = 255;
            }
            ctx.putImageData(
                normalized,
                (mask.left ?? 0) + (mask.positionRelativeToLayer ? (layer.left ?? 0) : 0),
                (mask.top ?? 0) + (mask.positionRelativeToLayer ? (layer.top ?? 0) : 0),
            );
        }
        return canvas;
    }

    function getAdjustmentName(adjustment: NonNullable<Layer['adjustment']>, name: string): string {
        const kindMap: Record<string, [string, string]> = {
            'brightness/contrast': ['Brightness/Contrast', '明るさ・コントラスト'],
            levels: ['Levels', 'レベル補正'],
            curves: ['Curves', 'トーンカーブ'],
            exposure: ['Exposure', '露光量'],
            vibrance: ['Vibrance', '自然な彩度'],
            'hue/saturation': ['Hue/Saturation', '色相・彩度'],
            'color balance': ['Color Balance', 'カラーバランス'],
            'black & white': ['Black & White', '白黒'],
            'photo filter': ['Photo Filter', 'レンズフィルター'],
            'channel mixer': ['Channel Mixer', 'チャンネルミキサー'],
            'color lookup': ['Color Lookup', 'カラールックアップ'],
            invert: ['Invert', '階調の反転'],
            posterize: ['Posterize', 'ポスタリゼーション'],
            threshold: ['Threshold', '2階調化'],
            'gradient map': ['Gradient Map', 'グラデーションマップ'],
            'selective color': ['Selective Color', '特定色域の選択'],
        };
        const isJapanese = LANGUAGE_STRINGS.getCode() === 'ja';
        const kind = kindMap[adjustment.type]?.[isJapanese ? 1 : 0] ?? adjustment.type;
        return isJapanese ? `[調整: ${kind}] ${name}` : `[Adjustment: ${kind}] ${name}`;
    }

    // ag-psd stores siblings bottom-to-top. Postorder keeps each folder after its children.
    function convertChildren(children: Layer[], parentGroupId: string | null): void {
        for (const item of children) {
            if (item.effects) {
                addWarning('layer-effect');
            }
            if (item.vectorMask || item.realMask || item.mask?.fromVectorData ||
                item.mask?.userMaskDensity !== undefined || item.mask?.userMaskFeather !== undefined ||
                item.mask?.vectorMaskDensity !== undefined || item.mask?.vectorMaskFeather !== undefined) {
                addWarning('mask');
            }
            const mask = item.mask
                ? { image: getPreparedMask(item.mask, item), enabled: !item.mask.disabled }
                : undefined;

            if (item.adjustment) {
                addWarning('adjustment');
                result.layers!.push({
                    name: getAdjustmentName(item.adjustment, item.name ?? ''),
                    isVisible: !item.hidden,
                    opacity: 1,
                    mixModeStr: 'source-over',
                    // A transparent placeholder must not become the base of a clipping stack.
                    hasClipping: true,
                    parentGroupId,
                    image: createCanvas(result.width, result.height),
                    mask,
                });
                continue;
            }

            if (item.children) {
                const groupId = randomUuid();
                convertChildren(item.children, groupId);
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
                    mask,
                });
                continue;
            }

            const canvas = createCanvas(result.width, result.height);
            if (item.canvas) {
                BB.ctx(canvas).drawImage(item.canvas, item.left ?? 0, item.top ?? 0);
            }
            result.layers!.push({
                name: item.name ?? '',
                isVisible: !item.hidden,
                opacity: item.opacity ?? 1,
                mixModeStr: getMixModeStr(item.blendMode ?? 'normal'),
                hasClipping: !!item.clipping,
                parentGroupId,
                image: canvas,
                mask,
            });
        }
    }

    convertChildren(psdObj.children ?? [], null);

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
                mask: item.mask,
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
