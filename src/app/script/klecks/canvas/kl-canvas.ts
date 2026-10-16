import { BB } from '../../bb/bb';
import { ctx, freeCanvas } from '../../bb/base/canvas';
import { changeCanvasDimensions } from '../../bb/base/change-canvas-dimensions';
import { floodFillBits } from '../image-operations/flood-fill';
import { drawShape } from '../image-operations/shape-tool';
import { renderText, TRenderTextParam } from '../image-operations/render-text';
import {
    TFillSampling,
    TGradient,
    TInterpolationAlgorithm,
    TKlNamedLayer,
    TCanvasBackground,
    TKlProject,
    isLayerFill,
    TMixMode,
    TRgb,
    TShapeToolObject,
} from '../kl-types';
import { drawProject } from './draw-project';
import { LANG } from '../../language/language';
import { drawGradient } from '../image-operations/gradient-tool';
import { MultiPolygon } from 'polygon-clipping';
import { compose, identity, Matrix, rotate, scale, translate } from 'transformation-matrix';
import { getSelectionPath2d } from '../../bb/multi-polygon/get-selection-path-2d';
import { transformMultiPolygon } from '../../bb/multi-polygon/transform-multi-polygon';
import { getMultiPolyBounds } from '../../bb/multi-polygon/get-multi-polygon-bounds';
import { coordinateBoundsToIndexBounds, rectToBounds } from '../../bb/math/math';
import { matrixToTuple } from '../../bb/math/matrix-to-tuple';
import { getEraseColor } from '../brushes/erase-color';
import { KlHistory } from '../history/kl-history';
import { getNextLayerId } from '../history/get-next-layer-id';
import {
    THistoryEntryDataComposed,
    THistoryEntryLayerComposed,
    THistoryEntryLayerTile,
    TLayerId,
} from '../history/history.types';
import { createFillColorTiles } from '../history/create-fill-color-tiles';
import { updateLayersViaComposed } from './update-layers-via-composed';
import { isHistoryEntryOpacityChange } from '../history/push-helpers/is-history-entry-opacity-change';
import { isHistoryEntryVisibilityChange } from '../history/push-helpers/is-history-entry-visibility-change';
import { transformCoordinateBounds } from '../../bb/transform/transform-coordinate-bounds';
import { createLayerMap } from '../history/push-helpers/create-layer-map';
import { canvasToLayerTiles } from '../history/push-helpers/canvas-to-layer-tiles';
import { Eyedropper } from './eyedropper';
import { randomUuid } from '../../bb/base/base';
import { translateMultiPolygon } from '../../bb/multi-polygon/translate-multi-polygon';
import { getBinaryMask } from '../select-tool/get-binary-mask';
import { TIndexBounds } from '../../bb/bb-types';
import { LayerCompositor } from './layer-compositor';
import { getMixModeStr } from './get-mix-mode';
import { getSubtreeRange, isGroupLayer } from './layer-tree';

export const MAX_LAYERS = 255;

export type TKlCanvasLayer = {
    id: TLayerId;
    index: number; // certain brushes need to know
    name: string;
    mixModeStr: TMixMode;
    hasClipping: boolean;
    isVisible: boolean;
    opacity: number;
    groupId?: string | null;
    parentGroupId?: string | null;
    isExpanded?: boolean;
    isPassThrough?: boolean;
    compositeObj?: TLayerComposite;
    canvas: HTMLCanvasElement;
    context: CanvasRenderingContext2D;
    mask?: {
        canvas: HTMLCanvasElement;
        context: CanvasRenderingContext2D;
        enabled: boolean;
        revision: number;
    };
};

export type TLayerComposite = {
    draw: (ctx: CanvasRenderingContext2D) => void;
};

/**
 * The image/canvas that the user paints on
 * Has layers. layers have names and opacity.
 *
 * Interacts with klHistory
 */
export class KlCanvas {
    private isDestroyed = false;
    private width: number;
    private height: number;
    private background: TCanvasBackground = 'transparent';
    private layers: TKlCanvasLayer[];
    private eyedropper: Eyedropper;
    private selection: undefined | MultiPolygon = undefined;
    private readonly klHistory: KlHistory;

    private createMask(
        image?: HTMLCanvasElement | HTMLImageElement,
        enabled = true,
    ): NonNullable<TKlCanvasLayer['mask']> {
        const canvas = BB.canvas(this.width, this.height);
        const context = BB.ctx(canvas);
        context.fillStyle = 'white';
        context.fillRect(0, 0, this.width, this.height);
        if (image) {
            context.drawImage(image, 0, 0);
            const data = context.getImageData(0, 0, this.width, this.height);
            for (let i = 0; i < data.data.length; i += 4) {
                const gray = Math.round(
                    data.data[i] * 0.2126 + data.data[i + 1] * 0.7152 + data.data[i + 2] * 0.0722,
                );
                data.data[i] = gray;
                data.data[i + 1] = gray;
                data.data[i + 2] = gray;
                data.data[i + 3] = 255;
            }
            context.putImageData(data, 0, 0);
        }
        return { canvas, context, enabled, revision: 1 };
    }

    private updateIndices(): void {
        this.layers.forEach((item, index) => {
            item.index = index;
        });
    }

    private getTopPaintIndex(): number {
        for (let i = this.layers.length - 1; i >= 0; i--) {
            if (!isGroupLayer(this.layers[i])) {
                return i;
            }
        }
        return -1;
    }

    private appendBlankPaintLayer(): TKlCanvasLayer {
        const canvas = BB.canvas(this.width, this.height);
        const layer: TKlCanvasLayer = {
            id: getNextLayerId(),
            index: this.layers.length,
            name: LANG('layers-layer') + ' 1',
            mixModeStr: 'source-over',
            hasClipping: false,
            isVisible: true,
            opacity: 1,
            groupId: null,
            parentGroupId: null,
            isExpanded: true,
            isPassThrough: false,
            canvas,
            context: BB.ctx(canvas),
        };
        this.layers.push(layer);
        return layer;
    }

    // ----------------------------------- public -----------------------------------

    constructor(
        history: KlHistory,
        private layerNrOffset: number = 0,
    ) {
        this.klHistory = history;
        this.layers = [];
        this.eyedropper = new Eyedropper();
        this.width = 0;
        this.height = 0;
        this.updateViaComposed(
            {
                projectId: { value: randomUuid() },
                size: { width: 0, height: 0 },
                activeLayerId: '',
                selection: { value: [] },
                background: 'transparent',
                layerMap: {},
            },
            this.klHistory.getComposed(),
        );
        if (this.getTopPaintIndex() < 0) {
            const paintLayer = this.appendBlankPaintLayer();
            this.klHistory.push({
                activeLayerId: paintLayer.id,
                layerMap: createLayerMap(
                    this.layers,
                    { attributes: ['index'] },
                    { layerId: paintLayer.id, attributes: 'all' },
                ),
            });
        }
    }

