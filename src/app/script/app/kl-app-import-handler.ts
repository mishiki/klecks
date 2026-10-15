import { TDropOption, TKlPsd, TRgb } from '../klecks/kl-types';
import { KL } from '../klecks/kl';
import { LANG } from '../language/language';
import { BB } from '../bb/bb';
import { changeCanvasDimensions } from '../bb/base/change-canvas-dimensions';
import { KlCanvas } from '../klecks/canvas/kl-canvas';
import { LayersUi } from '../klecks/ui/tool-tabs/layers-ui/layers-ui';
import { TRect, TSize2D } from '../bb/bb-types';
import { attempt, AttemptError, randomUuid, throwIfNull, throwIfUndefined } from '../bb/base/base';
import { loadImage, loadImageFromBlob } from '../bb/base/load-image';
import { ImportTrace } from '../bb/diagnostics/import-trace';
import { getNextLayerId } from '../klecks/history/get-next-layer-id';
import { detectFiletype } from '../klecks/storage/file-header-detection';
import { showError, showModal } from '../klecks/ui/modals/base/show-modal';

// todo later:
// onImage: (project: IKlProject) => void
// onLayer: (index: number, canvas: HMTLCanvasElement,layerName: string) => void

export class KlAppImportHandler {
    private readonly klRootEl: HTMLElement;
    private readonly klMaxCanvasSize: number;
    private readonly layersUi: LayersUi;
    private readonly setCurrentLayer: (index: number) => void;
    private readonly klCanvas: KlCanvas;
    private readonly onImportConfirm: () => void;
    private readonly applyUncommitted: () => void;

    private readonly onColor: (rgb: TRgb) => void;

    private reportImportFailure(error: unknown, trace?: ImportTrace, isPsd = false): void {
        trace?.fail(error);
        if (isPsd) {
            showError(
                BB.el({
                    // Error text must not be inserted as HTML.
                    textContent:
                        'Failed to load PSD: ' +
                        (error instanceof Error ? error.message : String(error)),
                }),
            );
        } else {
            showError(LANG('import-broken-file'));
        }
    }

