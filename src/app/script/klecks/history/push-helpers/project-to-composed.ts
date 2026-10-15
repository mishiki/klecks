import { isLayerFill, TKlProject, TKlProjectLayer } from '../../kl-types';
import { THistoryEntryDataComposed, THistoryEntryLayerTile } from '../history.types';
import { canvasToLayerTiles } from './canvas-to-layer-tiles';
import { getNextLayerId } from '../get-next-layer-id';
import { BB } from '../../../bb/bb';
import { isGroupLayer } from '../../canvas/layer-tree';
import { createFillColorTiles } from '../create-fill-color-tiles';

export function projectToComposed(project: TKlProject): THistoryEntryDataComposed {
    let lastId: string = '';
    let lastPaintId: string = '';
    const layers: TKlProjectLayer[] = project.layers.some((layer) => !isGroupLayer(layer))
        ? project.layers
        : [
              ...project.layers,
              {
                  name: 'Layer 1',
                  opacity: 1,
                  isVisible: true,
                  mixModeStr: 'source-over' as const,
                  hasClipping: false,
                  image: { fill: 'transparent' },
              },
          ];
    const layerMap = Object.fromEntries(
        layers.map((layer, index) => {
            lastId = getNextLayerId();
            if (!isGroupLayer(layer)) {
                lastPaintId = lastId;
            }
            let tiles: THistoryEntryLayerTile[] = [];
            const image = layer.image;

            if (isGroupLayer(layer)) {
                tiles = createFillColorTiles(project.width, project.height, 'transparent');
            } else if (image instanceof Array) {
                tiles = [...image];
            } else if (isLayerFill(image)) {
                tiles = createFillColorTiles(project.width, project.height, image.fill);
            } else {
                const canvas = (() => {
                    if (image instanceof HTMLCanvasElement) {
                        return image;
                    }
                    const canvas = BB.canvas(project.width, project.height);
                    const ctx = BB.ctx(canvas);
                    ctx.drawImage(image, 0, 0);
                    return canvas;
                })();
                tiles = canvasToLayerTiles(canvas);
            }

            let mask: { enabled: boolean; tiles: THistoryEntryLayerTile[] } | null = null;
            if (layer.mask) {
                const maskImage = layer.mask.image;
                let maskTiles: THistoryEntryLayerTile[];
                if (maskImage instanceof Array) {
                    maskTiles = [...maskImage];
                } else if (isLayerFill(maskImage)) {
                    maskTiles = createFillColorTiles(project.width, project.height, maskImage.fill);
                } else {
                    const maskCanvas = BB.canvas(project.width, project.height);
                    const maskContext = BB.ctx(maskCanvas);
                    maskContext.fillStyle = 'white';
                    maskContext.fillRect(0, 0, project.width, project.height);
                    maskContext.drawImage(maskImage, 0, 0);
                    const data = maskContext.getImageData(0, 0, project.width, project.height);
                    for (let i = 0; i < data.data.length; i += 4) {
                        const gray = Math.round(
                            data.data[i] * 0.2126 +
                            data.data[i + 1] * 0.7152 +
                            data.data[i + 2] * 0.0722,
                        );
                        data.data[i] = gray;
                        data.data[i + 1] = gray;
                        data.data[i + 2] = gray;
                        data.data[i + 3] = 255;
                    }
                    maskContext.putImageData(data, 0, 0);
                    maskTiles = canvasToLayerTiles(maskCanvas);
                    BB.freeCanvas(maskCanvas);
                }
                mask = { enabled: layer.mask.enabled, tiles: maskTiles };
            }

            return [
                lastId,
                {
                    name: layer.name,
                    opacity: layer.opacity,
                    isVisible: layer.isVisible,
                    mixModeStr: layer.mixModeStr,
                    hasClipping: layer.hasClipping,
                    groupId: layer.groupId ?? null,
                    parentGroupId: layer.parentGroupId ?? null,
                    isExpanded: layer.isExpanded ?? true,
                    isPassThrough: layer.isPassThrough ?? false,
                    index,
                    tiles,
                    mask,
                },
            ];
        }),
    );
    return {
        background: project.background ?? 'transparent',
        projectId: {
            value: project.projectId,
        },
        size: {
            width: project.width,
            height: project.height,
        },
        selection: {},
        activeLayerId: lastPaintId || lastId,
        layerMap,
    };
}
