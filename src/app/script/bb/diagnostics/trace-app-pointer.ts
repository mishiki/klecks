import { DIAGNOSTICS } from './diagnostics';
import type { TPointerEvent } from '../input/event.types';

export function traceAppPointer(stage: string, event: TPointerEvent): void {
    if (!DIAGNOSTICS.isRecording()) {
        return;
    }
    DIAGNOSTICS.record(stage, {
        type: event.type,
        pointerId: event.pointerId,
        pointerType: event.pointerType,
        eventTime: event.time,
        x: event.relX,
        y: event.relY,
        button: event.button,
        pressure: event.pressure,
        coalescedCount: event.coalescedArr?.length ?? 0,
    });
}
