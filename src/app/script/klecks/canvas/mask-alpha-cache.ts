import { createCanvas } from '../../bb/base/create-canvas';
import { ctx, freeCanvas } from '../../bb/base/canvas';
import { isLayerFill } from '../kl-types';

export type TRenderMask = {
    image?: unknown;
    canvas?: HTMLCanvasElement;
    enabled: boolean;
    revision?: number;
};

// Cache alpha conversion until the editor changes the grayscale mask. This avoids pixel
// readback on every viewport frame while preserving the editable grayscale source.
export class MaskAlphaCache {
    private entries = new Map<object, { revision: number; width: number; height: number; image: HTMLCanvasElement }>();

    retain(masks: (TRenderMask | null | undefined)[]): void {
        const sources = new Set(masks.filter((mask) => mask?.enabled).map((mask) => mask!.image ?? mask!.canvas));
        for (const [source, entry] of this.entries) {
            if (!sources.has(source)) {
                freeCanvas(entry.image);
                this.entries.delete(source);
            }
        }
    }

    get(mask: TRenderMask, width: number, height: number): HTMLCanvasElement {
        const source = mask.image ?? mask.canvas;
        if (!source || typeof source !== 'object') throw new Error('Invalid mask image');
        const revision = mask.revision ?? 0;
        const previous = this.entries.get(source);
        if (previous && previous.revision === revision && previous.width === width && previous.height === height) return previous.image;
        const image = previous?.image ?? createCanvas(width, height);
        image.width = width;
        image.height = height;
        const target = ctx(image);
        if (isLayerFill(source)) {
            target.fillStyle = source.fill;
            target.fillRect(0, 0, width, height);
        } else {
            target.drawImage(source as CanvasImageSource, 0, 0, width, height);
        }
        // Bounded strips avoid an additional full-image RGBA allocation for large documents.
        for (let y = 0; y < height; y += 64) {
            const pixels = target.getImageData(0, y, width, Math.min(64, height - y));
            const data = pixels.data;
            for (let i = 0; i < data.length; i += 4) {
                const gray = Math.round(data[i] * 0.2126 + data[i + 1] * 0.7152 + data[i + 2] * 0.0722);
                data[i + 3] = Math.round(gray * data[i + 3] / 255);
                data[i] = data[i + 1] = data[i + 2] = 255;
            }
            target.putImageData(pixels, 0, y);
        }
        this.entries.set(source, { revision, width, height, image });
        return image;
    }

    destroy(): void {
        this.entries.forEach((entry) => freeCanvas(entry.image));
        this.entries.clear();
    }
}
