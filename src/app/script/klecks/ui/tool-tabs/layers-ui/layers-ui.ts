import { getIconSvg } from '../../../../icon/icon';
import { BB } from '../../../../bb/bb';
import { changeCanvasDimensions } from '../../../../bb/base/change-canvas-dimensions';
import { SelectCustom } from '../../components/select-custom';
import { PointSlider } from '../../components/point-slider';
import { KlCanvas, MAX_LAYERS, TKlCanvasLayer } from '../../../canvas/kl-canvas';
import { TCanvasBackground, TMixMode } from '../../../kl-types';
import { LANG } from '../../../../language/language';
import { translateBlending } from '../../../canvas/translate-blending';
import { PointerListener } from '../../../../bb/input/pointer-listener';
import { TPointerEvent } from '../../../../bb/input/event.types';
import { renameLayerDialog } from './rename-layer-dialog';
import { mergeLayerDialog } from './merge-layer-dialog';
import { css } from '../../../../bb/base/base';
import { HAS_POINTER_EVENTS } from '../../../../bb/base/browser';
import { c } from '../../../../bb/base/c';
import { DropdownMenu } from '../../components/dropdown-menu';
import { KlHistory } from '../../../history/kl-history';
import * as classes from './layers-ui.module.scss';
import { BoxToggle } from '../../components/box-toggle';
import { FloatingLayerPreview } from '../../components/floating-layer-preview';
import { Options } from '../../components/options';

const paddingLeft = 25;
const layerHeight = 35;
type TBlendChoice = TMixMode | 'pass-through';
type TDropPlacement = 'above' | 'below' | 'inside';

type TLayerEl = HTMLElement & {
    label: HTMLElement;
    opacityLabel: HTMLElement;
    thumb?: HTMLCanvasElement;

    spot: number;
    layerName: string;
    opacity: number;
    pointerListener: PointerListener;
    opacitySlider: PointSlider;
    isSelected: boolean;
};

export type TLayersUiParams = {
    klCanvas: KlCanvas;
    onSelect: (layerIndex: number, pushHistory: boolean) => void;
    parentEl: HTMLElement;
    floatingLayerPreview: FloatingLayerPreview;
    applyUncommitted: () => void;
    klHistory: KlHistory;
    onUpdateProject: () => void; // triggers update of easel
    onClearLayer: () => void;
};

export class LayersUi {
    // from params
    private klCanvas: KlCanvas;
    private readonly onSelect: (layerIndex: number, pushHistory: boolean) => void;
    private readonly parentEl: HTMLElement;
    private readonly floatingLayerPreview: FloatingLayerPreview;
    private readonly applyUncommitted: () => void;
    private klHistory: KlHistory;
    private readonly onUpdateProject: () => void;
    private readonly onClearLayer: () => void;

    private readonly rootEl: HTMLElement;
    private isVisible: boolean = true;
    private klCanvasLayerArr: TKlCanvasLayer[];
    private readonly layerListEl: HTMLElement;
    private layerElArr: TLayerEl[];
    private visibleIndices: number[] = [];
    private selectedSpotIndex: number;
    private readonly removeBtn: HTMLButtonElement;
    private readonly addBtn: HTMLButtonElement;
    private readonly addGroupBtn: HTMLButtonElement;
    private readonly duplicateBtn: HTMLButtonElement;
    private readonly mergeBtn: HTMLButtonElement;
    private readonly moreDropdown: DropdownMenu<'clear-layer' | 'advanced-merge' | 'merge-all'>;
    private readonly modeSelect: SelectCustom<TBlendChoice>;
    private modeSelectIsGroup: boolean = false;
    private readonly clippingToggle: BoxToggle;
    private readonly backgroundOptions: Options<TCanvasBackground>;
    private oldHistoryState: number | undefined;
    private isManipulating: boolean = false;
    private isMutatingStructure: boolean = false;

    private readonly largeThumbCanvas: HTMLCanvasElement;
    private getParentIndex(index: number): number {
        const parentId = this.klCanvasLayerArr[index]?.parentGroupId;
        return parentId
            ? this.klCanvasLayerArr.findIndex((layer) => layer.groupId === parentId)
            : -1;
    }

    private getDepth(index: number): number {
        let depth = 0;
        let parentIndex = this.getParentIndex(index);
        while (parentIndex >= 0 && depth < this.klCanvasLayerArr.length) {
            depth++;
            parentIndex = this.getParentIndex(parentIndex);
        }
        return depth;
    }

