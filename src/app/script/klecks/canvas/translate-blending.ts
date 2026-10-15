import { TMixMode } from '../kl-types';
import { LANG } from '../../language/language';
import { TTranslationCode } from '../../../languages/languages';

export function translateBlending(blendMode?: TMixMode): string {
    if (!blendMode) {
        return LANG('layers-blend-normal');
    }

    const codes: {
        [key: string]: TTranslationCode;
    } = {
        'source-over': 'layers-blend-normal',
        multiply: 'layers-blend-multiply',
        screen: 'layers-blend-screen',
        overlay: 'layers-blend-overlay',
        'linear-burn': 'layers-blend-linear-burn',
        'linear-dodge': 'layers-blend-linear-dodge',
        'linear-light': 'layers-blend-linear-light',
        'color-burn': 'layers-blend-color-burn',
        'color-dodge': 'layers-blend-color-dodge',
        'vivid-light': 'layers-blend-vivid-light',
        'soft-light': 'layers-blend-soft-light',
        'hard-light': 'layers-blend-hard-light',
        'pin-light': 'layers-blend-pin-light',
        'hard-mix': 'layers-blend-hard-mix',
        darken: 'layers-blend-darken',
        lighten: 'layers-blend-lighten',
        'darker-color': 'layers-blend-darker-color',
        'lighter-color': 'layers-blend-lighter-color',
        difference: 'layers-blend-difference',
        exclusion: 'layers-blend-exclusion',
        subtract: 'layers-blend-subtract',
        divide: 'layers-blend-divide',
        hue: 'layers-blend-hue',
        saturation: 'layers-blend-saturation',
        color: 'layers-blend-color',
        luminosity: 'layers-blend-luminosity',
    };

    if (!(blendMode in codes)) {
        throw new Error('unknown blend mode');
    }
    return LANG(codes[blendMode]);
}
