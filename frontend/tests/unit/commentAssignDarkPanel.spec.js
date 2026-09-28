import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import path from 'path';

const source = readFileSync(path.resolve(__dirname, '../../src/components/molecules/CommentThread/CommentAssignment.vue'), 'utf8');
const style = source.slice(source.indexOf('<style')).replace(/\/\*[\s\S]*?\*\//g, '');
const rulesFor = (selector) => [...style.matchAll(/([^{}]+)\{([^}]*)\}/g)]
    .filter(([, selectors]) => selectors.split(',').some((s) => s.trim().startsWith(selector)))
    .map(([, , body]) => body)
    .join('');

/* The assign picker opens in the legacy DropDown panel, which stays white in both themes;
 * theme tokens flip to light ink and a dark field in dark mode and vanish on that panel. */
describe('comment assign picker on the white DropDown panel', () => {
    it('lets option names inherit the panel ink instead of a theme token', () => {
        const option = rulesFor('.cm-assign__option');
        expect(option).toMatch(/color:\s*inherit/);
        expect(option).not.toMatch(/var\(--/);
        expect(rulesFor('.cm-assign__empty')).not.toMatch(/var\(--/);
    });

    it('draws the search field with the legacy light input look, not the themed ah-input', () => {
        const input = source.match(/<input[\s\S]*?\/>/)[0];
        expect(input).not.toMatch(/\bah-input\b/);
        const search = rulesFor('.cm-assign__search');
        expect(search).toMatch(/background:\s*#fff/i);
        expect(search).toMatch(/color:\s*inherit/);
        expect(search).not.toMatch(/var\(--/);
    });
});
