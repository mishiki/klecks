/**
 * Application actions which are useful in a personal keybindings file.
 *
 * The values are deliberately written in the human-facing notation used by
 * the settings file.  The keybinding service normalizes these values to the
 * internal KeyListener names (for example `Ctrl` -> `ctrl`).
 *
 * An empty array is intentional: it makes an action visible and assignable
 * without reserving a default key for it.
 */
export const APP_PRESS_DEFAULTS: Record<string, string[]> = {
    fitView: ['Home'],
    resetView: ['End'],
    undo: ['Ctrl+Z', 'Cmd+Z'],
    redo: ['Ctrl+Y', 'Cmd+Y', 'Ctrl+Shift+Z', 'Cmd+Shift+Z'],
    save: ['Ctrl+S', 'Cmd+S'],
    saveProject: ['Ctrl+Shift+S', 'Cmd+Shift+S'],
    copy: ['Ctrl+C', 'Cmd+C'],
    preventNativeSelectAll: ['Ctrl+A', 'Cmd+A'],
    decreaseBrushSize: ['['],
    increaseBrushSize: [']'],
    fillLayer: ['Enter'],
    cancel: ['Escape'],
    clearLayer: ['Delete', 'Backspace'],
    advancedMerge: ['Ctrl+Shift+E', 'Cmd+Shift+E'],
    toggleEraser: ['Shift+E'],
    eraserBrush: ['E'],
    nextBrush: ['B'],
    handTool: ['H'],
    togglePaintBucketGradient: ['G'],
    textTool: ['T'],
    shapeTool: ['U'],
    selectTool: ['L'],
    swapColors: ['X'],
    flipView: ['M'],

    // The top-row and File menu actions do not have defaults, but can be
    // assigned from the same file as the editing shortcuts.
    newImage: [],
    openFile: [],
    placeFile: [],
    savePsd: [],
    shareImage: [],
    openHome: [],
    openHelp: [],
    openBrowserStorage: [],
    openRecovery: [],
    uploadImage: [],
    showFileTab: [],
    showLayersTab: [],
    showEditTab: [],
    showSettingsTab: [],
    paste: [],

    // Direct tool selection.  The existing one-key shortcuts above keep
    // their historical behavior; these names allow dedicated assignments.
    toolBrush: [],
    toolHand: [],
    toolPaintBucket: [],
    toolGradient: [],
    toolText: [],
    toolShape: [],
    toolSelect: [],
    toolTransform: [],
    toolEyedropper: [],
    toolRotate: [],
    toolZoom: [],

    // Direct brush selection.  These are intentionally unassigned so a
    // user's file can choose only the brushes it actually uses.
    brushPen: [],
    brushBlend: [],
    brushSketchy: [],
    brushPixel: [],
    brushChemy: [],
    brushSmudge: [],
    brushEraser: [],

    // Layer and mask commands.
    layerNew: [],
    layerNewGroup: [],
    layerDuplicate: [],
    layerRemove: [],
    layerMerge: [],
    layerRename: [],
    layerToggleClipping: [],
    layerClear: [],
    layerMergeAll: [],
    layerAddMask: [],
    layerRemoveMask: [],
    layerToggleMask: [],
    layerInvertMask: [],
    layerClearMask: [],

    // Edit tab actions. Each opens the same dialog as the corresponding
    // button and therefore keeps its normal layer and WebGL guards.
    filterCropExtend: [],
    filterFlip: [],
    filterPerspective: [],
    filterResize: [],
    filterRotate: [],
    filterTransform: [],
    filterBrightnessContrast: [],
    filterCurves: [],
    filterDistort: [],
    filterHueSaturation: [],
    filterInvert: [],
    filterTiltShift: [],
    filterToAlpha: [],
    filterBlur: [],
    filterUnsharpMask: [],
    filterGrid: [],
    filterNoise: [],
    filterPattern: [],
    filterVanishPoint: [],
};

