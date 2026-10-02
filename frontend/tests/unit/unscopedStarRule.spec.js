import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { describe, expect, test } from 'vitest';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.resolve(HERE, '../../src');
const GLOBAL_SHEET = 'assets/css/tokens.css';

const walk = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return walk(full);
    return /\.(css|vue)$/.test(entry.name) ? [full] : [];
});

/* A stylesheet a component pulls in with @import is not scoped, even from a <style scoped> block:
 * only the rules written in that block get the component's attribute. */
const unscopedCss = (file, text) => (file.endsWith('.css')
    ? text
    : [...text.matchAll(/<style(?![^>]*\bscoped\b)[^>]*>([\s\S]*?)<\/style>/g)].map((block) => block[1]).join('\n'));

const starRules = (css) => [...css.replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/(?:^|[{}])\s*([^{}@]+?)\s*\{/g)]
    .map((rule) => rule[1])
    .filter((selectors) => selectors.split(',').some((selector) => /^\*(::?[\w-]+)?$/.test(selector.trim())));

describe('a rule for every element belongs to the global stylesheet only', () => {
    test('the matcher sees a bare star, alone or in a list, and nothing narrower', () => {
        expect(starRules('* { margin: 0 }')).toHaveLength(1);
        expect(starRules('a { b: c } *, *::before { box-sizing: border-box }')).toHaveLength(1);
        expect(starRules('@media (max-width: 9px) { * { outline: none } }')).toHaveLength(1);
        expect(starRules('.card * { margin: 0 } :where(.card) * { outline: none } .a > * { gap: 0 }')).toHaveLength(0);
        expect(unscopedCss('X.vue', '<style scoped>* { a: b }</style><style>* { c: d }</style>')).toBe('* { c: d }');
    });

    test('no component or view stylesheet styles every element on the page', () => {
        const offenders = walk(SRC)
            .map((file) => path.relative(SRC, file).split(path.sep).join('/'))
            .filter((file) => file !== GLOBAL_SHEET)
            .filter((file) => starRules(unscopedCss(file, fs.readFileSync(path.join(SRC, file), 'utf8'))).length);
        expect(offenders).toEqual([]);
    });
});
