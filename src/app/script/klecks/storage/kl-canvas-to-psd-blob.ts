import { addPsdBackground } from './psd-background';
import { KlCanvas } from '../canvas/kl-canvas';
import type { Layer, Psd } from 'ag-psd/dist/psd';
import { blendKlToPsd } from './psd';
import { psdToBlob } from './psd-to-blob';
import { attempt, AttemptError } from '../../bb/base/base';

export async function klCanvasToPsdBlob(
    klCanvas: KlCanvas,
    isPreviewIncluded: boolean = true,
): Promise<Blob> {
    const layerArr = klCanvas.getLayers();
    const groupById = new Map<string, Layer>();
    const parentById = new Map<string, string | null>();
    for (const item of layerArr) {
        if (item.groupId) {
            groupById.set(item.groupId, {
                name: item.name,
                hidden: !item.isVisible,
                opacity: item.opacity,
                blendMode: item.isPassThrough ? 'pass through' : blendKlToPsd(item.mixModeStr),
                clipping: item.hasClipping,
                opened: item.isExpanded !== false,
                children: [],
            });
            parentById.set(item.groupId, item.parentGroupId ?? null);
        }
    }

    const children: Layer[] = [];
    for (const item of layerArr) {
        const layer: Layer = item.groupId
            ? groupById.get(item.groupId)!
            : {
                  name: item.name,
                  hidden: !item.isVisible,
                  opacity: item.opacity,
                  canvas: item.canvas,
                  blendMode: blendKlToPsd(item.mixModeStr),
                  clipping: item.hasClipping,
                  left: 0,
                  top: 0,
              };
        const parentId = item.parentGroupId;
        // Corrupt or stale parent references must not silently drop a layer on export.
        let parent = parentId ? groupById.get(parentId) : undefined;
        if (parent && item.groupId) {
            const visited = new Set([item.groupId]);
            let ancestorId: string | null | undefined = parentId;
            while (ancestorId && !visited.has(ancestorId)) {
                visited.add(ancestorId);
                ancestorId = parentById.get(ancestorId);
            }
            if (ancestorId) {
                parent = undefined;
            }
        }
        (parent?.children ?? children).push(layer);
    }

    let canvas: HTMLCanvasElement | undefined;
    if (isPreviewIncluded) {
        // makes saving less likely to fail
        const c = attempt(() => klCanvas.getCanvas(1, false, true));
        if (!(c instanceof AttemptError)) {
            canvas = c;
        }
    }

    const psdConfig: Psd = {
        width: klCanvas.getWidth(),
        height: klCanvas.getHeight(),
        canvas,
        children,
    };

    if (klCanvas.getBackground() === 'white') {
        addPsdBackground(psdConfig);
    }
    return await psdToBlob(psdConfig);
}
