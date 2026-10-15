function message(value: unknown): string | null {
    if (typeof value !== 'string') return null;
    return value.slice(0, 4096)
        .replace(/(?:https?|file|blob|ftp):\/\/[^\s"'<>]+/gi, '[redacted-url]')
        .replace(/(?:[A-Za-z]:[\\/]|\\\\)[^\r\n"'<>]+/g, '[redacted-path]')
        .replace(/[^\s"'<>]*[\\/][^\s"'<>]+/g, '[redacted-path]')
        .replace(/[^\s"'<>]+\.(?:psd|psb|sai2?|kra|png|jpe?g)\b/gi, '[redacted-file]')
        .replace(/[\u0000-\u001f\u007f]/g, ' ').slice(0, 240);
}
export function diagnosticLocation(value: unknown): string | undefined {
    if (typeof value !== 'string') return undefined;
    const match = value.slice(0, 4096).match(/(?:^|[\\/])([A-Za-z0-9_.-]+\.(?:[cm]?js|tsx?))(?:[?#][^:\s)]*)?(?::(\d+):(\d+))?\)?$/);
    return match ? match[1] + (match[2] ? ':' + match[2] + ':' + match[3] : '') : undefined;
}
export function diagnosticError(error: unknown): Record<string, unknown> {
    const result: Record<string, unknown> = { errorName: 'Error' };
    try {
        if (typeof error === 'string') result.message = message(error);
        else if (error && typeof error === 'object') {
            const e = error as { name?: unknown; message?: unknown; stack?: unknown };
            if (typeof e.name === 'string' && /^[A-Za-z][A-Za-z0-9_.-]{0,63}$/.test(e.name)) result.errorName = e.name;
            result.message = message(e.message);
            if (typeof e.stack === 'string') {
                result.frames = e.stack.slice(0, 16384).split('\n').slice(1, 17)
                    .map((line) => diagnosticLocation(line.trim()))
                    .filter((frame) => frame !== undefined);
            }
        }
    } catch { /* Error objects may have throwing getters. */ }
    return result;
}
