/* The List with many columns shown, read from its stylesheet and its column model: the task name
   keeps a minimum width on every level, the columns scroll sideways instead of crushing it, and
   the checkbox and the name stay in view while they do. */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import path from 'path';
import { MAX_DEPTH } from '@taskTreeRules';
import { columnCatalogue, fieldColumnId, gridTracks, listGridVars, resolveColumns } from '@/views/Projects/composables/viewColumns';

const SRC = path.resolve(__dirname, '../../src');
const read = (file) => readFileSync(path.join(SRC, file), 'utf8');
const css = (file) => read(file).replace(/\/\*[\s\S]*?\*\//g, '');

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
const customProperties = (body) => Object.fromEntries([...body.matchAll(/(--[\w-]+)\s*:\s*([^;]+)/g)].map(([, name, value]) => [name, value.trim()]));

const base = withoutMedia(list);
const wide = mediaBlocks(list, '(min-width: 768px)');
const phone = mediaBlocks(list, '(max-width: 767px)');

const ROOT = { ...customProperties(rule(tokens, ':root')), ...customProperties(rule(base, '.lv2')) };
const LOOKS = {
    comfortable: {},
    compact: customProperties(rule(mediaBlocks(tokens, '(min-width: 768px)'), '[data-density="compact"]')),
    'variant a': customProperties(rule(tokens, ':root[data-variant="a"]')),
    'variant b (dense)': customProperties(rule(tokens, ':root[data-variant="b"]')),
    'variant c': customProperties(rule(tokens, ':root[data-variant="c"]'))
};

function px(value, local = {}) {
    const variables = { ...ROOT, ...local };
    let resolved = value;
    for (let pass = 0; pass < 8 && /var\(/.test(resolved); pass += 1) {
        resolved = resolved.replace(/var\((--[\w-]+)(?:,\s*([^()]+))?\)/g, (whole, name, fallback) => variables[name] ?? fallback ?? whole);
    }
    const sum = resolved.replace(/calc/g, '').replace(/px/g, '');
    if (!sum.trim() || !/^[\d\s.+\-*/()]+$/.test(sum)) throw new Error(`cannot resolve "${value}" (got "${resolved}")`);
    return Function(`return (${sum});`)();
}

const field = (n) => ({ _id: `f${n}`, fieldTitle: `Field ${n}` });
const FIELDS = [1, 2, 3, 4].map(field);
const catalogue = columnCatalogue('list', { fields: FIELDS });
const shownFields = { shown: Object.fromEntries(FIELDS.map((item) => [fieldColumnId(item._id), true])) };
const thirteen = resolveColumns('list', catalogue, shownFields).filter((column) => column.visible);

const titleMin = (look = {}) => px('var(--lv2-title-min)', look);
const gap = () => px(declared(rule(base, '.lv2__row'), 'gap'));

describe('the Task column keeps a minimum width', () => {
    it('the thirteen-column List of the report is the case under test', () => {
        expect(thirteen.map((column) => column.id)).toEqual(['tags', 'assignee', 'due', 'priority', 'estimate', 'risk', 'doneBy', 'cf:f1', 'cf:f2', 'cf:f3', 'cf:f4']);
        expect(gridTracks('list', thirteen).split(/\s+(?![^(]*\))/)).toHaveLength(13);
    });

    it('its track has a floor instead of shrinking to nothing', () => {
        expect(gridTracks('list', thirteen).split(' ').slice(0, 2)).toEqual(['28px', 'var(--lv2-title-track)']);
        expect(ROOT['--lv2-title-track']).toBe('minmax(var(--lv2-title-min), 1fr)');
        const phoneTracks = declared(rule(phone, '.lv2'), '--lv2-cols');
        const fallbacks = [...list.matchAll(/--lv2-cols:([^;]+);/g)].map(([, value]) => value.trim()).filter((value) => value !== phoneTracks);
        expect(fallbacks.length).toBeGreaterThan(0);
        fallbacks.forEach((value) => expect(value.split(' ')[1]).toBe('var(--lv2-title-track)'));
    });

    it('the floor is about 240px at the comfortable size', () => {
        expect(titleMin()).toBeGreaterThanOrEqual(220);
        expect(titleMin()).toBeLessThanOrEqual(260);
    });

    it('the floor comes from a token beside the density tokens, and compact has its own', () => {
        expect(ROOT['--row-name-min']).toMatch(/^\d+px$/);
        expect(ROOT['--lv2-title-min']).toContain('var(--row-name-min)');
        expect(LOOKS.compact['--row-name-min']).toMatch(/^\d+px$/);
        expect(titleMin(LOOKS.compact)).toBeLessThan(titleMin());
        expect(titleMin(LOOKS['variant b (dense)'])).not.toBe(titleMin(LOOKS['variant c']));
    });

    it('the Tags column keeps the width of its header while it shares the free room', () => {
        expect(catalogue.find((column) => column.id === 'tags').track).toBe('minmax(56px, .45fr)');
    });

    it('on a phone the name has the whole first line and no track of its own', () => {
        expect(phone).toMatch(/\.lv2__row \.lv2__c-title, \.lv2__cols \.lv2__c-title \{ grid-column: 2 \/ -1; \}/);
        expect(declared(rule(phone, '.lv2'), '--lv2-cols')).not.toContain('--lv2-title-track');
    });
});

describe('a level-three row keeps the minimum', () => {
    const beforeName = (look) => px(declared(rule(base, '.lv2__title--sub'), 'padding-left'), { ...look, '--lv2-depth': String(MAX_DEPTH) })
        + px(declared(rule(base, '.lv2__disclose'), 'width'), look)
        + px(declared(rule(base, '.lv2__status'), 'width'), look)
        + 2 * px(declared(rule(base, '.lv2__title'), 'gap'), look);

    it('subtask rows lay out on the same tracks as their task', () => {
        expect(declared(rule(base, '.lv2__row'), 'grid-template-columns')).toBe('var(--lv2-cols)');
        expect(rule(base, '.lv2__row.is-sub')).not.toContain('grid-template-columns');
        expect(read('views/Projects/ListView/ListRow.vue')).not.toMatch(/--lv2-cols/);
    });

    it.each(Object.keys(LOOKS))('in the %s look the name of a sub-subtask still has the token\'s width after its indent', (look) => {
        const local = LOOKS[look];
        expect(titleMin(local) - beforeName(local)).toBeGreaterThanOrEqual(px('var(--row-name-min)', local));
        expect(px('var(--row-name-min)', local)).toBeGreaterThanOrEqual(96);
    });
});

describe('the List scrolls sideways when its columns do not fit', () => {
    const CONTAINER = 1132;
    const vars = listGridVars(thirteen.map((column) => (column.id === 'tags' ? { ...column, track: '56px' } : column)));
    const contentMin = (look = {}) => px(declared(rule(wide, '.lv2'), '--lv2-min-w') || ROOT['--lv2-min-w'], { ...look, '--lv2-fixed-w': vars['--lv2-fixed-w'] });

    it('the view hands the stylesheet the tracks and the room the fixed ones need', () => {
        expect(vars['--lv2-cols']).toBe(gridTracks('list', thirteen).replace('minmax(56px, .45fr)', '56px'));
        const fixed = 28 + 56 + 56 + 64 + 72 + 48 + 80 + 88 + 4 * 112;
        expect(vars['--lv2-fixed-w']).toBe(`${fixed + 12 * gap()}px`);
        expect(read('views/Projects/ListView/ListView.vue')).toMatch(/listGridVars\(gridColumns\.value\)/);
    });

    it('a flexible track counts for its floor', () => {
        const [tags] = thirteen;
        expect(listGridVars([tags])['--lv2-fixed-w']).toBe(`${28 + 56 + 2 * gap()}px`);
        expect(listGridVars([])['--lv2-fixed-w']).toBe(`${28 + gap()}px`);
    });

    it('the header and the groups are at least as wide as their tracks, the name\'s floor and their own padding', () => {
        const minWidth = ROOT['--lv2-min-w'];
        expect(minWidth).toContain('var(--lv2-fixed-w');
        expect(minWidth).toContain('var(--lv2-title-min)');
        expect(declared(rule(wide, '.lv2__cols, .lv2__sprint'), 'min-width')).toBe('var(--lv2-min-w)');
        const headPad = declared(rule(base, '.lv2__cols'), 'padding').match(/calc\([^)]*\)\)|[\d.]+px/g);
        expect(contentMin() - px(vars['--lv2-fixed-w']) - titleMin()).toBe(px(headPad[1]) + px(headPad[3]));
    });

    it('thirteen columns in a 1132px container overflow it, and the scroller scrolls both ways', () => {
        const room = CONTAINER - 2 * px('var(--page-pad-x, 20px)');
        expect(contentMin()).toBeGreaterThan(room);
        expect(contentMin(LOOKS.compact)).toBeGreaterThan(room);
        expect(declared(rule(base, '.lv2__scroll'), 'overflow')).toBe('auto');
    });

    it('the default columns still fit a 1132px container without scrolling', () => {
        const defaults = resolveColumns('list', columnCatalogue('list'), null).filter((column) => column.visible);
        const fits = px(ROOT['--lv2-min-w'], { '--lv2-fixed-w': listGridVars(defaults)['--lv2-fixed-w'] });
        expect(fits).toBeLessThanOrEqual(CONTAINER - 2 * px('var(--page-pad-x, 20px)'));
    });

    it('header and rows scroll in the one scroller, so they stay aligned', () => {
        const view = read('views/Projects/ListView/ListView.vue');
        expect(view).toMatch(/<div class="lv2__scroll ah-scroll" id="list_scroll" role="table">\s*<div class="lv2__cols" role="row">/);
        expect(declared(rule(base, '.lv2__cols'), 'grid-template-columns')).toBe(declared(rule(base, '.lv2__row'), 'grid-template-columns'));
    });

    it('nothing between a row and the scroller is a scroll container of its own', () => {
        expect(declared(rule(base, '.lv2__group'), 'overflow')).toBe('clip');
        expect(rule(base, '.lv2__sprint')).not.toContain('overflow');
        expect(rule(base, '.lv2__cols')).not.toMatch(/overflow\s*:/);
    });

    it('a phone keeps its folded rows and gets no minimum width', () => {
        expect(base).not.toMatch(/\.lv2__cols, \.lv2__sprint\s*\{[^}]*min-width/);
        expect(phone).not.toContain('--lv2-min-w');
    });
});

