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

const stylesOf = (file) => {
    const source = fs.readFileSync(file, 'utf8');
    const css = file.endsWith('.vue')
        ? [...source.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)].map((match) => match[1]).join('\n')
        : source;
    return css.replace(/\/\*[\s\S]*?\*\//g, '');
};

const rulesOf = (css) => {
    const rules = [];
    const open = [];
    let text = '';
    for (const char of css) {
        if (char === '{') {
            open.push({ selector: text.trim(), body: '' });
            text = '';
        } else if (char === '}') {
            const rule = open.pop();
            if (!rule) continue;
            rules.push({ selector: [...open.map((outer) => outer.selector), rule.selector].join(' '), body: rule.body + text });
            text = '';
        } else if (char === ';' && open.length) {
            open[open.length - 1].body += `${text};`;
            text = '';
        } else {
            text += char;
        }
    }
    return rules;
};

const DATE_PICKER_SELECTOR = /\.dp(__|--)/;
const LITERAL_COLOUR = /#[0-9a-f]{3,8}\b|\b(rgb|hsl)a?\(|:\s*(white|black)\b/i;

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
const over = (top, base) => top.rgb.map((channel, i) => channel * top.alpha + base[i] * (1 - top.alpha));
const luminance = (rgb) => {
    const [r, g, b] = rgb.map((v) => v / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const contrast = (a, b) => {
    const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
    return (hi + 0.05) / (lo + 0.05);
};

const tokens = read('assets/css/tokens.css');
const themes = { light: block(tokens, ':root'), dark: block(tokens, ':root[data-theme="dark"]') };

const MAPPING = {
    '--dp-background-color': '--surface',
    '--dp-text-color': '--ink',
    '--dp-hover-color': '--fill',
    '--dp-hover-text-color': '--ink',
    '--dp-primary-color': '--brand',
    '--dp-primary-text-color': '--on-brand',
    '--dp-secondary-color': '--ink-2',
    '--dp-border-color': '--border',
    '--dp-menu-border-color': '--border',
    '--dp-icon-color': '--ink-2',
    '--dp-disabled-color': '--fill',
    '--dp-disabled-color-text': '--ink-2',
    '--dp-range-between-dates-background-color': '--brand-tint',
    '--dp-range-between-dates-text-color': '--ink',
};

describe('the date picker follows the theme', () => {
    const globalCss = () => read('assets/css/datepicker.css').replace(/\/\*[\s\S]*?\*\//g, '');
    const mapping = () => rulesOf(globalCss()).find((rule) => /--dp-background-color/.test(rule.body));

    test('the global stylesheet is loaded with the tokens', () => {
        expect(read('assets/css/index.css')).toMatch(/@import 'datepicker\.css';/);
    });

    test('one mapping serves both themes and outranks the library', () => {
        const { selector } = mapping();
        expect(selector).not.toMatch(/data-theme/);
        expect(selector.split(',').map((part) => part.trim()).sort()).toEqual([':root .dp__theme_dark', ':root .dp__theme_light']);
    });

    test.each(Object.entries(MAPPING))('%s takes %s', (variable, token) => {
        expect(mapping().body).toMatch(new RegExp(`${variable}:\\s*var\\(${token}\\);`));
    });

    test('every colour the library reads is a token that both themes define', () => {
        const declarations = mapping().body.split(';').map((line) => line.trim()).filter(Boolean);
        const libraryCss = fs.readFileSync(path.resolve(HERE, '../../node_modules/@vuepic/vue-datepicker/dist/main.css'), 'utf8');
        const libraryColours = [...new Set(block(libraryCss, '.dp__theme_light').match(/--dp-[\w-]+(?=:)/g))];
        expect(libraryColours.length).toBeGreaterThan(20);
        expect(libraryColours.filter((name) => !declarations.some((line) => line.startsWith(`${name}:`)))).toEqual([]);

        const used = [...new Set(declarations.flatMap((line) => [...line.matchAll(/var\((--[\w-]+)\)/g)].map((match) => match[1])))];
        expect(used.filter((token) => !new RegExp(`${token}:`).test(themes.light))).toEqual([]);
        for (const token of ['--surface', '--ink', '--ink-2', '--border', '--fill', '--brand', '--on-brand', '--brand-tint']) {
            expect(themes.dark).toMatch(new RegExp(`${token}:`));
        }
    });

    test('no date-picker rule in the app carries a literal colour', () => {
        const offenders = [];
        for (const file of walk(SRC)) {
            for (const { selector, body } of rulesOf(stylesOf(file))) {
                if (!DATE_PICKER_SELECTOR.test(selector)) continue;
                if (LITERAL_COLOUR.test(body.replace(/url\([^)]*\)/g, ''))) offenders.push(`${path.relative(SRC, file)}: ${selector.replace(/\s+/g, ' ')}`);
            }
        }
        expect(offenders).toEqual([]);
    });

    test('the calendar\'s own buttons and presets carry no literal colour', () => {
        const calendar = rulesOf(stylesOf(path.join(SRC, 'components/atom/CalenderCompo/style.css')));
        const offenders = calendar
            .filter(({ selector }) => /\.btn\b|\.btn-|\.WrapperPresetRange/.test(selector))
            .filter(({ body }) => LITERAL_COLOUR.test(body))
            .map(({ selector }) => selector);
        expect(offenders).toEqual([]);
    });

    test('a selected day and both range ends take the brand fill with its own text colour', () => {
        const calendar = rulesOf(stylesOf(path.join(SRC, 'components/atom/CalenderCompo/style.css')));
        const selected = calendar.find(({ selector }) => selector === '.dp__calendar_item .dp__cell_inner:is(.dp__range_start, .dp__range_end, .dp__active_date)');
        expect(selected.body).toMatch(/background-color:\s*var\(--brand\);/);
        expect(selected.body).toMatch(/(?<![-\w])color:\s*var\(--on-brand\);/);
        expect(calendar.indexOf(selected)).toBeGreaterThan(calendar.findIndex(({ selector }) => selector === '.dp__cell_inner.dp__cell_offset.dp__pointer'));
    });

    test.each(Object.keys(themes))('day numbers stay readable on every cell fill in %s', (theme) => {
        const token = (name) => tokenIn(themes[theme], name);
        const surface = token('--surface').rgb;
        expect(contrast(token('--on-brand').rgb, token('--brand').rgb)).toBeGreaterThanOrEqual(4.5);
        for (const fill of ['--brand-tint', '--fill']) {
            const cell = over(token(fill), surface);
            expect(contrast(over(token('--ink'), cell), cell)).toBeGreaterThanOrEqual(4.5);
        }
        expect(contrast(over(token('--ink-2'), surface), surface)).toBeGreaterThanOrEqual(4.5);
    });
});
