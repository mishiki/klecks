import { BB } from '../../../bb/bb';
import { SelectCustom } from '../components/select-custom';
import { Options } from '../components/options';
import { showModal } from './base/show-modal';
import { LANG } from '../../../language/language';
import { TCanvasBackground } from '../../kl-types';
import { table } from '../components/table';
import { css } from '../../../bb/base/base';

export function newImageDialog(p: {
    maxCanvasSize: number;
    onConfirm: (width: number, height: number, background: TCanvasBackground) => void;
    onCancel: () => void;
}): void {
    const maxCanvasSize = Number.isFinite(p.maxCanvasSize)
        ? Math.max(1, Math.min(8192, Math.floor(p.maxCanvasSize)))
        : 8192;
    const onConfirm = p.onConfirm;
    const onCancel = p.onCancel;
    const screenWidth = window.screen.width * window.devicePixelRatio;
    const initialWidth = Math.max(
        1,
        Math.min(maxCanvasSize, Number.isFinite(screenWidth) ? Math.round(screenWidth) : 1),
    );

    const newImDiv = BB.el({ tagName: 'form' });
    let ratioSelect: SelectCustom<string> | undefined;
    let ratioOverflow = false;
    let lastFocusedDimension: 'width' | 'height' = 'width';
    let closeModal: (() => void) | undefined;
    let didConfirm = false;

    const ratioError = BB.el({
        css: {
            color: '#b44',
            fontSize: 12,
            lineHeight: '16px',
            marginTop: 4,
        },
    });
    const ratioValue = BB.el({
        textContent: '1:1',
        css: {
            color: '#888',
            minWidth: 50,
        },
    });

    const isValidDimension = (value: number): boolean =>
        Number.isSafeInteger(value) && value >= 1 && value <= maxCanvasSize;

    const widthInput = BB.el({
        tagName: 'input',
        css: { width: 70 },
        props: {
            type: 'number',
            min: '1',
            max: String(maxCanvasSize),
            step: '1',
            required: true,
            valueAsNumber: initialWidth,
            name: 'image-width',
        },
    });
    widthInput.setAttribute('data-ignore-focus', 'true');
    const heightInput = BB.el({
        tagName: 'input',
        css: { width: 70 },
        props: {
            type: 'number',
            min: '1',
            max: String(maxCanvasSize),
            step: '1',
            required: true,
            valueAsNumber: initialWidth,
            name: 'image-height',
        },
    });

    heightInput.setAttribute('data-ignore-focus', 'true');

    const readDimension = (input: HTMLInputElement): number | undefined => {
        const value = input.valueAsNumber;
        return input.validity.valid && isValidDimension(value) ? value : undefined;
    };
    const readDimensions = (): { width: number; height: number } | undefined => {
        const width = readDimension(widthInput);
        const height = readDimension(heightInput);
        return width === undefined || height === undefined ? undefined : { width, height };
    };

    const unitStyle = {
        color: '#888',
        fontSize: 12,
        marginLeft: 5,
    };
    const widthUnit = BB.el({
        textContent: LANG('new-px'),
        css: unitStyle,
    });
    const heightUnit = BB.el({
        textContent: LANG('new-px'),
        css: unitStyle,
    });
    const sizeTable = table([
        [LANG('width') + ':&nbsp;', widthInput, widthUnit],
        [BB.el({ css: { height: 5 } }), '', ''],
        [LANG('height') + ':&nbsp;', heightInput, heightUnit],
    ]);
    css(sizeTable, {
        marginBottom: 10,
    });

    const ratioPresets = [
        { id: '16:9', label: '16:9', ratio: 16 / 9 },
        { id: '3:2', label: '3:2', ratio: 3 / 2 },
        { id: 'sqrt2:1', label: '√2:1', ratio: Math.SQRT2 },
        { id: '5:4', label: '5:4', ratio: 5 / 4 },
        { id: '1:1', label: '1:1', ratio: 1 },
        { id: '4:5', label: '4:5', ratio: 4 / 5 },
        { id: '1:sqrt2', label: '1:√2', ratio: 1 / Math.SQRT2 },
        { id: '2:3', label: '2:3', ratio: 2 / 3 },
        { id: '9:16', label: '9:16', ratio: 9 / 16 },
    ] as const;

    function updateDimensionDisplay(): void {
        const dimensions = readDimensions();
        if (!dimensions) {
            ratioValue.textContent = '—';
            return;
        }

        let left = dimensions.width;
        let right = dimensions.height;
        while (right !== 0) {
            const remainder = left % right;
            left = right;
            right = remainder;
        }
        const divisor = left || 1;
        ratioValue.textContent =
            dimensions.width / divisor + ':' + dimensions.height / divisor;

        const scale = Math.min(260 / dimensions.width, 100 / dimensions.height);
        preview.style.width = dimensions.width * scale + 'px';
        preview.style.height = dimensions.height * scale + 'px';
        previewWrapper.style.backgroundSize = Math.round(Math.max(4, 60 * scale)) + 'px';
    }

    function updateAfterManualDimensionChange(): void {
        ratioOverflow = false;
        ratioError.textContent = '';
        ratioSelect?.setValue(undefined);
        if (!readDimensions()) {
            ratioError.textContent = LANG('new-size-invalid', {
                max: String(maxCanvasSize),
            });
        }
        updateDimensionDisplay();
    }

    const templateWrapper = BB.el({
        css: {
            display: 'flex',
            flexWrap: 'wrap',
            alignItems: 'center',
            gap: 5,
            marginBottom: 10,
        },
    });
    const ratioControl = BB.el({
        css: {
            display: 'flex',
            alignItems: 'center',
            gap: 5,
        },
    });
    const ratioLabelId = 'new-image-ratio-label';
    const ratioLabel = BB.el({
        tagName: 'label',
        textContent: LANG('new-ratio') + ':',
        props: { htmlFor: 'new-image-ratio' },
    });
    ratioSelect = new SelectCustom<string>({
        isFocusable: true,
        optionArr: ratioPresets.map((item): [string, string] => [item.id, item.label]),
        initValue: '1:1',
        onChange: (value) => {
            const preset = ratioPresets.find((item) => item.id === value);
            if (!preset) {
                return;
            }
            const width = readDimension(widthInput);
            const height = readDimension(heightInput);
            if (width === undefined && height === undefined) {
                ratioOverflow = false;
                ratioError.textContent = LANG('new-size-invalid', {
                    max: String(maxCanvasSize),
                });
                ratioSelect?.setValue(undefined);
                updateDimensionDisplay();
                return;
            }

            const anchor = width === undefined ? 'height' :
                height === undefined ? 'width' : lastFocusedDimension;
            const computed = anchor === 'width'
                ? Math.round(width! / preset.ratio)
                : Math.round(height! * preset.ratio);
            if (!isValidDimension(computed)) {
                ratioOverflow = true;
                ratioError.textContent = LANG('new-ratio-size-invalid', {
                    max: String(maxCanvasSize),
                });
                ratioSelect?.setValue(undefined);
                return;
            }

            ratioOverflow = false;
            ratioError.textContent = '';
            lastFocusedDimension = anchor;
            (anchor === 'width' ? heightInput : widthInput).valueAsNumber = computed;
            updateDimensionDisplay();
        },
        name: 'image-ratio',
        title: LANG('new-ratio'),
    });
    const ratioSelectElement = ratioSelect.getElement();
    ratioSelectElement.id = 'new-image-ratio';
    ratioSelectElement.setAttribute('aria-labelledby', ratioLabelId);
    ratioLabel.id = ratioLabelId;
    css(ratioSelectElement, {
        width: 95,
        flexGrow: 1,
    });
    ratioControl.append(ratioLabel, ratioSelectElement, ratioValue);
    templateWrapper.append(ratioControl);

    widthInput.addEventListener('focus', () => { lastFocusedDimension = 'width'; });
    heightInput.addEventListener('focus', () => { lastFocusedDimension = 'height'; });
    widthInput.addEventListener('input', updateAfterManualDimensionChange);
    heightInput.addEventListener('input', updateAfterManualDimensionChange);
    widthInput.addEventListener('invalid', () => {
        ratioError.textContent = LANG('new-size-invalid', {
            max: String(maxCanvasSize),
        });
    });
    heightInput.addEventListener('invalid', () => {
        ratioError.textContent = LANG('new-size-invalid', {
            max: String(maxCanvasSize),
        });
    });

    let background: TCanvasBackground = 'white';

    const previewWrapper = BB.el({
        className: 'kl-transparent-preview',
        css: {
            boxSizing: 'border-box',
            width: 340,
            height: 140,
            display: 'table',
            padding: 10,
            marginTop: 10,
            marginLeft: -20,
            background: 'var(--kl-checkerboard-background)',
        },
    });
    const preview = BB.el({
        className: 'kl-transparent-preview__canvas',
        css: {
            width: 200,
            height: 100,
            backgroundColor: 'white',
            marginLeft: 'auto',
            marginRight: 'auto',
            color: '#aaa',
            fontSize: 16,
            fontWeight: 'bold',
            textAlign: 'center',
            verticalAlign: 'center',
            display: 'table',
            overflow: 'hidden',
        },
    });
    const backgroundOptions = new Options<TCanvasBackground>({
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
        initId: background,
        ariaLabel: LANG('canvas-background'),
        isFocusable: true,
        onChange: (value) => {
            background = value;
            preview.style.backgroundColor = value === 'white' ? 'white' : 'transparent';
        },
    });

    BB.el({
        parent: previewWrapper,
        content: preview,
        css: {
            display: 'table-cell',
            verticalAlign: 'middle',
        },
    });
    BB.el({
        parent: preview,
        css: {
            display: 'table-cell',
            verticalAlign: 'middle',
        },
    });

    updateDimensionDisplay();
    newImDiv.append(templateWrapper);
    const secondRow = BB.el({
        parent: newImDiv,
        css: {
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'flex-end',
        },
    });
    const secondRowLeft = BB.el({
        parent: secondRow,
    });
    secondRowLeft.append(sizeTable, ratioError);
    const backgroundControl = BB.el({
        css: {
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'flex-start',
            gap: 4,
        },
    });
    BB.el({
        parent: backgroundControl,
        textContent: LANG('canvas-background'),
        css: { fontSize: 13 },
    });
    backgroundControl.append(backgroundOptions.getElement());
    secondRow.append(backgroundControl);
    newImDiv.append(previewWrapper);

    const actionRow = BB.el({
        css: {
            display: 'flex',
            justifyContent: 'flex-end',
            gap: 8,
            marginTop: 12,
        },
    });
    const cancelButton = BB.el({
        tagName: 'button',
        className: 'kl-button',
        textContent: LANG('modal-cancel'),
        props: { type: 'button' },
        onClick: () => closeModal?.(),
    });
    const createButton = BB.el({
        tagName: 'button',
        className: ['kl-button', 'kl-button-primary'],
        textContent: LANG('modal-ok'),
        props: { type: 'submit' },
    });
    actionRow.append(cancelButton, createButton);
    newImDiv.append(actionRow);

    newImDiv.addEventListener('submit', (event) => {
        event.preventDefault();
        if (ratioOverflow) {
            return;
        }
        const dimensions = readDimensions();
        if (!dimensions) {
            ratioError.textContent = LANG('new-size-invalid', {
                max: String(maxCanvasSize),
            });
            widthInput.reportValidity();
            heightInput.reportValidity();
            return;
        }

        didConfirm = true;
        closeModal?.();
        onConfirm(dimensions.width, dimensions.height, background);
    });

    showModal({
        message: `<b>${LANG('new-title')}</b>`,
        div: newImDiv,
        buttons: [],
        autoFocus: false,
        callback: function () {
            ratioSelect?.destroy();
            backgroundOptions.destroy();
            if (!didConfirm) {
                onCancel();
            }
        },
        closeFunc: (close) => {
            closeModal = close;
        },
    });
}
