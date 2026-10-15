import { drawBlended } from './draw-blended';
import { createCanvas } from '../../bb/base/create-canvas';
import { ctx, freeCanvas } from '../../bb/base/canvas';
import { changeCanvasDimensions } from '../../bb/base/change-canvas-dimensions';
import type { TKlLayer } from '../kl-types';
import { getClippingGroups } from './get-clipping-groups';

type TCompositeLayer = Omit<TKlLayer<unknown>, 'image'>;
type TDrawLayer<L> = (target: CanvasRenderingContext2D, layer: L) => void;
type TNode<L> = { layer: L; children: TNode<L>[]; hasClipping: boolean };

// Scratch surfaces are leased through recursion: a child must never overwrite its parent.
export class LayerCompositor {
    private canvases: HTMLCanvasElement[] = [];
    private depth = 0;

    private surface<T>(width: number, height: number, use: (canvas: HTMLCanvasElement) => T): T {
        const index = this.depth++;
        const canvas = (this.canvases[index] ??= createCanvas(width, height));
        changeCanvasDimensions(canvas, width, height, { ensureCleared: true });
        try {
            return use(canvas);
        } finally {
            this.depth--;
        }
    }

    draw<L extends TCompositeLayer>(
        target: CanvasRenderingContext2D,
        layers: readonly L[],
        width: number,
        height: number,
        drawLayer: TDrawLayer<L>,
    ): void {
        const nodes: TNode<L>[] = layers.map((layer) => ({ layer, children: [], hasClipping: layer.hasClipping }));
        const folders = new Map<string, TNode<L>>();
        nodes.forEach((node) => { if (node.layer.groupId) folders.set(node.layer.groupId, node); });
        const indices = new Map(nodes.map((node, index) => [node, index]));
        const roots: TNode<L>[] = [];
        nodes.forEach((node) => {
            const parent = node.layer.parentGroupId && folders.get(node.layer.parentGroupId);
            // Valid postorder requires the parent to occur after its descendants, ruling out cycles.
            if (parent && indices.get(parent)! > indices.get(node)!) parent.children.push(node);
            else roots.push(node);
        });

        const content = (context: CanvasRenderingContext2D, node: TNode<L>): void => {
            if (node.layer.groupId) siblings(context, node.children);
            else drawLayer(context, node.layer);
        };
        const isolated = (node: TNode<L>, use: (image: HTMLCanvasElement) => void): void => {
            this.surface(width, height, (image) => {
                const context = ctx(image);
                context.save();
                try {
                    content(context, node);
                } finally {
                    context.restore();
                }
                use(image);
            });
        };
        const paint = (context: CanvasRenderingContext2D, node: TNode<L>): void => {
            const layer = node.layer;
            if (!layer.isVisible || layer.opacity === 0) return;
            const mode = layer.isPassThrough ? 'source-over' : layer.mixModeStr;
            if (layer.groupId) {
                isolated(node, (image) => drawBlended(context, mode, layer.opacity, (c) => c.drawImage(image, 0, 0)));
            } else {
                drawBlended(context, mode, layer.opacity, (c) => drawLayer(c, layer));
            }
        };
        const passThrough = (context: CanvasRenderingContext2D, node: TNode<L>): void => {
            if (node.layer.opacity === 1) {
                siblings(context, node.children);
                return;
            }
            // Interpolate premultiplied results, including alpha, instead of putting an opaque
            // copy of the backdrop over itself. Work in the target's pixel coordinates.
            this.surface(context.canvas.width, context.canvas.height, (image) => {
                const c = ctx(image);
                c.drawImage(context.canvas, 0, 0);
                c.setTransform(context.getTransform());
                siblings(c, node.children);
                c.resetTransform();
                c.globalCompositeOperation = 'destination-in';
                c.globalAlpha = node.layer.opacity;
                c.fillStyle = '#000';
                c.fillRect(0, 0, image.width, image.height);
                c.globalCompositeOperation = 'lighter';
                c.globalAlpha = 1 - node.layer.opacity;
                c.drawImage(context.canvas, 0, 0);
                c.globalAlpha = 1;
                c.globalCompositeOperation = 'source-over';
                context.save();
                context.resetTransform();
                context.globalAlpha = 1;
                context.globalCompositeOperation = 'copy';
                context.drawImage(image, 0, 0);
                context.restore();
            });
        };
        const siblings = (context: CanvasRenderingContext2D, children: TNode<L>[]): void => {
            for (const stack of getClippingGroups(children)) {
                const base = stack[0];
                if (!base.layer.isVisible || base.layer.opacity === 0) continue;
                if (stack.length === 1) {
                    if (base.layer.groupId && base.layer.isPassThrough) passThrough(context, base);
                    else paint(context, base);
                    continue;
                }
                // Render the base once: repeated masks would otherwise multiply work in nested groups.
                isolated(base, (mask) => this.surface(width, height, (image) => {
                    const c = ctx(image);
                    // Base mode is applied once when the completed clipping stack meets its backdrop.
                    drawBlended(c, 'source-over', base.layer.opacity, (out) => out.drawImage(mask, 0, 0));
                    stack.slice(1).forEach((node) => paint(c, node));
                    // Restore the base alpha, exactly as for ordinary clipping layers.
                    drawBlended(c, 'destination-atop', base.layer.opacity,
                        (maskCtx) => maskCtx.drawImage(mask, 0, 0));
                    drawBlended(context, base.layer.isPassThrough ? 'source-over' : base.layer.mixModeStr, 1, (out) => out.drawImage(image, 0, 0));
                }));
            }
        };
        siblings(target, roots);
    }

    merge<L extends TCompositeLayer>(
        bottomCtx: CanvasRenderingContext2D,
        bottomLayer: L,
        topLayer: L,
        drawLayer: TDrawLayer<L>,
    ): boolean {
        const clipped = topLayer.hasClipping && !bottomLayer.hasClipping;
        if (!topLayer.isVisible || topLayer.opacity === 0 ||
            (clipped && (!bottomLayer.isVisible || bottomLayer.opacity === 0))) return false;
        if (clipped) {
            this.surface(bottomCtx.canvas.width, bottomCtx.canvas.height, (image) => {
                this.draw(ctx(image), [{ ...bottomLayer, opacity: 1, mixModeStr: 'source-over' }, topLayer],
                    image.width, image.height, drawLayer);
                bottomCtx.save();
                bottomCtx.globalCompositeOperation = 'copy';
                bottomCtx.globalAlpha = 1;
                bottomCtx.drawImage(image, 0, 0);
                bottomCtx.restore();
            });
        } else {
            this.draw(bottomCtx, [topLayer], bottomCtx.canvas.width, bottomCtx.canvas.height, drawLayer);
        }
        return true;
    }

    destroy(): void {
        this.canvases.forEach(freeCanvas);
        this.canvases = [];
    }
}
