import { describe, expect, it } from 'vitest';
import { blockText, diffBlocks, diffSummary, diffWords } from '@/components/molecules/Pages/pageDiff';

const para = (id, text) => ({ id, type: 'paragraph', data: { text } });
const kinds = (rows) => rows.map((row) => row.kind);
const textOf = (segments, ...wanted) => segments.filter((segment) => wanted.includes(segment.kind)).map((segment) => segment.text).join('');

describe('word-level changes', () => {
    it('marks the words that went and the words that came, and keeps the rest', () => {
        const before = 'The quick brown fox';
        const after = 'The slow brown fox jumps';
        const segments = diffWords(before, after);

        expect(textOf(segments, 'same', 'removed')).toBe(before);
        expect(textOf(segments, 'same', 'added')).toBe(after);
        expect(segments.filter((segment) => segment.kind === 'removed').map((segment) => segment.text.trim())).toEqual(['quick']);
        expect(segments.filter((segment) => segment.kind === 'added').map((segment) => segment.text.trim())).toEqual(['slow', 'jumps']);
    });

    it('answers one unchanged run for the same text, and nothing for two empty ones', () => {
        expect(diffWords('Same words', 'Same words')).toEqual([{ kind: 'same', text: 'Same words' }]);
        expect(diffWords('', '')).toEqual([]);
    });

    it('joins neighbouring words of one kind into a single run', () => {
        const segments = diffWords('alpha beta gamma', 'alpha one two gamma');
        expect(segments.filter((segment) => segment.kind === 'added').map((segment) => segment.text.trim())).toEqual(['one two']);
        expect(segments.filter((segment) => segment.kind === 'removed').map((segment) => segment.text.trim())).toEqual(['beta']);
    });

    it('falls back to the whole text for a block too long to compare word by word', () => {
        const before = Array.from({ length: 3000 }, (_, i) => `a${i}`).join(' ');
        const after = Array.from({ length: 3000 }, (_, i) => `b${i}`).join(' ');
        expect(diffWords(before, after)).toEqual([{ kind: 'removed', text: before }, { kind: 'added', text: after }]);
    });
});

describe('the text of a block', () => {
    it('reads every kind of block as plain text', () => {
        expect(blockText({ type: 'header', data: { text: 'Goals &amp; <b>risks</b>', level: 2 } })).toBe('Goals & risks');
        expect(blockText({ type: 'list', data: { items: [{ content: 'One', items: [{ content: 'Nested' }] }, 'Two'] } })).toBe('One\nNested\nTwo');
        expect(blockText({ type: 'checklist', data: { items: [{ text: 'Done', checked: true }, { text: 'Open', checked: false }] } })).toBe('[x] Done\n[ ] Open');
        expect(blockText({ type: 'code', data: { code: 'const a = 1;' } })).toBe('const a = 1;');
        expect(blockText({ type: 'table', data: { content: [['A', 'B'], ['<b>1</b>', '2']] } })).toBe('A | B\n1 | 2');
        expect(blockText({ type: 'image', data: { key: 'Pages/x/y.png', caption: 'Chart' } })).toBe('Chart');
        expect(blockText({ type: 'delimiter', data: {} })).toBe('');
        expect(blockText(null)).toBe('');
    });
});

describe('block-level changes', () => {
    it('reports added, removed and changed blocks in reading order', () => {
        const before = [para('a', 'Intro'), para('b', 'Scope is small'), para('c', 'Old risks')];
        const after = [para('a', 'Intro'), para('b', 'Scope is large'), para('d', 'New section')];

        const rows = diffBlocks(before, after);

        expect(kinds(rows)).toEqual(['same', 'changed', 'removed', 'added']);
        expect(rows[1].before).toEqual(before[1]);
        expect(rows[1].after).toEqual(after[1]);
        expect(rows[1].textChanged).toBe(true);
        expect(textOf(rows[1].words, 'removed').trim()).toBe('small');
        expect(textOf(rows[1].words, 'added').trim()).toBe('large');
        expect(rows[2].before).toEqual(before[2]);
        expect(rows[3].after).toEqual(after[2]);
        expect(diffSummary(rows)).toEqual({ added: 1, removed: 1, changed: 1 });
    });

    it('says nothing changed for the same blocks, whatever order their keys come in', () => {
        const before = [{ id: 'a', type: 'header', data: { text: 'Title', level: 2 } }];
        const after = [{ type: 'header', data: { level: 2, text: 'Title' }, id: 'a' }];
        expect(kinds(diffBlocks(before, after))).toEqual(['same']);
        expect(diffSummary(diffBlocks(before, after))).toEqual({ added: 0, removed: 0, changed: 0 });
    });

    it('reports a change that leaves the words alone, such as a heading level or a new image', () => {
        const before = [{ id: 'h', type: 'header', data: { text: 'Title', level: 2 } }, { id: 'i', type: 'image', data: { key: 'Pages/p/one.png', caption: 'Chart' } }];
        const after = [{ id: 'h', type: 'header', data: { text: 'Title', level: 3 } }, { id: 'i', type: 'image', data: { key: 'Pages/p/two.png', caption: 'Chart' } }];

        const rows = diffBlocks(before, after);

        expect(kinds(rows)).toEqual(['changed', 'changed']);
        expect(rows.map((row) => row.textChanged)).toEqual([false, false]);
    });

    it('reports a block that moved as removed where it was and added where it is', () => {
        const rows = diffBlocks([para('a', 'First'), para('b', 'Second')], [para('b', 'Second'), para('a', 'First')]);
        expect(rows.filter((row) => row.kind === 'same')).toHaveLength(1);
        expect(diffSummary(rows)).toEqual({ added: 1, removed: 1, changed: 0 });
    });

    it('pairs blocks that carry no ids, as the old history stored them', () => {
        const before = [{ type: 'paragraph', data: { text: 'Intro' } }, { type: 'paragraph', data: { text: 'Scope is small' } }];
        const after = [{ type: 'paragraph', data: { text: 'Intro' } }, { type: 'paragraph', data: { text: 'Scope is large' } }, { type: 'paragraph', data: { text: 'More' } }];

        const rows = diffBlocks(before, after);

        expect(kinds(rows)).toEqual(['same', 'changed', 'added']);
        expect(textOf(rows[1].words, 'added').trim()).toBe('large');
    });

    it('treats a missing side as an empty doc', () => {
        expect(kinds(diffBlocks(null, [para('a', 'New')]))).toEqual(['added']);
        expect(kinds(diffBlocks([para('a', 'Old')], undefined))).toEqual(['removed']);
        expect(diffBlocks(null, null)).toEqual([]);
    });
});