    /*
     * Resets canvas -> 1 layer, 100% opacity,
     * unless layers provided.
     * @param p
     */
    reset(p: {
        clearHistory?: boolean; // a different document starts a new baseline
        projectId?: string; // uuid
        width: number;
        height: number;
        background?: TCanvasBackground; // missing means transparent
        color?: TRgb; // optional - fill color
        image?: HTMLImageElement | HTMLCanvasElement; // image drawn on layer
        layerName?: string; // if via image
        layers?: (TKlNamedLayer<HTMLCanvasElement> & {
            id: TLayerId;
        })[];
    }): number {
        if (
            !p.width ||
            !p.height ||
            p.width < 1 ||
            p.height < 1 ||
            isNaN(p.width) ||
            isNaN(p.height)
        ) {
            throw new Error('invalid canvas size');
        }
        this.width = p.width;
        this.height = p.height;
        this.background = p.background ?? 'transparent';
        this.selection = undefined;
        this.layers.splice(1, Math.max(0, this.layers.length - 1));

        this.klHistory.pause(true);
        try {
            if (p.layers && p.layers.length > 0) {
                for (let i = 0; i < p.layers.length; i++) {
                    const pItem = p.layers[i];
                    if (!this.layers[i]) {
                        this.addLayer();
                    }
                    const layer = this.layers[i];
                    layer.id = pItem.id;
                    layer.name = pItem.name;
                    layer.isVisible = pItem.isVisible;
                    layer.mixModeStr = pItem.mixModeStr;
                    layer.hasClipping = pItem.hasClipping;
                    layer.groupId = pItem.groupId ?? null;
                    layer.parentGroupId = pItem.parentGroupId ?? null;
                    layer.isExpanded = pItem.isExpanded ?? true;
                    layer.isPassThrough = pItem.isPassThrough ?? false;
                    changeCanvasDimensions(layer.canvas, isGroupLayer(layer) ? 1 : this.width, isGroupLayer(layer) ? 1 : this.height, {
                        ensureCleared: true,
                    });
                    if (!isGroupLayer(layer)) {
                        layer.context.drawImage(pItem.image, 0, 0);
                    }
                    const replacementMask = pItem.mask
                        ? this.createMask(pItem.mask.image, pItem.mask.enabled)
                        : undefined;
                    if (layer.mask) {
                        BB.freeCanvas(layer.mask.canvas);
                    }
                    layer.mask = replacementMask;
                    this.setOpacity(i, pItem.opacity);
                }
                if (this.getTopPaintIndex() < 0) {
                    this.appendBlankPaintLayer();
                }
            } else {
                const layer = this.layers[0];
                layer.name = p.layerName ? p.layerName : LANG('layers-layer') + ' 1';
                layer.isVisible = true;
                layer.hasClipping = false;
                layer.groupId = null;
                layer.parentGroupId = null;
                layer.isExpanded = true;
                layer.isPassThrough = false;
                if (layer.mask) {
                    BB.freeCanvas(layer.mask.canvas);
                    layer.mask = undefined;
                }
                changeCanvasDimensions(layer.canvas, this.width, this.height, {
                    ensureCleared: true,
                });
                layer.mixModeStr = 'source-over';
                this.setOpacity(0, 1);
                if (p.color) {
                    this.layerFill(0, p.color);
                } else if (p.image) {
                    layer.context.drawImage(p.image, 0, 0);
                }
            }
        } finally {
            this.klHistory.pause(false);
        }
        this.updateIndices();

        if (!this.klHistory.isPaused()) {
            const historyEntryData: THistoryEntryDataComposed = {
                projectId: {
                    value: p.projectId ?? randomUuid(),
                },
                size: {
                    width: this.width,
                    height: this.height,
                },
                selection: { value: this.selection },
                background: this.background,
                activeLayerId: this.layers[this.getTopPaintIndex()].id,
                layerMap: createLayerMap(this.layers, {
                    attributes: 'all',
                }) as Record<TLayerId, THistoryEntryLayerComposed>,
            };
            if (p.clearHistory) {
                this.klHistory.reset(historyEntryData);
            } else {
                this.klHistory.push(historyEntryData);
            }
        }

        return this.getTopPaintIndex();
    }

    isLayerLimitReached(): boolean {
        return this.layers.length >= MAX_LAYERS;
    }

    getWidth(): number {
        return this.width;
    }

    getHeight(): number {
        return this.height;
    }

    getBackground(): TCanvasBackground {
        return this.background;
    }

    setBackground(background: TCanvasBackground): void {
        if (background === this.background) {
            return;
        }
        this.background = background;
        this.klHistory.push({ background });
    }

    /**
     * without resizing
     */
    setSize(width: number, height: number): void {
        this.width = width;
        this.height = height;
    }

    getLayerCount(): number {
        return this.layers.length;
    }

    resize(w: number, h: number, algorithm: TInterpolationAlgorithm = 'smooth'): boolean {
        if (
            !w ||
            !h ||
            (w === this.width && h === this.height) ||
            isNaN(w) ||
            isNaN(h) ||
            w < 1 ||
            h < 1
        ) {
            return false;
        }
        w = Math.max(w, 1);
        h = Math.max(h, 1);

        let tmp1, tmp2;

        if (algorithm === 'pixelated') {
            tmp1 = BB.canvas(w, h);
            const tmp1Ctx = BB.ctx(tmp1);
            tmp1Ctx.imageSmoothingEnabled = false;
            for (let i = 0; i < this.layers.length; i++) {
                const layer = this.layers[i];
                if (!isGroupLayer(layer)) {
                    tmp1Ctx.clearRect(0, 0, w, h);
                    tmp1Ctx.drawImage(layer.canvas, 0, 0, w, h);
                    changeCanvasDimensions(layer.canvas, w, h, { ensureCleared: true });
                    layer.context.drawImage(tmp1, 0, 0);
                }
                if (layer.mask) {
                    tmp1Ctx.clearRect(0, 0, w, h);
                    tmp1Ctx.drawImage(layer.mask.canvas, 0, 0, w, h);
                    changeCanvasDimensions(layer.mask.canvas, w, h, { ensureCleared: true });
                    layer.mask.context.drawImage(tmp1, 0, 0);
                    layer.mask.revision++;
                }
            }
        } else {
            // smooth
            tmp1 = BB.canvas();
            tmp2 = BB.canvas();
            for (let i = 0; i < this.layers.length; i++) {
                const layer = this.layers[i];
                if (!isGroupLayer(layer)) {
                    BB.resizeCanvas(layer.canvas, w, h, tmp1, tmp2);
                }
                if (layer.mask) {
                    BB.resizeCanvas(layer.mask.canvas, w, h, tmp1, tmp2);
                    layer.mask.revision++;
                }
            }
        }

        if (this.selection) {
            this.selection = transformMultiPolygon(
                this.selection,
                scale(w / this.width, h / this.height),
            );
        }
        this.width = w;
        this.height = h;

        this.klHistory.push({
            size: {
                width: this.width,
                height: this.height,
            },
            layerMap: createLayerMap(this.layers, { attributes: ['tiles', 'mask'] }),
            ...(this.selection ? { selection: { value: this.selection } } : {}),
        });

        BB.freeCanvas(tmp1);
        if (tmp2) {
            BB.freeCanvas(tmp2);
        }

        return true;
    }

