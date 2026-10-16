import { APP_PRESS_DEFAULTS } from '../bb/input/keybindings-app-defaults';
import { DIAGNOSTICS } from '../bb/diagnostics/diagnostics';
import { getIconUrl } from '../icon/icon';
import { KL } from '../klecks/kl';
import { TBrushId } from '../klecks/brushes-ui/brushes-ui';
import { BB } from '../bb/bb';
import { showIframeModal } from '../klecks/ui/modals/show-iframe-modal';
import { EmbedToolspaceTopRow } from '../embed/embed-toolspace-top-row';
import {
    TBrushUiInstance,
    TDeserializedKlStorageProject,
    TDrawEvent,
    TExportType,
    TGradient,
    TKlProject,
    TRgb,
    TUiLayout,
    isLayerFill,
} from '../klecks/kl-types';
import { importFilters } from '../klecks/filters/filters-lazy';
import { klCanvasToPsdBlob } from '../klecks/storage/kl-canvas-to-psd-blob';
import { ProjectStore } from '../klecks/storage/project-store';
import { SaveReminder } from '../klecks/ui/components/save-reminder';
import { KlCanvas } from '../klecks/canvas/kl-canvas';
import { LANG } from '../language/language';
import { LocalStorage } from '../bb/base/local-storage';
import { LineSmoothing } from '../klecks/events/line-smoothing';
import { LineSanitizer } from '../klecks/events/line-sanitizer';
import { TabRow } from '../klecks/ui/components/tab-row';
import { LayerPreview } from '../klecks/ui/components/layer-preview';
import { KlColorSlider } from '../klecks/ui/components/kl-color-slider';
import { ToolspaceToolRow } from '../klecks/ui/components/toolspace-tool-row';
import { StatusOverlay } from '../klecks/ui/components/status-overlay';
import { SaveToComputer } from '../klecks/storage/save-to-computer';
import { ToolspaceScroller } from '../klecks/ui/components/toolspace-scroller';
import { translateSmoothing } from '../klecks/utils/translate-smoothing';
import { KlAppImportHandler } from './kl-app-import-handler';
import { LayersUi, TLayerEditTarget } from '../klecks/ui/tool-tabs/layers-ui/layers-ui';
import { TCss, TVector2D } from '../bb/bb-types';
import { asyncThrow, css, getFilenameDate, randomUuid, sleep } from '../bb/base/base';
import { createConsoleApi } from './console-api';
import { KL_CONFIG } from '../klecks/kl-config';
import { TRenderTextParam } from '../klecks/image-operations/render-text';
import { Easel } from '../klecks/ui/easel/easel';
import { EaselHand } from '../klecks/ui/easel/tools/easel-hand';
import { EaselBrush } from '../klecks/ui/easel/tools/easel-brush';
import { EaselProjectUpdater } from '../klecks/ui/easel/easel-project-updater';
import { zoomByStep } from '../klecks/ui/project-viewport/utils/zoom-by-step';
import { EaselEyedropper } from '../klecks/ui/easel/tools/easel-eyedropper';
import { EaselPaintBucket } from '../klecks/ui/easel/tools/easel-paint-bucket';
import { EaselGradient } from '../klecks/ui/easel/tools/easel-gradient';
import { EaselText } from '../klecks/ui/easel/tools/easel-text';
import { EaselShape } from '../klecks/ui/easel/tools/easel-shape';
import { EaselRotate } from '../klecks/ui/easel/tools/easel-rotate';
import { EaselZoom } from '../klecks/ui/easel/tools/easel-zoom';
import { KlAppSelect } from './kl-app-select';
import { KlTempHistory } from '../klecks/history/kl-temp-history';
import { PinchZoomWatcher } from '../klecks/ui/components/pinch-zoom-watcher';
import { EASEL_MAX_SCALE, EASEL_MIN_SCALE } from '../klecks/ui/easel/easel.config';
import { THistoryEntryDataComposed } from '../klecks/history/history.types';
import { KlHistoryExecutor, THistoryExecutionType } from '../klecks/history/kl-history-executor';
import { HISTORY_TILE_SIZE, KlHistory } from '../klecks/history/kl-history';
import { isHistoryEntryActiveLayerChange } from '../klecks/history/push-helpers/is-history-entry-active-layer-change';
import { MobileUi } from '../klecks/ui/mobile/mobile-ui';
import { MobileToolUi } from '../klecks/ui/mobile/mobile-tool-ui';
import { canvasToBlob } from '../bb/base/canvas';
import { projectToComposed } from '../klecks/history/push-helpers/project-to-composed';
import { KlRecoveryManager } from '../klecks/storage/kl-recovery-manager';
import { UnloadWarningTrigger } from '../klecks/ui/components/unload-warning-trigger';
import { KL_INDEXED_DB } from '../klecks/storage/kl-indexed-db';
import { showError, showModal } from '../klecks/ui/modals/base/show-modal';
import { runBrowserStorageBanner } from '../klecks/ui/components/browser-storage-banner';
import { requestPersistentStorage } from '../klecks/storage/request-persistent-storage';
import { CrossTabChannel } from '../bb/base/cross-tab-channel';
import { MobileColorUi } from '../klecks/ui/mobile/mobile-color-ui';
import { PixelBrush } from '../klecks/brushes/pixel-brush';
import { BlendBrush } from '../klecks/brushes/blend-brush';
import { PenBrush } from '../klecks/brushes/pen-brush';
import { getSelectionPath2d } from '../bb/multi-polygon/get-selection-path-2d';
import { ToolspaceTopRow } from '../klecks/ui/components/toolspace-top-row';
import { setupUnfocusOnClickService } from '../klecks/ui/onfocus-on-click-service';
import { FloatingLayerPreview } from '../klecks/ui/components/floating-layer-preview';
import { isGroupLayer } from '../klecks/canvas/layer-tree';
import { KEY_BINDINGS } from '../bb/input/keybindings';

const toolPaintImg = getIconUrl('tool-paint');
const toolHandImg = getIconUrl('tool-hand');
const toolFillImg = getIconUrl('tool-fill');
const toolGradientImg = getIconUrl('tool-gradient');
const toolTextImg = getIconUrl('tool-text');
const toolShapeImg = getIconUrl('tool-shape');
const toolSelectImg = getIconUrl('tool-select');
const tabSettingsImg = getIconUrl('tab-settings');
const tabLayersImg = getIconUrl('tab-layers');
const tabEditImg = getIconUrl('tab-edit');
importFilters();

/**
 * Toolspace shrinks as the window gets shorter: first the color slider, then the tool row and
 * layer preview become small, then the layer preview hides. Only after that does it overflow.
 */
function getToolspaceLayout(uiHeight: number): {
    isLayerPreviewVisible: boolean;
    isLayerPreviewSmall: boolean;
    isToolRowSmall: boolean;
    colorSliderHeight: number;
} {
    // everything but color slider, with layer preview and large tool row.
    // Measured with the tallest brush tab, so it fits with 10px spacing above the bottom bar.
    const otherContentHeight = 447;
    const toolRowSaving = 18; // when small
    const layerPreviewSmallSaving = 4; // 36px instead of 40px
    const colorSliderMin = 158;
    const colorSliderMax = 400;

    let available = uiHeight - otherContentHeight;
    const isToolRowSmall = available < colorSliderMin;
    if (isToolRowSmall) {
        available += toolRowSaving + layerPreviewSmallSaving;
    }
    const isLayerPreviewSmall = isToolRowSmall;
    const isLayerPreviewVisible = available >= colorSliderMin;
    if (!isLayerPreviewVisible) {
        available += isLayerPreviewSmall ? 26 : 30; // hidden preview keeps a 10px bottom margin
    }
    return {
        isLayerPreviewVisible,
        isLayerPreviewSmall,
        isToolRowSmall,
        colorSliderHeight: Math.max(colorSliderMin, Math.min(colorSliderMax, available)),
    };
}

type TKlAppOptionsEmbed = {
    url: string;
    enableImageDropperImport?: boolean; // default false
    onSubmit: (onSuccess: () => void, onError: () => void) => void;
};

export type TKlAppParams = {
    project?: TKlProject;
    logoImg?: string; // app logo
    bottomBar?: HTMLElement; // row at bottom of toolspace
    helpPath?: string; // default help.html
    embed?: TKlAppOptionsEmbed;
    app?: {
        imgurKey?: string; // for imgur uploads
    };
    aboutEl?: HTMLElement; // replaces info about Klecks in settings tab
    klRecoveryManager?: KlRecoveryManager; // undefined if IndexedDB fails connecting
};

type TKlAppToolId =
    | 'hand'
    | 'brush'
    | 'select'
    | 'eyedropper'
    | 'paintBucket'
    | 'gradient'
    | 'text'
    | 'shape'
    | 'rotate'
    | 'zoom';

export class KlApp {
    private readonly rootEl: HTMLElement;
    private uiWidth: number;
    private uiHeight: number;
    private readonly helpPath: string;
    private readonly layerPreview: LayerPreview;
    private readonly floatingLayerPreview: FloatingLayerPreview;
    private readonly klColorSlider: KlColorSlider;
    private readonly toolspaceToolRow: ToolspaceToolRow;
    private readonly statusOverlay: StatusOverlay;
    private readonly klCanvas: KlCanvas;
    private uiLayout: TUiLayout;
    private readonly embed: undefined | TKlAppOptionsEmbed;
    private readonly saveToComputer: SaveToComputer;
    private readonly lineSanitizer: LineSanitizer;
    private readonly easel: Easel<TKlAppToolId>;
    private readonly easelProjectUpdater: EaselProjectUpdater<TKlAppToolId>;
    private readonly easelBrush: EaselBrush;
    private readonly collapseThreshold: number = 820;
    private readonly mobileUi: MobileUi;
    private readonly mobileToolUi: MobileToolUi;
    private readonly mobileColorUi: MobileColorUi;
    private readonly toolspace: HTMLElement;
    private readonly toolspaceInner: HTMLElement;
    private readonly toolWidth: number = 271;
    private readonly toolspaceTopRow: ToolspaceTopRow | EmbedToolspaceTopRow;
    private readonly bottomBar: HTMLElement | undefined;
    private readonly layersUi: LayersUi;
    private readonly toolspaceScroller: ToolspaceScroller;
    private readonly bottomBarWrapper: HTMLElement;
    private readonly saveReminder: SaveReminder | undefined;
    private readonly unloadWarningTrigger: UnloadWarningTrigger | undefined;
    private lastSavedHistoryIndex: number = 0;
    private readonly klHistory: KlHistory;

    private updateLastSaved(): void {
        this.lastSavedHistoryIndex = this.klHistory.getTotalIndex();
        this.saveReminder?.reset();
        this.unloadWarningTrigger?.update();
    }

    private updateCollapse(): void {
        this.mobileUi.setOrientation(this.uiLayout);
        if (this.uiWidth < this.collapseThreshold) {
            this.mobileUi.setIsVisible(true);
            if (this.mobileUi.getToolspaceIsOpen()) {
                if (this.uiLayout === 'left') {
                    css(this.easel.getElement(), {
                        left: 271,
                    });
                } else {
                    css(this.easel.getElement(), {
                        left: 0,
                    });
                }
                this.toolspace.style.display = 'block';
                this.easel.setSize(Math.max(0, this.uiWidth - this.toolWidth), this.uiHeight);
                this.statusOverlay.setWide(false);
            } else {
                if (this.uiLayout === 'left') {
                    css(this.easel.getElement(), {
                        left: 0,
                    });
                } else {
                    css(this.easel.getElement(), {
                        left: 0,
                    });
                }
                this.toolspace.style.display = 'none';
                this.easel.setSize(Math.max(0, this.uiWidth), this.uiHeight);
                this.statusOverlay.setWide(true);
            }
        } else {
            this.mobileUi.setIsVisible(false);
            if (this.uiLayout === 'left') {
                css(this.easel.getElement(), {
                    left: 271,
                });
            }
            this.toolspace.style.display = 'block';
            this.easel.setSize(Math.max(0, this.uiWidth - this.toolWidth), this.uiHeight);
            this.statusOverlay.setWide(false);
        }
    }

    private updateUi(): void {
        this.toolspace.classList.toggle('kl-toolspace--left', this.uiLayout === 'left');
        this.toolspace.classList.toggle('kl-toolspace--right', this.uiLayout === 'right');
        if (this.uiLayout === 'left') {
            css(this.toolspace, {
                left: 0,
                right: '',
            });
            css(this.easel.getElement(), {
                left: 271,
            });
        } else {
            css(this.toolspace, {
                left: '',
                right: 0,
            });
            css(this.easel.getElement(), {
                left: 0,
            });
        }
        this.statusOverlay.setUiState(this.uiLayout);
        this.floatingLayerPreview.setUiState(this.uiLayout);
        this.updateCollapse();
        this.toolspaceScroller.updateUiState(this.uiLayout);
    }

