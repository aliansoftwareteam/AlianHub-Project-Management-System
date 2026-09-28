import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import path from 'path';

const SRC = path.resolve(__dirname, '../../src/views/Projects/Kanban');
const css = readFileSync(path.join(SRC, 'new-style.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
const desktop = css.slice(0, css.indexOf('@media (max-width: 767px)'));
const card = readFileSync(path.join(SRC, 'BoardViewDisplayCardComponent.vue'), 'utf8');

const OPEN_MENU = '.kanban-card .option-list:has([aria-expanded="true"])';
const bodiesFor = (sheet, selector) => [...sheet.matchAll(/([^{}]+)\{([^}]*)\}/g)]
    .filter(([, selectors]) => selectors.split(',').map((s) => s.trim()).includes(selector))
    .map(([, , body]) => body)
    .join('');

/* The open menu's panel is teleported out of the card, so the card loses :hover and
 * :focus-within; a hidden trigger then refuses the focus Escape hands back to it. */
describe('a board card with its task menu open', () => {
    it('keeps the task menu trigger visible on desktop', () => {
        const body = bodiesFor(desktop, OPEN_MENU);
        expect(body).toMatch(/opacity:\s*1/);
        expect(body).toMatch(/visibility:\s*visible/);
    });

    it('binds the DropDown trigger attrs, aria-expanded among them, on a button inside .option-list', () => {
        const list = card.slice(card.indexOf('class="option-list"'));
        const button = list.slice(list.indexOf('<button'), list.indexOf('</button>'));
        expect(button).toMatch(/v-bind="triggerAttrs"/);
    });
});
