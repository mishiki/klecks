import { createCanvas } from '../../bb/base/create-canvas';
import { freeCanvas } from '../../bb/base/canvas';
import type { TMixMode } from '../kl-types';

const CUSTOM_MODES = [
    'linear-burn',
    'linear-dodge',
    'linear-light',
    'vivid-light',
    'pin-light',
    'hard-mix',
    'darker-color',
    'lighter-color',
    'subtract',
    'divide',
] as const;
export type TCustomMode = (typeof CUSTOM_MODES)[number];
const customModeIndex = new Map<string, number>(CUSTOM_MODES.map((mode, index) => [mode, index]));

let sourceCanvas: HTMLCanvasElement | undefined;
let sourceContext: CanvasRenderingContext2D | undefined;
let activeCustomDraws = 0;

type TSource = { canvas: HTMLCanvasElement; context: CanvasRenderingContext2D };

type TGpu = {
    canvas: HTMLCanvasElement;
    gl: WebGLRenderingContext;
    program?: WebGLProgram;
    buffer?: WebGLBuffer;
    backdropTexture?: WebGLTexture;
    sourceTexture?: WebGLTexture;
    backdropLocation?: WebGLUniformLocation;
    sourceLocation?: WebGLUniformLocation;
    modeLocation?: WebGLUniformLocation;
    opacityLocation?: WebGLUniformLocation;
    positionLocation?: number;
    ready: boolean;
};

let gpu: TGpu | undefined;
let gpuUnavailable = false;

const VERTEX_SHADER = `
    attribute vec2 a_position;
    varying vec2 v_uv;
    void main() {
        gl_Position = vec4(a_position, 0.0, 1.0);
        v_uv = (a_position + 1.0) * 0.5;
    }
`;

const FRAGMENT_SHADER = `
    precision highp float;
    varying vec2 v_uv;
    uniform sampler2D u_backdrop;
    uniform sampler2D u_source;
    uniform int u_mode;
    uniform float u_opacity;

    float burn(float b, float s) {
        if (b >= 1.0) return 1.0;
        if (s <= 0.0) return 0.0;
        return max(0.0, 1.0 - (1.0 - b) / s);
    }
    float dodge(float b, float s) {
        if (b <= 0.0) return 0.0;
        if (s >= 1.0) return 1.0;
        return min(1.0, b / (1.0 - s));
    }
    float vivid(float b, float s) {
        return s < 0.5 ? burn(b, 2.0 * s) : dodge(b, 2.0 * s - 1.0);
    }
    float channel(float b, float s) {
        if (u_mode == 0) return max(0.0, b + s - 1.0);
        if (u_mode == 1) return min(1.0, b + s);
        if (u_mode == 2) return clamp(b + 2.0 * s - 1.0, 0.0, 1.0);
        if (u_mode == 3) return vivid(b, s);
        if (u_mode == 4) return s < 0.5 ? min(b, 2.0 * s) : max(b, 2.0 * s - 1.0);
        if (u_mode == 5) return step(1.0, b + s);
        if (u_mode == 8) return max(0.0, b - s);
        // Define 0/0 as 0; division by a zero source otherwise saturates to 1.
        if (u_mode == 9) return s <= 0.0 ? (b <= 0.0 ? 0.0 : 1.0) : min(1.0, b / s);
        return b;
    }
    vec3 blend(vec3 b, vec3 s) {
        if (u_mode == 6) return dot(s, vec3(1.0)) < dot(b, vec3(1.0)) ? s : b;
        if (u_mode == 7) return dot(s, vec3(1.0)) > dot(b, vec3(1.0)) ? s : b;
        return vec3(channel(b.r, s.r), channel(b.g, s.g), channel(b.b, s.b));
    }
    void main() {
        vec4 backdrop = texture2D(u_backdrop, v_uv);
        vec4 source = texture2D(u_source, v_uv);
        float ab = backdrop.a;
        float asrc = source.a * u_opacity;
        float a = asrc + ab * (1.0 - asrc);
        vec3 premultiplied =
            (1.0 - asrc) * ab * backdrop.rgb +
            (1.0 - ab) * asrc * source.rgb +
            asrc * ab * blend(backdrop.rgb, source.rgb);
        gl_FragColor = vec4(premultiplied, a);
    }
`;

