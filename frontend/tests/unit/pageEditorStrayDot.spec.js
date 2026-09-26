import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { beforeAll, describe, expect, it } from 'vitest';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const vue = fs.readFileSync(path.resolve(HERE, '../../src/components/molecules/Pages/PageBlockEditor.vue'), 'utf8');
const css = vue.slice(vue.indexOf('<style scoped>'), vue.indexOf('</style>')).replace(/\/\*[\s\S]*?\*\//g, '');

const unwrapDeep = (selector) => selector.replace(/:deep\(((?:[^()]|\([^()]*\))*)\)/g, '$1').trim();
const splitSelectors = (list) => {
    const parts = [];
    let depth = 0;
    let start = 0;
    [...list].forEach((ch, i) => {
        if (ch === '(') depth += 1;
        if (ch === ')') depth -= 1;
        if (ch === ',' && depth === 0) {
            parts.push(list.slice(start, i));
            start = i + 1;
        }
    });
    parts.push(list.slice(start));
    return parts.map(unwrapDeep);
};
const rules = [...css.replace('<style scoped>', '').matchAll(/([^{}]+)\{([^{}]*)\}/g)].map(([, selectors, body]) => ({
    selectors: splitSelectors(selectors),
    declarations: body.split(';').map((decl) => decl.trim()).filter(Boolean).map((decl) => {
        const colon = decl.indexOf(':');
        return { name: decl.slice(0, colon).trim(), value: decl.slice(colon + 1).trim() };
    })
}));

const matches = (el, selector) => {
    try {
        return el.matches(selector);
    } catch {
        return false;
    }
};
const declarationsFor = (el) => rules.filter((rule) => rule.selectors.some((selector) => matches(el, selector))).flatMap((rule) => rule.declarations);
const PAINT = /^(background|border(?!-radius)|box-shadow|outline|padding)/;
const paintOn = (el) => declarationsFor(el).filter(({ name }) => PAINT.test(name)).map(({ name, value }) => `${name}: ${value}`);
const valueOf = (el, name) => declarationsFor(el).filter((decl) => decl.name === name).map((decl) => decl.value).pop();

// The markup Editor.js 2.30 keeps in every page editor, whether or not a toolbar is open.
beforeAll(() => {
    document.body.innerHTML = `
        <div class="pbe"><div class="pbe__holder"><div class="codex-editor">
            <div class="codex-editor__redactor"><div class="ce-block"><div class="ce-block__content">
                <ul class="cdx-nested-list cdx-nested-list--unordered">
                    <li class="cdx-nested-list__item"><div class="cdx-nested-list__item-body"><div class="cdx-nested-list__item-content">One</div></div></li>
                </ul>
            </div></div></div>
            <div class="ce-inline-toolbar"></div>
            <div class="ce-toolbar ce-toolbar--opened"><div class="ce-toolbar__content"><div class="ce-toolbar__actions">
                <div class="ce-toolbar__plus"></div>
                <div class="ce-toolbox"><div class="ce-popover" id="closed"><div class="ce-popover__container"></div></div></div>
            </div></div></div>
            <div class="ce-popover ce-popover--opened" id="open"><div class="ce-popover__container"></div></div>
        </div></div></div>`;
});

describe('the page editor beside the doc body', () => {
    it('paints nothing on the empty inline-toolbar holder, which sits at the top left of the editor', () => {
        expect(paintOn(document.querySelector('.ce-inline-toolbar'))).toEqual([]);
    });

    it('paints nothing on a closed popover, so no ring shows beside the + button', () => {
        expect(paintOn(document.querySelector('#closed'))).toEqual([]);
    });

    it('still themes an open popover, through the variables Editor.js paints its container with', () => {
        const popover = document.querySelector('#open');
        expect(valueOf(popover, '--color-background')).toBe('var(--surface)');
        expect(valueOf(popover, '--color-border')).toBe('var(--border)');
        expect(valueOf(popover, '--border-radius')).toBe('11px');
        expect(valueOf(popover.querySelector('.ce-popover__container'), 'box-shadow')).toBe('var(--shadow-pop)');
    });

    it('leaves list blocks their bullets', () => {
        const list = document.querySelector('.cdx-nested-list');
        const item = document.querySelector('.cdx-nested-list__item');
        const markerRules = [...declarationsFor(list), ...declarationsFor(item)].filter(({ name }) => /^(list-style|display)/.test(name));
        expect(markerRules).toEqual([]);
    });
});
