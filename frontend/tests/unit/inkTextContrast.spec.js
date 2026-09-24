import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { describe, expect, test } from 'vitest';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.resolve(HERE, '../../src');

const walk = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return walk(full);
    return /\.(css|scss|vue|js|ts)$/.test(entry.name) ? [full] : [];
});

const block = (css, selector) => {
    const start = css.indexOf(`${selector} {`);
    return start === -1 ? '' : css.slice(start, css.indexOf('}', start));
};

const parseColour = (value) => {
    const hex = /^#([0-9a-f]{6})$/i.exec(value);
    if (hex) return { rgb: [0, 2, 4].map((i) => parseInt(hex[1].slice(i, i + 2), 16)), alpha: 1 };
    const rgba = /^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*(?:,\s*([\d.]+))?\s*\)$/i.exec(value);
    if (rgba) return { rgb: rgba.slice(1, 4).map(Number), alpha: rgba[4] === undefined ? 1 : Number(rgba[4]) };
    throw new Error(`unparsed colour ${value}`);
};
const tokenIn = (body, name) => {
    const match = new RegExp(`${name}:\\s*([^;]+);`).exec(body);
    if (!match) throw new Error(`${name} is not defined`);
    return parseColour(match[1].trim());
};

const over = (fg, bg) => fg.rgb.map((c, i) => c * fg.alpha + bg.rgb[i] * (1 - fg.alpha));
const luminance = (rgb) => {
    const [r, g, b] = rgb.map((v) => v / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const contrast = (a, b) => {
    const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
    return (hi + 0.05) / (lo + 0.05);
};

const tokens = fs.readFileSync(path.join(SRC, 'assets/css/tokens.css'), 'utf8');
const themes = { light: block(tokens, ':root'), dark: block(tokens, ':root[data-theme="dark"]') };

describe('--ink-3 is retired for text', () => {
    test('no color declaration uses --ink-3', () => {
        const inkThreeText = /(?<![-\w])color\s*:\s*['"`]?\s*var\(\s*--ink-3\s*\)/;
        const offenders = [];
        for (const file of walk(SRC)) {
            fs.readFileSync(file, 'utf8').split('\n').forEach((line, i) => {
                if (inkThreeText.test(line)) offenders.push(`${path.relative(SRC, file)}:${i + 1}`);
            });
        }
        expect(offenders).toEqual([]);
    });

    // These states used --ink-3's lighter tone as their only cue; opacity keeps them distinct.
    test.each([
        ['components/organisms/MainChat/style.css', '.mc-icon-btn:disabled', '.55'],
        ['components/organisms/MainChat/style.css', '.mc-tool:disabled', '.55'],
        ['components/organisms/MainChat/style.css', '.mc-send:disabled', '.55'],
        ['components/organisms/MainChat/style.css', '.mc-send-more:disabled', '.55'],
        ['views/Settings/Sso/SsoSettings.vue', '.sso__link:disabled', '.55'],
        ['views/PersonalList/style.css', '.personal__view--muted', '.7'],
        ['views/Projects/ListView/style.css', '.lv2__row.is-sub.is-done .lv2__name', '.75'],
        ['views/Projects/ProjectDetail/ProjectMemoryCard.vue', '.pm__row.is-retired .pm__text', '.75'],
    ])('%s %s keeps a visible cue with opacity %s', (file, selector, opacity) => {
        const rule = block(fs.readFileSync(path.join(SRC, file), 'utf8'), selector);
        expect(rule).toContain('color: var(--ink-2)');
        expect(rule).toMatch(new RegExp(`opacity:\\s*${opacity.replace('.', '\\.')}\\s*;`));
    });

    test.each(Object.keys(themes))('--ink-2 reads at 4.5:1 or better on --surface and --canvas in %s', (theme) => {
        const ink2 = tokenIn(themes[theme], '--ink-2');
        for (const surface of ['--surface', '--canvas']) {
            const bg = tokenIn(themes[theme], surface);
            expect(contrast(over(ink2, bg), bg.rgb)).toBeGreaterThanOrEqual(4.5);
        }
    });
});