function getSource(target: CanvasRenderingContext2D, temporary: boolean): TSource {
    const { width, height } = target.canvas;
    if (temporary) {
        const canvas = createCanvas(width, height);
        const context = canvas.getContext('2d');
        if (!context) throw new Error('Could not create blend source context');
        return { canvas, context };
    }
    if (!sourceCanvas) {
        sourceCanvas = createCanvas(width, height);
        sourceContext = sourceCanvas.getContext('2d') ?? undefined;
        if (!sourceContext) {
            throw new Error('Could not create blend source context');
        }
    } else if (sourceCanvas.width !== width || sourceCanvas.height !== height) {
        sourceCanvas.width = width;
        sourceCanvas.height = height;
    }
    return { canvas: sourceCanvas, context: sourceContext! };
}

function compileShader(gl: WebGLRenderingContext, type: number, source: string): WebGLShader {
    const shader = gl.createShader(type);
    if (!shader) throw new Error('Could not create blend shader');
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
        const reason = gl.getShaderInfoLog(shader);
        gl.deleteShader(shader);
        throw new Error(`Could not compile blend shader: ${reason}`);
    }
    return shader;
}

function makeTexture(gl: WebGLRenderingContext): WebGLTexture {
    const texture = gl.createTexture();
    if (!texture) throw new Error('Could not create blend texture');
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    return texture;
}

function prepareGpu(state: TGpu): void {
    if (state.ready) return;
    const { gl } = state;
    const vertex = compileShader(gl, gl.VERTEX_SHADER, VERTEX_SHADER);
    const fragment = compileShader(gl, gl.FRAGMENT_SHADER, FRAGMENT_SHADER);
    const program = gl.createProgram();
    if (!program) throw new Error('Could not create blend program');
    gl.attachShader(program, vertex);
    gl.attachShader(program, fragment);
    gl.linkProgram(program);
    gl.deleteShader(vertex);
    gl.deleteShader(fragment);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
        const reason = gl.getProgramInfoLog(program);
        gl.deleteProgram(program);
        throw new Error(`Could not link blend program: ${reason}`);
    }
    const positionLocation = gl.getAttribLocation(program, 'a_position');
    const backdropLocation = gl.getUniformLocation(program, 'u_backdrop');
    const sourceLocation = gl.getUniformLocation(program, 'u_source');
    const modeLocation = gl.getUniformLocation(program, 'u_mode');
    const opacityLocation = gl.getUniformLocation(program, 'u_opacity');
    const buffer = gl.createBuffer();
    if (
        positionLocation < 0 || !backdropLocation || !sourceLocation ||
        !modeLocation || !opacityLocation || !buffer
    ) {
        throw new Error('Could not initialize blend program');
    }
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(
        gl.ARRAY_BUFFER,
        new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]),
        gl.STATIC_DRAW,
    );
    state.program = program;
    state.buffer = buffer;
    state.backdropTexture = makeTexture(gl);
    state.sourceTexture = makeTexture(gl);
    state.positionLocation = positionLocation;
    state.backdropLocation = backdropLocation;
    state.sourceLocation = sourceLocation;
    state.modeLocation = modeLocation;
    state.opacityLocation = opacityLocation;
    state.ready = true;
}

function getGpu(): TGpu | undefined {
    if (gpuUnavailable) return;
    if (gpu) return gpu;
    try {
        const canvas = createCanvas();
        const gl = canvas.getContext('webgl', {
            alpha: true,
            premultipliedAlpha: true,
            preserveDrawingBuffer: true,
            antialias: false,
            depth: false,
            stencil: false,
        });
        if (!gl) {
            gpuUnavailable = true;
            return;
        }
        gpu = { canvas, gl, ready: false };
        canvas.addEventListener('webglcontextlost', (event) => {
            event.preventDefault();
            if (gpu?.canvas === canvas) gpu.ready = false;
        });
        return gpu;
    } catch (_) {
        gpuUnavailable = true;
    }
}

