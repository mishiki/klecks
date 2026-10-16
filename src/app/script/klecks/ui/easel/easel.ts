import { EASEL_PRESS_DEFAULTS } from '../../../bb/input/keybindings-easel-defaults';
import { DIAGNOSTICS } from '../../../bb/diagnostics/diagnostics';
import { traceAppPointer } from '../../../bb/diagnostics/trace-app-pointer';
import { c } from '../../../bb/base/c';
import { ProjectViewport, TViewportTransform } from '../project-viewport/project-viewport';
import { PointerListener } from '../../../bb/input/pointer-listener';
import { BB } from '../../../bb/bb';
import { toMetaTransform } from '../../../bb/transform/to-meta-transform';
import { createTransform } from '../../../bb/transform/create-transform';
import { createMatrixFromTransform } from '../../../bb/transform/create-matrix-from-transform';
import { applyToPoint, inverse } from 'transformation-matrix';
import { EaselPointerPreprocessor } from './easel-pointer-preprocessor';
import { KeyListener } from '../../../bb/input/key-listener';
import { KEY_BINDINGS } from '../../../bb/input/keybindings';
import {
    TArrowKey,
    TEaselInterface,
    TEaselProject,
    TEaselTool,
    TEaselToolTrigger,
} from './easel.types';
import { TVector2D } from '../../../bb/bb-types';
import { zoomByStep } from '../project-viewport/utils/zoom-by-step';
import { SelectionRenderer } from './selection-renderer';
import { KL_CONFIG } from '../../kl-config';
import { minimizeAngleDeg, snapAngleDeg } from '../../../bb/math/math';
import {
    DEFAULT_DOUBLE_TAP_POINTER_TYPES,
    EASEL_MAX_SCALE,
    EASEL_MIN_SCALE,
    TEMP_TRIGGERS,
} from './easel.config';
import { isTransformEqual } from '../project-viewport/utils/is-transform-equal';
import { blendTransform } from '../project-viewport/utils/blend-transform';
import { getFitRectTransform } from '../project-viewport/utils/get-fit-rect-transform';
import { css } from '../../../bb/base/base';
import { TWheelEvent } from '../../../bb/input/event.types';
import { getIconSvg } from '../../../icon/icon';
import { type IconName } from '../../../../icons/icons';
import { LANG } from '../../../language/language';

function getToolEntries<GToolId extends string>(
    tools: Record<GToolId, TEaselTool>,
): [GToolId, TEaselTool][] {
    return Object.entries(tools) as [GToolId, TEaselTool][];
}

// The trigger names are kept on tools for their internal type contract.  The
// user-facing action names live in keybindings-easel-defaults.ts and are used
// here so a multi-key held binding can replace the historical single key.
const TEMP_TRIGGER_ACTIONS: Record<TEaselToolTrigger, string> = {
    'mouse-middle': 'hand',
    'mouse-right': 'eyedropper',
    space: 'hand',
    alt: 'eyedropper',
    r: 'rotateView',
    z: 'zoom',
};
const TEMP_ACTION_PRIMARY_TRIGGERS: Record<string, TEaselToolTrigger> = {
    eyedropper: 'alt',
    hand: 'space',
    rotateView: 'r',
    zoom: 'z',
};

export type TEaselParams<GToolId extends string> = {
    width: number; // size of DOM element
    height: number; // size of DOM element
    project: TEaselProject;
    tools: Record<GToolId, TEaselTool>;
    tool: NoInfer<GToolId>;
    onChangeTool: (toolId: NoInfer<GToolId>) => void;
    onTransformChange: (transform: TViewportTransform, scaleOrAngleChanged: boolean) => void; // whenever Viewport changes
    onBeforeRender?: () => void;
    onUndo?: () => void; // gesture triggers undo
    onRedo?: () => void; // gesture triggers redo
    onResetSelection: () => void; // via selection indicator
};

/**
 * An interactive project viewport, that also renders the selection. You interact with it through modes (aka tools).
 * One tool is active at a time. temp trigger can overwrite it temporarily.
 */
export class Easel<GToolId extends string> {
    private readonly rootEl: HTMLElement;
    private readonly svgEl: SVGElement; // each tool gets an element in this SVG tag, for an SVG overlay
    private readonly htmlOverlayEl: HTMLElement; // each tool can get an element in this html node, for an interactive overlay
    private readonly mirrorIndicatorEl: HTMLElement;
    private readonly selectionIndicatorEl: HTMLElement;
    private readonly viewport: ProjectViewport;
    private readonly pointerPreprocessor: EaselPointerPreprocessor;
    private readonly pointerListener: PointerListener;
    private readonly windowPointerListener: (e: PointerEvent) => void;
    private readonly keyListener: KeyListener;
    private readonly selectionRenderer: SelectionRenderer;
    private unsubscribeKeyBindings: (() => void) | undefined;

