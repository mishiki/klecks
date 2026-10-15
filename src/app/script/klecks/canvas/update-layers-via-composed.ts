import { HISTORY_TILE_SIZE } from '../history/kl-history';
import { TKlCanvasLayer } from './kl-canvas';
import { THistoryEntryDataComposed, THistoryEntryLayerTile } from '../history/history.types';
import { BB } from '../../bb/bb';
import { sortLayerMap } from '../history/sort-layer-map';
import { isLayerFill } from '../kl-types';
import { isGroupLayer } from './layer-tree';

function drawTile(
    context: CanvasRenderingContext2D,
    item: THistoryEntryLayerTile,
    index: number,
    tilesPerX: number,
    clearExisting: boolean,
): void {
    const x = (index % tilesPerX) * HISTORY_TILE_SIZE;
    const y = Math.floor(index / tilesPerX) * HISTORY_TILE_SIZE;
    if (isLayerFill(item)) {
        context.save();
        context.fillStyle = item.fill;
        if (clearExisting) {
            context.clearRect(x, y, HISTORY_TILE_SIZE, HISTORY_TILE_SIZE);
        }
        context.fillRect(x, y, HISTORY_TILE_SIZE, HISTORY_TILE_SIZE);
        context.restore();
    } else {
        context.putImageData(item.data, x, y);
    }
}

/**
 * Applies history delta to the project, optimized for performance.
 * note: modifies the canvases in project
 */
export function updateLayersViaComposed(
    layers: TKlCanvasLayer[],
    before: THistoryEntryDataComposed,
    after: THistoryEntryDataComposed,
): TKlCanvasLayer[] {
    const sizeDidChange =
        before.size.width !== after.size.width || before.size.height !== after.size.height;

    const updatedLayers = Object.entries(after.layerMap)
        .map(([id, composedAfterLayer]) => {
            let canvas = {} as HTMLCanvasElement;
            let context = {} as CanvasRenderingContext2D;
            const composedBeforeLayer = before.layerMap[id];
            const previous = composedBeforeLayer && layers[composedBeforeLayer.index];
            const tilesPerX = Math.ceil(after.size.width / HISTORY_TILE_SIZE);

            if (isGroupLayer(composedAfterLayer)) {
                canvas = previous && isGroupLayer(composedBeforeLayer)
                    ? previous.canvas
                    : BB.canvas(1, 1);
                context = BB.ctx(canvas);
            } else if (sizeDidChange || !composedBeforeLayer || isGroupLayer(composedBeforeLayer)) {
                // create new canvas
                canvas = BB.canvas(after.size.width, after.size.height);
                context = BB.ctx(canvas);

                composedAfterLayer.tiles.forEach((item, index) => {
                    drawTile(context, item, index, tilesPerX, false);
                });
            } else {
                canvas = layers[composedBeforeLayer.index].canvas;
                context = layers[composedBeforeLayer.index].context;
                composedAfterLayer.tiles.forEach((item, index) => {
                    if (item === composedBeforeLayer.tiles[index]) {
                        // todo more advanced check ^
                        return;
                    }
                    drawTile(context, item, index, tilesPerX, true);
                });
            }

            let mask: TKlCanvasLayer['mask'];
            const afterMask = composedAfterLayer.mask;
            const beforeMask = composedBeforeLayer?.mask;
            if (afterMask) {
                const reuse = !sizeDidChange && !!beforeMask && !!previous?.mask;
                const maskCanvas = reuse
                    ? previous!.mask!.canvas
                    : BB.canvas(after.size.width, after.size.height);
                const maskContext = reuse ? previous!.mask!.context : BB.ctx(maskCanvas);
                const pixelsChanged = !reuse || afterMask.tiles.some(
                    (tile, index) => tile !== beforeMask!.tiles[index],
                );
                if (pixelsChanged) {
                    afterMask.tiles.forEach((tile, index) => {
                        if (!reuse || tile !== beforeMask!.tiles[index]) {
                            drawTile(maskContext, tile, index, tilesPerX, reuse);
                        }
                    });
                }
                const enabledChanged = !beforeMask || afterMask.enabled !== beforeMask.enabled;
                mask = {
                    canvas: maskCanvas,
                    context: maskContext,
                    enabled: afterMask.enabled,
                    revision: (previous?.mask?.revision ?? 0) +
                        (pixelsChanged || enabledChanged ? 1 : 0),
                };
            }

            return {
                id,
                index: composedAfterLayer.index,
                name: composedAfterLayer.name,
                mixModeStr: composedAfterLayer.mixModeStr,
                hasClipping: composedAfterLayer.hasClipping,
                isVisible: composedAfterLayer.isVisible,
                opacity: composedAfterLayer.opacity,
                groupId: composedAfterLayer.groupId,
                parentGroupId: composedAfterLayer.parentGroupId,
                isExpanded: composedAfterLayer.isExpanded,
                isPassThrough: composedAfterLayer.isPassThrough,
                canvas,
                context,
                mask,
            };
        })
        .sort(sortLayerMap);

    const retainedMasks = new Set(updatedLayers.map((layer) => layer.mask?.canvas));
    layers.forEach((layer) => {
        if (layer.mask && !retainedMasks.has(layer.mask.canvas)) {
            BB.freeCanvas(layer.mask.canvas);
        }
    });
    return updatedLayers;
}