describe('the checkbox and the task name stay in view', () => {
    const select = rule(wide, '.lv2__c-select');
    const title = rule(wide, '.lv2__c-title');

    it('both stick to the left of the scroller, from tablet width up', () => {
        expect(declared(rule(wide, '.lv2__c-select, .lv2__c-title'), 'position')).toBe('sticky');
        expect(declared(select, 'left')).toBe('0');
        expect(base).not.toMatch(/\.lv2__c-select[^{]*\{[^}]*position:\s*sticky/);
        expect(phone).not.toMatch(/position:\s*sticky/);
    });

    it('the name sticks right after the checkbox, in the header and in the rows alike', () => {
        const selectWidth = px(declared(select, 'padding-left')) + 28 + gap();
        expect(px(declared(title, 'left'))).toBe(selectWidth);
        expect(px(declared(select, 'margin-right'))).toBe(-gap());
        expect(px(declared(select, 'padding-right'))).toBe(gap());
        expect(wide).not.toMatch(/\.lv2__cols[^{]*\.lv2__c-(select|title)[^{]*\{[^}]*left\s*:/);
    });

    it('they are opaque, in the colour of what they sit on, so the columns pass under them', () => {
        expect(declared(rule(wide, '.lv2__c-select, .lv2__c-title'), 'background')).toBe('linear-gradient(var(--lv2-row-tint), var(--lv2-row-tint)) var(--surface)');
        expect(declared(rule(wide, '.lv2__cols > .lv2__c-select, .lv2__cols > .lv2__c-title'), 'background')).toBe('var(--canvas)');
    });

    it('the row whose menu is open rises above the rows after it and the header', () => {
        const resting = Number(declared(rule(wide, '.lv2__c-select, .lv2__c-title'), 'z-index'));
        const lifted = Number(declared(rule(wide, '.lv2__c-title:has(.lv2__menu)'), 'z-index'));
        expect(resting).toBeGreaterThanOrEqual(1);
        expect(lifted).toBeGreaterThan(Number(declared(rule(base, '.lv2__cols'), 'z-index')));
        expect(lifted).toBeGreaterThan(resting);
    });

    it('the hover actions still anchor to the name\'s cell', () => {
        expect(declared(rule(wide, '.lv2__actions'), 'position')).toBe('absolute');
        expect(rule(wide, '.lv2__c-select, .lv2__c-title')).not.toMatch(/transform|filter|contain/);
    });
});

describe('a group header spans the group and keeps its label in view', () => {
    const group = read('views/Projects/ListView/ListGroup.vue');

    it('the bar is as wide as the rows under it', () => {
        expect(rule(base, '.lv2__group-bar')).not.toMatch(/(^|[;\s])(max-)?width\s*:/);
        expect(declared(rule(base, '.lv2__group-head'), 'flex')).toBe('1');
    });

    it('the select-all and the label stick to the left with the rows\' checkbox and name', () => {
        expect(group).toMatch(/<span class="lv2__group-label">\s*<span class="lv2__caret"[\s\S]*?<span class="lv2__group-meta">\{\{ headMeta \}\}<\/span>[\s\S]*?<\/span>\s*<span v-if="wip"/);
        expect(declared(rule(wide, '.lv2__group-select, .lv2__group-label'), 'position')).toBe('sticky');
        expect(declared(rule(wide, '.lv2__group-select'), 'left')).toBe('0');
        expect(px(declared(rule(wide, '.lv2__group-label'), 'left'))).toBeGreaterThan(0);
    });
});
