import { diagnosticError, diagnosticLocation } from './diagnostic-error';

export type TDiagnosticProjectSnapshot = {
    width: number;
    height: number;
    layerCount: number;
    paintLayerCount?: number;
    maskCount?: number;
    visibleLayerCount: number;
    background?: string;
    historyEstimatedBytes?: number;
    historyEntryCount?: number;
    brushId?: string;
    brushSize?: number;
    brushOpacity?: number;
    maxCanvasSize?: number;
};
export type TDiagnosticDetails = Record<string, unknown>;

type TDiagnosticEvent = { tMs: number; kind: string; data?: TDiagnosticDetails };
type TDiagnosticMetric = { count: number; totalMs: number; maxMs: number; samples: number[]; seed: number };
type TDiagnosticHeapSample = {
    tMs: number; usedBytes: number | null; totalBytes: number | null; limitBytes: number | null;
};

const BUILD_LABEL = 'layer-background-diagnostics-v2-psd';
const MAX_DURATION_MS = 120_000;
const MAX_EVENTS = 50_000;
const MAX_PROJECT_SNAPSHOTS = 121;
const MAX_METRIC_NAMES = 16;
const MAX_EVENT_COUNT_LABELS = 64;
const MAX_SAMPLES_PER_METRIC = 256;
const MAX_TOTAL_METRIC_SAMPLES = 2_048;
const SENSITIVE_KEY = /(?:^|[_-])(?:text|clipboard|payload|stack|filename|filepath|pathname|href|src|content|prompt|title|base64|datauri|html|localstorage|sessionstorage|project)(?:$|[_-])|url|project(?:Name|Title|FileName)|imageData|bitmap|pixels?/i;
const URL_VALUE = /(?:https?|file|blob|ftp):\/\/[^\s"'<>]+/gi;
const SAFE_IDENTIFIER = /^[A-Za-z][A-Za-z0-9_.:-]{0,63}$/;

function finiteNonNegative(value: unknown): number | null {
    return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null;
}

function boundedText(value: unknown, maxLength: number): string | null {
    if (typeof value !== 'string') return null;
    const text = value.slice(0, maxLength * 2).replace(URL_VALUE, '[redacted-url]').replace(/[\u0000-\u001f\u007f]/g, ' ').trim();
    return text ? text.slice(0, maxLength) : null;
}

function safeIdentifier(value: unknown, fallback = 'unknown'): string {
    if (typeof value !== 'string') return fallback;
    const normalized = value.trim().replace(/[^A-Za-z0-9_.:-]+/g, '-').slice(0, 64);
    return SAFE_IDENTIFIER.test(normalized) ? normalized : fallback;
}

function safeColor(value: unknown): string | undefined {
    if (typeof value !== 'string' || value.length > 80) return undefined;
    const color = value.trim();
    if (/^#[0-9a-f]{3,8}$/i.test(color) || /^[a-z]{1,24}$/i.test(color)) return color;
    return /^(?:rgb|rgba|hsl|hsla)\([0-9.%+\-,\s/deg]+\)$/i.test(color) ? color : undefined;
}

function sanitizeDetails(input?: Record<string, unknown>, depth = 0): TDiagnosticDetails | undefined {
    if (!input || typeof input !== 'object') return undefined;
    const output: TDiagnosticDetails = Object.create(null) as TDiagnosticDetails;
    let count = 0;
    const safePrimitive = (value: unknown): string | number | boolean | null | undefined => {
        if (value === null || typeof value === 'boolean') return value;
        if (typeof value === 'number') return Number.isFinite(value) ? value : undefined;
        if (typeof value === 'string') return boundedText(value, 256) ?? undefined;
        return undefined;
    };
    try {
        for (const key in input) {
            if (count >= 40) break;
            if (!Object.prototype.hasOwnProperty.call(input, key)) continue;
            if (!/^[A-Za-z][A-Za-z0-9_.-]{0,63}$/.test(key) || SENSITIVE_KEY.test(key)) continue;
            const value = input[key];
            const scalar = safePrimitive(value);
            if (scalar !== undefined) {
                output[key] = scalar;
                count++;
            } else if (Array.isArray(value)) {
                output[key] = value.slice(0, 16).map(safePrimitive).filter((item) => item !== undefined);
                count++;
            } else if (key === 'details' && depth === 0 && value && typeof value === 'object') {
                const nested = sanitizeDetails(value as Record<string, unknown>, 1);
                if (nested) { output[key] = nested; count++; }
            }
        }
    } catch {
        return undefined;
    }
    return count ? output : undefined;
}
function round(value: number, digits = 2): number {
    const factor = 10 ** digits;
    return Math.round(value * factor) / factor;
}

function percentile(samples: number[], fraction: number): number | null {
    if (!samples.length) return null;
    const sorted = samples.slice().sort((a, b) => a - b);
    return round(sorted[Math.max(0, Math.ceil(sorted.length * fraction) - 1)]);
}

function cloneJson<T>(value: T): T {
    return JSON.parse(JSON.stringify(value)) as T;
}

class DiagnosticsRecorder {
    private recording = false;
    private sessionId = 0;
    private startedAt: string | null = null;
    private stoppedAt: string | null = null;
    private startedPerf = 0;
    private stoppedPerf: number | null = null;
    private stopReason: string | null = null;
    private events: Array<TDiagnosticEvent | undefined> = new Array(MAX_EVENTS);
    private eventWriteIndex = 0;
    private eventCount = 0;
    private droppedEvents = 0;
    private eventCountsByKind = new Map<string, number>();
    private eventCountsByStage = new Map<string, number>();
    private metrics = new Map<string, TDiagnosticMetric>();
    private metricSampleCount = 0;
    private projectSnapshots: Array<Record<string, unknown>> = [];
    private heapSamples: TDiagnosticHeapSample[] = [];
    private environment: Record<string, unknown> | null = null;
    private projectProvider: (() => TDiagnosticProjectSnapshot) | null = null;
    private subscribers = new Set<() => void>();
    private disposers: Array<() => void> = [];
    private stopTimer: number | null = null;
    private heapTimer: number | null = null;
    private projectTimer: number | null = null;
    private rafHandle: number | null = null;
    private lastRafTime: number | null = null;
    private longTaskObserver: PerformanceObserver | null = null;

    isRecording(): boolean {
        return this.recording;
    }

    start(): void {
        if (this.recording || typeof window === 'undefined') return;
        this.clearReport();
        this.sessionId++;
        this.recording = true;
        this.startedAt = new Date().toISOString();
        this.startedPerf = this.now();
        this.environment = this.collectEnvironment();
        this.snapshotProject();
        this.installListeners();
        this.setupLongTaskObserver();
        this.startRafSampler();
        this.startHeapSampler();
        this.projectTimer = window.setInterval(() => this.snapshotProject(), 1_000);
        this.stopTimer = window.setTimeout(() => this.stop('duration-limit'), MAX_DURATION_MS);
        this.readStorageEstimate(this.sessionId);
        this.notifySubscribers();
    }

    stop(reason = 'manual'): void {
        if (!this.recording) return;
        this.snapshotProject();
        this.stoppedPerf = this.now();
        this.stoppedAt = new Date().toISOString();
        this.stopReason = safeIdentifier(reason, 'manual');
        this.recording = false;
        this.cleanup();
        this.notifySubscribers();
    }

    recordError(kind: string, error: unknown, details?: Record<string, unknown>): void {
        if (!this.recording) return;
        this.record(kind, { ...details, ...diagnosticError(error) });
    }

    record(kind: string, data?: Record<string, unknown>): void {
        if (!this.recording) return;
        this.appendEvent(safeIdentifier(kind), sanitizeDetails(data));
    }

    pointer(stage: string, event: PointerEvent, details?: Record<string, unknown>): void {
        if (!this.recording) return;
        if (stage === 'window' && typeof performance !== 'undefined') {
            const latency = performance.now() - event.timeStamp;
            if (Number.isFinite(latency) && latency >= 0 && latency <= 60_000) {
                this.measure('input.deliveryLatency', latency);
            }
        }
        const target = event.target as (EventTarget & { tagName?: unknown }) | null;
        const tag = target && typeof target.tagName === 'string' ? target.tagName.toUpperCase().slice(0, 32) : null;
        const data: TDiagnosticDetails = {
            stage: safeIdentifier(stage),
            timestamp: finiteNonNegative(event.timeStamp),
            type: safeIdentifier(event.type, 'pointer'),
            pointerId: Number.isFinite(event.pointerId) ? event.pointerId : null,
            pointerType: safeIdentifier(event.pointerType),
            x: Number.isFinite(event.clientX) ? event.clientX : null,
            y: Number.isFinite(event.clientY) ? event.clientY : null,
            pressure: Number.isFinite(event.pressure) ? event.pressure : null,
            buttons: Number.isFinite(event.buttons) ? event.buttons : null,
            button: Number.isFinite(event.button) ? event.button : null,
            isPrimary: typeof event.isPrimary === 'boolean' ? event.isPrimary : null,
            tiltX: Number.isFinite(event.tiltX) ? event.tiltX : null,
            tiltY: Number.isFinite(event.tiltY) ? event.tiltY : null,
            targetTagName: tag && SAFE_IDENTIFIER.test(tag) ? tag : null,
        };
        const safeDetails = sanitizeDetails(details);
        if (safeDetails) data.details = safeDetails;
        this.appendEvent('pointer', data);
    }

    measure(name: string, durationMs: number): void {
        if (!this.recording || !Number.isFinite(durationMs) || durationMs < 0) return;
        let metricName = SENSITIVE_KEY.test(name) ? 'other' : safeIdentifier(name);
        let metric = this.metrics.get(metricName);
        if (!metric && this.metrics.size >= MAX_METRIC_NAMES) {
            metricName = 'other';
            metric = this.metrics.get(metricName);
        }
        if (!metric) {
            metric = { count: 0, totalMs: 0, maxMs: 0, samples: [], seed: 0x12345678 };
            this.metrics.set(metricName, metric);
        }
        metric.count++;
        metric.totalMs += durationMs;
        metric.maxMs = Math.max(metric.maxMs, durationMs);
        if (metric.samples.length < MAX_SAMPLES_PER_METRIC && this.metricSampleCount < MAX_TOTAL_METRIC_SAMPLES) {
            metric.samples.push(durationMs);
            this.metricSampleCount++;
        } else if (metric.samples.length >= MAX_SAMPLES_PER_METRIC) {
            metric.seed = (metric.seed * 1_664_525 + 1_013_904_223) >>> 0;
            const slot = metric.seed % metric.count;
            if (slot < MAX_SAMPLES_PER_METRIC) metric.samples[slot] = durationMs;
        }
    }

    setProjectProvider(fn: () => TDiagnosticProjectSnapshot): void {
        this.projectProvider = fn;
    }

    getReport(): object {
        const now = this.recording ? this.now() : (this.stoppedPerf ?? this.startedPerf);
        const metrics: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
        for (const [name, metric] of this.metrics) {
            if (!metric.count) continue;
            metrics[name] = {
                count: metric.count,
                totalMs: round(metric.totalMs),
                maxMs: round(metric.maxMs),
                sampleCount: metric.samples.length,
                p50Ms: percentile(metric.samples, 0.5),
                p95Ms: percentile(metric.samples, 0.95),
            };
        }
        return cloneJson({
            schemaVersion: 1,
            buildLabel: BUILD_LABEL,
            recording: this.recording,
            startedAt: this.startedAt,
            stoppedAt: this.stoppedAt,
            durationMs: this.startedAt ? round(Math.max(0, now - this.startedPerf)) : 0,
            stopReason: this.stopReason,
            environment: this.environment,
            projectSnapshots: this.projectSnapshots,
            rawRgbaEstimateNote: 'Theoretical width x height x (paintLayerCount + maskCount) x 4 byte estimate; excludes folder markers, history, scratch canvases and GPU allocations.',
            rafIntervalNote: 'requestAnimationFrame callback cadence; this is not actual paint FPS.',
            renderTimingNote: 'Render duration is CPU-side submission time; it does not measure GPU completion.',
            recorderOverheadNote: 'Instrumentation itself adds some runtime overhead.',
            heapNote: 'Heap samples describe JavaScript heap only, not canvas, GPU, or total process memory.',
            eventCounts: {
                byKind: this.countReport(this.eventCountsByKind),
                byStage: this.countReport(this.eventCountsByStage),
            },
            events: this.getEvents(),
            droppedEvents: this.droppedEvents,
            metricSamplingNote: 'Percentiles estimate the session from bounded reservoir samples; count, totalMs and maxMs cover all measurements.',
            limits: { durationMs: MAX_DURATION_MS, retainedEvents: MAX_EVENTS },
            metrics,
            heapSamples: this.heapSamples,
        });
    }

    download(): void {
        if (typeof document === 'undefined' || typeof window === 'undefined') return;
        const blob = new Blob([JSON.stringify(this.getReport(), null, 2)], { type: 'application/json' });
        const objectUrl = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = objectUrl;
        link.download = 'klecks-diagnostics-' + new Date().toISOString().replace(/[:.]/g, '-') + '.json';
        link.style.display = 'none';
        document.body.appendChild(link);
        try { link.click(); }
        finally {
            link.remove();
            window.setTimeout(() => URL.revokeObjectURL(objectUrl), 1_000);
        }
    }

    subscribe(fn: () => void): () => void {
        if (this.subscribers.size < 64 || this.subscribers.has(fn)) this.subscribers.add(fn);
        return () => this.subscribers.delete(fn);
    }

    private now(): number {
        return typeof performance !== 'undefined' && typeof performance.now === 'function'
            ? performance.now() : Date.now();
    }

    private newMetric(): TDiagnosticMetric {
        return { count: 0, totalMs: 0, maxMs: 0, samples: [], seed: 0x12345678 };
    }

    private clearReport(): void {
        this.startedAt = this.stoppedAt = this.stopReason = null;
        this.startedPerf = 0;
        this.stoppedPerf = null;
        this.events = new Array(MAX_EVENTS);
        this.eventWriteIndex = this.eventCount = this.droppedEvents = this.metricSampleCount = 0;
        this.eventCountsByKind.clear();
        this.eventCountsByStage.clear();
        this.eventCountsByKind.set('other', 0);
        this.eventCountsByStage.set('other', 0);
        this.metrics.clear();
        this.metrics.set('other', this.newMetric()); // Reserve a bounded overflow bucket.
        this.projectSnapshots = [];
        this.heapSamples = [];
        this.environment = null;
    }

    private elapsedMs(): number {
        return round(Math.max(0, this.now() - this.startedPerf));
    }

    private appendEvent(kind: string, data?: TDiagnosticDetails): void {
        if (!this.recording) return;
        this.incrementCount(this.eventCountsByKind, kind);
        if (typeof data?.stage === 'string') this.incrementCount(this.eventCountsByStage, data.stage);
        this.events[this.eventWriteIndex] = { tMs: this.elapsedMs(), kind, ...(data ? { data } : {}) };
        this.eventWriteIndex = (this.eventWriteIndex + 1) % MAX_EVENTS;
        if (this.eventCount < MAX_EVENTS) this.eventCount++;
        else this.droppedEvents++;
    }

    private incrementCount(counts: Map<string, number>, label: string): void {
        if (!counts.has(label) && counts.size >= MAX_EVENT_COUNT_LABELS) label = 'other';
        counts.set(label, (counts.get(label) ?? 0) + 1);
    }

    private countReport(counts: Map<string, number>): Record<string, number> {
        const result: Record<string, number> = Object.create(null) as Record<string, number>;
        for (const [label, count] of counts) if (count) result[label] = count;
        return result;
    }

    private getEvents(): TDiagnosticEvent[] {
        const ordered = this.eventCount < MAX_EVENTS
            ? this.events.slice(0, this.eventCount)
            : this.events.slice(this.eventWriteIndex).concat(this.events.slice(0, this.eventWriteIndex));
        return ordered.filter((event): event is TDiagnosticEvent => !!event);
    }

    private snapshotProject(): void {
        if (!this.startedAt || !this.projectProvider) return;
        try {
            const snapshot = this.projectProvider();
            const width = finiteNonNegative(snapshot.width);
            const height = finiteNonNegative(snapshot.height);
            const layerCount = finiteNonNegative(snapshot.layerCount);
            const paintLayerCount = finiteNonNegative(snapshot.paintLayerCount) ?? layerCount;
            const maskCount = finiteNonNegative(snapshot.maskCount) ?? 0;
            const estimate = width !== null && height !== null && paintLayerCount !== null && maskCount !== null
                ? width * height * (paintLayerCount + maskCount) * 4 : Number.NaN;
            const item: Record<string, unknown> = {
                tMs: this.elapsedMs(), width, height, layerCount, paintLayerCount, maskCount,
                visibleLayerCount: finiteNonNegative(snapshot.visibleLayerCount),
                background: safeColor(snapshot.background) ?? null,
                historyEstimatedBytes: finiteNonNegative(snapshot.historyEstimatedBytes),
                historyEntryCount: finiteNonNegative(snapshot.historyEntryCount),
                brushId: typeof snapshot.brushId === 'string' ? safeIdentifier(snapshot.brushId) : null,
                brushSize: finiteNonNegative(snapshot.brushSize),
                brushOpacity: finiteNonNegative(snapshot.brushOpacity),
                maxCanvasSize: finiteNonNegative(snapshot.maxCanvasSize),
                rawRgbaEstimateBytes: Number.isSafeInteger(estimate) ? estimate : null,
            };
            if (this.projectSnapshots.length >= MAX_PROJECT_SNAPSHOTS) this.projectSnapshots.shift();
            this.projectSnapshots.push(item);
        } catch {
            // Snapshots are optional; do not retain project objects or exception text.
        }
    }

    private collectEnvironment(): Record<string, unknown> {
        const nav = typeof navigator !== 'undefined' ? navigator : null;
        const scr = typeof screen !== 'undefined' ? screen : null;
        const dpr = typeof window !== 'undefined' && Number.isFinite(window.devicePixelRatio)
            ? window.devicePixelRatio : null;
        const width = scr ? finiteNonNegative(scr.width) : null;
        const height = scr ? finiteNonNegative(scr.height) : null;
        const hardwareConcurrency = nav ? finiteNonNegative(nav.hardwareConcurrency) : null;
        const deviceMemory = nav
            ? finiteNonNegative((nav as Navigator & { deviceMemory?: number }).deviceMemory) : null;
        const pointerSupported = typeof PointerEvent !== 'undefined';
        const storage = nav && (nav as Navigator & { storage?: unknown }).storage;
        const estimateSupported = !!storage && typeof (storage as { estimate?: unknown }).estimate === 'function';
        const memory = typeof performance !== 'undefined'
            ? (performance as Performance & { memory?: { usedJSHeapSize?: number } }).memory : undefined;
        return {
            userAgent: nav ? boundedText(nav.userAgent, 512) : null,
            platform: nav ? boundedText(nav.platform, 128) : null,
            language: nav ? boundedText(nav.language, 32) : null,
            hardwareConcurrency, deviceMemoryGb: deviceMemory,
            screen: {
                width, height, devicePixelRatio: dpr,
                physicalWidthEstimate: width !== null && dpr !== null ? round(width * dpr) : null,
                physicalHeightEstimate: height !== null && dpr !== null ? round(height * dpr) : null,
            },
            viewport: {
                width: typeof window !== 'undefined' ? finiteNonNegative(window.innerWidth) : null,
                height: typeof window !== 'undefined' ? finiteNonNegative(window.innerHeight) : null,
            },
            secureContext: typeof window !== 'undefined' ? window.isSecureContext : null,
            support: {
                pointerEvent: pointerSupported,
                getCoalescedEvents: pointerSupported && typeof PointerEvent.prototype.getCoalescedEvents === 'function',
                storageEstimate: estimateSupported,
                heapMemory: !!memory && typeof memory.usedJSHeapSize === 'number',
                longTaskObserver: false,
            },
            storageEstimate: { supported: estimateSupported, available: false, usageBytes: null, quotaBytes: null },
            heapMemory: { supported: !!memory && typeof memory.usedJSHeapSize === 'number' },
            webgl: this.collectWebgl(),
        };
    }

    private collectWebgl(): Record<string, unknown> {
        if (typeof document === 'undefined') return { supported: false, version: null };
        let gl: WebGLRenderingContext | WebGL2RenderingContext | null = null;
        try {
            const canvas = document.createElement('canvas');
            gl = (canvas.getContext('webgl2') || canvas.getContext('webgl')) as
                WebGLRenderingContext | WebGL2RenderingContext | null;
            if (!gl) return { supported: false, version: null, vendor: null, renderer: null };
            const debug = gl.getExtension('WEBGL_debug_renderer_info') as
                | { UNMASKED_VENDOR_WEBGL: number; UNMASKED_RENDERER_WEBGL: number } | null;
            const get = (parameter: number): unknown => {
                try {
                    const value = gl?.getParameter(parameter);
                    if (value instanceof Int32Array) return Array.from(value);
                    if (typeof value === 'number') return value;
                    if (typeof value === 'string') return boundedText(value, 256);
                } catch { /* Capability is unavailable. */ }
                return null;
            };
            return {
                supported: true,
                version: boundedText(gl.getParameter(gl.VERSION), 128),
                vendor: get(debug?.UNMASKED_VENDOR_WEBGL ?? gl.VENDOR),
                renderer: get(debug?.UNMASKED_RENDERER_WEBGL ?? gl.RENDERER),
                debugRendererInfo: !!debug,
                maxTextureSize: get(gl.MAX_TEXTURE_SIZE),
                maxRenderbufferSize: get(gl.MAX_RENDERBUFFER_SIZE),
                maxViewportDims: get(gl.MAX_VIEWPORT_DIMS),
                maxCombinedTextureImageUnits: get(gl.MAX_COMBINED_TEXTURE_IMAGE_UNITS),
            };
        } catch {
            return { supported: false, version: null, vendor: null, renderer: null };
        } finally {
            try { gl?.getExtension('WEBGL_lose_context')?.loseContext(); } catch { /* Best effort. */ }
        }
    }

    private readStorageEstimate(session: number): void {
        if (!this.environment || typeof navigator === 'undefined') return;
        const storage = (navigator as Navigator & {
            storage?: { estimate?: () => Promise<{ usage?: number; quota?: number }> };
        }).storage;
        if (!storage || typeof storage.estimate !== 'function') return;
        try {
            storage.estimate().then((result) => {
                if (session !== this.sessionId || !this.environment) return;
                this.environment.storageEstimate = {
                    supported: true, available: true,
                    usageBytes: finiteNonNegative(result.usage), quotaBytes: finiteNonNegative(result.quota),
                };
            }).catch(() => {
                if (session === this.sessionId && this.environment) {
                    this.environment.storageEstimate = {
                        supported: true, available: false, usageBytes: null, quotaBytes: null,
                    };
                }
            });
        } catch { /* Optional browser API. */ }
    }

    private installListeners(): void {
        const addWindow = (type: string, listener: EventListener): void => {
            window.addEventListener(type, listener, { capture: true, passive: true });
            this.disposers.push(() => window.removeEventListener(type, listener, { capture: true }));
        };
        const pointerListener: EventListener = (event) => this.pointer('window', event as PointerEvent);
        for (const type of ['pointerdown', 'pointermove', 'pointerup', 'pointercancel', 'gotpointercapture', 'lostpointercapture']) {
            addWindow(type, pointerListener);
        }
        addWindow('blur', (event) => {
            if (event.target === window) this.record('window-blur');
        });
        addWindow('focus', (event) => {
            if (event.target === window) this.record('window-focus');
        });
        const contextListener = (kind: string) => (event: Event): void => {
            const target = event.target as (EventTarget & { tagName?: unknown }) | null;
            const tag = target && typeof target.tagName === 'string' ? target.tagName.toUpperCase().slice(0, 32) : null;
            this.record(kind, { targetTagName: tag && SAFE_IDENTIFIER.test(tag) ? tag : null });
        };
        addWindow('webglcontextlost', contextListener('webgl-context-lost'));
        addWindow('webglcontextrestored', contextListener('webgl-context-restored'));
        addWindow('error', ((event: ErrorEvent) => {
            this.recordError('window-error', event.error ?? event.message, {
                asset: diagnosticLocation(event.filename), line: event.lineno, column: event.colno,
            });
        }) as EventListener);
        addWindow('unhandledrejection', ((event: PromiseRejectionEvent) => {
            this.recordError('unhandled-rejection', event.reason);
        }) as EventListener);
        if (typeof document !== 'undefined') {
            const listener: EventListener = () => this.record('visibility-change', {
                visibility: safeIdentifier(document.visibilityState),
            });
            document.addEventListener('visibilitychange', listener, { capture: true, passive: true });
            this.disposers.push(() => document.removeEventListener('visibilitychange', listener, { capture: true }));
        }
    }

    private setupLongTaskObserver(): void {
        if (typeof PerformanceObserver === 'undefined' || !this.environment) return;
        try {
            const supported = PerformanceObserver.supportedEntryTypes;
            if (!supported || !supported.includes('longtask')) return;
            this.longTaskObserver = new PerformanceObserver((list) => {
                for (const entry of list.getEntries()) this.measure('longtask', entry.duration);
            });
            this.longTaskObserver.observe({ type: 'longtask', buffered: false });
            (this.environment.support as Record<string, unknown>).longTaskObserver = true;
        } catch {
            this.longTaskObserver?.disconnect();
            this.longTaskObserver = null;
        }
    }

    private startRafSampler(): void {
        if (typeof requestAnimationFrame !== 'function') return;
        const tick = (timestamp: number): void => {
            if (!this.recording) return;
            if (this.lastRafTime !== null) this.measure('rafInterval', timestamp - this.lastRafTime);
            this.lastRafTime = timestamp;
            this.rafHandle = requestAnimationFrame(tick);
        };
        this.lastRafTime = null;
        this.rafHandle = requestAnimationFrame(tick);
    }

    private startHeapSampler(): void {
        if (typeof performance === 'undefined') return;
        const getMemory = (): {
            usedJSHeapSize?: number; totalJSHeapSize?: number; jsHeapSizeLimit?: number;
        } | undefined => (performance as Performance & {
            memory?: { usedJSHeapSize?: number; totalJSHeapSize?: number; jsHeapSizeLimit?: number };
        }).memory;
        if (typeof getMemory()?.usedJSHeapSize !== 'number') return;
        const sample = (): void => {
            const memory = getMemory();
            if (!memory || typeof memory.usedJSHeapSize !== 'number') return;
            if (this.heapSamples.length >= MAX_PROJECT_SNAPSHOTS) this.heapSamples.shift();
            this.heapSamples.push({
                tMs: this.elapsedMs(),
                usedBytes: finiteNonNegative(memory.usedJSHeapSize),
                totalBytes: finiteNonNegative(memory.totalJSHeapSize),
                limitBytes: finiteNonNegative(memory.jsHeapSizeLimit),
            });
        };
        sample();
        this.heapTimer = window.setInterval(sample, 1_000);
    }

    private cleanup(): void {
        if (this.stopTimer !== null) window.clearTimeout(this.stopTimer);
        if (this.heapTimer !== null) window.clearInterval(this.heapTimer);
        if (this.projectTimer !== null) window.clearInterval(this.projectTimer);
        if (this.rafHandle !== null && typeof cancelAnimationFrame === 'function') cancelAnimationFrame(this.rafHandle);
        this.stopTimer = this.heapTimer = this.projectTimer = this.rafHandle = null;
        this.lastRafTime = null;
        for (const dispose of this.disposers.splice(0)) {
            try { dispose(); } catch { /* Continue releasing the remaining observers. */ }
        }
        this.longTaskObserver?.disconnect();
        this.longTaskObserver = null;
    }

    private notifySubscribers(): void {
        for (const subscriber of this.subscribers) {
            try { subscriber(); } catch { /* UI listeners cannot affect recording. */ }
        }
    }
}

export const DIAGNOSTICS = new DiagnosticsRecorder();