    // from params
    private readonly toolsMap: TEaselParams<GToolId>['tools'];
    // temp tool is tool that is active during holding a key or mouse button (e.g. hold space -> hand tool)
    private readonly tempTools: Record<TEaselToolTrigger, GToolId | undefined>;
    private readonly onChangeTool: TEaselParams<GToolId>['onChangeTool'];
    private readonly onTransformChange: (
        transform: TViewportTransform,
        scaleOrAngleChanged: boolean,
    ) => void;
    private readonly onUndo: (() => void) | undefined;
    private readonly onRedo: (() => void) | undefined;

    // state
    private project: TEaselProject;
    private width: number;
    private height: number;
    private toolId: GToolId;
    private tempToolId: GToolId | undefined;
    private animationFrameId: ReturnType<typeof requestAnimationFrame> | undefined;
    private doRender = false; // true -> will render on next renderLoop
    private cursorPos: TVector2D | undefined; // so brush cursor not top left corner after reload
    private isFrozen: boolean = false; // disable interaction with the easel whatsoever
    private lastRenderedTransform: TViewportTransform = {} as TViewportTransform; // previously rendered viewport transformation
    private pinchInitialTransform: TViewportTransform | undefined; // when starting a pinch-to-zoom gesture
    private targetTransform: TViewportTransform;

    // custom interface passed to tools
    private readonly easelInterface: TEaselInterface = {
        setCursor: (cursor) => (this.rootEl.style.cursor = cursor),
        getTransform: () => this.viewport.getTransform(),
        getTargetTransform: () => this.targetTransform,
        getSize: () => ({ width: this.width, height: this.height }),
        getProjectSize: () => ({ width: this.project.width, height: this.project.height }),
        setTransform: (transform, isImmediate) => this.setTargetTransform(transform, isImmediate),
        requestRender: () => this.requestRender(),
        isKeyPressed: (keyStr) => this.keyListener.isPressed(keyStr),
        minScale: EASEL_MIN_SCALE,
        maxScale: EASEL_MAX_SCALE,
        setAngleDeg: (...args) => this.setAngleDeg(...args),
        keyListener: {} as KeyListener, // this.keyListener
        updateDoubleTapPointerTypes: () => this.updateDoubleTapPointerTypes(),
        setRenderedSelection: (selection) => this.selectionRenderer.setRenderedSelection(selection),
        clearRenderedSelection: (isImmediate) =>
            this.selectionRenderer.clearRenderedSelection(isImmediate),
        onWheel: (e) => this.onWheel(e),
        getElement: () => this.rootEl,
    };

    private setTargetTransform(transform: TViewportTransform, isImmediate?: boolean): void {
        if (isImmediate) {
            this.viewport.setTransform(transform);
        }
        this.targetTransform = transform;
        this.doRender = true;
    }

    private updateToolSvgs(): void {
        const targetTool = this.tempToolId ?? this.toolId;
        getToolEntries(this.toolsMap).forEach(([toolId, tool]) => {
            tool.getSvgElement().style.display = toolId === targetTool ? '' : 'none';
        });
    }

    // different tools allow different pointer types to trigger the gesture
    private updateDoubleTapPointerTypes(): void {
        const pointerTypes =
            this.toolsMap[this.tempToolId ?? this.toolId].doubleTapPointerTypes ??
            DEFAULT_DOUBLE_TAP_POINTER_TYPES;
        this.pointerPreprocessor.setDoubleTapPointerTypes(pointerTypes);
    }

    private getTempToolIdForAction(action: string): GToolId | undefined {
        const trigger = TEMP_ACTION_PRIMARY_TRIGGERS[action];
        return trigger === undefined ? undefined : this.tempTools[trigger];
    }

    private getTempTriggerForAction(action: string): TEaselToolTrigger | undefined {
        return TEMP_ACTION_PRIMARY_TRIGGERS[action];
    }

    private isActiveTempBindingHeld(comboStr: string): boolean {
        if (this.tempToolId === undefined) {
            return false;
        }
        return (Object.keys(TEMP_ACTION_PRIMARY_TRIGGERS) as string[]).some(
            (action) =>
                this.getTempToolIdForAction(action) === this.tempToolId &&
                KEY_BINDINGS.held(action, comboStr),
        );
    }

