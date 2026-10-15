import type { Psd } from 'ag-psd/dist/psd';
import { BB } from '../../bb/bb';

// A real bottom layer keeps the paper visible in other PSD readers. Our marker
// lets this fork restore it as document background without consuming a layer.
const PAPER_LAYER_ID = 2147483646;
const PAPER_NAME = 'Klecks Paper';
const NAMESPACE = 'https://github.com/mishiki/klecks/ns/background/1.0/';

export function addPsdBackground(psd: Psd): void {
    const canvas = BB.canvas(psd.width, psd.height);
    const ctx = BB.ctx(canvas);
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    psd.children = [{
        id: PAPER_LAYER_ID,
        name: PAPER_NAME,
        canvas,
        left: 0,
        top: 0,
        opacity: 1,
        hidden: false,
        clipping: false,
        blendMode: 'normal',
    }, ...(psd.children ?? [])];
    psd.imageResources = {
        ...psd.imageResources,
        xmpMetadata: '<x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#"><rdf:Description xmlns:kp="' + NAMESPACE + '" kp:paperLayerId="' + PAPER_LAYER_ID + '"/></rdf:RDF></x:xmpmeta>',
    };
}

// Never remove an unmarked layer, or a marked layer edited in another program.
export function hasUnchangedPsdBackground(psd: Psd): boolean {
    const xmp = psd.imageResources?.xmpMetadata;
    const paper = psd.children?.[0];
    if (!xmp || !paper || (psd.children?.length ?? 0) < 2) {
        return false;
    }
    const doc = new DOMParser().parseFromString(xmp, 'application/xml');
    const marked = Array.from(doc.getElementsByTagName('*')).some(
        (el) => el.getAttributeNS(NAMESPACE, 'paperLayerId') === String(PAPER_LAYER_ID),
    );
    const canvas = paper.canvas;
    if (!marked || paper.id !== PAPER_LAYER_ID || paper.name !== PAPER_NAME ||
        !canvas || canvas.width !== psd.width || canvas.height !== psd.height ||
        paper.left !== 0 || paper.top !== 0 || paper.hidden ||
        (paper.opacity ?? 1) !== 1 || (paper.fillOpacity ?? 1) !== 1 ||
        paper.blendMode !== 'normal' || paper.clipping || paper.children ||
        paper.mask || paper.vectorMask || paper.effects || paper.adjustment) {
        return false;
    }
    const ctx = BB.ctx(canvas);
    // Bound temporary pixel memory when reopening large documents.
    for (let y = 0; y < canvas.height; y += 64) {
        const pixels = ctx.getImageData(0, y, canvas.width, Math.min(64, canvas.height - y)).data;
        if (pixels.some((value) => value !== 255)) {
            return false;
        }
    }
    return true;
}