    // ----------------------------------- public -----------------------------------

    constructor(p: TKlAppParams) {
        setupUnfocusOnClickService();
        this.embed = p.embed;
        this.helpPath = p.helpPath ?? 'help.html';
        const maxCanvasSize = 8192;
        this.uiLayout = (
            this.embed
                ? 'left'
                : LocalStorage.getItem('uiState')
                  ? LocalStorage.getItem('uiState')
                  : 'right'
        ) as TUiLayout;
        const projectStore = KL_INDEXED_DB.getIsAvailable() ? new ProjectStore() : undefined;
        this.rootEl = BB.el({
            className: 'g-root',
            css: {
                position: 'absolute',
                left: 0,
                top: 0,
                right: 0,
                bottom: 0,
            },
        });

        this.uiWidth = Math.max(0, window.innerWidth);
        this.uiHeight = Math.max(0, window.innerHeight);
        let exportType: TExportType = 'png';

        const initialWidth = Math.max(
            10,
            Math.min(
                maxCanvasSize,
                window.innerWidth < this.collapseThreshold
                    ? this.uiWidth
                    : this.uiWidth - this.toolWidth,
            ),
        );
        const initialHeight = Math.max(10, Math.min(maxCanvasSize, this.uiHeight));

        this.klHistory = new KlHistory({
            oldest: projectToComposed(
                p.project ?? {
                    projectId: randomUuid(),
                    width: initialWidth,
                    height: initialHeight,
                    background: 'white',
                    layers: [
                        {
                            name: LANG('layers-layer') + ' 1', // not ideal
                            opacity: 1,
                            isVisible: true,
                            mixModeStr: 'source-over',
                            hasClipping: false,
                            image: {
                                fill: 'transparent',
                            },
                        },
                    ],
                },
            ),
        });
        const klRecoveryManager = p.klRecoveryManager;
        if (klRecoveryManager) {
            klRecoveryManager.setKlHistory(this.klHistory);
            klRecoveryManager.setGetThumbnail((factor) =>
                this.klCanvas.getCanvas(factor, false, true),
            );
        }
        if (p.project) {
            // attempt at freeing memory
            p.project.layers.forEach((layer) => {
                if (layer.image instanceof HTMLCanvasElement) {
                    BB.freeCanvas(layer.image);
                }
                layer.image = null as any;
            });
        }

        this.klCanvas = new KL.KlCanvas(this.klHistory, this.embed ? -1 : 1);
        const tempHistory = new KlTempHistory();
        let mainTabRow: TabRow | undefined = undefined;

        const clearLayer = (showStatus?: boolean, ignoreSelection?: boolean) => {
            if (currentLayerTarget === 'mask') {
                finishMaskStroke();
                const context = this.klCanvas.getLayerMaskContext(currentLayerIndex);
                if (!context) {
                    return;
                }
                context.save();
                context.fillStyle = '#fff';
                context.fillRect(0, 0, context.canvas.width, context.canvas.height);
                context.restore();
                this.klCanvas.markLayerMaskChanged(currentLayerIndex);
                this.klCanvas.pushLayerMaskHistory(currentLayerIndex);
                this.easelProjectUpdater.update();
                return;
            }
            if (isCurrentLayerGroup()) {
                return;
            }
            applyUncommitted();
            const layerIndex = currentLayerIndex;
            this.klCanvas.eraseLayer({
                layerIndex,
                useAlphaLock: layerIndex === 0 && !brushUiMap.eraserBrush.getIsTransparentBg(),
                useSelection: !ignoreSelection,
            });
            showStatus &&
                this.statusOverlay.out(
                    this.klCanvas.getSelection()
                        ? LANG('cleared-selected-area')
                        : LANG('cleared-layer'),
                    true,
                );
        };

        let currentColor = new BB.RGB(0, 0, 0);
        let currentBrushUi: TBrushUiInstance<any>;
        let currentBrushId: TBrushId;
        DIAGNOSTICS.setProjectProvider(() => {
            const layers = this.klCanvas.getLayers();
            const entries = this.klHistory.getEntries();
            return {
                width: this.klCanvas.getWidth(),
                height: this.klCanvas.getHeight(),
                layerCount: layers.length,
                paintLayerCount: layers.filter((layer) => !layer.groupId).length,
                maskCount: layers.filter((layer) => !!layer.mask).length,
                visibleLayerCount: layers.filter((layer) => layer.isVisible && layer.opacity > 0).length,
                background: this.klCanvas.getBackground(),
                historyEntryCount: entries.length,
                historyEstimatedBytes: entries.reduce((sum, entry) => sum + entry.memoryEstimateBytes, 0),
                brushId: currentBrushId,
                brushSize: currentBrushUi?.getSize(),
                brushOpacity: currentBrushUi?.getOpacity(),
                maxCanvasSize,
            };
        });
        let lastNonEraserBrushId: TBrushId;
        let currentLayerIndex: number = this.klCanvas.getLayerCount() - 1;
        let currentLayerTarget: TLayerEditTarget = 'image';
        let maskControls: HTMLElement | undefined;
        const maskEraserBrush = new PenBrush();
        maskEraserBrush.setHistory(this.klHistory);
        let maskBrush: PenBrush | BlendBrush = maskEraserBrush;
        let maskStrokeActive = false;
        let maskStrokeLayerIndex = -1;
        const supportsMaskBrush = (id: TBrushId) =>
            id === 'penBrush' || id === 'blendBrush' || id === 'eraserBrush';
        const restoreImageBrush = () => {
            currentBrushUi.setLayer(this.klCanvas.getLayer(currentLayerIndex));
            currentBrushUi.setColor(currentColor);
        };
        const prepareMaskBrush = () => {
            const context = this.klCanvas.getLayerMaskContext(currentLayerIndex)!;
            if (currentBrushId === 'eraserBrush') {
                maskBrush = maskEraserBrush;
                maskBrush.setContext(context);
                maskBrush.setSize(currentBrushUi.getSize());
                maskBrush.setOpacity(currentBrushUi.getOpacity());
                maskBrush.setColor({ r: 0, g: 0, b: 0 });
            } else {
                // Reuse the UI-owned brush so tip, scatter and pressure settings stay in sync.
                maskBrush = currentBrushUi.getBrush() as PenBrush | BlendBrush;
                if (maskBrush instanceof BlendBrush) {
                    maskBrush.setContext(context, this.klCanvas.getLayer(currentLayerIndex).id, 'mask');
                } else {
                    maskBrush.setContext(context);
                }
                maskBrush.setColor(maskColor(currentColor));
            }
        };
        const finishMaskStroke = () => {
            if (!maskStrokeActive) {
                return;
            }
            maskStrokeActive = false;
            const layerIndex = maskStrokeLayerIndex;
            try {
                maskBrush.endLine();
            } finally {
                restoreImageBrush();
                this.klHistory.pause(false);
                this.toolspace.style.pointerEvents = '';
                this.klCanvas.markLayerMaskChanged(layerIndex);
                this.klCanvas.pushLayerMaskHistory(layerIndex);
                this.easelProjectUpdater.update();
                this.easel.requestRender();
            }
        };
        const maskColor = (color: TRgb): TRgb => {
            const gray = Math.round(color.r * 0.2126 + color.g * 0.7152 + color.b * 0.0722);
            return { r: gray, g: gray, b: gray };
        };
        const isCurrentLayerGroup = () => isGroupLayer(this.klCanvas.getLayer(currentLayerIndex));

        // when cycling through brushes you need to know the next non-eraser brush
        const getNextBrushId = (): TBrushId => {
            if (currentLayerTarget === 'mask') {
                return currentBrushId === 'eraserBrush'
                    ? (supportsMaskBrush(lastNonEraserBrushId) ? lastNonEraserBrushId : 'penBrush')
                    : 'eraserBrush';
            }
            if (currentBrushId === 'eraserBrush') {
                return lastNonEraserBrushId;
            }
            const keyArr = (Object.keys(KL.BRUSHES_UI) as TBrushId[]).filter(
                (item) => item !== 'eraserBrush',
            );
            const i = keyArr.findIndex((item) => item === currentBrushId);
            return keyArr[(i + 1) % keyArr.length];
        };

        const sizeWatcher = (val: number) => {
            brushSettingService.emitSize(val);
            if (this.easelBrush) {
                this.easelBrush.setBrush({ radius: val });
            }
        };

        const brushSettingService = new KL.BrushSettingService({
            onSetColor: (color) => {
                this.klColorSlider.setColor(color);
                currentBrushUi.setColor(color);
                this.mobileColorUi.setColor(color);
                currentColor = BB.copyObj(color);
            },
            onSetSize: (size) => {
                currentBrushUi.setSize(size);
                this.easelBrush.setBrush({ radius: size });
            },
            onSetOpacity: (opacity) => {
                currentBrushUi.setOpacity(opacity);
            },
            onGetColor: () => this.klColorSlider.getColor(),
            onGetSize: () => brushUiMap[currentBrushId].getSize(),
            onGetOpacity: () => brushUiMap[currentBrushId].getOpacity(),
            onGetSliderConfig: () => {
                return {
                    sizeSlider: KL.BRUSHES_UI[currentBrushId].sizeSlider,
                    opacitySlider: KL.BRUSHES_UI[currentBrushId].opacitySlider,
                };
            },
        });

        const lineSmoothing = new LineSmoothing({
            smoothing: translateSmoothing(1),
        });
        this.lineSanitizer = new LineSanitizer();

        const drawEventChain = new BB.EventChain({
            chainArr: [this.lineSanitizer as any, lineSmoothing as any],
        });

        drawEventChain.setChainOut(((event: TDrawEvent) => {
            if (event.type === 'up' && maskStrokeActive) {
                finishMaskStroke();
                return;
            }
            if (currentLayerTarget === 'mask' && this.klCanvas.getLayerMaskContext(currentLayerIndex)) {
                if (event.type === 'down') {
                    prepareMaskBrush();
                    maskStrokeLayerIndex = currentLayerIndex;
                    this.klHistory.pause(true);
                    maskStrokeActive = true;
                    try {
                        maskBrush.startLine(event.x, event.y, event.pressure ?? 1);
                    } catch (error) {
                        maskStrokeActive = false;
                        restoreImageBrush();
                        this.klHistory.pause(false);
                        this.toolspace.style.pointerEvents = '';
                        throw error;
                    }
                    this.toolspace.style.pointerEvents = 'none';
                } else if (event.type === 'move' && maskStrokeActive) {
                    try {
                        if (maskBrush instanceof BlendBrush) {
                            maskBrush.goLine(event.x, event.y, event.pressure ?? 1, false);
                        } else {
                            maskBrush.goLine(event.x, event.y, event.pressure ?? 1);
                        }
                    } catch (error) {
                        finishMaskStroke();
                        throw error;
                    }
                } else if (event.type === 'line') {
                    prepareMaskBrush();
                    this.klHistory.pause(true);
                    try {
                        maskBrush.drawLineSegment(event.x0 ?? event.x1, event.y0 ?? event.y1, event.x1, event.y1);
                    } finally {
                        restoreImageBrush();
                        this.klHistory.pause(false);
                    }
                } else {
                    return;
                }
                if (maskBrush instanceof BlendBrush) {
                    maskBrush.transferToCanvas();
                }
                this.klCanvas.markLayerMaskChanged(currentLayerIndex);
                if (event.type === 'line') {
                    this.klCanvas.pushLayerMaskHistory(currentLayerIndex);
                }
                this.easelBrush.setLastDrawEvent(
                    event.type === 'line'
                        ? { x: event.x1, y: event.y1 }
                        : { x: event.x, y: event.y },
                );
                this.easelProjectUpdater.update();
                this.easel.requestRender();
                return;
            }
            if (isCurrentLayerGroup()) {
                if (event.type === 'up') {
                    this.toolspace.style.pointerEvents = '';
                }
                return;
            }
            const diagnosticStart = DIAGNOSTICS.isRecording() ? performance.now() : undefined;
            if (diagnosticStart !== undefined) {
                DIAGNOSTICS.record('brush.dispatch', { ...event, brushId: currentBrushId });
            }
            if (event.type === 'down') {
                this.toolspace.style.pointerEvents = 'none';
                currentBrushUi.startLine(event.x, event.y, event.pressure);
                this.easelBrush.setLastDrawEvent({ x: event.x, y: event.y });
                this.easel.requestRender();
            }
            if (event.type === 'move') {
                currentBrushUi.goLine(event.x, event.y, event.pressure, event.isCoalesced);
                this.easelBrush.setLastDrawEvent({ x: event.x, y: event.y });
                this.easel.requestRender();
            }
            if (event.type === 'up') {
                this.toolspace.style.pointerEvents = '';
                currentBrushUi.endLine();
                this.easel.requestRender();
            }
            if (event.type === 'line') {
                currentBrushUi.getBrush().drawLineSegment(event.x0, event.y0, event.x1, event.y1);
                this.easelBrush.setLastDrawEvent({ x: event.x1, y: event.y1 });
                this.easel.requestRender();
            }
            if (diagnosticStart !== undefined) {
                DIAGNOSTICS.measure('brush.dispatch.' + event.type, performance.now() - diagnosticStart);
            }
        }) as any);

        let textToolSettings = {
            size: 20,
            align: 'left' as 'left' | 'center' | 'right',
            isBold: false,
            isItalic: false,
            font: 'sans-serif',
            letterSpacing: 0,
            lineHeight: 1,
            fill: {
                color: { r: 0, g: 0, b: 0, a: 1 },
            },
        } as TRenderTextParam;

        /**
         * Uncommited action is something like select tool > transform which puts the canvas and UI into
         * a temporary state. Changes need to be committed or discarded *before* doing something else.
         *
         * returns true if something was applied
         */
        const applyUncommitted = (): boolean => {
            return klAppSelect.commitTransform();
        };

        /** see applyUncommitted **/
        const discardUncommitted = (): boolean => {
            return klAppSelect.discardTransform();
        };

        const propagateUndoRedoChanges = (
            type: THistoryExecutionType,
            composedBefore: THistoryEntryDataComposed,
        ) => {
            if (['undo', 'redo'].includes(type)) {
                const composedAfter = this.klHistory.getComposed();

                this.klCanvas.updateViaComposed(composedBefore!, composedAfter);

                setCurrentLayer(composedAfter.layerMap[composedAfter.activeLayerId].index);
                this.easelProjectUpdater.update(); // triggers render

                const dimensionChanged =
                    composedBefore.size.width !== composedAfter.size.width ||
                    composedBefore.size.height !== composedAfter.size.height;
                if (dimensionChanged) {
                    this.easel.resetOrFitTransform(true);
                }
                this.easelBrush.setLastDrawEvent();
                this.layersUi.update(currentLayerIndex);
            }

            klAppSelect.onHistory(type);
        };

        const undo = (showMessage?: boolean) => {
            finishMaskStroke();
            if (!tempHistory.canDecreaseIndex()) {
                discardUncommitted();
            }
            const composedBefore = this.klHistory.getComposed();
            const result = klHistoryExecutor.undo();
            if (!result) {
                // didn't do anything
                return;
            }
            propagateUndoRedoChanges(result.type, composedBefore);
            if (showMessage) {
                this.statusOverlay.out(LANG('undo'), true);
            }
        };

        const redo = (showMessage?: boolean) => {
            finishMaskStroke();
            const composedBefore = this.klHistory.getComposed();
            const result = klHistoryExecutor.redo();
            if (!result) {
                // didn't do anything
                return;
            }
            propagateUndoRedoChanges(result.type, composedBefore);
            if (showMessage) {
                this.statusOverlay.out(LANG('redo'), true);
            }
        };

        this.statusOverlay = new KL.StatusOverlay();

        const klAppSelect = new KlAppSelect({
            klCanvas: this.klCanvas,
            onChangeMode: () => this.mobileToolUi.update(),
            getCurrentLayerIndex: () => currentLayerIndex,
            onUpdateProject: () => this.easelProjectUpdater.update(),
            klHistory: this.klHistory,
            tempHistory,
            statusOverlay: this.statusOverlay,
            onFill: () => {
                if (currentLayerTarget === 'mask' || isCurrentLayerGroup()) {
                    return;
                }
                this.klCanvas.layerFill(
                    currentLayerIndex,
                    this.klColorSlider.getColor(),
                    undefined,
                    true,
                );
                this.statusOverlay.out(
                    this.klCanvas.getSelection() ? LANG('filled-selected-area') : LANG('filled'),
                    true,
                );
            },
            onErase: () => {
                if (currentLayerTarget === 'mask' || isCurrentLayerGroup()) {
                    return;
                }
                const layerIndex = currentLayerIndex;
                this.klCanvas.eraseLayer({
                    layerIndex,
                    useAlphaLock: layerIndex === 0 && !brushUiMap.eraserBrush.getIsTransparentBg(),
                    useSelection: true,
                });
                this.statusOverlay.out(
                    this.klCanvas.getSelection()
                        ? LANG('cleared-selected-area')
                        : LANG('cleared-layer'),
                    true,
                );
            },
        });

        this.easelBrush = new EaselBrush({
            radius: 5,
            onLineStart: (e) => {
                // expects TDrawEvent
                drawEventChain.chainIn({
                    type: 'down',
                    scale: this.easel.getTransform().scale,
                    shiftIsPressed: keyListener.isPressed('shift'),
                    pressure: e.pressure,
                    isCoalesced: e.isCoalesced,
                    x: e.x,
                    y: e.y,
                } as any);
            },
            onLineGo: (e) => {
                // expects TDrawEvent
                drawEventChain.chainIn({
                    type: 'move',
                    scale: this.easel.getTransform().scale,
                    shiftIsPressed: keyListener.isPressed('shift'),
                    pressure: e.pressure,
                    isCoalesced: e.isCoalesced,
                    x: e.x,
                    y: e.y,
                } as any);
            },
            onLineEnd: () => {
                // expects TDrawEvent
                drawEventChain.chainIn({
                    type: 'up',
                    scale: this.easel.getTransform().scale,
                    shiftIsPressed: keyListener.isPressed('shift'),
                    isCoalesced: false,
                } as any);
            },
            onLine: (p1, p2) => {
                // expects TDrawEvent
                drawEventChain.chainIn({
                    type: 'line',
                    x0: p1.x,
                    y0: p1.y,
                    x1: p2.x,
                    y1: p2.y,
                    pressure0: 1,
                    pressure1: 1,
                } as any);
            },
        });

        const easelHand = new EaselHand({});
        const easelShape = new EaselShape({
            onDown: (p, angleRad) => {
                shapeTool.onDown(p.x, p.y, angleRad);
            },
            onMove: (p) => {
                shapeTool.onMove(p.x, p.y);
            },
            onUp: (p) => {
                shapeTool.onUp(p.x, p.y);
            },
        });

        let isFirstTransform = true;
        this.easel = new Easel({
            onBeforeRender: () => {
                if (currentLayerTarget === 'image' && !isCurrentLayerGroup()) {
                    currentBrushUi?.getBrush().transferToCanvas?.();
                }
            },
            width: Math.max(0, this.uiWidth - this.toolWidth),
            height: this.uiHeight,
            project: {
                width: this.klCanvas.getWidth(),
                height: this.klCanvas.getHeight(),
                layers: [],
            }, // temp
            tools: {
                brush: this.easelBrush,
                hand: easelHand,
                select: klAppSelect.getEaselSelect(),
                eyedropper: new EaselEyedropper({
                    onPick: (p) => {
                        const color = this.klCanvas.getColorAt(p.x, p.y);
                        if (color) {
                            brushSettingService.setColor(color);
                            return color;
                        }
                        return brushSettingService.getColor();
                    },
                    onPickEnd: () => {
                        if (
                            this.klColorSlider.getIsEyedropping() ||
                            this.mobileColorUi.getIsEyedropping()
                        ) {
                            this.klColorSlider.setIsEyedropping(false);
                            this.mobileColorUi.setIsEyedropping(false);
                            this.easel.setTool(this.toolspaceToolRow.getActive());
                        }
                    },
                }),
                paintBucket: new EaselPaintBucket({
                    onFill: (p) => {
                        if (currentLayerTarget === 'mask' || isCurrentLayerGroup()) {
                            return;
                        }
                        this.klCanvas.floodFill(
                            currentLayerIndex,
                            p.x,
                            p.y,
                            fillUi.getIsEraser() ? null : this.klColorSlider.getColor(),
                            fillUi.getOpacity(),
                            fillUi.getTolerance(),
                            fillUi.getSample(),
                            fillUi.getGrow(),
                            fillUi.getContiguous(),
                        );
                        this.easel.requestRender();
                    },
                }),
                gradient: new EaselGradient({
                    onDown: (p, angleRad) => {
                        gradientTool.onDown(p.x, p.y, angleRad);
                    },
                    onMove: (p) => {
                        gradientTool.onMove(p.x, p.y);
                    },
                    onUp: (p) => {
                        gradientTool.onUp(p.x, p.y);
                    },
                }),
                text: new EaselText({
                    onDown: (p, angleRad) => {
                        if (
                            KL.DIALOG_COUNTER.get() > 0 ||
                            currentLayerTarget === 'mask' ||
                            isCurrentLayerGroup()
                        ) {
                            return;
                        }

                        KL.textToolDialog({
                            klCanvas: this.klCanvas,
                            layerIndex: currentLayerIndex,
                            primaryColor: this.klColorSlider.getColor(),
                            secondaryColor: this.klColorSlider.getSecondaryRGB(),

                            text: {
                                ...textToolSettings,
                                text: '',
                                x: p.x,
                                y: p.y,
                                angleRad: angleRad,
                                fill: textToolSettings.fill
                                    ? {
                                          color: {
                                              ...this.klColorSlider.getColor(),
                                              a: textToolSettings.fill.color.a,
                                          },
                                      }
                                    : undefined,
                                stroke: textToolSettings.stroke
                                    ? {
                                          ...textToolSettings.stroke,
                                          color: {
                                              ...this.klColorSlider.getSecondaryRGB(),
                                              a: textToolSettings.stroke.color.a,
                                          },
                                      }
                                    : undefined,
                            },

                            onConfirm: (val) => {
                                textToolSettings = {
                                    ...val,
                                    text: '',
                                };
                                if (val.fill) {
                                    brushSettingService.setColor(
                                        new BB.RGB(
                                            val.fill.color.r,
                                            val.fill.color.g,
                                            val.fill.color.b,
                                        ),
                                    );
                                }
                                if (!isCurrentLayerGroup()) {
                                    this.klCanvas.text(currentLayerIndex, val);
                                }
                            },
                        });
                    },
                }),
                shape: easelShape,
                rotate: new EaselRotate({}),
                zoom: new EaselZoom({}),
            },
            tool: 'brush',
            onChangeTool: (toolId) => {
                if (toolId !== 'brush' && toolId !== 'eyedropper') {
                    currentBrushUi.freeResources?.();
                }
                this.mobileToolUi.update();
            },
            onTransformChange: (transform, isScaleOrAngleChanged) => {
                handUi.update(transform.scale, transform.angleDeg, transform.isMirrored);
                this.toolspaceToolRow.setEnableZoomIn(transform.scale !== EASEL_MAX_SCALE);
                this.toolspaceToolRow.setEnableZoomOut(transform.scale !== EASEL_MIN_SCALE);

                if (isScaleOrAngleChanged && !isFirstTransform) {
                    this.statusOverlay.out({
                        type: 'transform',
                        scale: transform.scale,
                        angleDeg: transform.angleDeg,
                    });
                }
                if (isFirstTransform) {
                    isFirstTransform = false;
                }
            },
            onUndo: () => {
                undo(true);
            },
            onRedo: () => {
                redo(true);
            },
            onResetSelection: () => klAppSelect.resetSelection(),
        });
        css(this.easel.getElement(), {
            position: 'absolute',
            left: 0,
            top: 0,
        });
        this.easelProjectUpdater = new EaselProjectUpdater({
            klCanvas: this.klCanvas,
            easel: this.easel,
        });
        this.klHistory.addListener(() => {
            this.easelProjectUpdater.update();
        });
        KL.DIALOG_COUNTER.subscribe((count) => {
            this.easel.setIsFrozen(count > 0);
        });

        const updateMainTabVisibility = () => {
            if (!mainTabRow) {
                return;
            }

            const toolObj = {
                brush: {},
                hand: {},
                paintBucket: {},
                gradient: {},
                text: {},
                shape: {},
                select: {},
            };

            const activeStr = this.toolspaceToolRow.getActive();
            const oldTabId = mainTabRow.getOpenedTabId();

            const keysArr = Object.keys(toolObj);
            for (let i = 0; i < keysArr.length; i++) {
                if (activeStr === keysArr[i]) {
                    mainTabRow.setIsVisible(keysArr[i], true);
                } else {
                    mainTabRow.setIsVisible(keysArr[i], false);
                    if (oldTabId === keysArr[i]) {
                        mainTabRow.open(activeStr);
                    }
                }
            }
        };

        const keyListener = new BB.KeyListener({
            onDown: (keyStr, event, comboStr, isRepeat) => {
                if (KL.DIALOG_COUNTER.get() > 0 || BB.isInputFocused(true)) {
                    return;
                }

                const isDrawing = this.lineSanitizer.getIsDrawing() || this.easel.getIsLocked();
                if (isDrawing) {
                    return;
                }

                // Assigned keys must not also trigger the browser's default action.
                if (Object.keys(APP_PRESS_DEFAULTS).some((action) => KEY_BINDINGS.matches('onPress', action, comboStr))) {
                    event.preventDefault();
                }

                if (KEY_BINDINGS.matches('onPress', 'fitView', comboStr) && !isRepeat) {
                    this.easel.fitTransform();
                }
                if (KEY_BINDINGS.matches('onPress', 'resetView', comboStr) && !isRepeat) {
                    this.easel.resetTransform();
                }
                if (KEY_BINDINGS.matches('onPress', 'undo', comboStr)) {
                    event.preventDefault();
                    undo();
                }
                if (KEY_BINDINGS.matches('onPress', 'redo', comboStr)) {
                    event.preventDefault();
                    redo();
                }
                if (!this.embed) {
                    if (KEY_BINDINGS.matches('onPress', 'save', comboStr) && !isRepeat) {
                        event.preventDefault();
                        applyUncommitted();
                        this.saveToComputer.save();
                    }
                    if (KEY_BINDINGS.matches('onPress', 'saveProject', comboStr) && !isRepeat) {
                        event.preventDefault();
                        applyUncommitted();
                        if (projectStore) {
                            (async () => {
                                await requestPersistentStorage();

                                const meta = projectStore!.getCurrentMeta();
                                const project = this.getProject();

                                if (meta && meta.projectId !== project.projectId) {
                                    const doOverwrite = await new Promise<boolean>(
                                        (resolve, reject) => {
                                            showModal({
                                                type: 'warning',
                                                message: LANG('file-storage-overwrite-confirm'),
                                                buttons: [
                                                    {
                                                        id: 'overwrite',
                                                        label: LANG('file-storage-overwrite'),
                                                    },
                                                    'Cancel',
                                                ],
                                                callback: async (result) => {
                                                    if (result === 'Cancel') {
                                                        resolve(false);
                                                        return;
                                                    }
                                                    resolve(true);
                                                },
                                            });
                                        },
                                    );
                                    if (!doOverwrite) {
                                        return;
                                    }
                                }

                                let success = true;
                                try {
                                    await projectStore!.store(this.klCanvas.getProject());
                                } catch (e) {
                                    success = false;
                                    asyncThrow(
                                        new Error(
                                            'keyboard-shortcut: failed to store browser storage, ' +
                                                e,
                                        ),
                                    );
                                    this.statusOverlay.out(
                                        '❌ ' + LANG('file-storage-failed'),
                                        true,
                                    );
                                }
                                if (success) {
                                    this.updateLastSaved();
                                    this.statusOverlay.out(LANG('file-storage-stored'), true);
                                }
                            })();
                        } else {
                            this.statusOverlay.out('❌ ' + LANG('file-storage-failed'), true);
                        }
                    }
                    if (KEY_BINDINGS.matches('onPress', 'copy', comboStr) && !isRepeat) {
                        event.preventDefault();
                        applyUncommitted();
                        copyToClipboard(true);
                    }
                }
                // Ctrl+A is intercepted so the canvas itself does not become
                // selected. It is intentionally exposed as a separate action
                // because it has no application selection operation to invoke.
                if (KEY_BINDINGS.matches('onPress', 'preventNativeSelectAll', comboStr)) {
                    event.preventDefault();
                }

                if (KEY_BINDINGS.matches('onPress', 'decreaseBrushSize', comboStr)) {
                    currentBrushUi.decreaseSize(
                        Math.max(0.005, 0.03 / this.easel.getTransform().scale),
                    );
                }
                if (KEY_BINDINGS.matches('onPress', 'increaseBrushSize', comboStr)) {
                    currentBrushUi.increaseSize(
                        Math.max(0.005, 0.03 / this.easel.getTransform().scale),
                    );
                }
                if (KEY_BINDINGS.matches('onPress', 'fillLayer', comboStr) && !isRepeat) {
                    if (
                        currentLayerTarget !== 'mask' &&
                        !applyUncommitted() &&
                        !isCurrentLayerGroup()
                    ) {
                        this.klCanvas.layerFill(
                            currentLayerIndex,
                            this.klColorSlider.getColor(),
                            undefined,
                            true,
                        );
                        this.statusOverlay.out(
                            this.klCanvas.getSelection()
                                ? LANG('filled-selected-area')
                                : LANG('filled'),
                            true,
                        );
                    }
                }
                if (KEY_BINDINGS.matches('onPress', 'cancel', comboStr) && !isRepeat) {
                    if (discardUncommitted()) {
                        event.preventDefault();
                    }
                }
                if (KEY_BINDINGS.matches('onPress', 'clearLayer', comboStr) && !isRepeat) {
                    clearLayer(true);
                }
                if (KEY_BINDINGS.matches('onPress', 'advancedMerge', comboStr) && !isRepeat) {
                    event.preventDefault();
                    this.layersUi.advancedMergeDialog();
                }
                if (KEY_BINDINGS.matches('onPress', 'toggleEraser', comboStr) && !isRepeat) {
                    event.preventDefault();
                    currentBrushUi.toggleEraser?.();
                } else if (KEY_BINDINGS.matches('onPress', 'eraserBrush', comboStr) && !isRepeat) {
                    event.preventDefault();
                    applyUncommitted();
                    this.toolspaceToolRow.setActive('brush');
                    this.easel.setTool('brush');
                    mainTabRow?.open('brush');
                    updateMainTabVisibility();
                    brushTabRow.open('eraserBrush');
                }
                if (KEY_BINDINGS.matches('onPress', 'nextBrush', comboStr) && !isRepeat) {
                    event.preventDefault();
                    const prevMode = this.easel.getTool();
                    const prevMainTabId = mainTabRow?.getOpenedTabId();
                    applyUncommitted();
                    this.toolspaceToolRow.setActive('brush');
                    this.easel.setTool('brush');
                    mainTabRow?.open('brush');
                    updateMainTabVisibility();
                    brushTabRow.open(
                        prevMode === 'brush' && prevMainTabId === 'brush'
                            ? getNextBrushId()
                            : currentBrushId === 'eraserBrush'
                              ? lastNonEraserBrushId
                              : currentBrushId,
                    );
                }
                if (KEY_BINDINGS.matches('onPress', 'handTool', comboStr) && !isRepeat) {
                    event.preventDefault();
                    this.toolspaceToolRow.setActive('hand', true);
                }
                if (KEY_BINDINGS.matches('onPress', 'togglePaintBucketGradient', comboStr) && !isRepeat) {
                    if (currentLayerTarget === 'mask') {
                        return;
                    }
                    event.preventDefault();
                    applyUncommitted();
                    const newMode =
                        this.easel.getTool() === 'paintBucket' ? 'gradient' : 'paintBucket';
                    this.toolspaceToolRow.setActive(newMode);
                    this.easel.setTool(newMode);
                    mainTabRow?.open(newMode);
                    updateMainTabVisibility();
                }
                if (KEY_BINDINGS.matches('onPress', 'textTool', comboStr) && !isRepeat) {
                    if (currentLayerTarget === 'mask') {
                        return;
                    }
                    event.preventDefault();
                    applyUncommitted();
                    this.toolspaceToolRow.setActive('text');
                    this.easel.setTool('text');
                    mainTabRow?.open('text');
                    updateMainTabVisibility();
                }
                if (KEY_BINDINGS.matches('onPress', 'shapeTool', comboStr) && !isRepeat) {
                    if (currentLayerTarget === 'mask') {
                        return;
                    }
                    event.preventDefault();
                    applyUncommitted();
                    this.toolspaceToolRow.setActive('shape');
                    this.easel.setTool('shape');
                    mainTabRow?.open('shape');
                    updateMainTabVisibility();
                }
                if (KEY_BINDINGS.matches('onPress', 'selectTool', comboStr) && !isRepeat) {
                    if (currentLayerTarget === 'mask') {
                        return;
                    }
                    event.preventDefault();
                    const prevTool = this.easel.getTool();
                    const prevSelectMode = klAppSelect.getSelectMode();
                    const prevMainTabId = mainTabRow?.getOpenedTabId();
                    // coming from hand -> keep uncommitted transform, so it can be resumed
                    if (prevTool !== 'hand') {
                        applyUncommitted();
                    }
                    this.toolspaceToolRow.setActive('select');
                    this.easel.setTool('select');
                    mainTabRow?.open('select');
                    updateMainTabVisibility();
                    if (
                        prevTool === 'select' &&
                        prevSelectMode === 'select' &&
                        prevMainTabId === 'select'
                    ) {
                        klAppSelect.getSelectUi().setMode('transform');
                    }
                }
                if (KEY_BINDINGS.matches('onPress', 'swapColors', comboStr) && !isRepeat) {
                    event.preventDefault();
                    this.klColorSlider.swapColors();
                }
                if (KEY_BINDINGS.matches('onPress', 'flipView', comboStr) && !isRepeat) {
                    event.preventDefault();
                    this.easel.setIsMirrored(!this.easel.getIsMirrored());
                }

                // Dedicated assignments are kept separate from the historical
                // cycling shortcuts above. This lets a keybindings file choose
                // a specific tool or brush without changing the old defaults.
                const directToolArr: [string, TKlAppToolId][] = [
                    ['toolBrush', 'brush'],
                    ['toolHand', 'hand'],
                    ['toolPaintBucket', 'paintBucket'],
                    ['toolGradient', 'gradient'],
                    ['toolText', 'text'],
                    ['toolShape', 'shape'],
                    ['toolSelect', 'select'],
                    ['toolEyedropper', 'eyedropper'],
                    ['toolRotate', 'rotate'],
                    ['toolZoom', 'zoom'],
                ];
                for (const [action, toolId] of directToolArr) {
                    if (!KEY_BINDINGS.matches('onPress', action, comboStr) || isRepeat) {
                        continue;
                    }
                    if (
                        currentLayerTarget === 'mask' &&
                        toolId !== 'brush' &&
                        toolId !== 'hand'
                    ) {
                        continue;
                    }
                    event.preventDefault();
                    if (toolId === 'rotate' || toolId === 'zoom') {
                        applyUncommitted();
                        this.easel.setTool(toolId);
                        continue;
                    }
                    if (toolId === 'eyedropper') {
                        this.klColorSlider.setIsEyedropping(true);
                        this.mobileColorUi.setIsEyedropping(true);
                        this.easel.setTool('eyedropper');
                        continue;
                    }
                    if (toolId === 'hand') {
                        this.toolspaceToolRow.setActive('hand', true);
                        continue;
                    }
                    if (toolId === 'select') {
                        applyUncommitted();
                        this.toolspaceToolRow.setActive('select', true);
                        klAppSelect.getSelectUi().setMode('select');
                        continue;
                    }
                    applyUncommitted();
                    this.toolspaceToolRow.setActive(toolId, true);
                }
                if (KEY_BINDINGS.matches('onPress', 'toolTransform', comboStr) && !isRepeat) {
                    if (currentLayerTarget === 'mask') {
                        return;
                    }
                    event.preventDefault();
                    applyUncommitted();
                    this.toolspaceToolRow.setActive('select', true);
                    klAppSelect.getSelectUi().setMode('transform');
                }

                const directBrushArr: [string, TBrushId][] = [
                    ['brushPen', 'penBrush'],
                    ['brushBlend', 'blendBrush'],
                    ['brushSketchy', 'sketchyBrush'],
                    ['brushPixel', 'pixelBrush'],
                    ['brushChemy', 'chemyBrush'],
                    ['brushSmudge', 'smudgeBrush'],
                    ['brushEraser', 'eraserBrush'],
                ];
                for (const [action, brushId] of directBrushArr) {
                    if (!KEY_BINDINGS.matches('onPress', action, comboStr) || isRepeat) {
                        continue;
                    }
                    event.preventDefault();
                    applyUncommitted();
                    this.toolspaceToolRow.setActive('brush');
                    this.easel.setTool('brush');
                    mainTabRow?.open('brush');
                    updateMainTabVisibility();
                    brushTabRow.open(
                        currentLayerTarget === 'mask' && !supportsMaskBrush(brushId)
                            ? 'penBrush'
                            : brushId,
                    );
                }

                if (KEY_BINDINGS.matches('onPress', 'newImage', comboStr) && !isRepeat) {
                    event.preventDefault();
                    showNewImageDialog();
                }
                if (KEY_BINDINGS.matches('onPress', 'openFile', comboStr) && !isRepeat) {
                    event.preventDefault();
                    fileUi?.triggerOpen();
                }
                if (KEY_BINDINGS.matches('onPress', 'placeFile', comboStr) && !isRepeat) {
                    event.preventDefault();
                    fileUi?.triggerPlace();
                }
                if (KEY_BINDINGS.matches('onPress', 'savePsd', comboStr) && !isRepeat) {
                    event.preventDefault();
                    this.saveAsPsd();
                }
                if (KEY_BINDINGS.matches('onPress', 'shareImage', comboStr) && !isRepeat) {
                    event.preventDefault();
                    shareImage();
                }
                if (KEY_BINDINGS.matches('onPress', 'openHome', comboStr) && !isRepeat) {
                    event.preventDefault();
                    showIframeModal('./home/', !!this.embed);
                }
                if (KEY_BINDINGS.matches('onPress', 'openHelp', comboStr) && !isRepeat) {
                    event.preventDefault();
                    showIframeModal(this.helpPath, !!this.embed);
                }
                if (KEY_BINDINGS.matches('onPress', 'openBrowserStorage', comboStr) && !isRepeat) {
                    event.preventDefault();
                    onOpenBrowserStorage();
                }
                if (KEY_BINDINGS.matches('onPress', 'openRecovery', comboStr) && !isRepeat) {
                    event.preventDefault();
                    fileUi?.triggerRecovery();
                }
                if (KEY_BINDINGS.matches('onPress', 'uploadImage', comboStr) && !isRepeat) {
                    event.preventDefault();
                    fileUi?.triggerUpload();
                }
                const tabActionArr: [string, string][] = [
                    ['showFileTab', 'file'],
                    ['showLayersTab', 'layers'],
                    ['showEditTab', 'edit'],
                    ['showSettingsTab', 'settings'],
                ];
                for (const [action, tabId] of tabActionArr) {
                    if (KEY_BINDINGS.matches('onPress', action, comboStr) && !isRepeat) {
                        event.preventDefault();
                        mainTabRow?.open(tabId);
                    }
                }
                if (KEY_BINDINGS.matches('onPress', 'paste', comboStr) && !isRepeat) {
                    event.preventDefault();
                    importHandler.readClipboard();
                }

                if (KEY_BINDINGS.matches('onPress', 'layerNew', comboStr) && !isRepeat) {
                    event.preventDefault();
                    this.layersUi.newLayer();
                }
                if (KEY_BINDINGS.matches('onPress', 'layerNewGroup', comboStr) && !isRepeat) {
                    event.preventDefault();
                    this.layersUi.newGroup();
                }
                if (KEY_BINDINGS.matches('onPress', 'layerDuplicate', comboStr) && !isRepeat) {
                    event.preventDefault();
                    this.layersUi.duplicateSelected();
                }
                if (KEY_BINDINGS.matches('onPress', 'layerRemove', comboStr) && !isRepeat) {
                    event.preventDefault();
                    this.layersUi.removeSelected();
                }
                if (KEY_BINDINGS.matches('onPress', 'layerMerge', comboStr) && !isRepeat) {
                    event.preventDefault();
                    this.layersUi.mergeSelected();
                }
                if (KEY_BINDINGS.matches('onPress', 'layerRename', comboStr) && !isRepeat) {
                    event.preventDefault();
                    this.layersUi.renameSelected();
                }
                if (
                    KEY_BINDINGS.matches('onPress', 'layerToggleClipping', comboStr) &&
                    !isRepeat
                ) {
                    event.preventDefault();
                    this.layersUi.toggleSelectedClipping();
                }
                if (KEY_BINDINGS.matches('onPress', 'layerClear', comboStr) && !isRepeat) {
                    event.preventDefault();
                    this.layersUi.clearSelected();
                }
                if (KEY_BINDINGS.matches('onPress', 'layerMergeAll', comboStr) && !isRepeat) {
                    event.preventDefault();
                    this.layersUi.mergeAll();
                }
                if (KEY_BINDINGS.matches('onPress', 'layerAddMask', comboStr) && !isRepeat) {
                    event.preventDefault();
                    this.layersUi.addMask();
                }
                if (KEY_BINDINGS.matches('onPress', 'layerRemoveMask', comboStr) && !isRepeat) {
                    event.preventDefault();
                    this.layersUi.removeMask();
                }
                if (KEY_BINDINGS.matches('onPress', 'layerToggleMask', comboStr) && !isRepeat) {
                    event.preventDefault();
                    this.layersUi.toggleMask();
                }
                if (KEY_BINDINGS.matches('onPress', 'layerInvertMask', comboStr) && !isRepeat) {
                    event.preventDefault();
                    this.layersUi.invertMask();
                }
                if (KEY_BINDINGS.matches('onPress', 'layerClearMask', comboStr) && !isRepeat) {
                    event.preventDefault();
                    this.layersUi.clearMask();
                }

                const filterActionArr: [string, string][] = [
                    ['filterCropExtend', 'cropExtend'],
                    ['filterFlip', 'flip'],
                    ['filterPerspective', 'perspective'],
                    ['filterResize', 'resize'],
                    ['filterRotate', 'rotate'],
                    ['filterTransform', 'transform'],
                    ['filterBrightnessContrast', 'brightnessContrast'],
                    ['filterCurves', 'curves'],
                    ['filterDistort', 'distort'],
                    ['filterHueSaturation', 'hueSaturation'],
                    ['filterInvert', 'invert'],
                    ['filterTiltShift', 'tiltShift'],
                    ['filterToAlpha', 'toAlpha'],
                    ['filterBlur', 'blur'],
                    ['filterUnsharpMask', 'unsharpMask'],
                    ['filterGrid', 'grid'],
                    ['filterNoise', 'noise'],
                    ['filterPattern', 'pattern'],
                    ['filterVanishPoint', 'vanishPoint'],
                ];
                for (const [action, filterKey] of filterActionArr) {
                    if (KEY_BINDINGS.matches('onPress', action, comboStr) && !isRepeat) {
                        event.preventDefault();
                        editUi.triggerFilter(filterKey);
                    }
                }
            },
            onUp: (keyStr, event) => {},
        });

        const brushUiMap: {
            [key: string]: any;
        } = {};
        // create brush UIs
        Object.entries(KL.BRUSHES_UI).forEach(([b, brushUi]) => {
            const ui = new (brushUi.Ui as any)({
                klHistory: this.klHistory,
                onSizeChange: sizeWatcher,
                onOpacityChange: (opacity: number) => {
                    brushSettingService.emitOpacity(opacity);
                },
                onConfigChange: () => {
                    brushSettingService.emitSliderConfig({
                        sizeSlider: KL.BRUSHES_UI[currentBrushId].sizeSlider,
                        opacitySlider: KL.BRUSHES_UI[currentBrushId].opacitySlider,
                    });
                    updateBrushCursor();
                },
            });
            brushUiMap[b] = ui;
            // no bottom padding. spacer above bottom bar provides it
            ui.getElement().style.padding = '10px 10px 0';
        });

        this.toolspace = BB.el({
            className: 'kl-toolspace',
            css: {
                position: 'absolute',
                right: 0,
                top: 0,
                bottom: 0,
                width: this.toolWidth,
                overflow: 'hidden',
                userSelect: 'none',
                touchAction: 'none',
            },
        });
        this.toolspaceInner = BB.el({
            parent: this.toolspace,
            css: {
                display: 'flex',
                flexDirection: 'column',
                minHeight: '100%',
            },
        });
        this.toolspace.oncontextmenu = () => {
            return false;
        };
        this.toolspace.onclick = BB.handleClick;

        this.mobileToolUi = new MobileToolUi({
            getToolId: () => this.toolspaceToolRow.getActive(),
            getSelectMode: () => klAppSelect.getSelectMode(),
            getCurrentBrushId: () => currentBrushId,
            getLastNonEraserBrushId: () => lastNonEraserBrushId,
            brushArr: (Object.keys(KL.BRUSHES_UI) as TBrushId[])
                .filter((id) => id !== 'eraserBrush')
                .map((id) => ({
                    id,
                    image: KL.BRUSHES_UI[id].image,
                    title: KL.BRUSHES_UI[id].tooltip,
                })),
            brushSettingService,
            onBrush: (brushId) => {
                this.toolspaceToolRow.setActive('brush', true);
                brushTabRow.open(
                    currentLayerTarget === 'mask' && !supportsMaskBrush(brushId)
                        ? 'penBrush'
                        : brushId,
                );
            },
            onTool: (toolId) => {
                if (
                    currentLayerTarget === 'mask' &&
                    toolId !== 'hand'
                ) {
                    return false;
                }
                if (toolId === 'select' || toolId === 'transform') {
                    this.toolspaceToolRow.setActive('select', true);
                    // transform can be rejected, if there's nothing to transform
                    return klAppSelect
                        .getSelectUi()
                        .setMode(toolId === 'select' ? 'select' : 'transform');
                }
                this.toolspaceToolRow.setActive(toolId, true);
                return true;
            },
        });
        this.mobileColorUi = new MobileColorUi({
            onEyedropper: (isActive) => {
                if (isActive) {
                    this.klColorSlider.setIsEyedropping(true);
                    this.easel.setTool('eyedropper');
                } else {
                    this.klColorSlider.setIsEyedropping(false);
                    this.easel.setTool(this.toolspaceToolRow.getActive());
                }
            },
            color: currentColor,
            onColorChange: (c) => {
                brushSettingService.setColor(c);
            },
        });

        this.mobileUi = new MobileUi({
            orientation: this.uiLayout,
            isVisible: this.uiWidth < this.collapseThreshold,
            onShowToolspace: (b) => {
                this.updateCollapse();
            },
            colorUi: this.mobileColorUi,
            toolUi: this.mobileToolUi,
            onUndo: () => undo(),
            onRedo: () => redo(),
        });

        this.updateCollapse();

        let overlayToolspace;
        setTimeout(() => {
            overlayToolspace = new KL.OverlayToolspace({
                enabledTest: () => {
                    return KL.DIALOG_COUNTER.get() === 0 && !this.easel.getIsLocked();
                },
                brushSettingService,
            });
            this.rootEl.append(overlayToolspace.getElement());
        }, 0);

        BB.append(this.rootEl, [
            this.easel.getElement(),
            // this.klCanvasWorkspace.getElement(),
            this.toolspace,
            this.mobileUi.getElement(),
        ]);

        if (this.embed) {
            this.toolspaceTopRow = new EmbedToolspaceTopRow({
                onHelp: () => {
                    showIframeModal(this.embed!.url + this.helpPath, !!this.embed);
                },
                onSubmit: () => {
                    applyUncommitted();
                    const onFailure = () => {
                        let closeFunc: () => void;
                        const saveBtn = BB.el({
                            tagName: 'button',
                            className: 'kl-button',
                            textContent: LANG('save-reminder-save-psd'),
                            css: {
                                display: 'block',
                            },
                        });
                        saveBtn.onclick = () => {
                            this.saveAsPsd();
                            closeFunc();
                        };
                        showModal({
                            message: '<b>' + LANG('upload-failed') + '</b>',
                            div: BB.el({
                                content: [
                                    BB.el({
                                        content: LANG('backup-drawing'),
                                        css: {
                                            marginBottom: 10,
                                        },
                                    }),
                                    saveBtn,
                                ],
                            }),
                            ignoreBackground: true,
                            closeFunc: (f) => {
                                closeFunc = f;
                            },
                        });
                    };

                    showModal({
                        message: LANG('submit-prompt'),
                        buttons: [{ id: 'submit', label: LANG('submit') }, 'Cancel'],
                        callback: async (result) => {
                            if (result !== 'submit') {
                                return;
                            }

                            const overlay = BB.el({
                                parent: this.rootEl,
                                className: 'upload-overlay',
                                content: '<div class="spinner"></div> ' + LANG('submit-submitting'),
                            });

                            this.embed!.onSubmit(
                                () => {
                                    this.updateLastSaved();
                                    overlay.remove();
                                },
                                () => {
                                    overlay.remove();
                                    onFailure();
                                },
                            );
                        },
                    });
                },
                onLeftRight: () => {
                    this.uiLayout = this.uiLayout === 'left' ? 'right' : 'left';
                    this.updateUi();
                },
            });
        } else {
            this.toolspaceTopRow = new KL.ToolspaceTopRow({
                logoImg: p.logoImg,
                onLogo: () => {
                    showIframeModal('./home/', !!this.embed);
                },
                onNew: () => {
                    showNewImageDialog();
                },
                onOpen: () => {
                    fileUi!.triggerOpen();
                },
                onSave: () => {
                    this.saveToComputer.save();
                },
                onShare: () => {
                    shareImage();
                },
                onHelp: () => {
                    showIframeModal(this.helpPath, !!this.embed);
                },
            });
        }
        this.toolspaceTopRow.getElement().style.marginBottom = '10px';
        this.toolspaceInner.append(this.toolspaceTopRow.getElement());

        this.toolspaceToolRow = new KL.ToolspaceToolRow({
            onActivate: (activeStr) => {
                if (
                    currentLayerTarget === 'mask' &&
                    activeStr !== 'brush' &&
                    activeStr !== 'hand'
                ) {
                    this.toolspaceToolRow.setActive('brush');
                    this.easel.setTool('brush');
                    mainTabRow?.open('brush');
                    updateMainTabVisibility();
                    return;
                }
                // hand doesn't cause changes. Select -> can resume uncommitted transform after hand
                if (activeStr !== 'hand' && activeStr !== 'select') {
                    applyUncommitted();
                }

                if (activeStr === 'brush') {
                    this.easel.setTool('brush');
                } else if (activeStr === 'hand') {
                    this.easel.setTool('hand');
                } else if (activeStr === 'paintBucket') {
                    this.easel.setTool('paintBucket');
                } else if (activeStr === 'gradient') {
                    this.easel.setTool('gradient');
                } else if (activeStr === 'text') {
                    this.easel.setTool('text');
                } else if (activeStr === 'shape') {
                    this.easel.setTool('shape');
                } else if (activeStr === 'select') {
                    // this.klCanvasWorkspace.setMode('shape');
                    this.easel.setTool('select');
                } else {
                    throw new Error('unknown activeStr');
                }
                mainTabRow?.open(activeStr);
                updateMainTabVisibility();
                this.klColorSlider.setIsEyedropping(false);
                this.mobileColorUi.setIsEyedropping(false);
            },
            onZoomIn: () => {
                const oldScale = this.easel.getTransform().scale;
                const newScale = zoomByStep(
                    oldScale,
                    keyListener.isPressed('shift') ? 1 / 8 : 1 / 2,
                );
                this.easel.scale(newScale / oldScale);
            },
            onZoomOut: () => {
                const oldScale = this.easel.getTransform().scale;
                const newScale = zoomByStep(
                    oldScale,
                    keyListener.isPressed('shift') ? -1 / 8 : -1 / 2,
                );
                this.easel.scale(newScale / oldScale);
            },
            onUndo: () => {
                undo();
            },
            onRedo: () => {
                redo();
            },
        });
        this.toolspaceToolRow.setIsSmall(getToolspaceLayout(this.uiHeight).isToolRowSmall);
        this.toolspaceInner.append(this.toolspaceToolRow.getElement());

        const setBrushColor = (p_color: TRgb) => {
            if (currentLayerTarget === 'mask') {
                this.klColorSlider.setColor(p_color);
            }
            currentColor = p_color;
            currentBrushUi.setColor(p_color);
            brushSettingService.emitColor(p_color);
            this.mobileColorUi.setColor(p_color);
            this.klColorSlider.setIsEyedropping(false);
            this.mobileColorUi.setIsEyedropping(false);
        };

        this.klColorSlider = new KL.KlColorSlider({
            width: 250,
            height: 30,
            svHeight: 100,
            startValue: new BB.RGB(0, 0, 0),
            onPick: setBrushColor,
            onEyedropper: (isActive) => {
                if (isActive) {
                    this.mobileColorUi.setIsEyedropping(true);
                    this.easel.setTool('eyedropper');
                } else {
                    this.mobileColorUi.setIsEyedropping(false);
                    this.easel.setTool(this.toolspaceToolRow.getActive());
                }
            },
        });
        this.klColorSlider.setHeight(getToolspaceLayout(this.uiHeight).colorSliderHeight);

        const updateBrushCursor = () => {
            const brush = currentBrushUi.getBrush();
            this.easelBrush.setBrush(
                brush instanceof PixelBrush
                    ? { type: 'pixel', pixelTip: brush.getTip() }
                    : { type: 'round' },
            );
        };

        const setCurrentBrush = (brushId: TBrushId) => {
            finishMaskStroke();
            if (currentBrushUi && brushId !== currentBrushId) {
                currentBrushUi.freeResources?.();
            }
            if (brushId !== 'eraserBrush') {
                lastNonEraserBrushId = brushId;
            }

            if (this.klColorSlider) {
                if (brushId === 'eraserBrush') {
                    this.klColorSlider.enable(false);
                } else {
                    this.klColorSlider.enable(true);
                }
            }

            currentBrushId = brushId;
            currentBrushUi = brushUiMap[brushId];
            currentBrushUi.setColor(currentColor);
            currentBrushUi.setLayer(this.klCanvas.getLayer(currentLayerIndex));
            updateBrushCursor();
            this.toolspaceToolRow.setActive('brush');
            updateMainTabVisibility();
        };

        const setCurrentLayer = (index: number, target: TLayerEditTarget = currentLayerTarget) => {
            finishMaskStroke();
            currentLayerIndex = index;
            const nextTarget: TLayerEditTarget =
                target === 'mask' && this.klCanvas.getLayer(index).mask ? 'mask' : 'image';
            if (nextTarget !== currentLayerTarget) {
                // The selected RGB color is shared; only mask painting converts it to gray.
                currentLayerTarget = nextTarget;
                maskControls && (maskControls.style.display = nextTarget === 'mask' ? 'block' : 'none');
                for (const id of Object.keys(KL.BRUSHES_UI) as TBrushId[]) {
                    brushTabRow.setIsVisible(
                        id,
                        nextTarget === 'image' || supportsMaskBrush(id),
                    );
                }
                if (nextTarget === 'mask') {
                    brushTabRow.open(supportsMaskBrush(currentBrushId) ? currentBrushId : 'penBrush');
                    this.toolspaceToolRow.setActive('brush');
                    this.easel.setTool('brush');
                    mainTabRow?.open('brush');
                    updateMainTabVisibility();
                }
            }
            currentBrushUi.setLayer(this.klCanvas.getLayer(currentLayerIndex));
        };

        const brushDiv = BB.el();
        const colorDiv = BB.el({
            css: {
                margin: 10,
                display: 'flex',
                flexWrap: 'wrap',
                justifyContent: 'space-between',
                alignItems: 'flex-end',
            },
        });
        const toolspaceStabilizerRow = new KL.ToolspaceStabilizerRow({
            smoothing: 1,
            onSelect: (v) => {
                lineSmoothing.setSmoothing(translateSmoothing(v));
            },
        });

        brushDiv.append(colorDiv);
        maskControls = BB.el({
            css: { display: 'none', padding: '0 10px 4px' },
        });
        maskControls.append(
            BB.el({ textContent: LANG('layers-mask-paint'), css: { fontSize: 12, marginBottom: 5 } }),
        );
        const maskColorButtons = BB.el({ css: { display: 'flex', gap: 5 } });
        for (const [key, gray] of [
            ['layers-mask-black', 0],
            ['layers-mask-white', 255],
        ] as const) {
            maskColorButtons.append(
                BB.el({
                    tagName: 'button',
                    className: 'kl-button',
                    textContent: LANG(key),
                    css: { flex: 1 },
                    onClick: () => {
                        if (currentBrushId === 'eraserBrush' && gray === 255) {
                            brushTabRow.open('penBrush');
                        }
                        brushSettingService.setColor({ r: gray, g: gray, b: gray });
                    },
                }),
            );
        }
        maskControls.append(maskColorButtons);
        brushDiv.prepend(maskControls);
        BB.append(colorDiv, [
            this.klColorSlider.getElement(),
            this.klColorSlider.getOutputElement(),
            toolspaceStabilizerRow.getElement(),
        ]);

        const brushTabRow = new KL.TabRow({
            initialId: 'penBrush',
            useAccent: true,
            tabArr: (() => {
                const commonStyle: TCss = {
                    height: 28,
                    width: 28,
                    color: 'var(--ui-on-bg-full-contrast)',
                };
                const createTab = (keyStr: TBrushId) => {
                    const im = KL.BRUSHES_UI[keyStr].image;
                    css(im, commonStyle);
                    return {
                        id: keyStr,
                        label: BB.el({
                            content: im,
                            css: {
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                height: '100%',
                            },
                        }),
                        title: KL.BRUSHES_UI[keyStr].tooltip,
                        onOpen: () => {
                            brushUiMap[keyStr].getElement().style.display = 'block';
                            setCurrentBrush(keyStr);
                            this.klColorSlider.setIsEyedropping(false);
                            this.mobileColorUi.setIsEyedropping(false);
                            brushSettingService.emitSliderConfig({
                                sizeSlider: KL.BRUSHES_UI[keyStr].sizeSlider,
                                opacitySlider: KL.BRUSHES_UI[keyStr].opacitySlider,
                            });
                            sizeWatcher(brushUiMap[keyStr].getSize());
                            brushSettingService.emitOpacity(brushUiMap[keyStr].getOpacity());
                            this.mobileToolUi.update();
                        },
                        onClose: () => {
                            brushUiMap[keyStr].getElement().style.display = 'none';
                        },
                    };
                };

                return (Object.keys(KL.BRUSHES_UI) as TBrushId[]).map(createTab);
            })(),
        });
        BB.append(brushDiv, [
            brushTabRow.getElement(),
            ...Object.entries(KL.BRUSHES_UI).map(([b]) => brushUiMap[b].getElement()),
        ]);

        const handUi = new KL.HandUi({
            scale: this.easel.getTransform().scale,
            angleDeg: 0,
            onReset: () => {
                this.easel.resetTransform();
            },
            onFit: () => {
                this.easel.fitTransform();
            },
            onAngleChange: (angleDeg, isRelative) => {
                this.easel.setAngleDeg(angleDeg, isRelative);
            },
            onChangeIsMirrored: (b) => {
                this.easel.setIsMirrored(b);
            },
            onChangeUseInertiaScrolling: (b) => {
                easelHand.setUseInertiaScrolling(b);
            },
        });

        const fillUi = new KL.FillUi({
            colorSlider: this.klColorSlider,
        });

        const gradientUi = new KL.GradientUi({
            colorSlider: this.klColorSlider,
        });

        const textUi = new KL.TextUi({
            colorSlider: this.klColorSlider,
        });

        const shapeUi = new KL.ShapeUi({
            colorSlider: this.klColorSlider,
            onChangePanning: (doPan) => easelShape.setPanning(doPan),
        });

        const gradientTool = new KL.GradientTool({
            onGradient: (isDone, x1, y1, x2, y2, angleRad) => {
                if (currentLayerTarget === 'mask' || isCurrentLayerGroup()) {
                    return;
                }
                const layerIndex = currentLayerIndex;
                const settings = gradientUi.getSettings();
                const gradientObj: TGradient = {
                    type: settings.type,
                    color1: this.klColorSlider.getColor(),
                    isReversed: settings.isReversed,
                    opacity: settings.opacity,
                    doLockAlpha: settings.doLockAlpha,
                    isEraser: settings.isEraser,
                    doSnap: keyListener.isPressed('shift') || settings.doSnap,
                    x1,
                    y1,
                    x2,
                    y2,
                    angleRad,
                };

                if (isDone) {
                    this.klCanvas.setComposite(layerIndex, undefined);
                    this.klCanvas.drawGradient(layerIndex, gradientObj);
                } else {
                    const selection = this.klCanvas.getSelection();
                    const selectionPath = selection
                        ? new Path2D(getSelectionPath2d(selection))
                        : undefined;
                    this.klCanvas.setComposite(layerIndex, {
                        draw: (ctx) => {
                            KL.drawGradient(ctx, gradientObj, selectionPath);
                        },
                    });
                }

                this.easelProjectUpdater.update();
            },
        });

        const shapeTool = new KL.ShapeTool({
            onShape: (isDone, x1, y1, x2, y2, angleRad) => {
                if (currentLayerTarget === 'mask' || isCurrentLayerGroup()) {
                    return;
                }
                const layerIndex = currentLayerIndex;

                const shapeObj: any = {
                    type: shapeUi.getShape(),
                    x1: x1,
                    y1: y1,
                    x2: x2,
                    y2: y2,
                    angleRad: angleRad,
                    isOutwards: shapeUi.getIsOutwards(),
                    opacity: shapeUi.getOpacity(),
                    isEraser: shapeUi.getIsEraser(),
                    doLockAlpha: shapeUi.getDoLockAlpha(),
                };
                if (shapeUi.getShape() === 'line') {
                    shapeObj.strokeRgb = this.klColorSlider.getColor();
                    shapeObj.lineWidth = shapeUi.getLineWidth();
                    shapeObj.isAngleSnap = shapeUi.getIsSnap() || keyListener.isPressed('shift');
                } else {
                    shapeObj.isFixedRatio = shapeUi.getIsFixed() || keyListener.isPressed('shift');
                    if (shapeUi.getMode() === 'stroke') {
                        shapeObj.strokeRgb = this.klColorSlider.getColor();
                        shapeObj.lineWidth = shapeUi.getLineWidth();
                    } else {
                        shapeObj.fillRgb = this.klColorSlider.getColor();
                    }
                }

                if (isDone) {
                    this.klCanvas.setComposite(layerIndex, undefined);
                    this.klCanvas.drawShape(layerIndex, shapeObj);
                } else {
                    const selection = this.klCanvas.getSelection();
                    const selectionPath = selection
                        ? new Path2D(getSelectionPath2d(selection))
                        : undefined;
                    this.klCanvas.setComposite(layerIndex, {
                        draw: (ctx) => {
                            KL.drawShape(ctx, shapeObj, selectionPath);
                        },
                    });
                }

                this.easelProjectUpdater.update();
            },
        });

        this.floatingLayerPreview = new FloatingLayerPreview();
        this.layersUi = new KL.LayersUi({
            klCanvas: this.klCanvas,
            onSelect: (layerIndex, pushHistory, target) => {
                setCurrentLayer(layerIndex, target);

                if (pushHistory) {
                    const topEntry = this.klHistory.getEntries().at(-1)!.data;
                    const replaceTop = isHistoryEntryActiveLayerChange(topEntry);

                    this.klHistory.push(
                        {
                            activeLayerId: this.klCanvas.getLayer(layerIndex).id,
                        },
                        replaceTop,
                    );
                }
            },
            parentEl: this.rootEl,
            floatingLayerPreview: this.floatingLayerPreview,
            applyUncommitted: () => applyUncommitted(),
            klHistory: this.klHistory,
            onUpdateProject: () => this.easelProjectUpdater.update(),
            onClearLayer: () => clearLayer(false, true),
        });
        this.layerPreview = new KL.LayerPreview({
            klRootEl: this.rootEl,
            onClick: () => {
                mainTabRow?.open('layers');
            },
            floatingLayerPreview: this.floatingLayerPreview,
            klHistory: this.klHistory,
            klCanvas: this.klCanvas,
        });
        const toolspaceLayout = getToolspaceLayout(this.uiHeight);
        this.layerPreview.setIsVisible(toolspaceLayout.isLayerPreviewVisible);
        this.layerPreview.setIsSmall(toolspaceLayout.isLayerPreviewSmall);

        const editUi = new KL.EditUi({
            klRootEl: this.rootEl,
            klColorSlider: this.klColorSlider,
            layersUi: this.layersUi,
            getCurrentColor: () => currentColor,
            maxCanvasSize,
            klCanvas: this.klCanvas,
            getCurrentLayerIndex: () => currentLayerIndex,
            getCurrentLayerTarget: () => currentLayerTarget,
            isEmbed: !!this.embed,
            statusOverlay: this.statusOverlay,
            onCanvasChanged: () => {
                this.easelProjectUpdater.update();
                this.easel.resetOrFitTransform(true);
            },
            applyUncommitted: () => applyUncommitted(),
            klHistory: this.klHistory,
            onCopyToClipboard: () => {
                applyUncommitted();
                copyToClipboard(false, false);
            },
            onPaste: () => importHandler.readClipboard(),
        });

        const klHistoryExecutor = new KlHistoryExecutor({
            klHistory: this.klHistory,
            tempHistory,
            onCanUndoRedoChange: (canUndo, canRedo) => {
                this.toolspaceToolRow.updateUndoRedo(canUndo, canRedo);
                this.mobileUi.updateUndoRedo(canUndo, canRedo);
            },
        });

        const showNewImageDialog = () => {
            applyUncommitted();
            KL.newImageDialog({
                maxCanvasSize,
                onConfirm: (width, height, background) => {
                    this.klCanvas.reset({
                        width: width,
                        height: height,
                        background,
                        clearHistory: true,
                    });

                    this.layersUi.update(0);
                    setCurrentLayer(0);
                    this.easelProjectUpdater.update();
                    this.easel.resetOrFitTransform(true);
                },
                onCancel: () => {},
            });
        };

        const shareImage = (callback?: () => void) => {
            applyUncommitted();
            BB.shareCanvas({
                canvas: this.klCanvas.getCanvas(1, false, true),
                fileName: getFilenameDate() + KL_CONFIG.filenameBase + '.png',
                title: getFilenameDate() + KL_CONFIG.filenameBase + '.png',
                callback: callback ? callback : () => {},
            });
        };

        this.saveToComputer = new KL.SaveToComputer(
            () => exportType,
            this.klCanvas,
            () => {
                this.updateLastSaved();
            },
        );

        const copyToClipboard = (showCrop: boolean = false, closeOnBlur: boolean = true) => {
            KL.clipboardDialog(
                this.rootEl,
                (maskSelection) => {
                    return this.klCanvas.getCanvas(1, maskSelection);
                },
                (inputObj) => {
                    if (currentLayerTarget === 'mask') {
                        return;
                    }
                    if (
                        inputObj.left === 0 &&
                        inputObj.right === 0 &&
                        inputObj.top === 0 &&
                        inputObj.bottom === 0
                    ) {
                        return;
                    }
                    //do a crop
                    KL.FILTER_LIB.cropExtend.apply!({
                        layer: this.klCanvas.getLayer(currentLayerIndex),
                        klCanvas: this.klCanvas,
                        input: inputObj,
                        klHistory: this.klHistory,
                    });
                    this.layersUi.update();
                    this.easelProjectUpdater.update();
                    this.easel.resetOrFitTransform(true);
                },
                this.statusOverlay,
                showCrop || false,
                closeOnBlur,
                this.klCanvas.getSelection(),
            );
        };

        const onOpenBrowserStorage = async () => {
            const showFailureMessage = () => {
                showError(LANG('file-storage-open-failed'));
            };

            if (!projectStore) {
                showFailureMessage();
                return;
            }
            const meta = projectStore.getCurrentMeta();

            // Check is project already opened in other tab.
            // (if it's already open in the current tab, user showed intentionality. Don't ask again.)
            if (meta && this.klHistory.getComposed().projectId.value !== meta.projectId) {
                let doOpen = true;
                const crossTabChannel = new CrossTabChannel('kl-tab-communication');

                const openedProjectIds: string[] = [];
                const otherIdListener = (message: any) => {
                    if (message.type === 'response-project-id') {
                        openedProjectIds.push(message.id);
                    }
                };
                crossTabChannel.subscribe(otherIdListener);
                crossTabChannel.postMessage({ type: 'request-project-ids' });
                await sleep(100);
                crossTabChannel.unsubscribe(otherIdListener);

                if (meta && openedProjectIds.includes(meta.projectId)) {
                    doOpen = await new Promise<boolean>((resolve, reject) => {
                        showModal({
                            message: LANG('file-storage-open-confirmation'),
                            buttons: [{ id: 'open', label: LANG('file-storage-open') }, 'Cancel'],
                            callback: async (result) => {
                                if (result === 'Cancel') {
                                    resolve(false);
                                    return;
                                }
                                resolve(true);
                            },
                        });
                    });
                }

                crossTabChannel.close();
                if (!doOpen) {
                    return;
                }
            }

            let closeLoader: (() => void) | undefined;
            showModal({
                message: LANG('loading'),
                callback: (result) => {
                    closeLoader = undefined;
                },
                closeFunc: (f) => {
                    closeLoader = f;
                },
            });
            let project: TDeserializedKlStorageProject | undefined;
            try {
                project = await projectStore?.read();
            } catch (e) {
                asyncThrow(e);
            }
            if (!project) {
                closeLoader?.();
                showFailureMessage();
                return;
            }
            applyUncommitted();
            const layerIndex = this.klCanvas.reset({
                projectId: project.project.projectId,
                width: project.project.width,
                height: project.project.height,
                background: project.project.background ?? 'transparent',
                clearHistory: true,
                layers: project.project.layers.map((item) => {
                    let image = item.image;
                    if (!(image instanceof HTMLCanvasElement)) {
                        image = BB.canvas(project.project.width, project.project.height);
                        if (item.image instanceof HTMLImageElement) {
                            const ctx = BB.ctx(image);
                            ctx.drawImage(item.image, 0, 0);
                        }
                    }
                    let mask: { image: HTMLCanvasElement; enabled: boolean; revision?: number } | undefined;
                    if (item.mask) {
                        const source = item.mask.image;
                        const maskCanvas = BB.canvas(project.project.width, project.project.height);
                        const context = BB.ctx(maskCanvas);
                        if (source instanceof HTMLCanvasElement || source instanceof HTMLImageElement) {
                            context.drawImage(source, 0, 0);
                        } else if (isLayerFill(source)) {
                            context.fillStyle = source.fill;
                            context.fillRect(0, 0, maskCanvas.width, maskCanvas.height);
                        } else {
                            const tilesPerRow = Math.ceil(maskCanvas.width / HISTORY_TILE_SIZE);
                            source.forEach((tile, tileIndex) => {
                                const x = (tileIndex % tilesPerRow) * HISTORY_TILE_SIZE;
                                const y = Math.floor(tileIndex / tilesPerRow) * HISTORY_TILE_SIZE;
                                if (isLayerFill(tile)) {
                                    context.fillStyle = tile.fill;
                                    context.fillRect(x, y, HISTORY_TILE_SIZE, HISTORY_TILE_SIZE);
                                } else {
                                    context.putImageData(tile.data, x, y);
                                }
                            });
                        }
                        mask = {
                            image: maskCanvas,
                            enabled: item.mask.enabled,
                            revision: item.mask.revision,
                        };
                    }
                    return {
                        ...item,
                        id: randomUuid(),
                        image,
                        mask,
                    };
                }),
            });
            this.layersUi.update(layerIndex);
            setCurrentLayer(layerIndex);
            this.easelProjectUpdater.update();
            this.easel.resetOrFitTransform(true);

            setTimeout(() => {
                // timeout to overwrite zoom overlay msg
                this.statusOverlay.out(LANG('file-storage-restored'));
            });
            closeLoader?.();
        };

        const fileUi = this.embed
            ? null
            : new KL.FileUi({
                  klRootEl: this.rootEl,
                  helpPath: this.helpPath,
                  projectStore: projectStore,
                  getProject: () => this.klCanvas.getProject(),
                  exportType: exportType,
                  onExportTypeChange: (type) => {
                      exportType = type;
                  },
                  onFileSelect: (files, optionsStr) =>
                      importHandler.handleFileSelect(files, optionsStr),
                  onSaveImageToComputer: () => {
                      applyUncommitted();
                      this.saveToComputer.save();
                  },
                  onNewImage: showNewImageDialog,
                  onShareImage: (callback) => {
                      applyUncommitted();
                      shareImage(callback);
                  },
                  onUpload: () => {
                      // on upload
                      applyUncommitted();
                      KL.imgurUpload(
                          this.klCanvas,
                          p.app && p.app.imgurKey ? p.app.imgurKey : '',
                          () => this.updateLastSaved(),
                      );
                  },
                  applyUncommitted: () => applyUncommitted(),
                  onChangeShowSaveDialog: (b) => {
                      this.saveToComputer.setShowsSaveDialog(b);
                  },
                  klRecoveryManager,
                  onOpenBrowserStorage,
                  onStoredToBrowserStorage: () => {
                      this.updateLastSaved();
                  },
              });

        if (!this.embed && projectStore) {
            this.saveReminder = new SaveReminder({
                onSaveAsPsd: () => {
                    if (!this.embed) {
                        this.saveAsPsd();
                    }
                },
                isDrawing: () => {
                    return this.isDrawing();
                },
                projectStore,
                getProject: () => this.getProject(),
                onStored: () => {
                    this.updateLastSaved();
                },
                applyUncommitted,
                klHistory: this.klHistory,
                helpPath: this.helpPath,
            });
        }

        const settingsUi = new KL.SettingsUi({
            onLeftRight: () => {
                this.uiLayout = this.uiLayout === 'left' ? 'right' : 'left';
                this.updateUi();
                if (!this.embed) {
                    LocalStorage.setItem('uiState', this.uiLayout);
                }
            },
            saveReminder: this.saveReminder,
            customAbout: p.aboutEl,
        });

        mainTabRow = new KL.TabRow({
            initialId: 'brush',
            tabArr: [
                {
                    id: 'brush',
                    title: LANG('tool-brush'),
                    image: toolPaintImg,
                    onOpen: () => {
                        if (currentBrushId === 'eraserBrush') {
                            this.klColorSlider.enable(false);
                        }
                        BB.append(colorDiv, [
                            this.klColorSlider.getElement(),
                            this.klColorSlider.getOutputElement(),
                            toolspaceStabilizerRow.getElement(),
                        ]);
                        brushDiv.style.display = 'block';
                    },
                    onClose: () => {
                        brushDiv.style.display = 'none';
                    },
                    css: {
                        minWidth: 45,
                    },
                },
                {
                    id: 'hand',
                    title: LANG('tool-hand'),
                    image: toolHandImg,
                    isVisible: false,
                    onOpen: () => {
                        handUi.setIsVisible(true);
                    },
                    onClose: () => {
                        handUi.setIsVisible(false);
                    },
                    css: {
                        minWidth: 45,
                    },
                },
                {
                    id: 'paintBucket',
                    title: LANG('tool-paint-bucket'),
                    image: toolFillImg,
                    isVisible: false,
                    onOpen: () => {
                        this.klColorSlider.enable(true);
                        fillUi.setIsVisible(true);
                    },
                    onClose: () => {
                        fillUi.setIsVisible(false);
                    },
                    css: {
                        minWidth: 45,
                    },
                },
                {
                    id: 'gradient',
                    title: LANG('tool-gradient'),
                    image: toolGradientImg,
                    isVisible: false,
                    onOpen: () => {
                        this.klColorSlider.enable(true);
                        gradientUi.setIsVisible(true);
                    },
                    onClose: () => {
                        gradientUi.setIsVisible(false);
                    },
                    css: {
                        minWidth: 45,
                    },
                },
                {
                    id: 'text',
                    title: LANG('tool-text'),
                    image: toolTextImg,
                    isVisible: false,
                    onOpen: () => {
                        this.klColorSlider.enable(true);
                        textUi.setIsVisible(true);
                    },
                    onClose: () => {
                        textUi.setIsVisible(false);
                    },
                    css: {
                        minWidth: 45,
                    },
                },
                {
                    id: 'shape',
                    title: LANG('tool-shape'),
                    image: toolShapeImg,
                    isVisible: false,
                    onOpen: () => {
                        this.klColorSlider.enable(true);
                        shapeUi.setIsVisible(true);
                    },
                    onClose: () => {
                        shapeUi.setIsVisible(false);
                    },
                    css: {
                        minWidth: 45,
                    },
                },
                {
                    id: 'select',
                    title: LANG('tool-select'),
                    image: toolSelectImg,
                    isVisible: false,
                    onOpen: () => {
                        klAppSelect.getSelectUi().setIsVisible(true);
                    },
                    onClose: () => {
                        klAppSelect.getSelectUi().setIsVisible(false);
                    },
                    css: {
                        minWidth: 45,
                    },
                },
                {
                    id: 'layers',
                    title: LANG('layers'),
                    image: tabLayersImg,
                    onOpen: () => {
                        this.layersUi.setIsVisible(true);
                        this.layersUi.update();
                    },
                    onClose: () => {
                        this.layersUi.setIsVisible(false);
                    },
                    css: {
                        minWidth: 45,
                    },
                },
                {
                    id: 'edit',
                    title: LANG('tab-edit'),
                    image: tabEditImg,
                    onOpen: () => {
                        editUi.show();
                    },
                    onClose: () => {
                        editUi.hide();
                    },
                    css: {
                        minWidth: 45,
                    },
                },
                {
                    id: 'file',
                    label: LANG('tab-file'),
                    isVisible: !!fileUi,
                    onOpen: () => {
                        if (!fileUi) {
                            return;
                        }
                        fileUi.getElement().style.display = 'block';
                        fileUi.setIsVisible(true);
                    },
                    onClose: () => {
                        if (!fileUi) {
                            return;
                        }
                        fileUi.getElement().style.display = 'none';
                        fileUi.setIsVisible(false);
                    },
                    css: {
                        padding: '0 7px',
                    },
                },
                {
                    id: 'settings',
                    title: LANG('tab-settings'),
                    image: tabSettingsImg,
                    onOpen: () => {
                        settingsUi.getElement().style.display = 'block';
                        // settingsTab.setIsVisible(true);
                    },
                    onClose: () => {
                        settingsUi.getElement().style.display = 'none';
                        // settingsTab.setIsVisible(false);
                    },
                    css: {
                        minWidth: 45,
                    },
                },
            ],
        });

        this.bottomBarWrapper = BB.el({
            css: {
                width: 270,
            },
        });
        if (p.bottomBar) {
            this.bottomBar = p.bottomBar;
            this.bottomBarWrapper.append(this.bottomBar);
        }

        BB.append(this.toolspaceInner, [
            this.layerPreview.getElement(),
            mainTabRow.getElement(),
            brushDiv,
            handUi.getElement(),
            fillUi.getElement(),
            gradientUi.getElement(),
            textUi.getElement(),
            shapeUi.getElement(),
            klAppSelect.getSelectUi().getElement(),
            this.layersUi.getElement(),
            editUi.getElement(),
            fileUi ? fileUi.getElement() : undefined,
            settingsUi.getElement(),
            BB.el({
                css: {
                    height: 10, // a bit of spacing at the bottom
                    flexGrow: 1,
                },
            }),
            this.bottomBarWrapper ? this.bottomBarWrapper : undefined,
        ]);

        this.toolspaceScroller = new KL.ToolspaceScroller({
            toolspace: this.toolspace,
            uiState: this.uiLayout,
        });

        if (!this.embed) {
            Object.defineProperty(window, 'KL', {
                value: createConsoleApi({
                    onDraw: (path: TVector2D[]): void => {
                        if (!path || path.length === 0) {
                            return;
                        }
                        path.forEach((p, index) => {
                            if (index === 0) {
                                currentBrushUi.startLine(p.x, p.y, 1);
                            } else {
                                currentBrushUi.goLine(p.x, p.y, 1);
                            }
                        });
                        currentBrushUi.endLine();
                    },
                }),
                writable: false,
            });
        }

        this.resize(this.uiWidth, this.uiHeight);
        this.updateUi();

        const importHandler = new KlAppImportHandler(
            {
                klRootEl: this.rootEl,
                maxCanvasSize,
                layersUi: this.layersUi,
                setCurrentLayer,
                klCanvas: this.klCanvas,
                onImportConfirm: () => {
                    this.easelProjectUpdater.update();
                    this.easel.resetOrFitTransform(true);
                },
                applyUncommitted: () => applyUncommitted(),
            },
            {
                onColor: (rgb) => brushSettingService.setColor(rgb),
            },
        );

        if (!this.embed || this.embed.enableImageDropperImport) {
            new KL.KlImageDropper({
                target: document.body,
                onDrop: (files, optionStr) => {
                    if (KL.DIALOG_COUNTER.get() > 0) {
                        return;
                    }
                    applyUncommitted();
                    importHandler.handleFileSelect(files, optionStr);
                },
                enabledTest: () => {
                    return KL.DIALOG_COUNTER.get() === 0;
                },
            });

            window.document.addEventListener(
                'paste',
                (e: ClipboardEvent) => importHandler.onPaste(e),
                false,
            );
        }

        this.unloadWarningTrigger = new UnloadWarningTrigger({
            klHistory: this.klHistory,
            getLastSavedHistoryIndex: () => this.lastSavedHistoryIndex,
        });

        {
            window.addEventListener('resize', () => {
                this.resize(window.innerWidth, window.innerHeight);
            });
            window.addEventListener('orientationchange', () => {
                this.resize(window.innerWidth, window.innerHeight);
            });
            // 2024-08: window.resize doesn't fire on iPad Safari when:
            // pinch zoomed page, then reload, and un-pinch-zoom page
            // therefor also listen to visualViewport.
            if ('visualViewport' in window && visualViewport !== null) {
                visualViewport.addEventListener('resize', () => {
                    this.resize(window.innerWidth, window.innerHeight);
                });
            }

            // iPad doesn't trigger 'resize' event when using text zoom, although it's resizing the window.
            // Workaround: place a div in the body that fills the window, and use a ResizeObserver
            const windowResizeWatcher = BB.el({
                parent: document.body,
                css: {
                    position: 'fixed',
                    left: 0,
                    top: 0,
                    right: 0,
                    bottom: 0,
                    pointerEvents: 'none',
                    zIndex: '-1',
                    userSelect: 'none',
                },
            });
            try {
                // Not all browsers support ResizeObserver. Not critical though.
                const observer = new ResizeObserver(() =>
                    this.resize(window.innerWidth, window.innerHeight),
                );
                observer.observe(windowResizeWatcher);
            } catch (e) {
                windowResizeWatcher.remove();
            }

            // prevent ctrl scroll -> zooming page
            this.rootEl.addEventListener(
                'wheel',
                (event) => {
                    if (keyListener.isPressed('ctrl')) {
                        event.preventDefault();
                    }
                },
                { passive: false },
            );
            // prevents pinch zoom of page on macOS Safari
            const prevent = (e: Event) => {
                e.preventDefault();
            };
            window.addEventListener('gesturestart', prevent, { passive: false });
            window.addEventListener('gesturechange', prevent, { passive: false });
            window.addEventListener('gestureend', prevent, { passive: false });

            const pinchZoomWatcher = new PinchZoomWatcher();
        }

        if (!this.embed) {
            setTimeout(() => {
                runBrowserStorageBanner({
                    projectStore,
                    klRecoveryManager,
                    onOpenBrowserStorage,
                    klHistory: this.klHistory,
                });
            });
        }
        this.saveReminder?.init();
    }