    private importFinishedLoading(
        importedImage: // convertedPsd | {type: 'image', width: number, height: number, canvas: image | canvas}
        | TKlPsd
            | {
                  type: 'image';
                  width: number;
                  height: number;
                  canvas: HTMLCanvasElement | HTMLImageElement;
              },
        filename: string | undefined, // string e.g. 'drawing.psd'
        optionStr: 'default' | 'layer' | 'image',
        trace?: ImportTrace,
    ): void {
        if (
            !importedImage ||
            isNaN(importedImage.width) ||
            isNaN(importedImage.height) ||
            importedImage.width <= 0 ||
            importedImage.height <= 0
        ) {
            trace?.finish('rejected', { reason: 'invalid-dimensions' });
            showError(LANG('import-broken-file'));
            return;
        }

        const getResizedDimensions = (width: number, height: number): TSize2D => {
            let w = parseInt('' + width);
            let h = parseInt('' + height);
            if (w > this.klMaxCanvasSize) {
                h = (this.klMaxCanvasSize / w) * h;
                w = this.klMaxCanvasSize;
            }
            if (h > this.klMaxCanvasSize) {
                w = (this.klMaxCanvasSize / h) * w;
                h = this.klMaxCanvasSize;
            }
            w = parseInt('' + w);
            h = parseInt('' + h);
            return {
                width: w,
                height: h,
            };
        };

        const importAsImage = (canvas: HTMLCanvasElement | HTMLImageElement) => {
            trace?.stage('apply-uncommitted');
            this.applyUncommitted();
            trace?.stage('image-resize', { width: canvas.width, height: canvas.height });
            const resizedDimensions = getResizedDimensions(canvas.width, canvas.height);

            //resize first
            const tempCanvas = BB.canvas(canvas.width, canvas.height);
            const tempCanvasCtx = BB.ctx(tempCanvas);
            tempCanvasCtx.drawImage(canvas, 0, 0);

            BB.resizeCanvas(tempCanvas, resizedDimensions.width, resizedDimensions.height);

            trace?.stage('canvas-reset', {
                width: resizedDimensions.width,
                height: resizedDimensions.height,
            });
            this.klCanvas.reset({
                width: resizedDimensions.width,
                height: resizedDimensions.height,
                image: tempCanvas,
                layerName: filename,
            });

            trace?.stage('layer-ui-update');
            this.layersUi.update(0);
            trace?.stage('current-layer-selection');
            this.setCurrentLayer(0);
            trace?.stage('on-import-confirm');
            this.onImportConfirm();
            trace?.finish('success', { mode: 'image', ...resizedDimensions });
        };

        /**
         * convertedPsdObj has no layers if flattened
         */
        const importAsImagePsd = (convertedPsdObj: TKlPsd, cropObj?: TRect) => {
            trace?.stage('apply-uncommitted');
            this.applyUncommitted();
            trace?.stage('psd-crop-resize', {
                width: convertedPsdObj.width,
                height: convertedPsdObj.height,
                cropWidth: cropObj?.width,
                cropHeight: cropObj?.height,
                layerCount: convertedPsdObj.layers?.length ?? 0,
            });
            // crop
            const crop = (
                targetCanvas: HTMLCanvasElement,
                cropCanvas: HTMLCanvasElement,
                cropObj: TRect,
            ): void => {
                const cropCtx = BB.ctx(cropCanvas);
                cropCtx.clearRect(0, 0, cropCanvas.width, cropCanvas.height);
                cropCtx.drawImage(targetCanvas, -cropObj.x, -cropObj.y);
                changeCanvasDimensions(targetCanvas, cropObj.width, cropObj.height, {
                    ensureCleared: true,
                });
                BB.ctx(targetCanvas).drawImage(cropCanvas, 0, 0);
            };
            if (
                cropObj &&
                (cropObj.width !== convertedPsdObj.width ||
                    cropObj.height !== convertedPsdObj.height)
            ) {
                const cropCanvas = BB.canvas(cropObj.width, cropObj.height);
                convertedPsdObj.width = cropObj.width;
                convertedPsdObj.height = cropObj.height;

                if (!convertedPsdObj.layers) {
                    crop(convertedPsdObj.canvas, cropCanvas, cropObj);
                }
                if (convertedPsdObj.layers) {
                    for (let i = 0; i < convertedPsdObj.layers.length; i++) {
                        const item = convertedPsdObj.layers[i];
                        if (!item.groupId) {
                            crop(item.image, cropCanvas, cropObj);
                        }
                        if (item.mask) {
                            crop(item.mask.image, cropCanvas, cropObj);
                        }
                    }
                }
            }

            // resize
            const resizedDimensions = getResizedDimensions(
                convertedPsdObj.width,
                convertedPsdObj.height,
            );
            convertedPsdObj.width = resizedDimensions.width;
            convertedPsdObj.height = resizedDimensions.height;
            if (!convertedPsdObj.layers) {
                BB.resizeCanvas(
                    convertedPsdObj.canvas,
                    convertedPsdObj.width,
                    convertedPsdObj.height,
                );
            }
            if (convertedPsdObj.layers) {
                for (let i = 0; i < convertedPsdObj.layers.length; i++) {
                    const item = convertedPsdObj.layers[i];
                    if (!item.groupId) {
                        BB.resizeCanvas(item.image, convertedPsdObj.width, convertedPsdObj.height);
                    }
                    if (item.mask) {
                        BB.resizeCanvas(
                            item.mask.image,
                            convertedPsdObj.width,
                            convertedPsdObj.height,
                        );
                    }
                }
            }

            let layerIndex;
            trace?.stage('canvas-reset', {
                width: convertedPsdObj.width,
                height: convertedPsdObj.height,
                layerCount: convertedPsdObj.layers?.length ?? 0,
            });
            if (convertedPsdObj.layers) {
                const groupIdMap = new Map<string, string>();
                for (const layer of convertedPsdObj.layers) {
                    if (layer.groupId) {
                        groupIdMap.set(layer.groupId, randomUuid());
                    }
                }
                layerIndex = this.klCanvas.reset({
                    width: convertedPsdObj.width,
                    height: convertedPsdObj.height,
                    background: convertedPsdObj.background ?? 'transparent',
                    layers: convertedPsdObj.layers.map((layer) => {
                        return {
                            id: getNextLayerId(),
                            name: layer.name,
                            isVisible: layer.isVisible,
                            opacity: layer.opacity,
                            mixModeStr: layer.mixModeStr,
                            hasClipping: layer.hasClipping,
                            groupId: layer.groupId ? groupIdMap.get(layer.groupId) : undefined,
                            parentGroupId: layer.parentGroupId
                                ? (groupIdMap.get(layer.parentGroupId) ?? null)
                                : null,
                            isExpanded: layer.isExpanded,
                            isPassThrough: layer.isPassThrough,
                            image: layer.image,
                            mask: layer.mask,
                        };
                    }),
                });
            } else {
                layerIndex = this.klCanvas.reset({
                    width: convertedPsdObj.width,
                    height: convertedPsdObj.height,
                    image: convertedPsdObj.canvas,
                });
            }
            trace?.stage('layer-ui-update', { layerIndex });
            this.layersUi.update(layerIndex);
            trace?.stage('current-layer-selection', { layerIndex });
            this.setCurrentLayer(layerIndex);
            trace?.stage('on-import-confirm');
            this.onImportConfirm();
            trace?.finish('success', {
                mode: convertedPsdObj.layers ? 'psd-layers' : 'psd-flattened',
                width: convertedPsdObj.width,
                height: convertedPsdObj.height,
                layerCount: convertedPsdObj.layers?.length ?? 0,
            });
        };

        const importAsLayer = (canvas: HTMLCanvasElement | HTMLImageElement) => {
            trace?.stage('apply-uncommitted');
            this.applyUncommitted();
            trace?.stage('layer-dialog-waiting', { width: canvas.width, height: canvas.height });
            KL.showImportAsLayerDialog({
                target: this.klRootEl,
                klCanvas: this.klCanvas,
                importImage: canvas,
                callback: (transformObj, isPixelated?: boolean) => {
                    try {
                        if (!transformObj) {
                            trace?.finish('cancelled', { reason: 'layer-dialog-cancelled' });
                            return;
                        }
                        trace?.stage('layer-add-or-draw');
                        const operation = (ctx: CanvasRenderingContext2D) => {
                            BB.drawTransformedImageWithBounds(
                                ctx,
                                canvas,
                                transformObj,
                                undefined,
                                isPixelated,
                            );
                        };
                        if (
                            !this.klCanvas.addLayer(undefined, {
                                name: filename,
                                mixModeStr: 'source-over',
                                isVisible: true,
                                opacity: 1,
                                image: operation,
                            })
                        ) {
                            trace?.event('layer-limit-draw-fallback');
                            this.klCanvas.drawOperation(
                                this.klCanvas.getLayers().length - 1,
                                operation,
                            );
                        }
                        const layers = this.klCanvas.getLayers();
                        const activeLayerIndex = layers.length - 1;
                        trace?.stage('current-layer-selection', { layerIndex: activeLayerIndex });
                        this.setCurrentLayer(activeLayerIndex);
                        trace?.stage('layer-ui-update', { layerIndex: activeLayerIndex });
                        this.layersUi.update(activeLayerIndex);
                        trace?.finish('success', { mode: 'layer', layerCount: layers.length });
                    } catch (error) {
                        this.reportImportFailure(error, trace, importedImage.type === 'psd');
                    }
                },
            });
        };

        if (optionStr === 'default' || !optionStr) {
            trace?.stage('import-dialog-waiting', { sourceType: importedImage.type });
            KL.showImportImageDialog({
                image: importedImage,
                target: this.klRootEl,
                maxSize: this.klMaxCanvasSize,
                callback: (res) => {
                    try {
                        trace?.event('import-dialog-selection', { choice: res.type });
                        if (res.type === 'as-image') {
                            importAsImage(res.image);
                        } else if (res.type === 'as-image-psd') {
                            importAsImagePsd(res.image, res.cropObj);
                        } else if (res.type === 'as-layer') {
                            importAsLayer(res.image);
                        } else if (res.type === 'cancel') {
                            trace?.finish('cancelled', { reason: 'import-dialog-cancelled' });
                        }
                    } catch (error) {
                        this.reportImportFailure(error, trace, importedImage.type === 'psd');
                    }
                },
            });
        }

        if (optionStr === 'layer') {
            importAsLayer(importedImage.canvas);
        }
        if (optionStr === 'image') {
            if (importedImage.type === 'psd') {
                importAsImagePsd(importedImage);
            } else {
                importAsImage(importedImage.canvas);
            }
        }
    }

