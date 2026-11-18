import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { describe, expect, it } from 'vitest';
import { contrastOn } from '../wcagContrast';
import { ACCENT_CHOICES, DEFAULT_ACCENT } from '@/components/organisms/Shell/accents';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const tokens = fs.readFileSync(path.resolve(HERE, '../../src/assets/css/tokens.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');

const rules = [...tokens.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map(([, selectors, body]) => ({
    selectors: selectors.split(',').map((s) => s.trim()),
    tokens: Object.fromEntries([...body.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)].map((m) => [m[1], m[2].trim()]))
}));
const ruleFor = (selector) => rules.find((rule) => rule.selectors.includes(selector));
const declared = (selector) => ruleFor(selector)?.tokens || {};

const THEMES = ['light', 'dark'];
const BRAND_FAMILY = ['--brand', '--brand-deep', '--brand-tint', '--brand-ring', '--brand-border'];
const CHOSEN = ACCENT_CHOICES.filter((accent) => accent !== DEFAULT_ACCENT);

const themeSelector = { light: ':root', dark: ':root[data-theme="dark"]' };
const accentSelector = (theme, accent) => (theme === 'dark'
    ? `:root[data-theme="dark"][data-accent="${accent}"]:not(.ah-high-contrast)`
    : `:root[data-accent="${accent}"]:not(.ah-high-contrast)`);
const swatchSelector = (theme, accent) => (theme === 'dark'
    ? `:root[data-theme="dark"] [data-accent-swatch="${accent}"]`
    : `[data-accent-swatch="${accent}"]`);

/* What the root element ends up with, in cascade order: a light accent block out-specifies the
   dark theme block, so a token a dark accent block forgets keeps its light value. */
const cascade = (theme, accent) => {
    const layers = [declared(themeSelector.light)];
    if (theme === 'dark') layers.push(declared(themeSelector.dark));
    if (accent !== DEFAULT_ACCENT) {
        layers.push(declared(accentSelector('light', accent)));
        if (theme === 'dark') layers.push(declared(accentSelector('dark', accent)));
    }
    return Object.assign({}, ...layers);
};

const rgbOf = (colour) => {
    const hex = /^#([0-9a-f]{6})$/i.exec(colour);
    if (hex) return hex[1].match(/../g).map((pair) => parseInt(pair, 16));
    return /^rgba?\(([^)]+)\)$/i.exec(colour)[1].split(',').slice(0, 3).map((part) => Number(part.trim()));
};

const CASES = ACCENT_CHOICES.flatMap((accent) => THEMES.map((theme) => [accent, theme]));

describe('the accent list', () => {
    it('offers six to eight accents, the default among them', () => {
        expect(ACCENT_CHOICES.length).toBeGreaterThanOrEqual(6);
        expect(ACCENT_CHOICES.length).toBeLessThanOrEqual(8);
        expect(new Set(ACCENT_CHOICES).size).toBe(ACCENT_CHOICES.length);
        expect(ACCENT_CHOICES).toContain(DEFAULT_ACCENT);
    });

    it('matches the accents tokens.css defines, so neither side has one the other lacks', () => {
        const inCss = [...new Set([...tokens.matchAll(/:root\[data-accent="([\w-]+)"\]/g)].map((m) => m[1]))].sort();
        expect(inCss).toEqual([...CHOSEN].sort());
    });

    it('leaves the default on :root, with no block of its own to repaint', () => {
        expect(tokens).not.toContain(`:root[data-accent="${DEFAULT_ACCENT}"]`);
    });
});

describe.each(CHOSEN)('the %s accent', (accent) => {
    it.each(THEMES)('redefines the brand family, and nothing else, in %s', (theme) => {
        const expected = theme === 'light' ? [...BRAND_FAMILY, '--rail-brand'] : BRAND_FAMILY;
        expect(Object.keys(declared(accentSelector(theme, accent))).sort()).toEqual([...expected].sort());
    });

    it.each(THEMES)('draws its tint, ring and border in its own colour in %s', (theme) => {
        const set = declared(accentSelector(theme, accent));
        ['--brand-tint', '--brand-ring', '--brand-border'].forEach((name) => {
            expect(rgbOf(set[name]), name).toEqual(rgbOf(set['--brand']));
        });
    });

    it.each(THEMES)('paints its swatch from the same rule in %s', (theme) => {
        expect(ruleFor(accentSelector(theme, accent)).selectors).toContain(swatchSelector(theme, accent));
    });
});

describe('the default accent swatch', () => {
    it.each(THEMES)('restates the %s brand, since inside another accent it would inherit that accent', (theme) => {
        expect(declared(swatchSelector(theme, DEFAULT_ACCENT))['--brand']).toBe(declared(themeSelector[theme])['--brand']);
    });
});

describe('accents under high contrast', () => {
    it('never override the high-contrast brand, which is tuned to 7:1', () => {
        const accentSelectors = rules.flatMap((rule) => rule.selectors).filter((selector) => selector.includes('[data-accent='));
        expect(accentSelectors.length).toBeGreaterThan(0);
        expect(accentSelectors.filter((selector) => !selector.includes(':not(.ah-high-contrast)'))).toEqual([]);
    });
});

describe.each(CASES)('contrast of the %s accent in %s', (accent, theme) => {
    const set = cascade(theme, accent);
    const grounds = ['--surface', '--surface-2', '--canvas'];

    it('reads text on the brand fill and its hover at 4.5:1 or better', () => {
        ['--brand', '--brand-deep'].forEach((fill) => {
            expect(contrastOn(set['--on-brand'], set[fill], set['--surface']), fill).toBeGreaterThanOrEqual(4.5);
        });
    });

    it('reads brand text on the surfaces and the canvas at 4.5:1 or better', () => {
        grounds.forEach((ground) => {
            expect(contrastOn(set['--brand'], set[ground], set[ground]), ground).toBeGreaterThanOrEqual(4.5);
        });
    });

    it('reads brand text on the brand tint at 4.5:1 or better', () => {
        grounds.forEach((ground) => {
            expect(contrastOn(set['--brand'], set['--brand-tint'], set[ground]), ground).toBeGreaterThanOrEqual(4.5);
        });
    });

    it('draws the focus ring in the brand colour, at 3:1 or better on the surfaces and the canvas', () => {
        expect(set['--focus']).toMatch(/var\(--brand\)/);
        grounds.forEach((ground) => {
            expect(contrastOn(set['--brand'], set[ground], set[ground]), ground).toBeGreaterThanOrEqual(3);
        });
    });

    it('reads the rail accent on the rail at 4.5:1 or better', () => {
        expect(contrastOn(set['--rail-brand'], set['--rail'], set['--rail'])).toBeGreaterThanOrEqual(4.5);
    });

    it('keeps the danger, warning and success colours of the theme', () => {
        const plain = cascade(theme, DEFAULT_ACCENT);
        ['--danger', '--danger-bg', '--danger-ink', '--warn', '--warn-bg', '--warn-ink', '--ok', '--ok-bg', '--ok-ink'].forEach((name) => {
            expect(set[name], name).toBe(plain[name]);
        });
    });
});