    /**
     * crop / extend
     */
    cropExtend(p: {
        left: number;
        top: number;
        right: number;
        bottom: number;
        fillColor?: TRgb;
    }): boolean {
        const newW = Math.round(p.left) + this.width + Math.round(p.right);
        const newH = Math.round(p.top) + this.height + Math.round(p.bottom);
        const offX = Math.round(p.left);
        const offY = Math.round(p.top);

        if (isNaN(newW) || isNaN(newH) || newW < 1 || newH < 1) {
            return false;
        }

        const bottomPaintIndex = this.layers.findIndex((layer) => !isGroupLayer(layer));
        for (let i = 0; i < this.layers.length; i++) {
            const layer = this.layers[i];
            if (!isGroupLayer(layer)) {
                const ctemp = BB.canvas(this.width, this.height);
                BB.ctx(ctemp).drawImage(layer.canvas, 0, 0);

                changeCanvasDimensions(layer.canvas, newW, newH, { ensureCleared: true });

                layer.context.save();
                if (i === bottomPaintIndex && p.fillColor) {
                    layer.context.fillStyle = BB.ColorConverter.toRgbStr(p.fillColor);
                    layer.context.fillRect(0, 0, newW, newH);
                    layer.context.clearRect(offX, offY, this.width, this.height);
                }
                layer.context.drawImage(ctemp, offX, offY);
                layer.context.restore();
                BB.freeCanvas(ctemp);
            }
            if (layer.mask) {
                const maskTemp = BB.canvas(this.width, this.height);
                BB.ctx(maskTemp).drawImage(layer.mask.canvas, 0, 0);
                changeCanvasDimensions(layer.mask.canvas, newW, newH, { ensureCleared: true });
                layer.mask.context.fillStyle = 'white';
                layer.mask.context.fillRect(0, 0, newW, newH);
                layer.mask.context.drawImage(maskTemp, offX, offY);
                layer.mask.revision++;
                BB.freeCanvas(maskTemp);
            }
        }
        this.width = newW;
        this.height = newH;

        if (this.selection) {
            this.selection = translateMultiPolygon(this.selection, offX, offY);
        }
        this.klHistory.push({
            size: {
                width: this.width,
                height: this.height,
            },
            layerMap: createLayerMap(this.layers, { attributes: ['tiles', 'mask'] }),
            ...(this.selection ? { selection: { value: this.selection } } : {}),
        });
        return true;
    }

    /**
     * will be inserted above of selected
     */
    addLayer(
        selectedIndex?: number,
        data?: {
            name?: string;
            mixModeStr: TMixMode;
            hasClipping?: boolean;
            isVisible: boolean;
            opacity: number;
            image: HTMLCanvasElement | HTMLImageElement | ((ctx: CanvasRenderingContext2D) => void);
            mask?: { image: HTMLCanvasElement | HTMLImageElement; enabled: boolean };
        },
    ): false | number {
        if (this.isLayerLimitReached()) {
            return false;
        }
        const selected = selectedIndex === undefined ? undefined : this.layers[selectedIndex];
        if (selectedIndex !== undefined && !selected) {
            return false;
        }
        const index = selected === undefined
            ? this.layers.length
            : isGroupLayer(selected)
                ? selectedIndex!
                : selectedIndex! + 1;
        const parentGroupId = selected === undefined
            ? null
            : isGroupLayer(selected)
                ? selected.groupId
                : (selected.parentGroupId ?? null);

        const canvas = BB.canvas(this.width, this.height);
        const context = BB.ctx(canvas);
        if (data) {
            if (typeof data.image === 'function') {
                data.image(context);
            } else {
                context.drawImage(data.image, 0, 0);
            }
        }

        const layerId = getNextLayerId();
        const layer: TKlCanvasLayer = {
            id: layerId,
            index,
            name:
                data && data.name !== undefined
                    ? data.name
                    : LANG('layers-layer') + ' ' + (this.layers.length + this.layerNrOffset),
            mixModeStr: getMixModeStr(data?.mixModeStr),
            hasClipping: data?.hasClipping ?? false,
            isVisible: data ? data.isVisible : true,
            opacity: data ? data.opacity : 1,
            groupId: null,
            parentGroupId,
            isExpanded: true,
            isPassThrough: false,
            canvas,
            context,
            mask: data?.mask ? this.createMask(data.mask.image, data.mask.enabled) : undefined,
        };

        this.layers.splice(index, 0, layer);

        this.klHistory.pause(true);
        try {
            this.setOpacity(index, 1);
        } finally {
            this.klHistory.pause(false);
        }
        this.updateIndices();

        if (!this.klHistory.isPaused()) {
            this.klHistory.push({
                activeLayerId: layerId,
                layerMap: createLayerMap(
                    this.layers,
                    { attributes: ['index'] },
                    {
                        layerId,
                        attributes: 'all',
                        tiles: data
                            ? undefined
                            : createFillColorTiles(this.width, this.height, 'transparent'),
                    },
                ),
            });
        }

        return index;
    }

    /** Insert an empty group as a sibling above the selected layer or group. */
    addGroup(selectedIndex?: number): false | number {
        if (this.isLayerLimitReached()) {
            return false;
        }
        const selected = selectedIndex === undefined ? undefined : this.layers[selectedIndex];
        if (selectedIndex !== undefined && !selected) {
            return false;
        }
        const index = selected === undefined ? this.layers.length : selectedIndex! + 1;
        const canvas = BB.canvas(1, 1);
        const group: TKlCanvasLayer = {
            id: getNextLayerId(),
            index,
            name: LANG('layers-group') + ' ' + (this.layers.filter(isGroupLayer).length + 1),
            mixModeStr: 'source-over',
            hasClipping: false,
            isVisible: true,
            opacity: 1,
            groupId: randomUuid(),
            parentGroupId: selected?.parentGroupId ?? null,
            isExpanded: true,
            isPassThrough: true,
            canvas,
            context: BB.ctx(canvas),
        };
        this.layers.splice(index, 0, group);
        this.updateIndices();
        if (!this.klHistory.isPaused()) {
            this.klHistory.push({
                activeLayerId: group.id,
                layerMap: createLayerMap(
                    this.layers,
                    { attributes: ['index'] },
                    { layerId: group.id, attributes: 'all' },
                ),
            });
        }
        return index;
    }

    duplicateLayer(srcIndex: number): false | number {
        if (!this.layers[srcIndex]) {
            return false;
        }
        const range = getSubtreeRange(this.layers, srcIndex);
        const sourceLayers = this.layers.slice(range.start, range.end + 1);
        if (this.layers.length + sourceLayers.length > MAX_LAYERS) {
            return false;
        }
        const newIndex = srcIndex + 1;
        const newGroupIds = new Map<string, string>();
        sourceLayers.forEach((layer) => {
            if (isGroupLayer(layer)) {
                newGroupIds.set(layer.groupId, randomUuid());
            }
        });
        const copies = sourceLayers.map((source, offset): TKlCanvasLayer => {
            const canvas = BB.canvas(
                isGroupLayer(source) ? 1 : this.width,
                isGroupLayer(source) ? 1 : this.height,
            );
            const context = BB.ctx(canvas);
            if (!isGroupLayer(source)) {
                context.drawImage(source.canvas, 0, 0);
            }
            const mask = source.mask
                ? this.createMask(source.mask.canvas, source.mask.enabled)
                : undefined;
            return {
                ...source,
                id: getNextLayerId(),
                index: newIndex + offset,
                name: offset === sourceLayers.length - 1
                    ? source.name + ' ' + LANG('layers-copy')
                    : source.name,
                groupId: isGroupLayer(source) ? newGroupIds.get(source.groupId)! : null,
                parentGroupId: source.parentGroupId
                    ? (newGroupIds.get(source.parentGroupId) ?? source.parentGroupId)
                    : null,
                canvas,
                context,
                mask,
                compositeObj: undefined,
            };
        });

        this.layers.splice(newIndex, 0, ...copies);

        this.updateIndices();

        if (!this.klHistory.isPaused()) {
            this.klHistory.push({
                activeLayerId: copies.at(-1)!.id,
                layerMap: createLayerMap(
                    this.layers,
                    { attributes: ['index'] },
                    ...copies.map((layer) => ({ layerId: layer.id, attributes: 'all' as const })),
                ),
            });
        }
        return newIndex + copies.length - 1;
    }