    // ----------------------------------- public -----------------------------------
    constructor(
        input: {
            klRootEl: HTMLElement;
            maxCanvasSize: number;
            layersUi: LayersUi;
            setCurrentLayer: (index: number) => void;
            klCanvas: KlCanvas;
            onImportConfirm: () => void;
            applyUncommitted: () => void;
        },
        callback: {
            onColor: (rgb: TRgb) => void;
        },
    ) {
        this.klRootEl = input.klRootEl;
        this.klMaxCanvasSize = input.maxCanvasSize;
        this.layersUi = input.layersUi;
        this.setCurrentLayer = input.setCurrentLayer;
        this.klCanvas = input.klCanvas;
        this.onImportConfirm = input.onImportConfirm;
        this.applyUncommitted = input.applyUncommitted;

        this.onColor = callback.onColor;
    }

    // ---- interface ----

    async readClipboard(): Promise<void> {
        try {
            // May freeze the app until it read the clipboard
            // But if you show a loading indicator on this line, it will show up too early.
            const clipboardItems = await navigator.clipboard.read();
            // On this line it's already done freezing.

            let hasImage = false;
            for (const item of clipboardItems) {
                for (const type of item.types) {
                    if (type.startsWith('image')) {
                        hasImage = true;
                        const blob = await item.getType(type);
                        const img = await loadImageFromBlob(blob);
                        this.importFinishedLoading(
                            {
                                type: 'image',
                                width: img.width,
                                height: img.height,
                                canvas: img,
                            },
                            undefined,
                            'default',
                        );
                        return;
                    }
                }
            }
            if (!hasImage) {
                showError(LANG('clipboard-no-image'));
            }
        } catch (error) {
            showError(LANG('clipboard-read-fail'));
        }
    }

