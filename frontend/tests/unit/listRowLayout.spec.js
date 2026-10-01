/* The List row's title cell, read from the stylesheet: a subtask sits one indent step to the
   right of its parent, and the hover actions do not take width from the task name. */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import path from 'path';

const SRC = path.resolve(__dirname, '../../src');
const css = (file) => readFileSync(path.join(SRC, file), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');

const list = css('views/Projects/ListView/style.css');
const tokens = css('assets/css/tokens.css');

function mediaBlocks(source, query) {
    const blocks = [];
    let from = 0;
    for (;;) {
        const start = source.indexOf(`@media ${query}`, from);
        if (start === -1) return blocks.join('\n');
        const open = source.indexOf('{', start);
        let depth = 1;
        let at = open + 1;
        while (depth && at < source.length) {
            if (source[at] === '{') depth += 1;
            if (source[at] === '}') depth -= 1;
            at += 1;
        }
        blocks.push(source.slice(open + 1, at - 1));
        from = at;
    }
}

const withoutMedia = (source) => source.replace(/@media[^{]*\{(?:[^{}]*\{[^}]*\})*[^}]*\}/g, '');

function rule(source, selector) {
    const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const match = source.match(new RegExp(`(?:^|[}\\s,])${escaped}\\s*\\{([^}]*)\\}`));
    return match ? match[1] : '';
}

const declared = (body, property) => (body.match(new RegExp(`(?:^|[;\\s])${property}\\s*:\\s*([^;]+)`)) || [])[1]?.trim() || '';

function customProperties(body) {
    return Object.fromEntries([...body.matchAll(/(--[\w-]+)\s*:\s*([^;]+)/g)].map(([, name, value]) => [name, value.trim()]));
}

const base = withoutMedia(list);
const variables = { ...customProperties(rule(tokens, ':root')), ...customProperties(rule(base, '.lv2')) };

function px(value, local = {}) {
    let resolved = value;
    for (let pass = 0; pass < 6 && /var\(/.test(resolved); pass += 1) {
        resolved = resolved.replace(/var\((--[\w-]+)(?:,\s*([^()]+))?\)/g, (whole, name, fallback) => local[name] ?? variables[name] ?? fallback ?? whole);
    }
    const sum = resolved.replace(/calc/g, '').replace(/px/g, '');
    if (!sum.trim() || !/^[\d\s.+\-*()]+$/.test(sum)) throw new Error(`cannot resolve "${value}" (got "${resolved}")`);
    return Function(`return (${sum});`)();
}

const width = (selector) => px(declared(rule(base, selector), 'width'));
const titleGap = () => px(declared(rule(base, '.lv2__title'), 'gap'));
const subtaskInset = (depth = 1) => px(declared(rule(base, '.lv2__title--sub'), 'padding-left'), { '--lv2-depth': String(depth) });
const parentCircle = () => width('.lv2__grip') + titleGap() + width('.lv2__disclose') + titleGap();
const subtaskCircle = (depth) => subtaskInset(depth) + width('.lv2__disclose') + titleGap();

describe('a subtask row is indented under its parent', () => {
    it('there is an indent token next to the density tokens', () => {
        expect(variables['--row-indent']).toBeTruthy();
        expect(px('var(--row-indent)')).toBeGreaterThanOrEqual(12);
    });

    it('the subtask title cell is indented by that token for each level it is down, not by a literal', () => {
        const indent = declared(rule(base, '.lv2__title--sub'), 'padding-left');
        expect(indent).toContain('var(--row-indent) * var(--lv2-depth');
        expect(indent).not.toMatch(/\d+px/);
    });

    it('a subtask keeps a place for its own disclosure, so its circle and name start one step right of the parent', () => {
        expect(subtaskCircle(1) - parentCircle()).toBe(px('var(--row-indent)'));
        expect(declared(rule(base, '.lv2__disclose--none'), 'visibility')).toBe('hidden');
    });

    it('a sub-subtask starts one more step to the right', () => {
        expect(subtaskCircle(2) - subtaskCircle(1)).toBe(px('var(--row-indent)'));
        expect(subtaskCircle(2) - parentCircle()).toBe(2 * px('var(--row-indent)'));
    });
});

describe('the column headers sit on one line', () => {
    it('every header is centred on the Task header, Done by included', () => {
        expect(declared(rule(base, '.lv2__cols'), 'align-items')).toBe('center');
    });
});

describe('the task name uses the free space in its cell', () => {
    const wide = mediaBlocks(list, '(min-width: 768px)');

    it('the hover actions sit over the end of the cell instead of reserving their width', () => {
        expect(declared(rule(wide, '.lv2__actions'), 'position')).toBe('absolute');
        expect(declared(rule(wide, '.lv2__title'), 'position')).toBe('relative');
    });

    it('hidden actions take no clicks from the name under them', () => {
        expect(declared(rule(wide, '.lv2__actions'), 'pointer-events')).toBe('none');
        expect(wide).toMatch(/\.lv2__row:hover \.lv2__actions,[^{]*\.lv2__row:focus-within \.lv2__actions[^{]*\{[^}]*pointer-events:\s*auto/);
    });

    /* A transformed ancestor would become the containing block of the row menu, which is fixed to the viewport. */
    it('the actions are not transformed', () => {
        expect(rule(wide, '.lv2__actions')).not.toMatch(/transform|filter/);
    });

    it('on a phone the row menu keeps its own place, where it is always shown', () => {
        expect(declared(rule(base, '.lv2__actions'), 'position')).toBe('');
        expect(mediaBlocks(list, '(max-width: 767px)')).not.toMatch(/\.lv2__actions\s*\{[^}]*position/);
    });
});