    private isHiddenByCollapsedGroup(index: number): boolean {
        let parentIndex = this.getParentIndex(index);
        let remaining = this.klCanvasLayerArr.length;
        while (parentIndex >= 0 && remaining-- > 0) {
            if (this.klCanvasLayerArr[parentIndex].isExpanded === false) {
                return true;
            }
            parentIndex = this.getParentIndex(parentIndex);
        }
        return false;
    }

    private isDescendantOf(index: number, groupIndex: number): boolean {
        let parentIndex = this.getParentIndex(index);
        let remaining = this.klCanvasLayerArr.length;
        while (parentIndex >= 0 && remaining-- > 0) {
            if (parentIndex === groupIndex) {
                return true;
            }
            parentIndex = this.getParentIndex(parentIndex);
        }
        return false;
    }

    private revealAncestors(index: number): void {
        this.klCanvasLayerArr = this.klCanvas.getLayers();
        const ancestors: number[] = [];
        let parentIndex = this.getParentIndex(index);
        let remaining = this.klCanvasLayerArr.length;
        while (parentIndex >= 0 && remaining-- > 0) {
            ancestors.unshift(parentIndex);
            parentIndex = this.getParentIndex(parentIndex);
        }
        for (const ancestorIndex of ancestors) {
            if (this.klCanvasLayerArr[ancestorIndex].isExpanded === false) {
                this.klCanvas.setGroupExpanded(ancestorIndex, true);
            }
        }
        this.klCanvasLayerArr = this.klCanvas.getLayers();
    }

    private performStructuralChange(
        change: () => false | number | undefined,
    ): false | number | undefined {
        this.isMutatingStructure = true;
        try {
            const newIndex = change();
            if (typeof newIndex === 'number') {
                this.revealAncestors(newIndex);
            }
            return newIndex;
        } finally {
            this.isMutatingStructure = false;
        }
    }

    private selectAfterStructure(newIndex: number): void {
        this.selectedSpotIndex = newIndex;
        this.klCanvasLayerArr = this.klCanvas.getLayers();
        this.createLayerList(true);
        this.onSelect(newIndex, false);
    }

    private getDropTarget(clientY: number): { index: number; placement: TDropPlacement } | undefined {
        if (!this.visibleIndices.length) {
            return;
        }
        const top = this.layerListEl.getBoundingClientRect().top;
        const y = Math.max(0, Math.min(this.visibleIndices.length * layerHeight - 1, clientY - top));
        const row = Math.floor(y / layerHeight);
        const fraction = (y % layerHeight) / layerHeight;
        const index = this.visibleIndices[row];
        const isGroup = !!this.klCanvasLayerArr[index].groupId;
        const placement: TDropPlacement =
            isGroup && fraction >= 0.25 && fraction <= 0.75
                ? 'inside'
                : fraction < 0.5
                  ? 'above'
                  : 'below';
        return { index, placement };
    }

    private showDropTarget(target?: { index: number; placement: TDropPlacement }): void {
        for (const row of this.layerElArr) {
            if (row) {
                row.classList.remove(classes.dropAbove, classes.dropBelow, classes.dropInside);
            }
        }
        if (target) {
            const row = this.layerElArr[target.index];
            row?.classList.add(
                target.placement === 'above'
                    ? classes.dropAbove
                    : target.placement === 'below'
                      ? classes.dropBelow
                      : classes.dropInside,
            );
        }
    }

    private renameLayer(layerSpot: number): void {
        renameLayerDialog(this.parentEl, this.klCanvas.getLayer(layerSpot).name, (newName) => {
            if (newName === undefined || newName === this.klCanvas.getLayer(layerSpot).name) {
                return;
            }
            this.klCanvas.renameLayer(layerSpot, newName);
            //this.createLayerList();
            this.onSelect(layerSpot, false);
        });
    }

    private updateHeight(): void {
        this.layerListEl.style.height = this.visibleIndices.length * layerHeight + 'px';
    }

