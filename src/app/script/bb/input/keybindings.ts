import JSON5 from 'json5';
import { APP_PRESS_DEFAULTS } from './keybindings-app-defaults';
import { EASEL_PRESS_DEFAULTS, EASEL_HELD_DEFAULTS, EASEL_GESTURE_DEFAULTS, EASEL_GESTURE_ALLOWED } from './keybindings-easel-defaults';
import { UI_HELD_DEFAULTS, UI_GESTURE_DEFAULTS, UI_GESTURE_ALLOWED } from './keybindings-ui-defaults';

export type TBindingSection = 'onPress' | 'whileHeld' | 'onGesture';
type TBindings = Record<TBindingSection, Record<string, string[]>>;
const STORAGE_KEY = 'kl-keybindings-v1';
const MAX_TEXT_SIZE = 262144;
const defaults: TBindings = {
    onPress: { ...APP_PRESS_DEFAULTS, ...EASEL_PRESS_DEFAULTS },
    whileHeld: { ...EASEL_HELD_DEFAULTS, ...UI_HELD_DEFAULTS },
    onGesture: { ...EASEL_GESTURE_DEFAULTS, ...UI_GESTURE_DEFAULTS },
};
const aliases: Record<string, string> = {
    control: 'ctrl', command: 'cmd', meta: 'cmd', option: 'alt',
    escape: 'esc', spacebar: 'space', '[': 'sqbr_open', ']': 'sqbr_close',
    arrowleft: 'left', arrowright: 'right', arrowup: 'up', arrowdown: 'down',
    '+': 'plus', '-': 'minus', mousemiddle: 'mouse-middle', mouseright: 'mouse-right',
    mouseleft: 'mouse-left', '=': 'equals', ',': 'comma', '.': 'period', '/': 'slash',
    ';': 'semicolon', "'": 'quote', '`': 'backquote', '\\': 'backslash',
};
const keyNames = new Set([
    ...'abcdefghijklmnopqrstuvwxyz0123456789', ...Array.from({ length: 24 }, (_, i) => 'f' + (i + 1)),
    'ctrl', 'cmd', 'alt', 'shift', 'space', 'enter', 'esc', 'backspace', 'delete',
    'sqbr_open', 'sqbr_close', 'plus', 'minus', 'left', 'right', 'up', 'down', 'home', 'end',
    'tab', 'pageup', 'pagedown', 'insert', 'equals', 'comma', 'period', 'slash', 'semicolon',
    'quote', 'backquote', 'backslash', 'mouse-middle', 'mouse-right', 'mouse-left',
]);
export function normalizeBinding(value: string, gesture = false): string {
    if (gesture) return value.toLowerCase().replace(/[\s_-]/g, '');
    let text = value.trim().toLowerCase();
    if (text === '+') text = 'plus';
    else if (text.endsWith('++')) text = text.slice(0, -1) + 'plus';
    const keys = text.split('+').map((part) => {
        const key = part.trim();
        return aliases[key] ?? key;
    });
    if (!keys.length || keys.some((key) => !keyNames.has(key)) || new Set(keys).size !== keys.length) {
        throw new Error('Unknown or repeated key: ' + value);
    }
    return keys.sort().join('+');
}
function normalizeAll(input: TBindings): TBindings {
    return Object.fromEntries(Object.entries(input).map(([section, actions]) => [section,
        Object.fromEntries(Object.entries(actions).map(([action, bindings]) => [action,
            bindings.map((binding) => normalizeBinding(binding, section === 'onGesture'))])),
    ])) as TBindings;
}
const normalizedDefaults = normalizeAll(defaults);
const allowedGestures = { ...EASEL_GESTURE_ALLOWED, ...UI_GESTURE_ALLOWED };
function parseSettings(text: string): TBindings {
    if (text.length > MAX_TEXT_SIZE) throw new Error('Key settings exceed 256 KB.');
    const input: unknown = JSON5.parse(text);
    if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('Expected a settings object.');
    const result = JSON.parse(JSON.stringify(normalizedDefaults)) as TBindings;
    for (const [section, actions] of Object.entries(input)) {
        if (!Object.prototype.hasOwnProperty.call(defaults, section)) throw new Error('Unknown section: ' + section);
        if (!actions || typeof actions !== 'object' || Array.isArray(actions)) throw new Error('Expected actions in ' + section);
        const name = section as TBindingSection;
        for (const [action, bindings] of Object.entries(actions)) {
            if (!Object.prototype.hasOwnProperty.call(defaults[name], action)) throw new Error('Unknown action: ' + section + '.' + action);
            if (!Array.isArray(bindings) || bindings.length > 16 || bindings.some((key) => typeof key !== 'string' || key.length > 100)) {
                throw new Error('Expected an array of key names: ' + section + '.' + action);
            }
            const normalized = (bindings as string[]).map((key) => normalizeBinding(key, name === 'onGesture'));
            if (name === 'onPress' && normalized.some((key) => key.includes('mouse-'))) {
                throw new Error('Mouse buttons belong in whileHeld/onGesture: ' + action);
            }
            if (name === 'whileHeld') {
                const mouseTools = ['eyedropper', 'hand', 'rotateView', 'zoom'];
                if (normalized.some((key) => key.includes('mouse-') && (key.includes('+') || !mouseTools.includes(action)))) {
                    throw new Error('Mouse bindings require a single button and a temporary canvas tool: ' + action);
                }
            }
            if (name === 'onGesture') {
                const allowed = new Set((allowedGestures[action] ?? []).map((key) => normalizeBinding(key, true)));
                if (normalized.some((key) => !allowed.has(key))) throw new Error('Unknown gesture for ' + action);
            }
            result[name][action] = [...new Set(normalized)];
        }
    }
    const used = new Map<string, string>();
    for (const [action, bindings] of Object.entries(result.onPress)) {
        for (const key of bindings) {
            const previous = used.get(key);
            if (previous && previous !== action) throw new Error('Duplicate onPress binding ' + key + ': ' + previous + ' / ' + action);
            used.set(key, action);
        }
    }
    const exclusiveHeld = ['eyedropper', 'hand', 'rotateView', 'zoom', 'hudColorPicker'];
    const heldUsed = new Map<string, string>();
    for (const action of exclusiveHeld) {
        for (const key of result.whileHeld[action] ?? []) {
            if (used.has(key)) throw new Error('Binding used by onPress and whileHeld: ' + key);
            if (heldUsed.has(key)) throw new Error('Duplicate held tool binding: ' + key);
            heldUsed.set(key, action);
        }
    }
    return result;
}
function displayKey(combo: string): string {
    const names: Record<string, string> = { ctrl: 'Ctrl', cmd: 'Cmd', alt: 'Alt', shift: 'Shift', space: 'Space', esc: 'Escape',
        sqbr_open: '[', sqbr_close: ']', plus: 'Plus', minus: '-', left: 'ArrowLeft', right: 'ArrowRight', up: 'ArrowUp', down: 'ArrowDown',
        'mouse-left': 'MouseLeft', 'mouse-middle': 'MouseMiddle', 'mouse-right': 'MouseRight' };
    return combo.split('+').map((key) => names[key] ?? (key.length === 1 ? key.toUpperCase() : key[0].toUpperCase() + key.slice(1))).join('+');
}
class KeyBindings {
    private value: TBindings = JSON.parse(JSON.stringify(normalizedDefaults)) as TBindings;
    private listeners = new Set<() => void>();
    constructor() {
        try {
            const saved = localStorage.getItem(STORAGE_KEY);
            if (saved) this.value = parseSettings(saved);
        } catch { /* Unavailable storage or obsolete settings: retain defaults. */ }
    }
    get(section: string, action: string): string[] {
        return this.value[section as TBindingSection]?.[action]?.slice() ?? [];
    }
    matches(section: string, action: string, combo: string): boolean {
        if (!combo) return false;
        try { return this.get(section, action).includes(normalizeBinding(combo, section === 'onGesture')); }
        catch { return false; }
    }
    held(action: string, combo: string, exact = false): boolean {
        if (exact) return this.matches('whileHeld', action, combo);
        if (!combo) return false;
        try {
            const down = new Set(normalizeBinding(combo).split('+'));
            return this.get('whileHeld', action).some((binding) => binding.split('+').every((key) => down.has(key)));
        } catch { return false; }
    }
    importText(text: string): void {
        const value = parseSettings(text);
        // Persist before replacing the active configuration; a failure leaves it unchanged.
        localStorage.setItem(STORAGE_KEY, JSON.stringify(value));
        this.value = value;
        this.listeners.forEach((listener) => listener());
    }
    reset(): void {
        localStorage.removeItem(STORAGE_KEY);
        this.value = JSON.parse(JSON.stringify(normalizedDefaults)) as TBindings;
        this.listeners.forEach((listener) => listener());
    }
    subscribe(listener: () => void): () => void {
        this.listeners.add(listener);
        return () => this.listeners.delete(listener);
    }
    exportText(): string {
        const value = Object.fromEntries(Object.entries(this.value).map(([section, actions]) => [section,
            Object.fromEntries(Object.entries(actions).map(([action, keys]) => [action,
                section === 'onGesture' ? keys : keys.map(displayKey)])),
        ]));
        return '// Klecks key settings (JSON5). Edit and import in Settings.\n' +
            '// onPress: execute; whileHeld: hold tool/modifier; onGesture: mouse/touch controls.\n' +
            '// [] disables an action; omitted actions use defaults. Duplicate onPress keys are rejected.\n' +
            '// Browser/OS-reserved shortcuts may not reach the app.\n' + JSON.stringify(value, null, 2) + '\n';
    }
}
export const KEY_BINDINGS = new KeyBindings();