    private lastFrameTimestamp: number = 0;
    /**
     * Only call once from outside. Will perpetuate itself and render when doRender = true
     */
    private renderLoop(): void {
        const now = performance.now();
        const deltaMs = now - this.lastFrameTimestamp;
        this.lastFrameTimestamp = now;
        this.animationFrameId = requestAnimationFrame(() => this.renderLoop());
        if (!this.doRender) {
            return;
        }
        const tool = this.getActiveTool();
        const oldTransform = this.viewport.getTransform();
        let newTransform = oldTransform;
        if (isTransformEqual(oldTransform, this.targetTransform)) {
            this.doRender = false;
        } else {
            const defaultDeltaMs = 1000 / 60;
            const timeFactor = deltaMs / defaultDeltaMs;
            const easeFactor = 1 - 0.7 ** timeFactor;

            newTransform = blendTransform(
                oldTransform,
                this.targetTransform,
                {
                    width: this.project.width,
                    height: this.project.height,
                },
                {
                    x: this.width / 2,
                    y: this.height / 2,
                },
                easeFactor,
            );
            this.viewport.setTransform(newTransform);
        }

        // todo: is last renderedTransform needed?

        const isPositionChanged =
            newTransform.x !== this.lastRenderedTransform.x ||
            newTransform.y !== this.lastRenderedTransform.y;
        const isScaleOrAngleChanged =
            newTransform.scale !== this.lastRenderedTransform.scale ||
            newTransform.angleDeg !== this.lastRenderedTransform.angleDeg;
        const isMirroredChanged = newTransform.isMirrored !== this.lastRenderedTransform.isMirrored;

        const diagnosticStart = DIAGNOSTICS.isRecording() ? performance.now() : undefined;
        this.viewport.render(!isTransformEqual(oldTransform, newTransform));
        if (diagnosticStart !== undefined) {
            DIAGNOSTICS.measure('easel.render', performance.now() - diagnosticStart);
        }
        if (isPositionChanged || isScaleOrAngleChanged || isMirroredChanged) {
            tool.onUpdateTransform?.(newTransform);
            this.selectionRenderer.setTransform(newTransform);
            this.onTransformChange(this.targetTransform, isScaleOrAngleChanged);
            this.lastRenderedTransform = newTransform;
        }
    }

    /**
     * activate temporary tool. Can only push one.
     */
    private pushTempTool(toolId: GToolId | undefined): void {
        if (this.tempToolId !== undefined || toolId === undefined) {
            return;
        }
        const tool = this.toolsMap[this.toolId];
        if (tool.getIsLocked?.()) {
            return;
        }

        this.tempToolId = toolId;
        const activeToolId = this.getActiveToolId();
        this.toolsMap[activeToolId].activate?.(this.cursorPos);
        Object.values<TEaselTool>(this.toolsMap).forEach((tool) => tool.onTool?.(activeToolId));
        this.updateToolSvgs();
        this.updateDoubleTapPointerTypes();
    }

    /**
     * Turn off temporary tool
     */
    private popTempTool(toolId: GToolId | undefined): void {
        if (this.tempToolId !== toolId || toolId === undefined) {
            return;
        }
        this.tempToolId = undefined;
        this.getActiveTool().activate?.(this.cursorPos, true);
        const activeToolId = this.getActiveToolId();
        Object.values<TEaselTool>(this.toolsMap).forEach((tool) => tool.onTool?.(activeToolId));
        this.updateToolSvgs();
        this.updateDoubleTapPointerTypes();
    }

    private getActiveToolId(): GToolId {
        return this.tempToolId ?? this.toolId;
    }

    private getActiveTool(): TEaselTool {
        return this.toolsMap[this.getActiveToolId()];
    }

    private getResetTransform(isMirrored: boolean = false): TViewportTransform {
        return createTransform(
            {
                x: this.width / 2,
                y: this.height / 2,
            },
            { x: this.project.width / 2, y: this.project.height / 2 },
            1,
            0,
            isMirrored,
        );
    }

    private getFitTransform(): TViewportTransform {
        return getFitRectTransform(
            { x: 0, y: 0, width: this.project.width, height: this.project.height },
            this.viewport.getTransform(),
            { width: this.width, height: this.height },
            true,
        );
    }

    private readonly onWheel = (e: TWheelEvent): void => {
        if (!KEY_BINDINGS.matches('onGesture', 'wheelZoom', 'wheel')) {
            return;
        }
        e.event?.preventDefault();
        let isImmediate = false;
        if (Math.abs(e.deltaY) < 0.8) {
            isImmediate = true;
        }
        if (e.event && e.event.ctrlKey && !this.keyListener.isPressed('ctrl')) {
            isImmediate = true;
            let factor = 1;
            if (e.event.deltaMode === 0) {
                factor = 6;
            }
            e.deltaY *= factor;
        }
        if (KEY_BINDINGS.held('wheelFine', this.keyListener.getComboStr())) {
            e.deltaY /= 4;
        }

        // zoom
        const transform = this.targetTransform;
        const viewportPoint = {
            x: e.relX,
            y: e.relY,
        };
        const mat = createMatrixFromTransform(transform);
        const canvasPoint = applyToPoint(inverse(mat), viewportPoint);
        const newScale = BB.clamp(
            transform.scale * (1 + 4 / 10) ** -e.deltaY,
            EASEL_MIN_SCALE,
            EASEL_MAX_SCALE,
        );
        this.setTargetTransform(
            createTransform(
                viewportPoint,
                canvasPoint,
                newScale,
                transform.angleDeg,
                transform.isMirrored,
            ),
            isImmediate,
        );
    };

