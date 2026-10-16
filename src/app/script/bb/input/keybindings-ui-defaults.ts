/**
 * Bindings used by UI components which are not part of the main editor
 * keyboard dispatcher.  Keeping these here makes the exported settings file
 * describe the gestures shown in Help as well as the editor shortcuts.
 *
 * Gesture names are deliberately short, stable tokens.  They are normalized
 * by keybindings.ts, so users may write e.g. `Mouse Right` in a settings file
 * and it will be compared as `mouseright`.
 */
export const UI_HELD_DEFAULTS: Record<string, string[]> = {
    hudColorPicker: ['Ctrl+Alt', 'Cmd+Alt'],
};

export const UI_GESTURE_DEFAULTS: Record<string, string[]> = {
    sliderRelativeMouse: ['MouseRight'],
    sliderRelativeWheel: ['Wheel'],
    sliderManualInput: ['DoubleTap'],
    sliderFineGrained: ['VerticalFine'],
};

/** Values accepted for each UI gesture when a user remaps it. */
export const UI_GESTURE_ALLOWED: Record<string, string[]> = {
    sliderRelativeMouse: ['MouseLeft', 'MouseMiddle', 'MouseRight'],
    sliderRelativeWheel: ['Wheel'],
    sliderManualInput: ['DoubleTap'],
    sliderFineGrained: ['VerticalFine'],
};
