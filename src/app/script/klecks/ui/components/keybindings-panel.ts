import { BB } from '../../../bb/bb';
import { KEY_BINDINGS } from '../../../bb/input/keybindings';
import { LANG } from '../../../language/language';

const MAX_KEYBINDINGS_FILE_SIZE = 256 * 1024;

function errorMessage(error: unknown): string {
    if (error instanceof Error && error.message) {
        return error.message;
    }
    return String(error);
}

function downloadText(text: string): void {
    const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.download = 'klecks-keybindings.json5';
    link.rel = 'noopener';
    link.href = url;
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 40_000);
}

/**
 * Small file-based keybinding UI.  The editor intentionally lives in a text
 * editor: this keeps the complete configuration visible and lets a user keep
 * one file for Windows and Android without another in-app editor to maintain.
 */
export function createKeybindingsPanel(): HTMLElement {
    const root = BB.el({ css: { marginTop: 15 } });
    BB.el({
        parent: root,
        textContent: LANG('settings-keybindings-title'),
        css: { fontWeight: 'bold' },
    });
    BB.el({
        parent: root,
        textContent: LANG('settings-keybindings-description'),
        css: { fontSize: 12, margin: '5px 0' },
    });

    const status = BB.el({
        parent: root,
        css: { fontSize: 12, marginBottom: 5, minHeight: 16 },
    });
    const buttons = BB.el({
        parent: root,
        css: { display: 'flex', flexWrap: 'wrap', gap: 5 },
    });
    const fileInput = BB.el({
        tagName: 'input',
        props: {
            type: 'file',
            accept: '.json5,.json,text/plain',
        },
        css: { display: 'none' },
    }) as HTMLInputElement;
    root.append(fileInput);

    const setStatus = (message: string, isError = false): void => {
        status.textContent = message;
        status.style.color = isError ? '#d44' : '';
    };

    BB.el({
        parent: buttons,
        tagName: 'button',
        className: 'kl-button',
        textContent: LANG('settings-keybindings-import'),
        onClick: () => fileInput.click(),
    });
    BB.el({
        parent: buttons,
        tagName: 'button',
        className: 'kl-button',
        textContent: LANG('settings-keybindings-export'),
        onClick: () => {
            downloadText(KEY_BINDINGS.exportText());
            setStatus(LANG('settings-keybindings-exported'));
        },
    });
    BB.el({
        parent: buttons,
        tagName: 'button',
        className: 'kl-button',
        textContent: LANG('settings-keybindings-reset'),
        onClick: () => {
            try {
                KEY_BINDINGS.reset();
                setStatus(LANG('settings-keybindings-reset-done'));
            } catch (error) {
                setStatus('❌ ' + errorMessage(error), true);
            }
        },
    });

    fileInput.addEventListener('change', () => {
        const file = fileInput.files?.[0];
        // Allow selecting the same file again after correcting it.
        fileInput.value = '';
        if (!file) {
            return;
        }
        if (file.size > MAX_KEYBINDINGS_FILE_SIZE) {
            setStatus(LANG('settings-keybindings-too-large'), true);
            return;
        }
        file.text()
            .then((text) => {
                try {
                    KEY_BINDINGS.importText(text);
                    setStatus(LANG('settings-keybindings-imported'));
                } catch (error) {
                    setStatus('❌ ' + errorMessage(error), true);
                }
            })
            .catch((error) => setStatus('❌ ' + errorMessage(error), true));
    });

    return root;
}