    // ----------------------------------- public -----------------------------------
    constructor(p: TEaselParams<GToolId>) {
        this.project = p.project;
        this.width = p.width;
        this.height = p.height;
        this.toolId = p.tool;
        this.toolsMap = { ...p.tools };
        this.onChangeTool = p.onChangeTool;
        this.onTransformChange = p.onTransformChange;
        this.onUndo = p.onUndo;
        this.onRedo = p.onRedo;

        this.tempTools = Object.fromEntries(
            TEMP_TRIGGERS.map((trigger) => {
                return [
                    trigger,
                    getToolEntries(this.toolsMap)
                        .filter(([toolName, tool]) => {
                            return tool.tempTriggers && tool.tempTriggers.includes(trigger);
                        })
                        .map((i) => i[0])[0],
                ];
            }),
        ) as Record<TEaselToolTrigger, GToolId | undefined>;

        this.viewport = new ProjectViewport({
            width: this.width,
            height: this.height,
            project: {
                width: this.project.width,
                height: this.project.height,
                layers: this.project.layers,
                background: this.project.background,
            },
            transform: this.getResetTransform(),
            onBeforeRender: p.onBeforeRender,
            renderAfter: (ctx, renderedTransform) => {
                const tool = this.getActiveTool();
                tool.renderAfterViewport?.(ctx, renderedTransform);
            },
        });
        this.targetTransform = this.viewport.getTransform();

        Object.values<TEaselTool>(this.toolsMap).forEach((tool) => {
            tool.setEaselInterface?.(this.easelInterface);
            tool.onResize?.(this.width, this.height);
        });

        let mouseTempToolId: GToolId | undefined;

        let angleIsExtraSticky = false;
        this.pointerPreprocessor = new EaselPointerPreprocessor({
            onUndo: () => {
                if (KEY_BINDINGS.matches('onGesture', 'touchTwoFingerUndo', 'touch-two-finger-tap')) {
                    this.onUndo?.();
                }
            },
            onRedo: () => {
                if (
                    KEY_BINDINGS.matches(
                        'onGesture',
                        'touchThreeFingerRedo',
                        'touch-three-finger-tap',
                    )
                ) {
                    this.onRedo?.();
                }
            },
            onPinch: (event) => {
                if (
                    !KEY_BINDINGS.matches(
                        'onGesture',
                        'touchTwoFingerTransform',
                        'touch-two-finger-transform',
                    )
                ) {
                    return;
                }
                if (DIAGNOSTICS.isRecording()) {
                    DIAGNOSTICS.record('easel.gesture.pinch', { type: event.type });
                }
                if (event.type === 'move') {
                    const transform = this.viewport.getTransform();
                    if (!this.pinchInitialTransform) {
                        this.pinchInitialTransform = BB.copyObj(transform);
                        angleIsExtraSticky = this.pinchInitialTransform.angleDeg % 180 === 0;
                    }

                    let newAngleDeg =
                        this.pinchInitialTransform.angleDeg + (event.angleRad / Math.PI) * 180;
                    newAngleDeg = minimizeAngleDeg(
                        snapAngleDeg(newAngleDeg, 90, angleIsExtraSticky ? 12 : 4),
                    );
                    if (newAngleDeg % 90 !== 0) {
                        angleIsExtraSticky = false;
                    }

                    const metaTransform = toMetaTransform(this.pinchInitialTransform, {
                        x: event.downRelX,
                        y: event.downRelY,
                    });
                    metaTransform.scale = BB.clamp(
                        this.pinchInitialTransform.scale * event.scale,
                        EASEL_MIN_SCALE,
                        EASEL_MAX_SCALE,
                    );
                    metaTransform.viewportP.x += event.relX - event.downRelX;
                    metaTransform.viewportP.y += event.relY - event.downRelY;
                    metaTransform.angleDeg = newAngleDeg;

                    this.setTargetTransform(
                        createTransform(
                            metaTransform.viewportP,
                            metaTransform.canvasP,
                            metaTransform.scale,
                            metaTransform.angleDeg,
                            metaTransform.isMirrored,
                        ),
                        true,
                    );
                    this.requestRender();
                } else if (event.type === 'end') {
                    this.pinchInitialTransform = undefined;
                }
            },
            onDoubleTap: (e, gesture) => {
                const action =
                    gesture === 'mouse-middle-double-tap'
                        ? 'mouseMiddleDoubleTapFit'
                        : 'doubleTapFit';
                const gestureToken =
                    gesture === 'mouse-middle-double-tap'
                        ? 'mouse-middle-double-tap'
                        : 'double-tap';
                if (!KEY_BINDINGS.matches('onGesture', action, gestureToken)) {
                    return;
                }
                if (this.fitTransform()) {
                    this.requestRender();
                } else {
                    this.scale(2, e.relX, e.relY);
                }
            },
            onChainOut: (e) => {
                traceAppPointer('easel.after-gestures', e);
                if (DIAGNOSTICS.isRecording() && e.type === 'pointerdown') {
                    DIAGNOSTICS.record('easel.tool', { toolId: this.tempToolId ?? this.toolId });
                }
                this.cursorPos = {
                    x: e.relX,
                    y: e.relY,
                };
                if (e.type === 'pointerdown') {
                    const button = e.button ? 'Mouse' + e.button : '';
                    const action = ['eyedropper', 'hand', 'rotateView', 'zoom'].find(
                        (candidate) => KEY_BINDINGS.matches('whileHeld', candidate, button),
                    );
                    if (action) {
                        mouseTempToolId = this.getTempToolIdForAction(action);
                        this.pushTempTool(mouseTempToolId);
                    }
                } else if (e.type === 'pointermove') {
                    // noop?
                } else if (e.type === 'pointerup') {
                    if (mouseTempToolId !== undefined) {
                        this.getActiveTool().onPointer(e);
                        this.popTempTool(mouseTempToolId);
                        mouseTempToolId = undefined;
                        return;
                    }
                }
                // Temporary mouse tools interpret the configured button as their primary drag.
                this.getActiveTool().onPointer(mouseTempToolId !== undefined && e.button
                    ? { ...e, button: 'left' }
                    : e);
            },
        });
        /*
        // My trackpad pinching (via PointerListener) doesn't currently work with Safari on macOS.
        // So I tried GestureListener, which works, but doesn't mesh well with the other event listeners.
        let lastScale = 0;
        this.gestureListener = new GestureListener({
            target: this.viewport.getElement(),
            onStart: (e) => {
                lastScale = e.scale;
            },
            onChange: (e) => {
                const deltaScale = e.scale / lastScale;
                lastScale = e.scale;

                // zoom
                const transform = this.viewport.getTransform();
                const viewportPoint = {
                    x: e.layerX,
                    y: e.layerY,
                };
                const mat = createMatrixFromTransform(transform);
                const canvasPoint = applyToPoint(inverse(mat), viewportPoint);
                const newScale = BB.clamp(
                    transform.scale * deltaScale,
                    EASEL_MIN_SCALE,
                    EASEL_MAX_SCALE,
                );
                this.setTransform(
                    createTransform(viewportPoint, canvasPoint, newScale, transform.angleDeg),
                );
                this.requestRender();
            },
        });*/

        this.pointerListener = new PointerListener({
            target: this.viewport.getElement(),
            diagnosticLabel: 'easel',
            onPointer: (e) => {
                traceAppPointer('easel.before-gestures', e);
                const diagnosticStart = DIAGNOSTICS.isRecording() ? performance.now() : undefined;
                this.pointerPreprocessor.chainIn(e);
                if (diagnosticStart !== undefined) {
                    DIAGNOSTICS.measure('easel.input-dispatch', performance.now() - diagnosticStart);
                }
            },
            onWheel: this.onWheel,
            onEnterLeave: (isOver) => {
                const tool = this.getActiveTool();
                if (!isOver) {
                    this.cursorPos = undefined;
                    tool.onPointerLeave?.();
                }
            },
            useDirtyWheel: true,
            isWheelPassive: false,
            maxPointers: 3, // 3 fingers needed for redo gesture
        });

        this.windowPointerListener = (e: PointerEvent) => {
            if (this.isFrozen) {
                return;
            }
            if (!(e.target instanceof Node && this.rootEl.contains(e.target))) {
                this.getActiveTool().onClickOutside?.();
            }
        };
        window.addEventListener('pointerdown', this.windowPointerListener);

        this.keyListener = new KeyListener({
            onDown: (keyStr, e, comboStr, isRepeat) => {
                if (this.isFrozen || BB.isInputFocused(true)) {
                    return;
                }

                if (Object.keys(EASEL_PRESS_DEFAULTS).some((action) => KEY_BINDINGS.matches('onPress', action, comboStr)) ||
                    ['eyedropper', 'hand', 'rotateView', 'zoom'].some((action) => KEY_BINDINGS.matches('whileHeld', action, comboStr))) {
                    e.preventDefault();
                }

                if (KEY_BINDINGS.matches('onPress', 'zoomIn', comboStr)) {
                    const oldScale = this.getTransform().scale;
                    const newScale = zoomByStep(
                        oldScale,
                        KEY_BINDINGS.held('zoomFine', comboStr) ? 1 / 8 : 1 / 2,
                    );
                    this.scale(newScale / oldScale);
                }
                if (KEY_BINDINGS.matches('onPress', 'zoomOut', comboStr)) {
                    const oldScale = this.getTransform().scale;
                    const newScale = zoomByStep(
                        oldScale,
                        KEY_BINDINGS.held('zoomFine', comboStr) ? -1 / 8 : -1 / 2,
                    );
                    this.scale(newScale / oldScale);
                }
                const arrowAction = (
                    [
                        ['left', 'panLeft'],
                        ['right', 'panRight'],
                        ['up', 'panUp'],
                        ['down', 'panDown'],
                    ] as const
                ).find(([, action]) => KEY_BINDINGS.matches('onPress', action, comboStr));
                if (arrowAction) {
                    const arrowKey = arrowAction[0] as TArrowKey;
                    const activeTool = this.getActiveTool();
                    if (!activeTool.onArrowKeys?.(arrowKey)) {
                        const stepSize = 40;
                        if (arrowKey === 'left') {
                            this.translate(stepSize, 0);
                        }
                        if (arrowKey === 'right') {
                            this.translate(-stepSize, 0);
                        }
                        if (arrowKey === 'up') {
                            this.translate(0, stepSize);
                        }
                        if (arrowKey === 'down') {
                            this.translate(0, -stepSize);
                        }
                    }
                }

                if (KEY_BINDINGS.matches('onPress', 'rotateLeft', comboStr)) {
                    this.setAngleDeg(-15, true);
                }
                if (KEY_BINDINGS.matches('onPress', 'rotateRight', comboStr)) {
                    this.setAngleDeg(15, true);
                }
                if (KEY_BINDINGS.matches('onPress', 'resetRotation', comboStr)) {
                    this.setAngleDeg(0, false);
                }

                // activate temporary tool
                (['eyedropper', 'hand', 'rotateView', 'zoom'] as const).forEach((action) => {
                    const keyTrigger = this.getTempTriggerForAction(action);
                    if (
                        keyTrigger !== undefined &&
                        KEY_BINDINGS.matches('whileHeld', action, comboStr) &&
                        !(this.toolsMap[this.toolId].blockTrigger === keyTrigger &&
                            KEY_BINDINGS.held('selectionSubtract', comboStr))
                    ) {
                        this.pushTempTool(this.getTempToolIdForAction(action));
                    }
                });
                const tool = this.toolsMap[this.tempToolId ?? this.toolId];
                tool.onKeyDown?.(keyStr, e, comboStr, isRepeat);
            },
            onUp: (keyStr, e, oldComboStr) => {
                if (this.isFrozen) {
                    return;
                }

                // Turn off a temporary tool when the complete held binding is
                // released.  Checking the old combo also handles chords such
                // as Ctrl+Space when either key is released first.
                (['eyedropper', 'hand', 'rotateView', 'zoom'] as const).forEach((action) => {
                    const keyTrigger = this.getTempTriggerForAction(action);
                    if (
                        keyTrigger !== undefined &&
                        mouseTempToolId === undefined &&
                        this.tempToolId === this.getTempToolIdForAction(action) &&
                        !KEY_BINDINGS.held(action, this.keyListener.getComboStr())
                    ) {
                        this.popTempTool(this.getTempToolIdForAction(action));
                    }
                });
                const tool = this.toolsMap[this.tempToolId ?? this.toolId];
                tool.onKeyUp?.(keyStr, e, oldComboStr);
            },
            onBlur: () => {
                mouseTempToolId = undefined;
                if (this.tempToolId !== undefined) {
                    this.popTempTool(this.tempToolId);
                }
                const tool = this.toolsMap[this.tempToolId ?? this.toolId];
                tool.onBlur?.();
            },
        });
        this.unsubscribeKeyBindings = KEY_BINDINGS.subscribe(() => {
            mouseTempToolId = undefined;
            if (
                this.tempToolId !== undefined &&
                !this.isActiveTempBindingHeld(this.keyListener.getComboStr())
            ) {
                this.popTempTool(this.tempToolId);
            }
        });
        this.easelInterface.keyListener = this.keyListener;

        this.selectionRenderer = new SelectionRenderer({
            transform: this.viewport.getTransform(),
            selection: this.project.selection,
            width: this.width,
            height: this.height,
        });

        this.svgEl = BB.createSvg({
            elementType: 'svg',
            width: '' + this.width,
            height: '' + this.height,
        });
        css(this.svgEl, {
            position: 'absolute',
            left: 0,
            top: 0,
            pointerEvents: 'none',
        });
        this.svgEl.append(
            this.selectionRenderer.getElement(),
            ...Object.values<TEaselTool>(this.toolsMap).map((item) => item.getSvgElement()),
        );
        this.htmlOverlayEl = BB.el({
            css: {
                position: 'absolute',
                left: 0,
                top: 0,
            },
        });
        this.htmlOverlayEl.append(
            ...Object.values<TEaselTool>(this.toolsMap)
                .map((item) => item.getHtmlOverlayElement?.() || undefined)
                .filter((item) => item !== undefined),
        );
        this.updateToolSvgs();

        const createIndicator = (icon: IconName, title: string, onClick: () => void) => {
            const el = BB.el({
                content: getIconSvg(icon, { width: 20, height: 20 }),
                title,
                onClick,
                css: {
                    display: 'none',
                    padding: 5,
                    borderRadius: 5,
                    background: 'var(--canvas-overlay-bg)',
                    color: '#fff',
                    cursor: 'pointer',
                    pointerEvents: 'auto',
                },
            });
            // rootEl prevents default on touchend, which would suppress the click
            el.addEventListener('touchend', (e) => e.stopPropagation());
            return el;
        };
        this.mirrorIndicatorEl = createIndicator('view-flip', LANG('hand-flip'), () =>
            this.setIsMirrored(false),
        );
        this.selectionIndicatorEl = createIndicator(
            'select-mode-select',
            LANG('select-deselect'),
            p.onResetSelection,
        );
        this.selectionIndicatorEl.style.display = this.project.selection ? '' : 'none';
        const indicatorsEl = BB.el({
            css: {
                position: 'absolute',
                left: 5,
                bottom: 5,
                display: 'flex',
                gap: 5,
                pointerEvents: 'none',
            },
        });
        indicatorsEl.append(this.mirrorIndicatorEl, this.selectionIndicatorEl);

        this.rootEl = c(
            {
                css: {
                    userSelect: 'none',
                    touchAction: 'none',
                    overscrollBehaviorX: 'none',
                },
            },
            [this.viewport.getElement(), this.svgEl, this.htmlOverlayEl, indicatorsEl],
        );

        // prevent contextmenu
        this.rootEl.addEventListener(
            'contextmenu',
            (e) => {
                e.preventDefault();
                return false;
            },
            { passive: false },
        );

        // Carried over from old KlCanvasWorkspace. Prevent some default browser behavior. Todo what breaks if removed?
        this.rootEl.addEventListener('touchend', (e) => {
            e.preventDefault();
            return false;
        });
        // Carried over from old KlCanvasWorkspace. Prevent some default browser behavior. Todo what breaks if removed?
        this.rootEl.addEventListener('dragstart', (e) => {
            e.preventDefault();
            return false;
        });

        this.toolsMap[this.toolId].activate?.(this.cursorPos);
        Object.values<TEaselTool>(this.toolsMap).forEach((tool) => tool.onTool?.(this.toolId));
        {
            // adjust the transform without triggering a render
            const doRender = this.doRender;
            this.resetOrFitTransform(true);
            this.doRender = doRender;
        }
        this.renderLoop();
    }

