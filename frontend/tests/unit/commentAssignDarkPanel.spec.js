import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import path from 'path';

const source = readFileSync(path.resolve(__dirname, '../../src/components/molecules/CommentThread/CommentAssignment.vue'), 'utf8');
const style = source.slice(source.indexOf('<style')).replace(/\/\*[\s\S]*?\*\//g, '');
const rulesFor = (selector) => [...style.matchAll(/([^{}]+)\{([^}]*)\}/g)]
    .filter(([, selectors]) => selectors.split(',').some((s) => s.trim().startsWith(selector)))
    .map(([, , body]) => body)
    .join('');

/* The assign picker opens in the DropDown panel, which is a token surface in both themes. */
describe('comment assign picker on the themed DropDown panel', () => {
    it('lets option names inherit the panel ink', () => {
        expect(rulesFor('.cm-assign__option')).toMatch(/color:\s*inherit/);
        expect(rulesFor('.cm-assign__empty')).toMatch(/color:\s*inherit/);
    });

    it('draws the search field on the panel surface, with the panel ink', () => {
        const search = rulesFor('.cm-assign__search');
        expect(search).toMatch(/background:\s*var\(--surface\)/);
        expect(search).toMatch(/border:\s*1px solid var\(--border\)/);
        expect(search).toMatch(/color:\s*inherit/);
        expect(search).not.toMatch(/#[0-9a-f]{3,8}\b/i);
    });
});