    getLayerContext(index: number, doReturnNull?: boolean): CanvasRenderingContext2D | null {
        if (this.layers[index]) {
            return this.layers[index].context;
        }
        if (doReturnNull) {
            return null;
        }
        throw new Error(
            'layer of index ' + index + ' not found (in ' + this.layers.length + ' layers)',
        );
    }

    addLayerMask(index: number): boolean {
        const layer = this.layers[index];
        if (!layer || layer.mask) {
            return false;
        }
        layer.mask = this.createMask();
        if (!this.klHistory.isPaused()) {
            const layerMap = createLayerMap(this.layers, { layerId: layer.id, attributes: [] });
            layerMap[layer.id].mask = {
                enabled: true,
                tiles: createFillColorTiles(this.width, this.height, 'white'),
            };
            this.klHistory.push({ layerMap });
        }
        return true;
    }

    removeLayerMask(index: number): boolean {
        const layer = this.layers[index];
        if (!layer?.mask) {
            return false;
        }
        BB.freeCanvas(layer.mask.canvas);
        layer.mask = undefined;
        if (!this.klHistory.isPaused()) {
            const layerMap = createLayerMap(this.layers, { layerId: layer.id, attributes: [] });
            layerMap[layer.id].mask = null;
            this.klHistory.push({ layerMap });
        }
        return true;
    }

    setLayerMaskEnabled(index: number, enabled: boolean): boolean {
        const layer = this.layers[index];
        if (!layer?.mask || layer.mask.enabled === enabled) {
            return false;
        }
        layer.mask.enabled = enabled;
        layer.mask.revision++;
        if (!this.klHistory.isPaused()) {
            const layerMap = createLayerMap(this.layers, { layerId: layer.id, attributes: [] });
            layerMap[layer.id].mask = { enabled };
            this.klHistory.push({ layerMap });
        }
        return true;
    }

    invertLayerMask(index: number): boolean {
        const context = this.getLayerMaskContext(index);
        if (!context) {
            return false;
        }
        const data = context.getImageData(0, 0, this.width, this.height);
        for (let i = 0; i < data.data.length; i += 4) {
            const gray = 255 - Math.round(
                data.data[i] * 0.2126 + data.data[i + 1] * 0.7152 + data.data[i + 2] * 0.0722,
            );
            data.data[i] = gray;
            data.data[i + 1] = gray;
            data.data[i + 2] = gray;
            data.data[i + 3] = 255;
        }
        context.putImageData(data, 0, 0);
        this.markLayerMaskChanged(index);
        this.pushLayerMaskHistory(index);
        return true;
    }

    getLayerMaskContext(index: number): CanvasRenderingContext2D | null {
        return this.layers[index]?.mask?.context ?? null;
    }

    /** Call while painting so live compositing knows the mask pixels changed. */
    markLayerMaskChanged(index: number): boolean {
        const mask = this.layers[index]?.mask;
        if (!mask) {
            return false;
        }
        mask.revision++;
        return true;
    }

    /** Commit mask pixels after a stroke. Unchanged tiles are omitted from the history entry. */
    pushLayerMaskHistory(index: number): boolean {
        const layer = this.layers[index];
        if (!layer?.mask || this.klHistory.isPaused()) {
            return false;
        }
        const composedMask = this.klHistory.getComposed().layerMap[layer.id]?.mask;
        const currentTiles = canvasToLayerTiles(layer.mask.canvas);
        const changedTiles: (THistoryEntryLayerTile | undefined)[] = currentTiles.map((tile, tileIndex) => {
            const old = composedMask?.tiles[tileIndex];
            if (!old || isLayerFill(tile)) {
                return tile;
            }
            const pixels = tile.data.data;
            if (isLayerFill(old)) {
                const value = old.fill === 'white' ? 255 : old.fill === 'black' ? 0 : -1;
                if (value >= 0) {
                    for (let i = 0; i < pixels.length; i += 4) {
                        if (
                            pixels[i] !== value || pixels[i + 1] !== value ||
                            pixels[i + 2] !== value || pixels[i + 3] !== 255
                        ) {
                            return tile;
                        }
                    }
                    return undefined;
                }
                return tile;
            }
            const beforePixels = old.data.data;
            if (pixels.length !== beforePixels.length) {
                return tile;
            }
            for (let i = 0; i < pixels.length; i++) {
                if (pixels[i] !== beforePixels[i]) {
                    return tile;
                }
            }
            return undefined;
        });
        if (
            !changedTiles.some((tile) => tile !== undefined) &&
            composedMask?.enabled === layer.mask.enabled
        ) {
            return false;
        }
        layer.mask.revision++;
        const layerMap = createLayerMap(this.layers, { layerId: layer.id, attributes: [] });
        layerMap[layer.id].mask = {
            enabled: layer.mask.enabled,
            tiles: changedTiles,
        };
        this.klHistory.push({ layerMap });
        return true;
    }

    removeLayer(index: number): false | number {
        const toDeleteLayer = this.layers[index];
        if (!toDeleteLayer) {
            return false;
        }
        const range = getSubtreeRange(this.layers, index);
        const paintOutside = this.layers.some((layer, layerIndex) =>
            (layerIndex < range.start || layerIndex > range.end) && !isGroupLayer(layer),
        );
        if (!paintOutside) {
            return false;
        }
        const removed = this.layers.splice(range.start, range.end - range.start + 1);
        removed.forEach((layer) => {
            BB.freeCanvas(layer.canvas);
            if (layer.mask) {
                BB.freeCanvas(layer.mask.canvas);
            }
        });
        this.updateIndices();
        const activeLayerIndex = this.layers.reduce((bestIndex, layer, layerIndex) => {
            if (isGroupLayer(layer)) {
                return bestIndex;
            }
            return bestIndex < 0 ||
                Math.abs(layerIndex - range.start) < Math.abs(bestIndex - range.start)
                ? layerIndex
                : bestIndex;
        }, -1);
        const activeLayerId = this.layers[activeLayerIndex].id;

        if (!this.klHistory.isPaused()) {
            this.klHistory.push({
                activeLayerId,
                layerMap: createLayerMap(this.layers, { attributes: ['index'] }),
            });
        }
        return activeLayerIndex;
    }

    renameLayer(index: number, name: string): boolean {
        const targetLayer = this.layers[index];
        if (targetLayer) {
            targetLayer.name = name;
        } else {
            return false;
        }

        if (!this.klHistory.isPaused()) {
            this.klHistory.push({
                layerMap: createLayerMap(this.layers, {
                    layerId: targetLayer.id,
                    attributes: ['name'],
                }),
            });
        }

        return true;
    }

