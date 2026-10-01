import { describe, expect, it } from 'vitest';
import { shownDescription } from '@/utils/taskDescription';

const paragraph = (text) => ({ type: 'paragraph', data: { text } });

describe('the description the task panel hands the editor', () => {
    it('is the stored editor document when the task has one', () => {
        const block = { time: 1, version: '2.30.7', blocks: [paragraph('Typed')] };
        expect(shownDescription({ descriptionBlock: block, rawDescription: 'Typed' })).toBe(block);
    });

    it('is built from the plain text of a task imported before descriptions were stored as documents', () => {
        const shown = shownDescription({ descriptionBlock: {}, rawDescription: 'Agree the date\n- Book the room' });
        expect(shown.blocks).toEqual([paragraph('Agree the date'), { type: 'list', data: { style: 'unordered', items: [{ content: 'Book the room', items: [] }] } }]);
        expect(shownDescription({ rawDescription: 'Only text' }).blocks).toEqual([paragraph('Only text')]);
    });

    it('shows that text as text: markup in it is escaped, never run', () => {
        const shown = shownDescription({ rawDescription: '<img src=x onerror=alert(1)>' });
        expect(shown.blocks).toEqual([paragraph('&lt;img src=x onerror=alert(1)&gt;')]);
    });

    it('links nothing in the text of a task filed from outside', () => {
        const shown = shownDescription({ rawDescription: 'Pay at https://example.test/pay', origin: { kind: 'email' } });
        expect(shown.blocks).toEqual([paragraph('Pay at https://example.test/pay')]);
    });

    it('still reads the older description field, and is empty for a task with no description', () => {
        expect(shownDescription({ description: 'older text', rawDescription: 'older text' })).toBe('older text');
        expect(shownDescription({ descriptionBlock: 'older text form' })).toBe('older text form');
        expect(shownDescription({ TaskName: 'x' })).toBeUndefined();
        expect(shownDescription(undefined)).toBeUndefined();
    });
});