    // update and render
    setProject(project: TEaselProject): void {
        this.project = project;
        this.viewport.setProject({
            width: this.project.width,
            height: this.project.height,
            layers: this.project.layers,
            background: this.project.background,
        });
        this.selectionRenderer.setSelection(this.project.selection);
        this.selectionIndicatorEl.style.display = this.project.selection ? '' : 'none';
        this.getActiveTool().onUpdateSelection?.(this.project.selection);
        this.requestRender();
    }

    // update and render
    setSize(width: number, height: number): void {
        const m = createMatrixFromTransform(this.viewport.getTransform());
        const canvasCenterPoint = applyToPoint(inverse(m), {
            x: this.width / 2,
            y: this.height / 2,
        });

        this.width = width;
        this.height = height;
        BB.setAttributes(this.svgEl, {
            width: '' + this.width,
            height: '' + this.height,
        });
        this.selectionRenderer.setSize(width, height);
        this.getActiveTool().onResize?.(width, height);
        this.viewport.setSize(width, height);
        const transform = this.viewport.getTransform();
        this.setTargetTransform(
            createTransform(
                {
                    x: this.width / 2,
                    y: this.height / 2,
                },
                canvasCenterPoint,
                transform.scale,
                transform.angleDeg,
                transform.isMirrored,
            ),
            true,
        );

        this.requestRender();
    }