    setOpacity(layerIndex: number, opacity: number): void {
        if (!this.layers[layerIndex]) {
            return;
        }
        opacity = Math.max(0, Math.min(1, opacity));
        this.layers[layerIndex].opacity = opacity;

        if (!this.klHistory.isPaused()) {
            const layerId = this.layers[layerIndex].id;
            const topEntry = this.klHistory.getEntries().at(-1)!.data;
            const replaceTop = isHistoryEntryOpacityChange(topEntry, layerId);
            this.klHistory.push(
                {
                    layerMap: createLayerMap(this.layers, {
                        layerId,
                        attributes: ['opacity'],
                    }),
                },
                replaceTop,
            );
        }
    }

    setLayerIsVisible(layerIndex: number, isVisible: boolean): void {
        if (this.layers[layerIndex]) {
            this.layers[layerIndex].isVisible = isVisible;
        } else {
            throw new Error(`layer ${layerIndex} undefined`);
        }

        if (!this.klHistory.isPaused()) {
            const layerId = this.layers[layerIndex].id;
            const topEntry = this.klHistory.getEntries().at(-1)!.data;
            const replaceTop = isHistoryEntryVisibilityChange(topEntry, layerId);
            this.klHistory.push(
                {
                    layerMap: createLayerMap(this.layers, {
                        layerId,
                        attributes: ['isVisible'],
                    }),
                },
                replaceTop,
            );
        }
    }

    setLayerHasClipping(layerIndex: number, hasClipping: boolean): void {
        if (this.layers[layerIndex]) {
            this.layers[layerIndex].hasClipping = hasClipping;
        } else {
            throw new Error(`layer ${layerIndex} undefined`);
        }

        if (!this.klHistory.isPaused()) {
            // todo could this also do replace top like setLayerIsVisible? - might require extra effort
            this.klHistory.push({
                layerMap: createLayerMap(this.layers, {
                    layerId: this.layers[layerIndex].id,
                    attributes: ['hasClipping'],
                }),
            });
        }
    }

    moveLayer(index: number, delta: number): void | number {
        if (!delta || !this.layers[index]) {
            return;
        }
        const parentId = this.layers[index].parentGroupId ?? null;
        const siblings = this.layers.flatMap((layer, layerIndex) =>
            (layer.parentGroupId ?? null) === parentId ? [layerIndex] : [],
        );
        const position = siblings.indexOf(index);
        if (position < 0) {
            return;
        }
        const targetPosition = Math.max(0, Math.min(position + Math.trunc(delta), siblings.length - 1));
        if (targetPosition === position) {
            return;
        }
        return this.moveLayerTo(
            index,
            siblings[targetPosition],
            targetPosition > position ? 'above' : 'below',
        );
    }

    /** Move a layer and all descendants. above/below make it a sibling of target. */
    moveLayerTo(
        index: number,
        targetIndex: number,
        placement: 'above' | 'below' | 'inside',
    ): number | undefined {
        const source = this.layers[index];
        const target = this.layers[targetIndex];
        if (!source || !target) {
            return undefined;
        }
        const sourceRange = getSubtreeRange(this.layers, index);
        if (targetIndex >= sourceRange.start && targetIndex <= sourceRange.end) {
            return undefined;
        }
        if (placement === 'inside' && !isGroupLayer(target)) {
            return undefined;
        }

        const targetRange = getSubtreeRange(this.layers, targetIndex);
        const insertionIndex = placement === 'inside'
            ? targetIndex
            : placement === 'below'
                ? targetRange.start
                : targetIndex + 1;
        const parentGroupId = placement === 'inside'
            ? target.groupId!
            : (target.parentGroupId ?? null);
        const length = sourceRange.end - sourceRange.start + 1;
        const adjustedIndex = insertionIndex > sourceRange.end
            ? insertionIndex - length
            : insertionIndex;
        if (adjustedIndex === sourceRange.start && (source.parentGroupId ?? null) === parentGroupId) {
            return index;
        }
        const subtree = this.layers.splice(sourceRange.start, length);
        subtree.at(-1)!.parentGroupId = parentGroupId;
        this.layers.splice(adjustedIndex, 0, ...subtree);
        this.updateIndices();
        const newRootIndex = adjustedIndex + length - 1;
        if (!this.klHistory.isPaused()) {
            this.klHistory.push({
                activeLayerId: source.id,
                layerMap: createLayerMap(
                    this.layers,
                    { attributes: ['index'] },
                    { layerId: source.id, attributes: ['index', 'parentGroupId'] },
                ),
            });
        }
        return newRootIndex;
    }

    setGroupExpanded(index: number, isExpanded: boolean): boolean {
        const group = this.layers[index];
        if (!isGroupLayer(group)) {
            return false;
        }
        if ((group.isExpanded ?? true) === isExpanded) {
            return true;
        }
        group.isExpanded = isExpanded;
        if (!this.klHistory.isPaused()) {
            this.klHistory.push({
                layerMap: createLayerMap(this.layers, {
                    layerId: group.id,
                    attributes: ['isExpanded'],
                }),
            });
        }
        return true;
    }

    setGroupPassThrough(index: number, isPassThrough: boolean): boolean {
        const group = this.layers[index];
        if (!isGroupLayer(group)) {
            return false;
        }
        if ((group.isPassThrough ?? false) === isPassThrough) {
            return true;
        }
        group.isPassThrough = isPassThrough;
        if (!this.klHistory.isPaused()) {
            this.klHistory.push({
                layerMap: createLayerMap(this.layers, {
                    layerId: group.id,
                    attributes: ['isPassThrough'],
                }),
            });
        }
        return true;
    }

    mergeLayer(layerIndex: number, mixModeStr?: TMixMode): number | undefined {
        const topLayer = this.layers[layerIndex];
        const bottomLayer = this.layers[layerIndex - 1];
        if (
            !bottomLayer ||
            !topLayer ||
            isGroupLayer(bottomLayer) ||
            isGroupLayer(topLayer) ||
            !!bottomLayer.mask ||
            !!topLayer.mask ||
            (bottomLayer.parentGroupId ?? null) !== (topLayer.parentGroupId ?? null)
        ) {
            return;
        }

        const compositor = new LayerCompositor();
        let hasChanges: boolean;
        try {
            hasChanges = compositor.merge(
                bottomLayer.context,
                bottomLayer,
                { ...topLayer, mixModeStr: mixModeStr ?? topLayer.mixModeStr },
                (ctx, layer) => ctx.drawImage(layer.canvas, 0, 0),
            );
        } finally {
            compositor.destroy();
        }

        this.klHistory.pause(true);
        try {
            this.removeLayer(layerIndex);
        } finally {
            this.klHistory.pause(false);
        }
        if (!this.klHistory.isPaused()) {
            this.klHistory.push({
                activeLayerId: bottomLayer.id,
                layerMap: createLayerMap(
                    this.layers,
                    { attributes: ['index'] },
                    hasChanges ? { layerId: bottomLayer.id, attributes: ['tiles'] } : undefined,
                ),
            });
        }

        return bottomLayer.index;
    }