    // -------- interface --------

    getElement(): HTMLElement {
        return this.rootEl;
    }

    resize(w: number, h: number): void {
        // iPad scrolls down when increasing text zoom
        if (window.scrollY > 0) {
            window.scrollTo(0, 0);
        }

        if (this.uiWidth === Math.max(0, w) && this.uiHeight === Math.max(0, h)) {
            return;
        }

        this.uiWidth = Math.max(0, w);
        this.uiHeight = Math.max(0, h);

        this.updateCollapse();

        const toolspaceLayout = getToolspaceLayout(this.uiHeight);
        this.layerPreview.setIsVisible(toolspaceLayout.isLayerPreviewVisible);
        this.layerPreview.setIsSmall(toolspaceLayout.isLayerPreviewSmall);
        this.klColorSlider.setHeight(toolspaceLayout.colorSliderHeight);
        this.toolspaceToolRow.setIsSmall(toolspaceLayout.isToolRowSmall);
    }

    out(msg: string): void {
        this.statusOverlay.out(msg);
    }

    async getPNG(): Promise<Blob> {
        return await canvasToBlob(this.klCanvas.getCanvas(1, false, true), 'image/png');
    }

    getPSD = async (): Promise<Blob> => {
        return await klCanvasToPsdBlob(this.klCanvas, false);
    };

    getProject(): TKlProject {
        return this.klCanvas.getProject();
    }

    swapUiLeftRight(): void {
        this.uiLayout = this.uiLayout === 'left' ? 'right' : 'left';
        if (!this.embed) {
            LocalStorage.setItem('uiState', this.uiLayout);
        }
        this.updateUi();
    }

    setLogo(logoImg: string, isPixelated?: boolean, keepOriginalColors?: boolean): void {
        if (this.toolspaceTopRow instanceof ToolspaceTopRow) {
            this.toolspaceTopRow.setLogo(logoImg, isPixelated, keepOriginalColors);
        }
    }

    saveAsPsd(): void {
        this.saveToComputer.save('psd');
    }

    isDrawing(): boolean {
        return this.lineSanitizer.getIsDrawing() || this.easel.getIsLocked();
    }
}