    private createLayerList(force?: boolean): void {
        if (this.klHistory.getChangeCount() === this.oldHistoryState && !force) {
            return;
        }
        this.isManipulating = false;
        this.oldHistoryState = this.klHistory.getChangeCount();
        this.klCanvasLayerArr = this.klCanvas.getLayers();

        this.visibleIndices = [];
        for (let index = this.klCanvasLayerArr.length - 1; index >= 0; index--) {
            if (!this.isHiddenByCollapsedGroup(index)) {
                this.visibleIndices.push(index);
            }
        }

        const createLayerEntry = (index: number, rowPosition: number): void => {
            const klLayer = this.klCanvasLayerArr[index];
            const layerName = klLayer.name;
            const opacity = klLayer.opacity;
            const isVisible = klLayer.isVisible;
            const layercanvas = klLayer.context.canvas;
            const hasClipping = klLayer.hasClipping;
            const clippingOffset = hasClipping ? 15 : 0;
            const isGroup = !!klLayer.groupId;
            const indent = Math.min(84, this.getDepth(index) * 14);
            const contentLeft = paddingLeft + indent + (isGroup ? 18 : 0);

            const layer: TLayerEl = BB.el({
                className: ['kl-layer', ...(isGroup ? [classes.groupRow] : [])],
            }) as HTMLElement as TLayerEl;
            this.layerElArr[index] = layer;
            css(layer, {
                top: rowPosition * layerHeight,
            });
            const innerLayer = BB.el();
            css(innerLayer, {
                position: 'relative',
            });

            const container1 = BB.el();
            css(container1, {
                width: 270,
                height: 34,
            });
            const container2 = BB.el();
            layer.append(innerLayer);
            innerLayer.append(container1, container2);

            layer.spot = index;

            if (isGroup) {
                const expanded = klLayer.isExpanded !== false;
                const expandButton = BB.el({
                    tagName: 'button',
                    parent: container1,
                    textContent: expanded ? '▾' : '▸',
                    title: LANG(expanded ? 'layers-group-collapse' : 'layers-group-expand'),
                    props: {
                        type: 'button',
                        ariaLabel: LANG(expanded ? 'layers-group-collapse' : 'layers-group-expand'),
                        ariaExpanded: '' + expanded,
                    },
                    css: {
                        position: 'absolute',
                        left: paddingLeft + indent,
                        top: 2,
                        width: 18,
                        height: 30,
                        padding: 0,
                        border: 0,
                        background: 'transparent',
                        color: 'inherit',
                        cursor: 'pointer',
                    },
                });
                expandButton.onpointerdown = (event) => event.stopPropagation();
                expandButton.onmousedown = (event) => event.stopPropagation();
                expandButton.onclick = (event) => {
                    event.stopPropagation();
                    this.applyUncommitted();
                    const selectGroup = expanded && this.isDescendantOf(this.selectedSpotIndex, index);
                    if (selectGroup) {
                        this.selectedSpotIndex = index;
                    }
                    this.isMutatingStructure = true;
                    try {
                        this.klCanvas.setGroupExpanded(index, !expanded);
                    } finally {
                        this.isMutatingStructure = false;
                    }
                    this.klCanvasLayerArr = this.klCanvas.getLayers();
                    this.createLayerList(true);
                    if (selectGroup) {
                        this.onSelect(index, false);
                    }
                };
            }

            //checkbox - visibility
            {
                const checkWrapper = BB.el({
                    tagName: 'label',
                    parent: container1,
                    title: LANG('layers-visibility-toggle'),
                    css: {
                        display: 'flex',
                        width: 25,
                        height: '100%',
                        justifyContent: 'right',
                        alignItems: 'center',
                        cursor: 'pointer',
                    },
                });
                const check = BB.el({
                    tagName: 'input',
                    parent: checkWrapper,
                    props: {
                        type: 'checkbox',
                        tabIndex: -1,
                        name: 'layer-visibility',
                    },
                    css: {
                        display: 'block',
                        cursor: 'pointer',
                        margin: 0,
                        marginRight: 5,
                    },
                });
                check.checked = isVisible;
                check.onchange = () => {
                    this.klCanvas.setLayerIsVisible(layer.spot, check.checked);
                    if (layer.spot === this.selectedSpotIndex) {
                        this.onSelect(this.selectedSpotIndex, false);
                    }
                };
                // prevent layer getting dragged
                const preventFunc = (e: PointerEvent | MouseEvent) => {
                    e.preventDefault();
                    e.stopPropagation();
                };
                if (HAS_POINTER_EVENTS) {
                    checkWrapper.onpointerdown = preventFunc;
                } else {
                    checkWrapper.onmousedown = preventFunc;
                }
            }

            //thumb or folder glyph
            if (isGroup) {
                container1.append(
                    BB.el({
                        tagName: 'span',
                        textContent: '📁',
                        props: { ariaHidden: 'true' },
                        css: {
                            position: 'absolute',
                            left: contentLeft + 3,
                            top: 5,
                            fontSize: 20,
                            lineHeight: '24px',
                            pointerEvents: 'none',
                        },
                    }),
                );
            } else {
                const thumbDimensions = BB.fitInto(
                    layercanvas.width,
                    layercanvas.height,
                    30,
                    30,
                    1,
                    true,
                );
                layer.thumb = BB.canvas(thumbDimensions.width, thumbDimensions.height);

                const thc = BB.ctx(layer.thumb);
                thc.save();
                if (layer.thumb.width > layercanvas.width) {
                    thc.imageSmoothingEnabled = false;
                }
                thc.drawImage(layercanvas, 0, 0, layer.thumb.width, layer.thumb.height);
                thc.restore();
                css(layer.thumb, {
                    position: 'absolute',
                    left: (32 - layer.thumb.width) / 2 + contentLeft,
                    top: (32 - layer.thumb.height) / 2 + 1,
                    background: 'var(--kl-checkerboard-background)',
                });
            }

            //clipping indicator
            const clippingIcon = hasClipping
                ? getIconSvg('layer-clipping', {
                      position: 'absolute',
                      left: contentLeft + 32,
                      top: 9,
                      width: 16,
                      height: 16,
                      pointerEvents: 'none',
                  })
                : undefined;
            clippingIcon?.classList.add(classes.clippingIndicator);

            //layerlabel
            {
                layer.label = BB.el({
                    className: 'kl-layer__label',
                });
                layer.layerName = layerName;
                layer.label.append(layer.layerName);

                css(layer.label, {
                    position: 'absolute',
                    left: 1 + 32 + 5 + contentLeft + clippingOffset,
                    top: 1,
                    fontSize: 13,
                    width: Math.max(40, 165 - (contentLeft - paddingLeft) - clippingOffset),
                    height: 20,
                    overflow: 'hidden',
                    whiteSpace: 'nowrap',
                    textOverflow: 'ellipsis',
                });

                layer.label.ondblclick = () => {
                    this.applyUncommitted();
                    this.renameLayer(layer.spot);
                };
            }
            //layer label opacity
            {
                layer.opacityLabel = BB.el({
                    className: 'kl-layer__opacity-label',
                });
                layer.opacity = opacity;
                layer.opacityLabel.append(parseInt('' + layer.opacity * 100) + '%');

                css(layer.opacityLabel, {
                    position: 'absolute',
                    left: 250 - 1 - 5 - 50 - 5 + paddingLeft,
                    top: 1,
                    fontSize: 13,
                    textAlign: 'right',
                    width: 50,
                    transition: 'color 0.2s ease-in-out',
                    textDecoration: isVisible ? undefined : 'line-through',
                });
            }

            let oldOpacity: number;
            const opacitySlider = new PointSlider({
                init: layer.opacity,
                width: Math.max(90, 200 - (contentLeft - paddingLeft) - clippingOffset),
                pointSize: 14,
                callback: (sliderValue, isFirst, isLast) => {
                    if (isFirst) {
                        this.isManipulating = true;
                        oldOpacity = this.klCanvas.getLayer(layer.spot).opacity;
                        return;
                    }
                    if (isLast) {
                        this.isManipulating = false;
                        if (oldOpacity !== sliderValue) {
                            this.klCanvas.setOpacity(layer.spot, sliderValue);
                        }
                        return;
                    }
                    layer.opacityLabel.innerHTML = Math.round(sliderValue * 100) + '%';
                    this.klHistory.pause(true);
                    try {
                        this.klCanvas.setOpacity(layer.spot, sliderValue);
                    } finally {
                        this.klHistory.pause(false);
                    }
                    this.onUpdateProject();
                },
                getDoIgnore: () => this.isManipulating,
            });
            css(opacitySlider.getElement(), {
                position: 'absolute',
                left: 39 + contentLeft + clippingOffset,
                top: 17,
            });
            layer.opacitySlider = opacitySlider;

            //larger layer preview - hover
            if (layer.thumb) {
                layer.thumb.onpointerover = (e) => {
                    if (e.buttons !== 0 && (!e.pointerType || e.pointerType !== 'touch')) {
                        //shouldn't show while dragging
                        return;
                    }

                    const thumbDimensions = BB.fitInto(
                        layercanvas.width,
                        layercanvas.height,
                        250,
                        250,
                        1,
                        true,
                    );

                    changeCanvasDimensions(
                        this.largeThumbCanvas,
                        thumbDimensions.width,
                        thumbDimensions.height,
                        { ensureCleared: true },
                    );
                    const ctx = BB.ctx(this.largeThumbCanvas);
                    ctx.save();
                    if (this.largeThumbCanvas.width > layercanvas.width) {
                        ctx.imageSmoothingEnabled = false;
                    }
                    ctx.imageSmoothingQuality = 'high';
                    ctx.drawImage(
                        layercanvas,
                        0,
                        0,
                        this.largeThumbCanvas.width,
                        this.largeThumbCanvas.height,
                    );
                    ctx.restore();
                    this.floatingLayerPreview.show(this.largeThumbCanvas, e.clientY);
                };
                // Won't fire when element is removed from DOM. To fix when rewriting layers-ui.
                layer.thumb.onpointerout = () => {
                    this.floatingLayerPreview.hide();
                };
            }

            if (layer.thumb) {
                container1.append(layer.thumb);
            }
            if (clippingIcon) {
                container1.append(clippingIcon);
            }
            container1.append(layer.label, layer.opacityLabel, opacitySlider.getElement());
            let freshSelection = false;
            let isDragging = false;
            let hasMoved = false;
            let dropTarget: { index: number; placement: TDropPlacement } | undefined;

            // Visible rows map back to real model indices, even when groups are collapsed.
            const dragEventHandler = (event: TPointerEvent) => {
                if (
                    event.type === 'pointerdown' &&
                    event.button === 'left' &&
                    !this.isManipulating
                ) {
                    freshSelection = false;
                    if (!layer.isSelected) {
                        freshSelection = true;
                        this.activateLayer(layer.spot);
                    }
                    isDragging = true;
                    hasMoved = false;
                    dropTarget = undefined;
                    this.isManipulating = true;
                } else if (event.type === 'pointermove' && event.button === 'left' && isDragging) {
                    if (!hasMoved) {
                        const distance = Math.hypot(
                            event.pageX - (event.downPageX ?? event.pageX),
                            event.pageY - (event.downPageY ?? event.pageY),
                        );
                        if (distance < 4) {
                            return;
                        }
                        hasMoved = true;
                        this.floatingLayerPreview.hide();
                        layer.classList.add(classes.dragging);
                    }
                    const candidate = this.getDropTarget(event.clientY);
                    dropTarget =
                        candidate &&
                        candidate.index !== layer.spot &&
                        !(isGroup && this.isDescendantOf(candidate.index, layer.spot))
                            ? candidate
                            : undefined;
                    this.showDropTarget(dropTarget);
                }
                if (event.type === 'pointerup' && isDragging) {
                    isDragging = false;
                    this.isManipulating = false;
                    layer.classList.remove(classes.dragging);
                    this.showDropTarget();
                    if (hasMoved && dropTarget) {
                        const target = dropTarget;
                        this.applyUncommitted();
                        const newIndex = this.performStructuralChange(() =>
                            this.klCanvas.moveLayerTo(
                                layer.spot,
                                target.index,
                                target.placement,
                            ),
                        );
                        if (typeof newIndex === 'number') {
                            this.selectAfterStructure(newIndex);
                        } else if (freshSelection) {
                            this.onSelect(layer.spot, true);
                        }
                    } else if (freshSelection) {
                        this.applyUncommitted();
                        this.onSelect(layer.spot, true);
                    }
                    freshSelection = false;
                    dropTarget = undefined;
                }
            };

            layer.pointerListener = new BB.PointerListener({
                target: container1,
                onPointer: dragEventHandler,
                maxPointers: 1,
            });

            this.layerListEl.append(layer);
        };
        this.layerElArr = new Array(this.klCanvasLayerArr.length);
        while (this.layerListEl.firstChild) {
            const child = this.layerListEl.firstChild as TLayerEl;
            child.pointerListener.destroy();
            child.opacitySlider.destroy();
            child.remove();
        }
        for (let rowPosition = 0; rowPosition < this.visibleIndices.length; rowPosition++) {
            createLayerEntry(this.visibleIndices[rowPosition], rowPosition);
        }
        const previousSelection = this.selectedSpotIndex;
        if (!this.layerElArr[this.selectedSpotIndex]) {
            let parentIndex = this.getParentIndex(this.selectedSpotIndex);
            while (parentIndex >= 0 && !this.layerElArr[parentIndex]) {
                parentIndex = this.getParentIndex(parentIndex);
            }
            this.selectedSpotIndex =
                parentIndex >= 0 ? parentIndex : (this.visibleIndices[0] ?? 0);
        }
        this.activateLayer(this.selectedSpotIndex);
        this.updateHeight();
        if (previousSelection !== this.selectedSpotIndex) {
            this.onSelect(this.selectedSpotIndex, false);
        }
    }

