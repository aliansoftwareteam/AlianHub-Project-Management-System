import { describe, expect, test } from 'vitest';
import fs from 'fs';
import path from 'path';

const SRC = path.resolve(__dirname, '../../src');

const sheets = (dir = SRC) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return sheets(full);
    return /\.(css|scss|vue)$/.test(entry.name) ? [full] : [];
});

const cssOf = (file) => {
    const text = fs.readFileSync(file, 'utf8');
    const css = file.endsWith('.vue') ? [...text.matchAll(/<style(?![^>]*\bscoped\b)[^>]*>([\s\S]*?)<\/style>/g)].map((m) => m[1]).join('\n') : text;
    return css.replace(/\/\*[\s\S]*?\*\//g, '');
};

const pinsEveryPage = (css) => [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].some(([, selectors, body]) => (
    selectors.split(',').some((selector) => selector.trim() === '.ah-page')
    && /(^|[;\s])(height|max-height|overflow(-y)?)\s*:/.test(body)
));

describe('the page frame stays with the pages that scroll a panel of their own', () => {
    test('no stylesheet pins or clips every .ah-page', () => {
        const found = sheets().filter((file) => pinsEveryPage(cssOf(file))).map((file) => path.relative(SRC, file));
        expect(found).toEqual([]);
    });

    test('a rule on the bare class is found, one on a named page is not', () => {
        expect(pinsEveryPage('.ah-page { display: flex; height: 100%; overflow: hidden; }')).toBe(true);
        expect(pinsEveryPage('.other, .ah-page { overflow-y: hidden }')).toBe(true);
        expect(pinsEveryPage('.ah-page.home { height: 100%; overflow: hidden; }')).toBe(false);
        expect(pinsEveryPage('.ah-page { color: var(--ink); min-height: 100%; }')).toBe(false);
    });
});
