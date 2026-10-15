import { BB } from '../../../bb/bb';
import { SelectCustom } from '../components/select-custom';
import { Options } from '../components/options';
import { showModal } from './base/show-modal';
import { LANG } from '../../../language/language';
import { TCanvasBackground } from '../../kl-types';
import { TSize2D } from '../../../bb/bb-types';
import { table } from '../components/table';
import { css } from '../../../bb/base/base';
import { Input } from '../components/input';
import { Destroyer } from '../../../bb/base/base';

export function newImageDialog(p: {
    maxCanvasSize: number;
    canvasWidth: number; // current canvas size
    canvasHeight: number; // current canvas size
    workspaceWidth: number;
    workspaceHeight: number;
    onConfirm: (width: number, height: number, background: TCanvasBackground) => void;
    onCancel: () => void;
}): void {
    const maxCanvasSize = p.maxCanvasSize;
    const canvasWidth = p.canvasWidth;
    const canvasHeight = p.canvasHeight;
    const workspaceWidth = p.workspaceWidth;
    const workspaceHeight = p.workspaceHeight;
    const onConfirm = p.onConfirm;
    const onCancel = p.onCancel;

    function createRatioSize(
        ratioX: number,
        ratioY: number,
        width: number,
        height: number,
        padding: number,
    ): TSize2D {
        return BB.fitInto(
            ratioX,
            ratioY,
            Math.min(maxCanvasSize, width - padding),
            Math.min(maxCanvasSize, height - padding),
            1,
        );
    }

    const newImDiv = BB.el();
    const widthInput = new Input({
        type: 'number',
        init: canvasWidth,
        min: 1,
        max: maxCanvasSize,
        step: 1,
        name: 'image-width',
        isFocusIgnored: true,
        css: { width: 70 },
        onChange: () => updateRatio(),
    });
    const unitStyle = {
        color: '#888',
        fontSize: 12,
        marginLeft: 5,
    };
    const widthUnit = BB.el({
        textContent: LANG('new-px'),
        css: unitStyle,
    });
    const heightInput = new Input({
        type: 'number',
        init: canvasHeight,
        min: 1,
        max: maxCanvasSize,
        step: 1,
        name: 'image-height',
        isFocusIgnored: true,
        css: { width: 70 },
        onChange: () => updateRatio(),
    });
    const heightUnit = BB.el({
        textContent: LANG('new-px'),
        css: unitStyle,
    });

    const sizeTable = table([
        [LANG('width') + ':&nbsp;', widthInput.getElement(), widthUnit],
        [BB.el({ css: { height: 5 } }), '', ''],
        [LANG('height') + ':&nbsp;', heightInput.getElement(), heightUnit],
    ]);
    css(sizeTable, {
        marginBottom: 10,
    });

    const ratioWrapper = BB.el({
        css: {
            marginTop: 5,
            color: '#888',
        },
    });

    const templateWrapper = BB.el({
        css: {
            display: 'flex',
            flexWrap: 'wrap',
            gap: 5,
            marginBottom: 10,
        },
    });
    const presetBtnConfig = {
        tagName: 'button',
        className: 'kl-button',
        css: { flexGrow: '1' },
    } as const;
    const destroyer = new Destroyer();
    const presetFitBtn = BB.el({
        ...presetBtnConfig,
        textContent: LANG('new-fit'),
        destroyer,
        onClick: () => {
            widthInput.setValue(workspaceWidth, true);
            heightInput.setValue(workspaceHeight, true);
            updateRatio();
        },
    });
    const presetCurrentBtn = BB.el({
        ...presetBtnConfig,
        textContent: LANG('new-current'),
        destroyer,
        onClick: () => {
            widthInput.setValue(canvasWidth, true);
            heightInput.setValue(canvasHeight, true);
            updateRatio();
        },
    });
    const presetSquareBtn = BB.el({
        ...presetBtnConfig,
        textContent: LANG('new-square'),
        destroyer,
        onClick: () => {
            const { width, height } = createRatioSize(
                1,
                1,
                workspaceWidth,
                workspaceHeight,
                templatePadding,
            );
            widthInput.setValue(width, true);
            heightInput.setValue(height, true);
            updateRatio();
        },
    });
    const presetLandscapeBtn = BB.el({
        ...presetBtnConfig,
        textContent: LANG('new-landscape'),
        destroyer,
        onClick: () => {
            const { width, height } = createRatioSize(
                4,
                3,
                workspaceWidth,
                workspaceHeight,
                templatePadding,
            );
            widthInput.setValue(width, true);
            heightInput.setValue(height, true);
            updateRatio();
        },
    });
    const presetPortraitBtn = BB.el({
        ...presetBtnConfig,
        textContent: LANG('new-portrait'),
        destroyer,
        onClick: () => {
            const { width, height } = createRatioSize(
                3,
                4,
                workspaceWidth,
                workspaceHeight,
                templatePadding,
            );
            widthInput.setValue(width, true);
            heightInput.setValue(height, true);
            updateRatio();
        },
    });
    const presetOversizeBtn = BB.el({
        ...presetBtnConfig,
        textContent: LANG('new-oversize'),
        destroyer,
        onClick: () => {
            widthInput.setValue(workspaceWidth + 500, true);
            heightInput.setValue(workspaceHeight + 500, true);
            updateRatio();
        },
    });

    templateWrapper.append(
        presetCurrentBtn,
        presetFitBtn,
        presetOversizeBtn,
        presetSquareBtn,
        presetLandscapeBtn,
        presetPortraitBtn,
    );

    const templatePadding = 0;

    const select = new SelectCustom({
        isFocusable: true,
        optionArr: [
            ['screen', LANG('new-screen')],
            ['16 9', LANG('new-video') + ' 16:9'],
            ['3 2', '3:2'],
            ['5 3', '5:3'],
            ['2 1', '2:1'],
            ['paper', LANG('new-din-paper') + ' √2:1'],
            ['9 16', '9:16'],
            ['2 3', '2:3'],
            ['3 5', '3:5'],
            ['1 2', '1:2'],
            ['1 1.4142135623730951', '1:√2'],
        ],
        onChange: function (val): void {
            if (val === 'screen') {
                widthInput.setValue(window.screen.width, true);
                heightInput.setValue(window.screen.height, true);
            } else if (val === 'paper') {
                const { width, height } = createRatioSize(
                    Math.sqrt(2),
                    1,
                    workspaceWidth,
                    workspaceHeight,
                    templatePadding,
                );
                widthInput.setValue(width, true);
                heightInput.setValue(height, true);
            } else {
                const split = val.split(' ');
                const { width, height } = createRatioSize(
                    parseFloat(split[0]),
                    parseFloat(split[1]),
                    workspaceWidth,
                    workspaceHeight,
                    templatePadding,
                );
                widthInput.setValue(width, true);
                heightInput.setValue(height, true);
            }
            updateRatio();
            select.setValue(undefined);
        },
        name: 'image-format',
    });
    setTimeout(() => {
        // safari: not empty without also setting it to null via timeout
        select.setValue(undefined);
    }, 0);
    css(select.getElement(), {
        width: 80,
        flexGrow: 1,
    });
    templateWrapper.append(select.getElement());

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

    function updateRatio(): void {
        function hcf(u: number, v: number): number {
            let U = u,
                V = v;

            while (true) {
                if (!(U %= V)) {
                    return V;
                }
                if (!(V %= U)) {
                    return U;
                }
            }
        }

        let w = widthInput.getValue();
        let h = heightInput.getValue();

        //generated canvas size doesn't always match ratio. so check if a common ratio is very close
        const commonRatios = [
            [1, 2],
            [2, 1],
            [2, 3],
            [3, 2],
            [3, 4],
            [4, 3],
            [4, 5],
            [5, 4],
            [16, 9],
            [9, 16],
            [3, 2],
            [2, 3],
            [5, 3],
            [3, 5],
            [2, 1],
            [1, 2],
            [1.414, 1],
            [1, 1.414],
        ];
        const reducedArr = BB.reduce(w, h);
        let closestRatio = commonRatios[0];
        let closestDistance = Math.abs(
            commonRatios[0][0] / commonRatios[0][1] - reducedArr[0] / reducedArr[1],
        );
        for (let i = 0; i < commonRatios.length; i++) {
            if (
                Math.abs(commonRatios[i][0] / commonRatios[i][1] - reducedArr[0] / reducedArr[1]) <
                closestDistance
            ) {
                closestRatio = commonRatios[i];
                closestDistance = Math.abs(
                    commonRatios[i][0] / commonRatios[i][1] - reducedArr[0] / reducedArr[1],
                );
            }
        }
        //display ratio
        if (closestDistance > 0 && closestDistance < 0.005) {
            ratioWrapper.innerText =
                LANG('new-ratio') + ': ~' + closestRatio[0] + ':' + closestRatio[1];
        } else {
            ratioWrapper.innerText = LANG('new-ratio') + ': ' + reducedArr[0] + ':' + reducedArr[1];
        }

        const realw = w;
        const T = hcf(w, h);
        w /= T;
        h /= T;
        w *= 260;
        h *= 260;
        if (w > 260) {
            h = (260 / w) * h;
            w = 260;
        }
        if (h > 100) {
            w = (100 / h) * w;
            h = 100;
        }

        preview.style.width = w + 'px';
        preview.style.height = h + 'px';
        previewWrapper.style.backgroundSize = Math.round(Math.max(4, 60 * (w / realw))) + 'px';
    }

    updateRatio();

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
    secondRowLeft.append(sizeTable, ratioWrapper);
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

    showModal({
        message: `<b>${LANG('new-title')}</b>`,
        div: newImDiv,
        buttons: ['Ok', 'Cancel'],
        callback: function (result) {
            destroyer.destroy();
            select.destroy();
            backgroundOptions.destroy();
            widthInput.destroy();
            heightInput.destroy();

            if (result === 'Cancel') {
                onCancel();
                return;
            }
            onConfirm(widthInput.getValue(), heightInput.getValue(), background);
        },
        clickOnEnter: 'Ok',
    });
}