    private updateButtons(): void {
        const maxReached = this.klCanvasLayerArr.length >= MAX_LAYERS;
        const oneLayer = this.klCanvasLayerArr.length === 1;
        const selected = this.klCanvasLayerArr[this.selectedSpotIndex];
        const isGroup = !!selected?.groupId;
        const rasterCount = this.klCanvasLayerArr.filter((layer) => !layer.groupId).length;
        const canMerge = this.canMergeSelected();

        this.addBtn.disabled = maxReached;
        this.addGroupBtn.disabled = maxReached;
        this.removeBtn.disabled = oneLayer || (!isGroup && rasterCount <= 1);
        this.duplicateBtn.disabled = maxReached;
        this.mergeBtn.disabled = !canMerge;
        this.moreDropdown.setEnabled('clear-layer', !isGroup);
        this.moreDropdown.setEnabled('advanced-merge', canMerge);
        this.moreDropdown.setEnabled('merge-all', !oneLayer);
    }

    private canMergeSelected(): boolean {
        const selected = this.klCanvasLayerArr[this.selectedSpotIndex];
        const below = this.klCanvasLayerArr[this.selectedSpotIndex - 1];
        return (
            !!selected &&
            !!below &&
            !selected.groupId &&
            !below.groupId &&
            (selected.parentGroupId ?? null) === (below.parentGroupId ?? null)
        );
    }