    mergeAll(): number | false {
        if (this.layers.length <= 1 && !this.layers[0]?.mask) {
            return false;
        }

        // Merge paint only; document background remains separate.
        const mergedCanvas = drawProject(this.getProject());
        const bottomLayer: TKlCanvasLayer = {
            id: this.layers[0].id,
            index: 0,
            canvas: mergedCanvas,
            context: ctx(mergedCanvas),
            name: LANG('layers-layer') + ' 1',
            opacity: 1,
            isVisible: true,
            mixModeStr: 'source-over',
            hasClipping: false,
            groupId: null,
            parentGroupId: null,
            isExpanded: true,
            isPassThrough: false,
        };
        freeCanvas(this.layers[0].canvas);
        if (this.layers[0].mask) {
            freeCanvas(this.layers[0].mask.canvas);
        }
        this.layers[0] = bottomLayer;

        this.klHistory.pause(true);
        try {
            // remove upper layers
            for (let i = this.layers.length - 1; i > 0; i--) {
                this.removeLayer(i);
            }
        } finally {
            this.klHistory.pause(false);
        }

        if (!this.klHistory.isPaused()) {
            const activeLayerId = bottomLayer.id;
            this.klHistory.push({
                activeLayerId,
                layerMap: createLayerMap(this.layers, {
                    layerId: bottomLayer.id,
                    attributes: 'all',
                }),
            });
        }

        return 0;
    }

    // rotates the canvas with all layers. either by 90, 180, or 270 degrees
    rotate(deg: number): void {
        while (deg < 0) {
            deg += 360;
        }
        deg %= 360;
        if (deg !== 90 && deg !== 180 && deg !== 270) {
            return;
        }
        const temp = BB.canvas();
        if (deg === 180) {
            changeCanvasDimensions(temp, this.width, this.height);
        } else if (deg === 90 || deg === 270) {
            changeCanvasDimensions(temp, this.height, this.width);
        }
        let matrix: Matrix = identity();
        if (deg === 90) {
            matrix = compose(translate(this.height, 0), rotate(Math.PI / 2));
        } else if (deg === 180) {
            matrix = compose(translate(this.width, this.height), rotate(Math.PI));
        } else if (deg === 270) {
            matrix = compose(translate(0, this.width), rotate((3 * Math.PI) / 2));
        }
        const ctx = BB.ctx(temp);
        for (let i = 0; i < this.layers.length; i++) {
            const layer = this.layers[i];
            if (!isGroupLayer(layer)) {
                ctx.clearRect(0, 0, temp.width, temp.height);
                ctx.save();
                ctx.setTransform(...matrixToTuple(matrix));
                ctx.drawImage(layer.canvas, 0, 0);
                ctx.restore();
                changeCanvasDimensions(layer.canvas, temp.width, temp.height, {
                    ensureCleared: true,
                });
                layer.context.drawImage(temp, 0, 0);
            }
            if (layer.mask) {
                ctx.save();
                ctx.setTransform(1, 0, 0, 1, 0, 0);
                ctx.fillStyle = 'white';
                ctx.fillRect(0, 0, temp.width, temp.height);
                ctx.setTransform(...matrixToTuple(matrix));
                ctx.drawImage(layer.mask.canvas, 0, 0);
                ctx.restore();
                changeCanvasDimensions(layer.mask.canvas, temp.width, temp.height, {
                    ensureCleared: true,
                });
                layer.mask.context.drawImage(temp, 0, 0);
                layer.mask.revision++;
            }
        }
        this.width = temp.width;
        this.height = temp.height;

        if (this.selection) {
            this.selection = transformMultiPolygon(this.selection, matrix);
        }

        this.klHistory.push({
            size: {
                width: this.width,
                height: this.height,
            },
            layerMap: createLayerMap(this.layers, { attributes: ['tiles', 'mask'] }),
            ...(this.selection ? { selection: { value: this.selection } } : {}),
        });
        BB.freeCanvas(temp);
    }

    flip(isHorizontal: boolean, isVertical: boolean, layerIndex?: number): void {
        if (!isHorizontal && !isVertical) {
            return;
        }
        if (layerIndex !== undefined && !this.layers[layerIndex]) {
            return;
        }

        const range = layerIndex === undefined
            ? undefined
            : getSubtreeRange(this.layers, layerIndex);

        const temp = BB.canvas(this.width, this.height);
        changeCanvasDimensions(temp, this.width, this.height);
        const tempCtx = BB.ctx(temp);

        const matrix = compose(
            translate(temp.width / 2, temp.height / 2),
            scale(isHorizontal ? -1 : 1, isVertical ? -1 : 1),
            translate(-temp.width / 2, -temp.height / 2),
        );

        for (let i = 0; i < this.layers.length; i++) {
            if (range && (i < range.start || i > range.end)) {
                continue;
            }
            const layer = this.layers[i];
            if (!isGroupLayer(layer)) {
                tempCtx.save();
                tempCtx.clearRect(0, 0, temp.width, temp.height);
                tempCtx.setTransform(...matrixToTuple(matrix));
                tempCtx.drawImage(layer.canvas, 0, 0);
                tempCtx.restore();

                layer.context.clearRect(0, 0, layer.canvas.width, layer.canvas.height);
                layer.context.drawImage(temp, 0, 0);
            }
            if (layer.mask) {
                tempCtx.save();
                tempCtx.setTransform(1, 0, 0, 1, 0, 0);
                tempCtx.fillStyle = 'white';
                tempCtx.fillRect(0, 0, temp.width, temp.height);
                tempCtx.setTransform(...matrixToTuple(matrix));
                tempCtx.drawImage(layer.mask.canvas, 0, 0);
                tempCtx.restore();
                layer.mask.context.clearRect(0, 0, this.width, this.height);
                layer.mask.context.drawImage(temp, 0, 0);
                layer.mask.revision++;
            }
        }

        if (this.selection) {
            this.selection = transformMultiPolygon(this.selection, matrix);
        }

        const targets = range
            ? this.layers.slice(range.start, range.end + 1).map((layer) => ({
                  layerId: layer.id,
                  attributes: ['tiles', 'mask'] as ('tiles' | 'mask')[],
              }))
            : [];
        this.klHistory.push({
            layerMap: createLayerMap(
                this.layers,
                range ? { attributes: [] } : { attributes: ['tiles', 'mask'] },
                ...targets,
            ),
            ...(this.selection ? { selection: { value: this.selection } } : {}),
        });
        BB.freeCanvas(temp);
    }

    // arbitrary drawing operation & focus layer
    drawOperation(layerIndex: number, operation: (ctx: CanvasRenderingContext2D) => void): void {
        const targetLayer = this.layers[layerIndex];
        if (!targetLayer || isGroupLayer(targetLayer)) {
            return;
        }
        const ctx = targetLayer.context;
        operation(ctx);

        if (!this.klHistory.isPaused()) {
            this.klHistory.push({
                activeLayerId: targetLayer.id,
                layerMap: createLayerMap(this.layers, {
                    layerId: targetLayer.id,
                    attributes: ['tiles'],
                }),
            });
        }
    }

