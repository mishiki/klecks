import { DIAGNOSTICS } from './diagnostics';
let nextImportId = 0;
export class ImportTrace {
    private readonly importId = ++nextImportId;
    private readonly started = performance.now();
    private stageStarted = this.started;
    private currentStage: string | undefined;
    private ended = false;
    private stageHadError = false;
    constructor(sizeBytes: number, option: string) { this.event('start', { sizeBytes, option }); }
    private closeStage(outcome: string): void {
        if (!this.currentStage) return;
        this.event('stage-end', { outcome: this.stageHadError && outcome === 'completed' ? 'recovered-error' : outcome, durationMs: performance.now() - this.stageStarted });
        this.currentStage = undefined;
    }
    stage(name: string, details?: Record<string, unknown>): void {
        if (this.ended) return;
        this.closeStage('completed');
        this.currentStage = name;
        this.stageHadError = false;
        this.stageStarted = performance.now();
        this.event('stage-start', details);
    }
    event(name: string, details?: Record<string, unknown>): void {
        if (this.ended) return;
        DIAGNOSTICS.record('psd-import.' + name, { ...details, importId: this.importId, stage: this.currentStage });
    }
    error(error: unknown): void {
        if (this.ended) return;
        this.stageHadError = true;
        DIAGNOSTICS.recordError('psd-import.error', error, { importId: this.importId, stage: this.currentStage });
    }
    fail(error: unknown): void {
        if (this.ended) return;
        this.error(error);
        this.closeStage('failed');
        this.end('failed');
    }
    private end(outcome: string, details?: Record<string, unknown>): void {
        this.event('end', { ...details, outcome, durationMs: performance.now() - this.started });
        this.ended = true;
    }
    finish(outcome: 'success' | 'cancelled' | 'rejected', details?: Record<string, unknown>): void {
        if (this.ended) return;
        this.closeStage(outcome === 'success' ? 'completed' : outcome);
        this.end(outcome, details);
    }
    run<T>(stage: string, fn: () => T, details?: Record<string, unknown>): T {
        this.stage(stage, details);
        try { return fn(); } catch (error) { this.fail(error); throw error; }
    }
}