    private getBlendOptions(isGroup: boolean): ([TBlendChoice, string] | undefined)[] {
        const modes: (TMixMode | undefined)[] = [
            'source-over',
            'multiply',
            'screen',
            'overlay',
            undefined,
            'linear-burn',
            'linear-dodge',
            'linear-light',
            'color-burn',
            'color-dodge',
            'vivid-light',
            'soft-light',
            'hard-light',
            'pin-light',
            'hard-mix',
            undefined,
            'darken',
            'lighten',
            'darker-color',
            'lighter-color',
            'difference',
            'exclusion',
            'subtract',
            'divide',
            undefined,
            'hue',
            'saturation',
            'color',
            'luminosity',
        ];
        const options = modes.map((mode): [TBlendChoice, string] | undefined =>
            mode ? [mode, translateBlending(mode)] : undefined,
        );
        return isGroup
            ? [['pass-through', LANG('layers-blend-pass-through')], undefined, ...options]
            : options;
    }

    private mergeLayer(mixModeStr?: TMixMode): void {
        if (!this.canMergeSelected()) {
            return;
        }
        const layerIndex = this.performStructuralChange(() =>
            this.klCanvas.mergeLayer(this.selectedSpotIndex, mixModeStr),
        );
        if (typeof layerIndex !== 'number') {
            return;
        }
        this.selectAfterStructure(layerIndex);
    }

