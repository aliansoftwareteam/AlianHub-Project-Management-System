/* The nested rows of the Table and the Board card, read from their stylesheets: each level sits
   one indent step in, every new control is a full target, and a name keeps room on a phone. */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import path from 'path';
import { gridTracks } from '@/views/Projects/composables/viewColumns';

const SRC = path.resolve(__dirname, '../../src');
const css = (file) => readFileSync(path.join(SRC, file), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
const source = (file) => readFileSync(path.join(SRC, file), 'utf8');

const table = css('views/Projects/TableView/style.css');
const board = css('views/Projects/Kanban/new-style.css');
const tokens = css('assets/css/tokens.css');

function mediaBlocks(sheet, query) {
    const blocks = [];
    let from = 0;
    for (;;) {
        const start = sheet.indexOf(`@media ${query}`, from);
        if (start === -1) return blocks.join('\n');
        const open = sheet.indexOf('{', start);
        let depth = 1;
        let at = open + 1;
        while (depth && at < sheet.length) {
            if (sheet[at] === '{') depth += 1;
            if (sheet[at] === '}') depth -= 1;
            at += 1;
        }
        blocks.push(sheet.slice(open + 1, at - 1));
        from = at;
    }
}

function rule(sheet, selector) {
    const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const match = sheet.match(new RegExp(`(?:^|[}\\s,])${escaped}\\s*\\{([^}]*)\\}`));
    return match ? match[1] : '';
}

const declared = (body, property) => (body.match(new RegExp(`(?:^|[;\\s])${property}\\s*:\\s*([^;]+)`)) || [])[1]?.trim() || '';
const customProperties = (body) => Object.fromEntries([...body.matchAll(/(--[\w-]+)\s*:\s*([^;]+)/g)].map(([, name, value]) => [name, value.trim()]));

const variables = customProperties(rule(tokens, ':root'));

function px(value, local = {}) {
    let resolved = value;
    for (let pass = 0; pass < 6 && /var\(/.test(resolved); pass += 1) {
        resolved = resolved.replace(/var\((--[\w-]+)(?:,\s*([^()]+))?\)/g, (whole, name, fallback) => local[name] ?? variables[name] ?? fallback ?? whole);
    }
    const sum = resolved.replace(/calc/g, '').replace(/px/g, '');
    if (!sum.trim() || !/^[\d\s.+\-*/()]+$/.test(sum)) throw new Error(`cannot resolve "${value}" (got "${resolved}")`);
    return Function(`return (${sum});`)();
}

const FLOOR = 24;
const PHONE_HIT = { '--hit-min': '40px' };
const size = (sheet, selector, property, local) => px(declared(rule(sheet, selector), property), local);
const isFullTarget = (sheet, selector, local) => {
    const body = rule(sheet, selector);
    const wide = declared(body, 'width') || declared(body, 'min-width');
    const tall = declared(body, 'height') || declared(body, 'min-height');
    return Boolean(wide && tall) && px(wide, local) >= FLOOR && px(tall, local) >= FLOOR;
};

describe('a nested Table row', () => {
    const indent = (depth) => size(table, '.tv2__name-cell', 'padding-left', { '--tv2-depth': String(depth) });

    it('uses the List\'s indent token, one step for each level', () => {
        expect(declared(rule(table, '.tv2__name-cell'), 'padding-left')).toContain('var(--row-indent)');
        expect(indent(0)).toBe(0);
        expect(indent(1)).toBe(px('var(--row-indent)'));
        expect(indent(2)).toBe(2 * px('var(--row-indent)'));
    });

    it('starts at depth 0, so a row that names no depth is not indented', () => {
        expect(customProperties(rule(table, '.tv2'))['--tv2-depth']).toBe('0');
    });

    it('has a disclosure that is a full target', () => {
        expect(isFullTarget(table, '.tv2__disclose')).toBe(true);
        expect(declared(rule(table, '.tv2__disclose'), 'width')).toContain('var(--hit-min)');
    });

    it('keeps the disclosure\'s room on a row with nothing to open, so names line up', () => {
        expect(declared(rule(table, '.tv2__disclose--none'), 'visibility')).toBe('hidden');
        expect(rule(table, '.tv2__disclose--none')).not.toMatch(/display\s*:\s*none/);
    });

    it('leaves the task name 100px or more on the third level, with phone-sized targets too', () => {
        const nameTrack = Number(gridTracks('table', []).match(/minmax\((\d+)px/)[1]);
        const room = (local) => nameTrack - indent(2) - size(table, '.tv2__disclose', 'width', local) - size(table, '.tv2__name-cell', 'gap');
        expect(room()).toBeGreaterThanOrEqual(100);
        expect(room(PHONE_HIT)).toBeGreaterThanOrEqual(100);
    });

    it('is not resized by the phone rules: the density tokens size it', () => {
        expect(mediaBlocks(table, '(max-width: 767px)')).not.toMatch(/\.tv2__disclose|\.tv2__name-cell/);
    });

    it('names the disclosure and says whether it is open', () => {
        const row = source('views/Projects/TableView/TableRow.vue');
        expect(row).toMatch(/class="tv2__disclose"[\s\S]{0,200}:aria-expanded="expanded"[\s\S]{0,200}:aria-label="\$t\('List\.toggle_subtasks'\)"/);
    });
});

describe('the subtasks inside a Board card', () => {
    const indent = (depth) => size(board, '.kanban-board .card-subtask__row', 'padding-left', { '--card-depth': String(depth) });

    it('indent the third level one step with the List\'s token', () => {
        expect(declared(rule(board, '.kanban-board .card-subtask__row'), 'padding-left')).toContain('var(--row-indent)');
        expect(indent(0)).toBe(0);
        expect(indent(1)).toBe(px('var(--row-indent)'));
    });

    it.each([
        ['the count that opens them', '.kanban-board .card-subtasks-toggle'],
        ['a row\'s disclosure', '.kanban-board .card-subtask__disclose'],
        ['a row\'s name', '.kanban-board .card-subtask__name'],
        ['a row\'s Add subtask', '.kanban-board .card-subtask__add']
    ])('%s is a full target', (_, selector) => {
        expect(isFullTarget(board, selector)).toBe(true);
        expect(rule(board, selector)).toContain('var(--hit-min)');
    });

    it('a row is as tall as its controls', () => {
        expect(size(board, '.kanban-board .card-subtask__row', 'min-height')).toBeGreaterThanOrEqual(FLOOR);
    });

    it('cuts a long name short instead of widening the card', () => {
        const name = rule(board, '.kanban-board .card-subtask__name');
        expect(declared(name, 'text-overflow')).toBe('ellipsis');
        expect(declared(name, 'min-width')).toBeTruthy();
        expect(source('views/Projects/Kanban/BoardCardSubtasks.vue')).toMatch(/class="card-subtask__name"[^>]*:title="sub\.TaskName"/);
    });

    it('leaves a name 100px or more inside a phone-width card, on both nested levels', () => {
        const phone = mediaBlocks(board, '(max-width: 767px)');
        const card = Number(rule(phone, '.kanban-board .kanban-column').match(/min\((\d+)px/)[1]);
        const padding = px(declared(rule(phone, '.kanban-board .kanban-card'), 'padding'));
        const gap = size(board, '.kanban-board .card-subtask__row', 'gap');
        const slot = (selector) => size(board, selector, 'width');
        const dot = size(board, '.kanban-board .card-subtask__dot', 'width');
        const inner = card - 2 * padding;
        const levelTwo = inner - slot('.kanban-board .card-subtask__disclose') - dot - slot('.kanban-board .card-subtask__add') - 3 * gap;
        const levelThree = inner - indent(1) - slot('.kanban-board .card-subtask__disclose') - dot - 2 * gap;
        expect(levelTwo).toBeGreaterThanOrEqual(100);
        expect(levelThree).toBeGreaterThanOrEqual(100);
    });

    it('is not resized by the phone rules', () => {
        expect(mediaBlocks(board, '(max-width: 767px)')).not.toMatch(/\.card-subtask|\.card-subtasks-toggle/);
    });

    it('names each control', () => {
        const rows = source('views/Projects/Kanban/BoardCardSubtasks.vue');
        expect(rows).toMatch(/class="card-subtask__disclose"[\s\S]{0,200}:aria-expanded=[\s\S]{0,200}:aria-label="\$t\('List\.toggle_subtasks'\)"/);
        expect(rows).toMatch(/class="card-subtask__add"[\s\S]{0,200}:aria-label="\$t\('Projects\.add_subtask_to', \{ name: sub\.TaskName \}\)"/);
    });
});

describe('the files of the nested rows', () => {
    it.each([
        'views/Projects/Kanban/BoardCardSubtasks.vue',
        'views/Projects/TableView/TableSubtaskRows.vue',
        'views/Projects/TableView/TableRow.vue',
        'views/Projects/composables/subtaskTree.js'
    ])('%s has no hex colour', (file) => {
        expect(source(file).match(/#[0-9a-fA-F]{3,8}\b/g) || []).toEqual([]);
    });
});