    requestRender(): void {
        this.doRender = true;
    }

    getTransform(): TViewportTransform {
        return this.viewport.getTransform();
    }

    setTransform(transform: TViewportTransform): void {
        this.setTargetTransform(transform, true);
    }

    setTool(toolId: GToolId): void {
        if (toolId === this.toolId) {
            return;
        }
        this.toolId = toolId;
        this.toolsMap[this.toolId].activate?.(this.cursorPos);
        Object.values<TEaselTool>(this.toolsMap).forEach((tool) => tool.onTool?.(this.toolId));
        this.onChangeTool(toolId);
        this.updateToolSvgs();
        this.updateDoubleTapPointerTypes();
        this.requestRender();
    }

    getTool(): GToolId {
        return this.toolId;
    }

    translate(dX: number, dY: number): void {
        const transform = this.targetTransform;
        this.setTargetTransform({
            ...transform,
            x: transform.x + dX,
            y: transform.y + dY,
        });
    }

    scale(factor: number, viewportX?: number, viewportY?: number): void {
        const before = this.targetTransform;
        const viewportRect = { width: this.width, height: this.height };
        viewportX = viewportX ?? viewportRect.width / 2;
        viewportY = viewportY ?? viewportRect.height / 2;

        const metaTransform = toMetaTransform(before, { x: viewportX, y: viewportY });
        metaTransform.scale = BB.clamp(
            metaTransform.scale * factor,
            EASEL_MIN_SCALE,
            EASEL_MAX_SCALE,
        );

        this.setTargetTransform(
            createTransform(
                metaTransform.viewportP,
                metaTransform.canvasP,
                metaTransform.scale,
                metaTransform.angleDeg,
                metaTransform.isMirrored,
            ),
        );
    }