function renderGpu(
    target: CanvasRenderingContext2D,
    source: HTMLCanvasElement,
    modeIndex: number,
    opacity: number,
): HTMLCanvasElement | undefined {
    const state = getGpu();
    if (!state) return;
    const { gl, canvas } = state;
    if (gl.isContextLost()) return;
    const { width, height } = target.canvas;
    try {
        const viewport = gl.getParameter(gl.MAX_VIEWPORT_DIMS) as Int32Array | null;
        const maxTextureSize = gl.getParameter(gl.MAX_TEXTURE_SIZE) as number | null;
        if (
            !viewport || !maxTextureSize ||
            width > maxTextureSize || height > maxTextureSize ||
            width > viewport[0] || height > viewport[1]
        ) return;
        prepareGpu(state);
        if (canvas.width !== width) canvas.width = width;
        if (canvas.height !== height) canvas.height = height;
        if (gl.drawingBufferWidth !== width || gl.drawingBufferHeight !== height) return;
        gl.viewport(0, 0, width, height);
        gl.disable(gl.BLEND);
        gl.disable(gl.DITHER);
        gl.disable(gl.SCISSOR_TEST);
        gl.disable(gl.DEPTH_TEST);
        gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
        gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
        gl.pixelStorei(gl.UNPACK_COLORSPACE_CONVERSION_WEBGL, gl.NONE);
        gl.useProgram(state.program!);
        gl.bindBuffer(gl.ARRAY_BUFFER, state.buffer!);
        gl.enableVertexAttribArray(state.positionLocation!);
        gl.vertexAttribPointer(state.positionLocation!, 2, gl.FLOAT, false, 0, 0);
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, state.backdropTexture!);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, target.canvas);
        gl.uniform1i(state.backdropLocation!, 0);
        gl.activeTexture(gl.TEXTURE1);
        gl.bindTexture(gl.TEXTURE_2D, state.sourceTexture!);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source);
        gl.uniform1i(state.sourceLocation!, 1);
        gl.uniform1i(state.modeLocation!, modeIndex);
        gl.uniform1f(state.opacityLocation!, opacity);
        gl.drawArrays(gl.TRIANGLES, 0, 6);
        if (gl.isContextLost() || gl.getError() !== gl.NO_ERROR) return;
        return canvas;
    } catch (_) {
        if (!gl.isContextLost()) gpuUnavailable = true;
    }
}

function clamp(value: number): number {
    return Math.max(0, Math.min(1, value));
}

function burn(base: number, source: number): number {
    if (base >= 1) return 1;
    if (source <= 0) return 0;
    return Math.max(0, 1 - (1 - base) / source);
}

function dodge(base: number, source: number): number {
    if (base <= 0) return 0;
    if (source >= 1) return 1;
    return Math.min(1, base / (1 - source));
}

function vivid(base: number, source: number): number {
    return source < 0.5 ? burn(base, 2 * source) : dodge(base, 2 * source - 1);
}

function blendChannel(base: number, source: number, mode: TCustomMode): number {
    switch (mode) {
        case 'linear-burn': return Math.max(0, base + source - 1);
        case 'linear-dodge': return Math.min(1, base + source);
        case 'linear-light': return clamp(base + 2 * source - 1);
        case 'vivid-light': return vivid(base, source);
        case 'pin-light': return source < 0.5 ? Math.min(base, 2 * source) : Math.max(base, 2 * source - 1);
        case 'hard-mix': return base + source >= 1 ? 1 : 0;
        case 'subtract': return Math.max(0, base - source);
        // Zero over zero follows the same explicit convention as the shader.
        case 'divide': return source <= 0 ? (base <= 0 ? 0 : 1) : Math.min(1, base / source);
        default: return base;
    }
}

