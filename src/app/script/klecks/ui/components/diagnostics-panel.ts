import { BB } from '../../../bb/bb';
import { DIAGNOSTICS } from '../../../bb/diagnostics/diagnostics';
import { LANG } from '../../../language/language';

export function createDiagnosticsPanel(): HTMLElement {
    let hasReport = false;
    const root = BB.el({ css: { marginTop: 15 } });
    BB.el({ parent: root, textContent: LANG('diagnostics-title'), css: { fontWeight: 'bold' } });
    BB.el({ parent: root, textContent: LANG('diagnostics-description'), css: { fontSize: 12, margin: '5px 0' } });
    const status = BB.el({ parent: root, textContent: LANG('diagnostics-idle'), css: { fontSize: 12, marginBottom: 5 } });
    const buttons = BB.el({ parent: root, css: { display: 'flex', flexWrap: 'wrap', gap: 5 } });
    const start = BB.el({
        parent: buttons, tagName: 'button', className: 'kl-button',
        textContent: LANG('diagnostics-start'),
        onClick: () => {
            hasReport = true;
            DIAGNOSTICS.start();
        },
    });
    const save = (): void => {
        if (DIAGNOSTICS.isRecording()) {
            DIAGNOSTICS.stop('user');
        }
        DIAGNOSTICS.download();
    };
    const download = BB.el({
        parent: buttons, tagName: 'button', className: 'kl-button',
        textContent: LANG('diagnostics-save'), onClick: save,
    });
    // Remains accessible after switching from Settings back to the brush tab.
    const badge = BB.el({
        parent: document.body, tagName: 'button', className: 'kl-button',
        textContent: LANG('diagnostics-stop-save'), onClick: save,
        css: {
            position: 'fixed', top: 6, left: '50%', transform: 'translateX(-50%)',
            zIndex: 10000, display: 'none', background: '#a01d24', color: '#fff',
            maxWidth: '90vw', fontSize: 12,
        },
    });
    const update = (): void => {
        const recording = DIAGNOSTICS.isRecording();
        start.disabled = recording;
        download.disabled = !hasReport;
        download.textContent = LANG(recording ? 'diagnostics-stop-save' : 'diagnostics-save');
        status.textContent = LANG(recording ? 'diagnostics-recording' : hasReport ? 'diagnostics-ready' : 'diagnostics-idle');
        badge.style.display = recording ? '' : 'none';
    };
    DIAGNOSTICS.subscribe(update);
    update();
    return root;
}