    // ----------------------------------- public -----------------------------------
    constructor(p: TLayersUiParams) {
        this.klCanvas = p.klCanvas;
        this.onSelect = p.onSelect;
        this.parentEl = p.parentEl;
        this.floatingLayerPreview = p.floatingLayerPreview;
        this.applyUncommitted = p.applyUncommitted;
        this.klHistory = p.klHistory;
        this.onUpdateProject = p.onUpdateProject;
        this.onClearLayer = p.onClearLayer;

        this.layerElArr = [];
        const width = 270;

        this.largeThumbCanvas = BB.canvas();

        this.klCanvasLayerArr = this.klCanvas.getLayers();
        this.selectedSpotIndex = this.klCanvasLayerArr.length - 1;
        this.backgroundOptions = new Options<TCanvasBackground>({
            optionArr: [
                {
                    id: 'white',
                    label: LANG('background-white'),
                    ariaLabel: LANG('background-white'),
                },
                {
                    id: 'transparent',
                    label: LANG('background-transparent'),
                    ariaLabel: LANG('background-transparent'),
                },
            ],
            initId: this.klCanvas.getBackground(),
            ariaLabel: LANG('canvas-background'),
            isFocusable: true,
            onChange: (background) => {
                this.applyUncommitted();
                this.klCanvas.setBackground(background);
                this.onUpdateProject();
            },
        });
        this.rootEl = BB.el({
            css: {
                marginRight: 10,
                marginBottom: 0,
                marginLeft: 10,
                marginTop: 10,
                cursor: 'default',
                position: 'relative',
                zIndex: 0,
            },
        });

        const listDiv = BB.el({
            css: {
                width: width,
                position: 'relative',
                margin: '0 -10px',
                zIndex: 0,
            },
        });

        this.layerListEl = BB.el({
            parent: listDiv,
        });

        this.addBtn = BB.el({ tagName: 'button', className: 'kl-button' });
        this.addGroupBtn = BB.el({ tagName: 'button', className: 'kl-button' });
        this.duplicateBtn = BB.el({ tagName: 'button', className: 'kl-button' });
        this.mergeBtn = BB.el({ tagName: 'button', className: 'kl-button' });
        this.removeBtn = BB.el({ tagName: 'button', className: 'kl-button' });

        const iconSize = 20;
        this.clippingToggle = new BoxToggle({
            keepOriginalLabel: true,
            label: (() => {
                const icon = getIconSvg('layer-clipping', {
                    width: iconSize,
                    height: iconSize,
                });
                icon.classList.add(classes.clippingIcon);
                return BB.el({
                    content: icon,
                    className: classes.clippingIconWrapper,
                });
            })(),
            title: LANG('layers-clipping'),
            init: this.klCanvasLayerArr[this.selectedSpotIndex].hasClipping,
            onChange: (hasClipping) => {
                this.klCanvas.setLayerHasClipping(this.selectedSpotIndex, hasClipping);
                this.update(this.selectedSpotIndex);
            },
        });
        this.moreDropdown = new DropdownMenu({
            button: BB.el({
                content: getIconSvg('chevron-down', { width: '13px' }),
                css: {
                    display: 'flex',
                    justifyContent: 'center',
                    opacity: '0.9',
                },
            }),
            buttonTitle: LANG('more'),
            items: [
                ['clear-layer', LANG('layers-clear'), '⌫'],
                ['advanced-merge', LANG('layers-merge-advanced'), 'Ctrl + Shift + E'],
                ['merge-all', LANG('layers-merge-all')],
            ],
            onItemClick: (id) => {
                if (id === 'clear-layer') {
                    if (!this.klCanvasLayerArr[this.selectedSpotIndex]?.groupId) {
                        this.onClearLayer();
                    }
                }
                if (id === 'advanced-merge') {
                    if (this.canMergeSelected()) {
                        this.advancedMergeDialog();
                    }
                }
                if (id === 'merge-all') {
                    this.applyUncommitted();
                    const newIndex = this.performStructuralChange(() => this.klCanvas.mergeAll());
                    if (typeof newIndex !== 'number') {
                        return;
                    }
                    this.selectAfterStructure(newIndex);
                }
            },
        });

        this.updateButtons();

        const createButtons = () => {
            const div = BB.el();
            const async = () => {
                this.addBtn.tabIndex = -1;
                this.addGroupBtn.tabIndex = -1;
                this.duplicateBtn.tabIndex = -1;
                this.mergeBtn.tabIndex = -1;
                this.removeBtn.tabIndex = -1;

                this.addBtn.title = LANG('layers-new');
                this.addGroupBtn.title = LANG('layers-new-group');
                this.duplicateBtn.title = LANG('layers-duplicate');
                this.removeBtn.title = LANG('layers-remove');
                this.mergeBtn.title = LANG('layers-merge');

                this.addBtn.append(
                    getIconSvg('add-layer', {
                        height: 20,
                    }),
                );
                this.duplicateBtn.append(
                    getIconSvg('duplicate-layer', {
                        height: 20,
                    }),
                );
                this.mergeBtn.append(
                    getIconSvg('merge-layers', {
                        height: 20,
                    }),
                );
                this.removeBtn.append(
                    getIconSvg('remove-layer', {
                        height: 20,
                    }),
                );
                this.addGroupBtn.append(
                    BB.el({
                        tagName: 'span',
                        textContent: '📁',
                        props: { ariaHidden: 'true' },
                        className: classes.addGroupIcon,
                    }),
                );
                div.append(
                    c(',flex,gap-5,mb-10', [
                        this.addBtn,
                        this.addGroupBtn,
                        this.removeBtn,
                        this.duplicateBtn,
                        this.mergeBtn,
                        this.clippingToggle.getElement(),
                        c(',grow-1'),
                        this.moreDropdown.getElement(),
                    ]),
                );

                this.addBtn.onclick = () => {
                    this.applyUncommitted();
                    const newIndex = this.performStructuralChange(() =>
                        this.klCanvas.addLayer(this.selectedSpotIndex),
                    );
                    if (typeof newIndex !== 'number') {
                        return;
                    }
                    this.selectAfterStructure(newIndex);
                };
                this.addGroupBtn.onclick = () => {
                    this.applyUncommitted();
                    const newIndex = this.performStructuralChange(() =>
                        this.klCanvas.addGroup(this.selectedSpotIndex),
                    );
                    if (typeof newIndex !== 'number') {
                        return;
                    }
                    this.selectAfterStructure(newIndex);
                };
                this.duplicateBtn.onclick = () => {
                    this.applyUncommitted();
                    const newIndex = this.performStructuralChange(() =>
                        this.klCanvas.duplicateLayer(this.selectedSpotIndex),
                    );
                    if (typeof newIndex !== 'number') {
                        return;
                    }
                    this.selectAfterStructure(newIndex);
                };
                this.removeBtn.onclick = () => {
                    this.applyUncommitted();
                    const newIndex = this.performStructuralChange(() =>
                        this.klCanvas.removeLayer(this.selectedSpotIndex),
                    );
                    if (typeof newIndex !== 'number') {
                        return;
                    }
                    this.selectAfterStructure(newIndex);
                };
                this.mergeBtn.onclick = () => {
                    this.applyUncommitted();
                    this.mergeLayer();
                };

            };
            setTimeout(async, 1);
            return div;
        };
        this.rootEl.append(createButtons());

        let modeWrapper;
        {
            modeWrapper = BB.el({
                content: LANG('layers-blending') + '&nbsp;',
                css: {
                    fontSize: 15,
                },
            });

            this.modeSelect = new SelectCustom<TBlendChoice>({
                optionArr: this.getBlendOptions(false),
                onChange: (val) => {
                    this.applyUncommitted();
                    const index = this.selectedSpotIndex;
                    const selected = this.klCanvasLayerArr[index];
                    if (val === 'pass-through') {
                        if (!selected.groupId) {
                            return;
                        }
                        this.klCanvas.setGroupPassThrough(index, true);
                    } else {
                        this.klCanvas.setMixMode(index, val);
                    }
                    this.update(this.selectedSpotIndex);
                    this.createLayerList(true);
                },
                css: {
                    marginBottom: 10,
                },
                name: 'layer-blend-mode',
            });

            modeWrapper.append(this.modeSelect.getElement());
            this.rootEl.append(modeWrapper);
        }

        this.rootEl.append(listDiv);
        const backgroundControl = BB.el({
            className: classes.backgroundControl,
            content: [
                BB.el({
                    textContent: LANG('canvas-background'),
                    className: classes.backgroundLabel,
                }),
                this.backgroundOptions.getElement(),
            ],
        });
        this.rootEl.append(backgroundControl);

        this.klHistory.addListener(() => {
            this.backgroundOptions.setValue(this.klCanvas.getBackground(), true);
            if (this.isMutatingStructure || !this.isVisible) {
                return;
            }
            this.createLayerList();
        });

        this.createLayerList();
    }

