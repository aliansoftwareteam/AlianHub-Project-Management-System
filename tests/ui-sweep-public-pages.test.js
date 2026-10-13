const fs = require('fs');
const path = require('path');

const read = (rel) => fs.readFileSync(path.join(__dirname, '..', rel), 'utf8');

const channel = (value) => {
    const v = value / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
};
const luminance = (hex) => {
    const [r, g, b] = [1, 3, 5].map((i) => channel(parseInt(hex.slice(i, i + 2), 16)));
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const contrast = (a, b) => {
    const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
    return (hi + 0.05) / (lo + 0.05);
};
const colourOf = (css, selector) => {
    const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const rule = new RegExp(`\\s${escaped}\\{(?:[^}]*;)?color:#([0-9a-f]{6}|[0-9a-f]{3})\\b`, 'i').exec(css);
    if (!rule) return null;
    return `#${rule[1].length === 3 ? rule[1].replace(/./g, (c) => c + c) : rule[1]}`;
};

describe('public share pages', () => {
    const css = read('Modules/PublicShares/publicRenderer.js');

    test.each([
        ['.muted', '#f5f6fa'],
        ['.key', '#ffffff'],
        ['.footer', '#f5f6fa'],
        ['.dk__side-label', '#ffffff'],
        ['.dk__meta', '#ffffff'],
        ['.dk__subs th', '#ffffff'],
    ])('%s text reaches 4.5:1', (selector, background) => {
        const colour = colourOf(css, selector);
        expect(colour).toBeTruthy();
        expect(contrast(colour, background)).toBeGreaterThanOrEqual(4.5);
    });

    test('a long page title in the breadcrumb ends in an ellipsis instead of being cut mid-letter', () => {
        const crumb = /\n {4}\.crumb\{([^}]*)\}/.exec(css)[1];
        expect(crumb).toMatch(/display:inline-block/);
        expect(crumb).toMatch(/text-overflow:ellipsis/);
        expect(crumb).toMatch(/white-space:nowrap/);
    });

    test('a wide table in a shared doc scrolls inside the page instead of widening it on a phone', () => {
        const table = /\n {4}\.doc table\{([^}]*)\}/.exec(css)[1];
        expect(table).toMatch(/display:block/);
        expect(table).toMatch(/max-width:100%/);
        expect(table).toMatch(/overflow-x:auto/);
    });

    test('the share buttons keep white text at 4.5:1', () => {
        const button = /\n {4}button\{margin-top:14px;background:(#[0-9a-f]{6})/.exec(css);
        expect(contrast('#ffffff', button[1])).toBeGreaterThanOrEqual(4.5);
    });
});

describe('public form', () => {
    const source = read('Modules/Forms/publicForm.js');

    test('muted text on a light form reaches 4.5:1 on the page and the card', () => {
        const light = /const muted = dark \? '#[0-9a-f]{6}' : '(#[0-9a-f]{6})'/.exec(source)[1];
        expect(contrast(light, '#f5f6fa')).toBeGreaterThanOrEqual(4.5);
        expect(contrast(light, '#ffffff')).toBeGreaterThanOrEqual(4.5);
        expect(source).toMatch(/\.intro,\.help,\.footer,\.drop \.hint\{color:\$\{muted\}\}/);
    });

    test('the sent confirmation is announced to screen readers', () => {
        expect(source).toMatch(/<div class="note ok" role="status">/);
    });

    test('unselected rating stars are visible as controls (3:1) in both themes', () => {
        const [, dark, light] = /\.stars label\{color:\$\{dark \? '(#[0-9a-f]{6})' : '(#[0-9a-f]{6})'\}\}/.exec(source);
        expect(contrast(light, '#ffffff')).toBeGreaterThanOrEqual(3);
        expect(contrast(dark, '#1f2130')).toBeGreaterThanOrEqual(3);
    });
});
