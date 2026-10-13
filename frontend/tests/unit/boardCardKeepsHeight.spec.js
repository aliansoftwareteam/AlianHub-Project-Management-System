import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const css = readFileSync(resolve(__dirname, '../../src/views/Projects/Kanban/new-style.css'), 'utf8');

const ruleFor = (selector) => {
    const start = css.indexOf(`${selector} {`);
    return start === -1 ? '' : css.slice(start, css.indexOf('}', start));
};

describe('board cards in a full column', () => {
    // jsdom has no layout: a phone's min-height on the card lets the flex column squeeze it to 44px, and its content then covers the next card.
    it('keep their height and let the column scroll', () => {
        expect(ruleFor('.kanban-board .kanban-cards')).toMatch(/display:\s*flex/);
        expect(ruleFor('.kanban-board .kanban-card')).toMatch(/flex-shrink:\s*0/);
    });
});