    // ---- interface ----
    update(activeLayerSpotIndex?: number): void {
        this.backgroundOptions.setValue(this.klCanvas.getBackground(), true);
        this.klCanvasLayerArr = this.klCanvas.getLayers();
        if (activeLayerSpotIndex || activeLayerSpotIndex === 0) {
            this.selectedSpotIndex = activeLayerSpotIndex;
        }
        this.updateButtons();
        if (this.isVisible) {
            this.createLayerList();
            this.activateLayer(this.selectedSpotIndex);
        }
    }

    getSelected(): number {
        return this.selectedSpotIndex;
    }

    activateLayer(spotIndex: number): void {
        if (spotIndex < 0 || spotIndex > this.layerElArr.length - 1) {
            throw (
                'invalid spotIndex ' + spotIndex + ', layerElArr.length ' + this.layerElArr.length
            );
        }
        this.selectedSpotIndex = spotIndex;
        const selected = this.klCanvasLayerArr[this.selectedSpotIndex];
        const isGroup = !!selected.groupId;
        if (this.modeSelectIsGroup !== isGroup) {
            this.modeSelect.setOptionArr(this.getBlendOptions(isGroup));
            this.modeSelectIsGroup = isGroup;
        }
        this.modeSelect.setValue(
            isGroup && selected.isPassThrough ? 'pass-through' : selected.mixModeStr,
        );
        this.clippingToggle.setValue(selected.hasClipping);
        for (let i = 0; i < this.layerElArr.length; i++) {
            const layer = this.layerElArr[i];
            if (!layer) {
                continue;
            }
            const isSelected = this.selectedSpotIndex === layer.spot;

            css(layer, {
                boxShadow: '',
            });
            layer.classList.toggle('kl-layer--selected', isSelected);
            layer.opacitySlider.setActive(isSelected);
            layer.isSelected = isSelected;
        }
        this.updateButtons();
    }

    getElement(): HTMLElement {
        return this.rootEl;
    }

    advancedMergeDialog(): void {
        this.applyUncommitted();
        if (!this.canMergeSelected()) {
            return;
        }
        mergeLayerDialog(this.parentEl, {
            topCanvas: this.klCanvasLayerArr[this.selectedSpotIndex].context.canvas,
            bottomCanvas: this.klCanvasLayerArr[this.selectedSpotIndex - 1].context.canvas,
            topOpacity: this.klCanvas.getLayer(this.selectedSpotIndex).opacity,
            mixModeStr: this.klCanvasLayerArr[this.selectedSpotIndex].mixModeStr,
            callback: (mode) => this.mergeLayer(mode as TMixMode),
        });
    }

    setIsVisible(b: boolean): void {
        if (b === this.isVisible) {
            return;
        }
        this.isVisible = b;
        this.rootEl.style.display = b ? 'block' : 'none';
        if (b) {
            this.createLayerList(true);
        }
    }
}