    layerFill(
        layerIndex: number,
        colorObj: TRgb,
        compositeOperation?: string,
        doClipSelection?: boolean,
    ): void {
        if (!this.layers[layerIndex] || isGroupLayer(this.layers[layerIndex])) {
            return;
        }
        const ctx = this.layers[layerIndex].context;
        ctx.save();
        const isUniformFill =
            !(doClipSelection && this.selection) && compositeOperation === undefined;
        if (compositeOperation) {
            ctx.globalCompositeOperation = compositeOperation as GlobalCompositeOperation;
        }

        let bounds: TIndexBounds | undefined;
        if (doClipSelection && this.selection) {
            const selectionPath = getSelectionPath2d(this.selection);
            ctx.clip(selectionPath);
            bounds = getMultiPolyBounds(this.selection, 'index');
        }

        const fill = 'rgba(' + colorObj.r + ',' + colorObj.g + ',' + colorObj.b + ',1)';
        ctx.fillStyle = fill;
        ctx.fillRect(
            0,
            0,
            this.layers[layerIndex].canvas.width,
            this.layers[layerIndex].canvas.height,
        );
        ctx.restore();

        if (!this.klHistory.isPaused()) {
            const targetLayer = this.layers[layerIndex];
            this.klHistory.push({
                layerMap: createLayerMap(this.layers, {
                    layerId: targetLayer.id,
                    attributes: ['tiles'],
                    tiles: isUniformFill
                        ? createFillColorTiles(this.width, this.height, fill)
                        : undefined,
                    bounds,
                }),
            });
        }
    }

    floodFill(
        layerIndex: number, // index of layer to be filled
        x: number, // starting point
        y: number,
        rgb: TRgb | null, // fill color, if null -> erase
        opacity: number,
        tolerance: number,
        sampleStr: TFillSampling,
        grow: number, // int >= 0 - radius around filled area that is to be filled too
        isContiguous: boolean,
    ): void {
        if (x < 0 || y < 0 || x >= this.width || y >= this.height || opacity === 0) {
            return;
        }
        tolerance = Math.round(tolerance);
        x = Math.round(x);
        y = Math.round(y);

        if (!['above', 'current', 'all'].includes(sampleStr)) {
            throw new Error('invalid sampleStr');
        }
        const selectionMask = this.selection
            ? getBinaryMask(this.selection, this.width, this.height)
            : undefined;
        if (selectionMask && selectionMask[y * this.width + x] === 0) {
            // don't fill if outside of selection
            return;
        }

        const targetLayer = this.layers[layerIndex];
        if (!targetLayer || isGroupLayer(targetLayer)) {
            return;
        }
        let result: ReturnType<typeof floodFillBits>;
        let targetCtx;
        let targetImageData;

        if (sampleStr === 'all') {
            const srcCanvas = this.layers.length === 1 ? this.layers[0].canvas : this.getCanvas();
            const srcCtx = BB.ctx(srcCanvas);
            const srcImageData = srcCtx.getImageData(0, 0, this.width, this.height);
            const srcData = srcImageData.data;
            result = floodFillBits(
                srcData,
                selectionMask,
                this.width,
                this.height,
                x,
                y,
                tolerance,
                Math.round(grow),
                isContiguous,
            );

            targetCtx = targetLayer.context;
            targetImageData = targetCtx.getImageData(0, 0, this.width, this.height);
        } else {
            const srcIndex = sampleStr === 'above' ? layerIndex + 1 : layerIndex;

            if (srcIndex >= this.layers.length) {
                return;
            }

            const srcCtx = this.layers[srcIndex].context;
            const srcImageData = srcCtx.getImageData(0, 0, this.width, this.height);
            const srcData = srcImageData.data;
            result = floodFillBits(
                srcData,
                selectionMask,
                this.width,
                this.height,
                x,
                y,
                tolerance,
                Math.round(grow),
                isContiguous,
            );

            targetCtx = layerIndex === srcIndex ? srcCtx : targetLayer.context;
            targetImageData =
                layerIndex === srcIndex
                    ? srcImageData
                    : targetCtx.getImageData(0, 0, this.width, this.height);
        }

        const targetData = targetImageData.data;
        if (rgb) {
            if (opacity === 1) {
                for (let i = 0; i < this.width * this.height; i++) {
                    if (result.data[i] === 255) {
                        targetData[i * 4] = rgb.r;
                        targetData[i * 4 + 1] = rgb.g;
                        targetData[i * 4 + 2] = rgb.b;
                        targetData[i * 4 + 3] = 255;
                    }
                }
            } else {
                for (let i = 0; i < this.width * this.height; i++) {
                    if (result.data[i] === 255) {
                        targetData[i * 4] = BB.mix(targetData[i * 4], rgb.r, opacity);
                        targetData[i * 4 + 1] = BB.mix(targetData[i * 4 + 1], rgb.g, opacity);
                        targetData[i * 4 + 2] = BB.mix(targetData[i * 4 + 2], rgb.b, opacity);
                        targetData[i * 4 + 3] = BB.mix(targetData[i * 4 + 3], 255, opacity);
                    }
                }
            }
        } else {
            // erase
            if (opacity === 1) {
                for (let i = 0; i < this.width * this.height; i++) {
                    if (result.data[i] === 255) {
                        targetData[i * 4 + 3] = 0;
                    }
                }
            } else {
                for (let i = 0; i < this.width * this.height; i++) {
                    if (result.data[i] === 255) {
                        targetData[i * 4 + 3] = BB.mix(targetData[i * 4 + 3], 0, opacity);
                    }
                }
            }
        }
        targetCtx.putImageData(targetImageData, 0, 0);

        // const ctx = this.layers[layerIndex].context;
        // ctx.save();
        // ctx.fillStyle = 'rgba(255,0,0,0.2)';
        // ctx.fillRect(
        //     result.bounds.x1,
        //     result.bounds.y1,
        //     result.bounds.x2 - result.bounds.x1,
        //     result.bounds.y2 - result.bounds.y1,
        // );
        // ctx.restore();

        if (!this.klHistory.isPaused()) {
            this.klHistory.push({
                layerMap: createLayerMap(this.layers, {
                    layerId: targetLayer.id,
                    attributes: ['tiles'],
                    bounds: result.bounds,
                }),
            });
        }
    }

    /**
     * draw geometric shape (circle, line, rect)
     * @param layerIndex
     * @param shapeObj
     */
    drawShape(layerIndex: number, shapeObj: TShapeToolObject): void {
        if (shapeObj.x1 === shapeObj.x2 && shapeObj.y1 === shapeObj.y2) {
            return;
        }
        const targetLayer = this.layers[layerIndex];
        if (!targetLayer || isGroupLayer(targetLayer)) {
            return;
        }
        const selectionPath = this.selection
            ? new Path2D(getSelectionPath2d(this.selection))
            : undefined;
        const bounds = drawShape(targetLayer.context, shapeObj, selectionPath);

        // debug
        /*const ctx = this.layers[layerIndex].context;
        ctx.save();
        ctx.fillStyle = 'rgba(255,0,0,0.2)';
        ctx.fillRect(bounds.x1, bounds.y1, bounds.x2 - bounds.x1, bounds.y2 - bounds.y1);
        ctx.restore();*/

        if (!this.klHistory.isPaused()) {
            this.klHistory.push({
                layerMap: createLayerMap(this.layers, {
                    layerId: targetLayer.id,
                    attributes: ['tiles'],
                    bounds,
                }),
            });
        }
    }

    drawGradient(layerIndex: number, gradientObj: TGradient): void {
        const targetLayer = this.layers[layerIndex];
        if (!targetLayer || isGroupLayer(targetLayer)) {
            return;
        }
        const selectionPath = this.selection
            ? new Path2D(getSelectionPath2d(this.selection))
            : undefined;
        drawGradient(targetLayer.context, gradientObj, selectionPath);
        if (!this.klHistory.isPaused()) {
            this.klHistory.push({
                layerMap: createLayerMap(this.layers, {
                    layerId: targetLayer.id,
                    attributes: ['tiles'],
                }),
            });
        }
    }

