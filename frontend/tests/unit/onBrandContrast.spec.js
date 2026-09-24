import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { describe, expect, test } from 'vitest';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.resolve(HERE, '../../src');
const read = (rel) => fs.readFileSync(path.join(SRC, rel), 'utf8');

const walk = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return walk(full);
    return /\.(css|scss|vue)$/.test(entry.name) ? [full] : [];
});

const block = (css, selector) => {
    const start = css.indexOf(`${selector} {`);
    return start === -1 ? '' : css.slice(start, css.indexOf('}', start));
};
const tokenIn = (body, name) => (new RegExp(`${name}:\\s*(#[0-9a-f]{6})`, 'i').exec(body) || [])[1];

const luminance = (hex) => {
    const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
        .map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const contrast = (a, b) => {
    const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
    return (hi + 0.05) / (lo + 0.05);
};

const tokens = read('assets/css/tokens.css');
const themes = { light: block(tokens, ':root'), dark: block(tokens, ':root[data-theme="dark"]') };

describe('text on the brand fill', () => {
    test.each(Object.keys(themes))('--on-brand reads at 4.5:1 or better on --brand and --brand-deep in %s', (theme) => {
        const onBrand = tokenIn(themes[theme], '--on-brand');
        expect(onBrand).toBeTruthy();
        for (const fill of ['--brand', '--brand-deep']) {
            expect(contrast(tokenIn(themes[theme], fill), onBrand)).toBeGreaterThanOrEqual(4.5);
        }
    });

    test('light mode keeps white on the brand fill', () => {
        expect(tokenIn(themes.light, '--on-brand')).toMatch(/^#fff(fff)?$/i);
    });

    test('no rule fills with a theme brand colour and paints white on it', () => {
        const brandFill = /background(-color)?\s*:[^;}]*var\(\s*--(brand(-deep)?|kiln-ember(-deep)?)\s*\)/;
        const whiteInk = /(^|[;{\s])(color|stroke|fill)\s*:\s*(#fff\b|#ffffff\b|white\b|rgba?\(\s*255\s*,\s*255\s*,\s*255)/i;
        const offenders = [];
        for (const file of walk(SRC)) {
            const css = fs.readFileSync(file, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
            for (const [, selector, body] of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
                if (brandFill.test(body) && whiteInk.test(body)) offenders.push(`${path.relative(SRC, file)} ${selector.trim()}`);
            }
            for (const line of css.split('\n')) {
                if (/style=/.test(line) && /var\(--brand\)/.test(line) && /'#fff(fff)?'|white/i.test(line) && !/var\(--on-brand\)/.test(line)) {
                    offenders.push(`${path.relative(SRC, file)} ${line.trim()}`);
                }
            }
        }
        expect(offenders).toEqual([]);
    });

    test('the checkbox tick uses --on-brand', () => {
        expect(block(tokens, '.ah-check:checked::after')).toMatch(/border:\s*2px solid var\(--on-brand\)/);
    });

    test('a team mark without its own colour uses --on-brand', () => {
        expect(read('views/Settings/Teams/Teams.vue')).toMatch(/class="tm__mark"\s*\n\s*:style="\{ color: row\.teamColor\?\.bgColor \? \(row\.teamColor\.color \|\| '#fff'\) : 'var\(--on-brand\)'/);
    });

    test('the page checklist tick uses --on-brand, with a dark hover fill it can read on', () => {
        const vue = read('components/molecules/Pages/PageBlockEditor.vue');
        expect(vue).toMatch(/\.pbe :deep\(\.cdx-checklist__item-checkbox-check\) \{ background: var\(--surface\);/);
        expect(vue).toMatch(/cdx-checklist__item-checkbox-check svg path\) \{ stroke: var\(--on-brand\); \}/);
        expect(vue).toMatch(/:root\[data-theme="dark"\] \.pbe :deep\(\.cdx-checklist__item--checked \.cdx-checklist__item-checkbox:hover \.cdx-checklist__item-checkbox-check\) \{ background: var\(--brand-deep\)/);
    });
});