    resetTransform(isImmediate?: boolean): void {
        const transform = this.getResetTransform(this.targetTransform.isMirrored);
        this.setTargetTransform(transform, isImmediate);
        this.requestRender();
    }

    fitTransform(isImmediate?: boolean): boolean {
        const oldTransform = this.viewport.getTransform();
        const transform = this.getFitTransform();

        const isPositionChanged = transform.x !== oldTransform.x || transform.y !== oldTransform.y;
        const isScaleOrAngleChanged =
            transform.scale !== oldTransform.scale || transform.angleDeg !== oldTransform.angleDeg;

        if (!isPositionChanged && !isScaleOrAngleChanged) {
            return false;
        }

        this.setTargetTransform(transform, isImmediate);
        return true;
    }

    /**
     * Automatically decide what is best. E.g. if it's pixel art, Fit might be better.
     */
    resetOrFitTransform(isImmediate?: boolean): void {
        const threshold = 4; // >= 400% zoom. pixelated, not blurry
        if (
            !KL_CONFIG.disableAutoFit &&
            this.project.width <= this.width / threshold &&
            this.project.height <= this.height / threshold
        ) {
            this.fitTransform(isImmediate);
        } else {
            this.resetTransform(isImmediate);
        }
    }

    setAngleDeg(angleDeg: number, isRelative: undefined | boolean) {
        const viewportTransform = this.targetTransform;
        const viewportMat = createMatrixFromTransform(viewportTransform);
        const viewportRect = { width: this.width, height: this.height };
        const viewportCenterP = {
            x: viewportRect.width / 2,
            y: viewportRect.height / 2,
        };
        const newAngleDeg = minimizeAngleDeg(
            isRelative ? viewportTransform.angleDeg + angleDeg : angleDeg,
        );

        const newViewportTransform = createTransform(
            viewportCenterP,
            applyToPoint(inverse(viewportMat), viewportCenterP),
            viewportTransform.scale,
            newAngleDeg,
            viewportTransform.isMirrored,
        );
        this.setTargetTransform(newViewportTransform);
    }