    onPaste(e: ClipboardEvent): void {
        if (KL.DIALOG_COUNTER.get() > 0 || BB.isInputFocused(true)) {
            return;
        }

        const retrieveImageFromClipboardAsBlob = (
            items: DataTransferItemList,
            callback: (file: File) => void,
        ) => {
            if (!items) {
                return;
            }
            for (let i = 0; i < items.length; i++) {
                if (!items[i].type.includes('image')) {
                    continue;
                }
                const file = items[i].getAsFile();
                file && callback(file);
            }
        };

        e.stopPropagation();
        e.preventDefault();

        if (!e.clipboardData) {
            return;
        }

        if (e.clipboardData.files[0]) {
            retrieveImageFromClipboardAsBlob(e.clipboardData.items, (imageBlob) => {
                void loadImageFromBlob(imageBlob)
                    .then((img) => {
                        this.importFinishedLoading(
                            {
                                type: 'image',
                                width: img.width,
                                height: img.height,
                                canvas: img,
                            },
                            undefined,
                            'default',
                        );
                    })
                    .catch(() => showError(LANG('clipboard-read-fail')));
            });
        } else if (e.clipboardData.items[0]) {
            e.clipboardData.items[0].getAsString((pasteStr) => {
                pasteStr = pasteStr.trim();
                if (pasteStr.match(/^https?/)) {
                    // url
                    void loadImage(pasteStr, { crossOrigin: 'anonymous' })
                        .then((img) => {
                            this.importFinishedLoading(
                                {
                                    type: 'image',
                                    width: img.width,
                                    height: img.height,
                                    canvas: img,
                                },
                                undefined,
                                'default',
                            );
                        })
                        .catch((error) => console.log('error loading', error));
                } else if (pasteStr.match(/^#?([a-fA-F0-9]{6}|[a-fA-F0-9]{3})$/)) {
                    // url
                    const rgbObj = BB.ColorConverter.hexToRGB(pasteStr.replace('#', ''));
                    rgbObj && this.onColor(rgbObj);
                }
            });
        }
    }

    async handleFileSelect(files: FileList, optionStr: TDropOption): Promise<void> {
        const showWarningPsdFlattened = () => {
            showModal({
                type: 'warning',
                message: LANG('import-psd-unsupported') + '<br /><br />',
                buttons: ['Ok'],
            });
        };

        // files need to be copied, because the input is reset
        const fileArr = [...files];
        if (fileArr.length > 1) {
            const shouldImport = await new Promise<boolean>((resolve) => {
                showModal({
                    type: 'warning',
                    message: LANG('import-many-files-warning', {
                        x: '' + fileArr.length,
                    }),
                    buttons: [
                        {
                            id: 'import',
                            label: LANG('import-many-files-confirm', {
                                x: '' + fileArr.length,
                            }),
                        },
                        'Cancel',
                    ],
                    callback: (result) => {
                        resolve(result === 'import');
                    },
                });
            });
            if (!shouldImport) {
                return;
            }
        }

        let hasUnsupportedFile = false;

        for (let i = 0; i < fileArr.length; i++) {
            const file = fileArr[i];
            const trace = new ImportTrace(file.size, optionStr);
            trace.stage('filetype-detection');
            let fileType: Awaited<ReturnType<typeof detectFiletype>>;
            try {
                fileType = await detectFiletype(file);
            } catch (error) {
                this.reportImportFailure(error, trace);
                return;
            }
            trace.event('filetype-detected', { type: fileType ?? 'unsupported' });
            if (fileType === 'image') {
                trace.stage('image-decode');
                void loadImageFromBlob(file)
                    .then((image) => {
                        trace.event('image-decoded', {
                            width: image.width,
                            height: image.height,
                        });
                        this.importFinishedLoading(
                            {
                                type: 'image',
                                width: image.width,
                                height: image.height,
                                canvas: image,
                            },
                            file.name,
                            optionStr,
                            trace,
                        );
                    })
                    .catch((error) => this.reportImportFailure(error, trace));
            } else if (fileType === 'psd') {
                const loaderSizeBytes = 1024 * 1024 * 25; // 25mb
                const maxSizeBytes = 1024 * 1024 * 1024; // 1gb
                const maxResolution = this.klMaxCanvasSize;

                trace.stage('psd-size-check');
                if (file.size >= maxSizeBytes) {
                    // pretty likely to break stuff
                    trace.finish('rejected', { reason: 'file-too-large' });
                    showError('File too big. Unable to import.');
                    return;
                }

                const doShowLoader = fileArr.length === 1 && file.size >= loaderSizeBytes;
                let loaderIsOpen = true;
                let loaderWasDismissed = false;
                let closingLoader = false;
                let closeLoader: (() => void) | null = null;

                const dismissLoader = (): void => {
                    if (!closeLoader) {
                        return;
                    }
                    const close = closeLoader;
                    closingLoader = true;
                    try {
                        close();
                    } catch (error) {
                        trace.error(error);
                    } finally {
                        closingLoader = false;
                        closeLoader = null;
                    }
                };

                if (doShowLoader) {
                    try {
                        trace.event('loader-shown');
                        showModal({
                            message: LANG('import-opening'),
                            callback: () => {
                                loaderIsOpen = false;
                                closeLoader = null;
                                if (!closingLoader) {
                                    loaderWasDismissed = true;
                                    trace.finish('cancelled', { reason: 'loader-dismissed' });
                                }
                            },
                            closeFunc: (f) => {
                                closeLoader = f;
                            },
                        });
                    } catch (error) {
                        this.reportImportFailure(error, trace, true);
                        return;
                    }
                }

                try {
                    const reader = new FileReader();
                    reader.onload = (readerResult) => {
                        if (loaderWasDismissed) {
                            return;
                        }
                        void (async () => {
                            const target = throwIfNull(readerResult.target);
                            trace.stage('psd-library-load');
                            const agPsdLazy = await KL.loadAgPsd();
                            if (doShowLoader && !loaderIsOpen) {
                                return;
                            }

                            trace.stage('psd-metadata-parse');
                            const metadata = agPsdLazy.readPsd(target.result as any, {
                                skipLayerImageData: true,
                                skipThumbnail: true,
                                skipCompositeImageData: true,
                            });
                            const pendingLayers = [...(metadata.children ?? [])];
                            let layerCount = 0;
                            let groupCount = 0;
                            let paintLayerCount = 0;
                            let maskCount = 0;
                            let adjustmentCount = 0;
                            while (pendingLayers.length > 0) {
                                const layer = pendingLayers.pop()!;
                                layerCount++;
                                if (layer.children) {
                                    groupCount++;
                                    for (const child of layer.children) {
                                        pendingLayers.push(child);
                                    }
                                } else if (layer.adjustment) {
                                    adjustmentCount++;
                                } else {
                                    paintLayerCount++;
                                }
                                if (layer.mask) {
                                    maskCount++;
                                }
                            }
                            trace.event('psd-metadata', {
                                width: metadata.width,
                                height: metadata.height,
                                bitsPerChannel: metadata.bitsPerChannel,
                                colorMode: metadata.colorMode,
                                layerCount,
                                groupCount,
                                paintLayerCount,
                                maskCount,
                                adjustmentCount,
                            });
                            if (metadata.width > maxResolution || metadata.height > maxResolution) {
                                dismissLoader();
                                trace.finish('rejected', {
                                    reason: 'resolution-limit',
                                    width: metadata.width,
                                    height: metadata.height,
                                });
                                showError(
                                    LANG('import-psd-too-large').replace(
                                        /{x}/g,
                                        '' + maxResolution,
                                    ) +
                                        '<br /><br />' +
                                        LANG('import-psd-size') +
                                        ': ' +
                                        metadata.width +
                                        ' x ' +
                                        metadata.height +
                                        ' pixels',
                                );
                                return;
                            }

                            trace.stage('psd-full-parse');
                            const parsed = attempt(() => agPsdLazy.readPsd(target.result as any));
                            if (parsed instanceof AttemptError) {
                                trace.error(parsed.error);
                                trace.event('psd-full-parse-fallback', { reason: 'parse-error' });
                                trace.stage('psd-flattened-parse');
                                const flattened = agPsdLazy.readPsd(target.result as any, {
                                    skipLayerImageData: true,
                                    skipThumbnail: true,
                                });
                                trace.event('psd-flattened-result', {
                                    width: flattened.width,
                                    height: flattened.height,
                                });

                                if (optionStr === 'image') {
                                    showWarningPsdFlattened();
                                }

                                dismissLoader();
                                this.importFinishedLoading(
                                    {
                                        type: 'psd',
                                        width: flattened.width,
                                        height: flattened.height,
                                        canvas: throwIfUndefined(flattened.canvas),
                                        error: true,
                                    },
                                    file.name,
                                    optionStr,
                                    trace,
                                );
                                return;
                            }

                            trace.stage('psd-conversion');
                            const convertedPsd = KL.PSD.psdToKlPsd(parsed);
                            trace.event('psd-converted', {
                                width: convertedPsd.width,
                                height: convertedPsd.height,
                                layerCount: convertedPsd.layers?.length ?? 0,
                                flattened: !convertedPsd.layers,
                                warningCodes: convertedPsd.warningArr ?? [],
                            });
                            if (optionStr === 'image' && convertedPsd.error) {
                                showWarningPsdFlattened();
                            }

                            dismissLoader();
                            this.importFinishedLoading(convertedPsd, file.name, optionStr, trace);
                        })().catch((error) => {
                            if (loaderWasDismissed) {
                                return;
                            }
                            dismissLoader();
                            this.reportImportFailure(error, trace, true);
                        });
                    };
                    reader.onerror = () => {
                        if (loaderWasDismissed) {
                            return;
                        }
                        dismissLoader();
                        this.reportImportFailure(reader.error ?? new Error('File read failed'), trace, true);
                    };
                    reader.onabort = () => {
                        if (loaderWasDismissed) {
                            return;
                        }
                        dismissLoader();
                        trace.finish('cancelled', { reason: 'file-read-aborted' });
                    };
                    trace.stage('psd-file-read');
                    reader.readAsArrayBuffer(file);
                } catch (error) {
                    dismissLoader();
                    this.reportImportFailure(error, trace, true);
                }
            } else {
                hasUnsupportedFile = true;
                trace.finish('rejected', { reason: 'unsupported-filetype' });
            }
        }
        if (hasUnsupportedFile) {
            showError(LANG('import-unsupported-file'));
        }
    }
}
