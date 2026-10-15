import { isLayerFill } from '../kl-types';
import { THistoryEntryData } from './history.types';
import { HISTORY_TILE_SIZE } from './kl-history';
import { getTileSizeFromIndex } from './image-data-tile';
import { asyncThrow } from '../../bb/base/base';

// creates some visibility for problems with history entries.
export function validateHistoryEntry(
    entryData: THistoryEntryData,
    previousSize: { width: number; height: number },
): void {
    if (
        entryData.background !== undefined &&
        entryData.background !== 'white' &&
        entryData.background !== 'transparent'
    ) {
        asyncThrow(new Error('[KlHistory] Invalid background value'));
        return;
    }
    const size = entryData.size ?? previousSize;
    const tilesX = Math.ceil(size.width / HISTORY_TILE_SIZE);
    const tilesY = Math.ceil(size.height / HISTORY_TILE_SIZE);
    const expectedTileCount = tilesX * tilesY;

    const layerEntries = Object.entries(entryData.layerMap ?? {});
    for (let layerIndex = 0; layerIndex < layerEntries.length; layerIndex++) {
        const [layerId, layer] = layerEntries[layerIndex];
        for (const [kind, tiles] of [['layer', layer.tiles], ['mask', layer.mask?.tiles]] as const) {
            if (tiles === undefined) {
                continue;
            }
            if (tiles.length !== expectedTileCount) {
                const err = `[KlHistory] Invalid tile count for ${kind} "${layerId}": expected ${expectedTileCount}, got ${tiles.length}`;
                asyncThrow(new Error(err));
                return;
            }

            for (let tileIndex = 0; tileIndex < tiles.length; tileIndex++) {
                const tile = tiles[tileIndex];
                if (tile === undefined || isLayerFill(tile)) {
                    continue;
                }
                const tileSize = getTileSizeFromIndex(tileIndex, size);
                if (tile.data.width !== tileSize.width || tile.data.height !== tileSize.height) {
                    const err = `[KlHistory] Invalid tile dimensions for ${kind} "${layerId}" at index ${tileIndex}: expected ${tileSize.width}x${tileSize.height}, got ${tile.data.width}x${tile.data.height}`;
                    asyncThrow(new Error(err));
                    return;
                }
            }
        }
    }
}