    setIsMirrored(isMirrored: boolean): void {
        if (isMirrored === this.getIsMirrored()) {
            return;
        }
        const transform = this.targetTransform;
        const viewportCenterP = { x: this.width / 2, y: this.height / 2 };
        this.setTargetTransform(
            createTransform(
                viewportCenterP,
                applyToPoint(inverse(createMatrixFromTransform(transform)), viewportCenterP),
                transform.scale,
                minimizeAngleDeg(-transform.angleDeg),
                isMirrored,
            ),
            true,
        );
        this.mirrorIndicatorEl.style.display = isMirrored ? '' : 'none';
    }

    getIsMirrored(): boolean {
        return this.targetTransform.isMirrored;
    }

    getIsLocked(): boolean {
        return this.getActiveTool().getIsLocked?.() ?? false;
    }

    setIsFrozen(b: boolean): void {
        this.isFrozen = b;
    }

    getElement(): HTMLElement {
        return this.rootEl;
    }

    destroy(): void {
        this.viewport.destroy();
        this.pointerListener.destroy();
        this.keyListener.destroy();
        this.unsubscribeKeyBindings?.();
        this.unsubscribeKeyBindings = undefined;
        this.animationFrameId !== undefined && cancelAnimationFrame(this.animationFrameId);
        this.selectionRenderer.destroy();
        window.removeEventListener('pointerdown', this.windowPointerListener);
    }
}
