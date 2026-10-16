/**
 * Canvas and viewport bindings.  Names in this file are deliberately stable
 * and human-facing: they are the keys users edit in the exported JSON5 file.
 */
export const EASEL_PRESS_DEFAULTS: Record<string, string[]> = {
    zoomIn: ['Plus', 'Shift+Plus'],
    zoomOut: ['-'],
    panLeft: ['ArrowLeft', 'Shift+ArrowLeft'],
    panRight: ['ArrowRight', 'Shift+ArrowRight'],
    panUp: ['ArrowUp', 'Shift+ArrowUp'],
    panDown: ['ArrowDown', 'Shift+ArrowDown'],
    rotateLeft: ['R+ArrowLeft'],
    rotateRight: ['R+ArrowRight'],
    resetRotation: ['R+ArrowUp'],
};

export const EASEL_HELD_DEFAULTS: Record<string, string[]> = {
    eyedropper: ['Alt'],
    hand: ['Space', 'MouseMiddle'],
    rotateView: ['R'],
    zoom: ['Z'],
    lineTool: ['Shift'],
    rotateSnap: ['Shift'],
    selectionAdd: ['Shift'],
    selectionSubtract: ['Alt'],
    selectionNudgeFine: ['Shift'],
    wheelFine: ['Shift'],
    zoomFine: ['Shift'],
};

export const EASEL_GESTURE_DEFAULTS: Record<string, string[]> = {
    wheelZoom: ['wheel'],
    doubleTapFit: ['double-tap'],
    mouseMiddleDoubleTapFit: ['mouse-middle-double-tap'],
    touchTwoFingerTransform: ['touch-two-finger-transform'],
    touchTwoFingerUndo: ['touch-two-finger-tap'],
    touchThreeFingerRedo: ['touch-three-finger-tap'],
};

/** The gesture vocabulary accepted by the easel handlers. */
export const EASEL_GESTURE_ALLOWED: Record<string, string[]> = {
    wheelZoom: ['wheel'],
    doubleTapFit: ['double-tap'],
    mouseMiddleDoubleTapFit: ['mouse-middle-double-tap'],
    touchTwoFingerTransform: ['touch-two-finger-transform'],
    touchTwoFingerUndo: ['touch-two-finger-tap'],
    touchThreeFingerRedo: ['touch-three-finger-tap'],
};