    text(layerIndex: number, p: TRenderTextParam): void {
        const targetLayer = this.layers[layerIndex];
        if (!targetLayer || isGroupLayer(targetLayer)) {
            return;
        }
        const rect = renderText(
            targetLayer.canvas,
            BB.copyObj(p),
            this.selection ? new Path2D(getSelectionPath2d(this.selection)) : undefined,
        );

        // add 2, because rect not entirely accurate
        const padding = 2 + (p.stroke ? p.stroke.lineWidth / 2 : 0);
        const changedBounds = transformCoordinateBounds(
            rectToBounds(rect, 'coordinate'),
            compose(translate(p.x, p.y), rotate(-p.angleRad)),
        );
        changedBounds.x1 -= padding;
        changedBounds.y1 -= padding;
        changedBounds.x2 += padding;
        changedBounds.y2 += padding;

        // const ctx = this.layers[layerIndex].context;
        // ctx.save();
        // ctx.fillStyle = 'rgba(255,0,0,0.2)';
        // ctx.fillRect(bounds.x1, bounds.y1, bounds.x2 - bounds.x1, bounds.y2 - bounds.y1);
        // ctx.restore();

        if (!this.klHistory.isPaused()) {
            this.klHistory.push({
                layerMap: createLayerMap(this.layers, {
                    layerId: targetLayer.id,
                    attributes: ['tiles'],
                    bounds: coordinateBoundsToIndexBounds(changedBounds),
                }),
            });
        }
    }

    eraseLayer(p: {
        layerIndex: number;
        useAlphaLock?: boolean; // default false
        useSelection?: boolean; // default false
    }): void {
        const targetLayer = this.layers[p.layerIndex];
        if (!targetLayer || isGroupLayer(targetLayer)) {
            return;
        }
        const ctx = targetLayer.context;
        ctx.save();
        let bounds: TIndexBounds | undefined;
        if (p.useSelection && this.selection) {
            const selectionPath = getSelectionPath2d(this.selection);
            ctx.clip(selectionPath);
            bounds = getMultiPolyBounds(this.selection, 'index');
        }
        if (p.useAlphaLock) {
            ctx.globalCompositeOperation = 'source-atop';
        } else {
            ctx.globalCompositeOperation = 'destination-out';
        }
        ctx.fillStyle = BB.ColorConverter.toRgbStr(getEraseColor());
        ctx.fillRect(0, 0, this.width, this.height);
        ctx.restore();

        const isUniformFill = !p.useAlphaLock && !(p.useSelection && this.selection);
        if (!this.klHistory.isPaused()) {
            this.klHistory.push({
                layerMap: createLayerMap(this.layers, {
                    layerId: targetLayer.id,
                    attributes: ['tiles'],
                    tiles: isUniformFill
                        ? createFillColorTiles(this.width, this.height, 'transparent')
                        : undefined,
                    bounds,
                }),
            });
        }
    }

    getKlHistory(): KlHistory {
        return this.klHistory;
    }

    getLayersReference(): TKlCanvasLayer[] {
        return this.layers;
    }

    getLayers(): TKlCanvasLayer[] {
        return this.layers.map((layer) => ({ ...layer }));
    }

    getLayer(index: number): TKlCanvasLayer {
        const layer = this.layers[index];
        if (!layer) {
            throw new Error(
                'layer of index ' + index + ' not found (in ' + this.layers.length + ' layers)',
            );
        }
        return { ...layer };
    }

    getColorAt(x: number, y: number): TRgb | undefined {
        let result: TRgb | undefined;
        try {
            result = this.eyedropper.getColorAt(x, y, this.klHistory.getComposed());
        } catch (_) {
            // history probably messed up. but the app should stay operational
        }
        return result;
    }

    getCanvas(
        factor: number = 1,
        masksSelection?: boolean,
        includeBackground: boolean = false,
    ): HTMLCanvasElement {
        return drawProject(
            this.getProject(),
            factor,
            masksSelection ? this.selection : undefined,
            includeBackground,
        );
    }

    getProject(): TKlProject {
        return {
            projectId: this.klHistory.getComposed().projectId.value,
            background: this.background,
            width: this.width,
            height: this.height,
            layers: this.layers.map((layer) => {
                return {
                    name: layer.name,
                    isVisible: layer.isVisible,
                    opacity: layer.opacity,
                    mixModeStr: layer.mixModeStr,
                    hasClipping: layer.hasClipping,
                    groupId: layer.groupId ?? null,
                    parentGroupId: layer.parentGroupId ?? null,
                    isExpanded: layer.isExpanded ?? true,
                    isPassThrough: layer.isPassThrough ?? false,
                    image: layer.canvas,
                    mask: layer.mask
                        ? {
                              image: layer.mask.canvas,
                              enabled: layer.mask.enabled,
                              revision: layer.mask.revision,
                          }
                        : undefined,
                };
            }),
        };
    }

    setMixMode(layerIndex: number, mixModeStr: TMixMode): void {
        const targetLayer = this.layers[layerIndex];
        targetLayer.mixModeStr = mixModeStr;
        if (isGroupLayer(targetLayer)) {
            targetLayer.isPassThrough = false;
        }

        if (!this.klHistory.isPaused()) {
            this.klHistory.push({
                layerMap: createLayerMap(this.layers, {
                    layerId: targetLayer.id,
                    attributes: ['mixModeStr', 'isPassThrough'],
                }),
            });
        }
    }

    /**
     * Set composite drawing step for KlCanvasWorkspace.
     * To apply temporary manipulations to a layer.
     *
     * @param layerIndex
     * @param compositeObj
     */
    setComposite(layerIndex: number, compositeObj: undefined | TLayerComposite): void {
        if (!this.layers[layerIndex]) {
            throw new Error('invalid layer');
        }
        this.layers[layerIndex].compositeObj = compositeObj;
    }

    setSelection(selection?: MultiPolygon): void {
        if (!this.selection && !selection) {
            return;
        }

        this.selection = selection;

        this.klHistory.push({
            selection: {
                value: selection,
            },
        });
    }

    getSelection(): KlCanvas['selection'] {
        return this.selection;
    }

    /**
     * called after undo/redo, to apply the changes to the klCanvas.
     * before - before undo/redo was called - equivalent to current state of klCanvas.
     * after - after undo/redo was called.
     */
    updateViaComposed(before: THistoryEntryDataComposed, after: THistoryEntryDataComposed): void {
        this.width = after.size.width;
        this.height = after.size.height;
        this.background = after.background ?? 'transparent';
        this.selection = after.selection.value;
        this.layers = updateLayersViaComposed(this.layers, before, after);
    }

    destroy(): void {
        if (this.isDestroyed) {
            return;
        }
        this.layers.forEach((layer) => {
            BB.freeCanvas(layer.canvas);
            if (layer.mask) {
                BB.freeCanvas(layer.mask.canvas);
            }
            layer.canvas = {} as HTMLCanvasElement;
            layer.context = {} as CanvasRenderingContext2D;
        });
        this.layers = [];
        this.eyedropper.destroy();
        this.isDestroyed = true;
    }
}