/** Composites one straight RGBA pixel. Input channels are 0–255; output is straight RGBA. */
export function compositeRgba(
    backdrop: ArrayLike<number>,
    source: ArrayLike<number>,
    mode: TCustomMode,
    opacity: number,
    offset = 0,
    output?: [number, number, number, number],
): [number, number, number, number] {
    const result: [number, number, number, number] = output ?? [0, 0, 0, 0];
    const ab = backdrop[offset + 3] / 255;
    const asrc = (source[offset + 3] / 255) * opacity;
    const a = asrc + ab * (1 - asrc);
    if (a === 0) {
        result[0] = result[1] = result[2] = result[3] = 0;
        return result;
    }
    const backdropSum = backdrop[offset] + backdrop[offset + 1] + backdrop[offset + 2];
    const sourceSum = source[offset] + source[offset + 1] + source[offset + 2];
    const wholeColorFromSource = mode === 'darker-color'
        ? sourceSum < backdropSum
        : mode === 'lighter-color' && sourceSum > backdropSum;
    for (let index = 0; index < 3; index++) {
        const b = backdrop[offset + index] / 255;
        const s = source[offset + index] / 255;
        const blended = mode === 'darker-color' || mode === 'lighter-color'
            ? (wholeColorFromSource ? s : b)
            : blendChannel(b, s, mode);
        const premultiplied =
            (1 - asrc) * ab * b +
            (1 - ab) * asrc * s +
            asrc * ab * blended;
        result[index] = (premultiplied / a) * 255;
    }
    result[3] = a * 255;
    return result;
}

function renderCpu(
    target: CanvasRenderingContext2D,
    source: TSource,
    mode: TCustomMode,
    opacity: number,
): HTMLCanvasElement {
    const { width, height } = target.canvas;
    const pixelResult: [number, number, number, number] = [0, 0, 0, 0];
    // The source canvas becomes the result, one strip at a time. Already processed
    // strips are never sampled again, so only two small ImageData buffers are live.
    for (let y = 0; y < height; y += 64) {
        const rows = Math.min(64, height - y);
        const backdrop = target.getImageData(0, y, width, rows).data;
        const sourceImage = source.context.getImageData(0, y, width, rows);
        const pixels = sourceImage.data;
        for (let i = 0; i < pixels.length; i += 4) {
            const result = compositeRgba(backdrop, pixels, mode, opacity, i, pixelResult);
            pixels[i] = result[0];
            pixels[i + 1] = result[1];
            pixels[i + 2] = result[2];
            pixels[i + 3] = result[3];
        }
        source.context.putImageData(sourceImage, 0, y);
    }
    return source.canvas;
}

function copyIntoTarget(target: CanvasRenderingContext2D, canvas: HTMLCanvasElement): void {
    // Keep the target's clip, but copy every pixel (including transparent ones).
    target.save();
    try {
        target.resetTransform();
        target.globalCompositeOperation = 'copy';
        target.globalAlpha = 1;
        target.filter = 'none';
        target.shadowColor = 'transparent';
        target.shadowBlur = 0;
        target.shadowOffsetX = 0;
        target.shadowOffsetY = 0;
        target.drawImage(canvas, 0, 0);
    } finally {
        target.restore();
    }
}

export function drawBlended(
    target: CanvasRenderingContext2D,
    mode: TMixMode | GlobalCompositeOperation,
    opacity: number,
    drawSource: (ctx: CanvasRenderingContext2D) => void,
): void {
    const modeIndex = customModeIndex.get(mode);
    if (modeIndex === undefined) {
        target.save();
        try {
            target.globalAlpha = opacity;
            target.globalCompositeOperation = mode as GlobalCompositeOperation;
            drawSource(target);
        } finally {
            target.restore();
        }
        return;
    }

    const temporary = activeCustomDraws > 0;
    const source = getSource(target, temporary);
    const { width, height } = target.canvas;
    activeCustomDraws++;
    try {
        source.context.save();
        source.context.resetTransform();
        source.context.clearRect(0, 0, width, height);
        source.context.restore();
        source.context.save();
        try {
            source.context.setTransform(target.getTransform());
            source.context.imageSmoothingEnabled = target.imageSmoothingEnabled;
            source.context.imageSmoothingQuality = target.imageSmoothingQuality;
            source.context.globalAlpha = 1;
            source.context.globalCompositeOperation = 'source-over';
            drawSource(source.context);
        } finally {
            source.context.restore();
        }

        const effectiveOpacity = clamp(opacity);
        const result = renderGpu(target, source.canvas, modeIndex, effectiveOpacity) ??
            renderCpu(target, source, CUSTOM_MODES[modeIndex], effectiveOpacity);
        copyIntoTarget(target, result);
    } finally {
        activeCustomDraws--;
        if (temporary) freeCanvas(source.canvas);
    }
}
