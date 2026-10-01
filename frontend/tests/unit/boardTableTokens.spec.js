/* The Board and the Table, read from their stylesheets and templates: every size follows the look
   and the density, the classic look still computes the sizes it had, every control is a full
   target, and the Table's first columns stay in view when it scrolls sideways. */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { describe, expect, it } from 'vitest';
import { gridTracks } from '@/views/Projects/composables/viewColumns';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.resolve(HERE, '../../src');
const read = (rel) => fs.readFileSync(path.join(SRC, rel), 'utf8');
const withoutComments = (css) => css.replace(/\/\*[\s\S]*?\*\//g, '');
const styleOf = (rel) => withoutComments(rel.endsWith('.vue')
    ? [...read(rel).matchAll(/<style(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/style>/g)].map((m) => m[1]).join('\n')
    : read(rel)).replace(/@import[^;]+;/g, '');
const templateOf = (rel) => read(rel).slice(0, read(rel).indexOf('<script'));

const BOARD = 'views/Projects/Kanban/new-style.css';
const TABLE = 'views/Projects/TableView/style.css';
const CARD = 'views/Projects/Kanban/BoardViewDisplayCardComponent.vue';
const CARD_SUBTASKS = 'views/Projects/Kanban/BoardCardSubtasks.vue';
const CREATE = 'views/Projects/Kanban/BoardViewTaskCreate.vue';
const COLUMNS = 'views/Projects/Kanban/KanbanBoard.vue';
const BOARD_VIEW = 'views/Projects/Kanban/BoardView.vue';
const TABLE_VIEW = 'views/Projects/TableView/TableView.vue';
const TABLE_ROW = 'views/Projects/TableView/TableRow.vue';
const TABLE_GROUP = 'views/Projects/TableView/TableViewTable.vue';
const TABLE_SUBTASKS = 'views/Projects/TableView/TableSubtaskRows.vue';
const SHEETS = [BOARD, TABLE];
const COMPONENTS = [CARD, CARD_SUBTASKS, CREATE, COLUMNS, BOARD_VIEW, TABLE_VIEW, TABLE_ROW, TABLE_GROUP, TABLE_SUBTASKS];

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
const WIDE = '(min-width: 768px)';
const PHONE = '(max-width: 767px)';

/* What one selector ends up with inside a stylesheet: every rule that lists it, later ones winning. */
function declarations(css, selector) {
    const out = {};
    [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].forEach(([, selectors, body]) => {
        if (!selectors.split(',').map((s) => s.trim()).includes(selector)) return;
        body.split(';').map((d) => d.trim()).filter(Boolean).forEach((d) => {
            out[d.slice(0, d.indexOf(':')).trim()] = d.slice(d.indexOf(':') + 1).trim();
        });
    });
    return out;
}
const declared = (rel, selector, property) => declarations(withoutMedia(styleOf(rel)), selector)[property] || '';
const inMedia = (rel, query, selector, property) => declarations(mediaBlocks(styleOf(rel), query), selector)[property] || '';
const localTokens = (css, selector) => Object.fromEntries(Object.entries(declarations(css, selector)).filter(([name]) => name.startsWith('--')));

const tokens = withoutComments(read('assets/css/tokens.css'));
const block = (selector) => {
    const start = tokens.indexOf(`${selector} {`);
    return start === -1 ? '' : tokens.slice(start + selector.length + 2, tokens.indexOf('}', start));
};
const custom = (body) => Object.fromEntries([...body.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)].map((m) => [m[1], m[2].trim()]));

const base = custom(block(':root'));
const phoneAt = tokens.indexOf('@media (max-width: 767px) {\n    body {');
const phoneBody = custom(tokens.slice(phoneAt, tokens.indexOf('}', phoneAt)));
const compactAt = tokens.indexOf('[data-density="compact"]');
const LOOK = {
    dense: base,
    compact: { ...base, ...custom(tokens.slice(compactAt, tokens.indexOf('}', compactAt))) },
    classic: { ...base, ...custom(block(':root[data-variant="classic"]')) },
    a: { ...base, ...custom(block(':root[data-variant="a"]')) },
    c: { ...base, ...custom(block(':root[data-variant="c"]')) },
    phone: { ...base, ...phoneBody },
};
const LOOKS = ['dense', 'classic', 'a', 'c'];
const DESKTOP = [...LOOKS, 'compact'];
const UNSET_IN_CLASSIC = Object.keys(LOOK.classic).filter((name) => LOOK.classic[name] === 'initial');

const boardSheet = styleOf(BOARD);
const boardEnv = (look, extra = {}) => ({
    ...LOOK[look],
    ...localTokens(withoutMedia(boardSheet), '.kanban-board'),
    ...(look === 'compact' ? localTokens(mediaBlocks(boardSheet, WIDE), '[data-density="compact"] .kanban-board') : {}),
    ...(look === 'phone' ? localTokens(mediaBlocks(boardSheet, PHONE), '.kanban-board') : {}),
    ...extra,
});
const tableEnv = (look, extra = {}) => ({ ...LOOK[look], ...localTokens(withoutMedia(styleOf(TABLE)), '.tv2'), ...extra });

/* The font families stay as written: a size is what a look changes. */
const FAMILY = /var\((--font-(?:ui|mono))\)/g;
function resolve(value, env) {
    let out = value.replace(FAMILY, '<$1>');
    for (let pass = 0; pass < 60 && out.includes('var('); pass += 1) {
        out = out.replace(/var\(\s*(--[\w-]+)\s*(?:,\s*((?:[^()]|\([^()]*\))*))?\)/, (whole, name, fallback) => {
            if (env[name] !== undefined && env[name] !== 'initial') return env[name];
            if (fallback !== undefined) return fallback.trim();
            throw new Error(`${name} is not set and has no fallback in "${value}"`);
        }).replace(FAMILY, '<$1>');
    }
    return out.replace(/<(--font-(?:ui|mono))>/g, 'var($1)');
}
const number = (expression, value) => {
    const sum = expression.replace(/px/g, '');
    if (!sum.trim() || !/^[\d\s.+\-*/]+$/.test(sum)) throw new Error(`cannot compute "${expression}" in "${value}"`);
    return Math.round(Function(`return (${sum});`)() * 1000) / 1000;
};
/* Works out every calc(), min() and max(), with the brackets inside them, once the tokens are in. */
function computed(value, env) {
    let out = resolve(value, env);
    for (let pass = 0; pass < 60 && /\(/.test(out.replace(FAMILY, '')); pass += 1) {
        const before = out;
        out = out.replace(/(^|[\s(*/+,-])\(([^()]*)\)/, (whole, lead, inside) => `${lead}${number(inside, value)}px`);
        if (out !== before) continue;
        out = out.replace(/(min|max|calc)\(([^()]*)\)/, (whole, fn, inside) => {
            const parts = inside.split(',').map((part) => number(part, value));
            return `${fn === 'calc' ? parts[0] : Math[fn](...parts)}px`;
        });
        if (out === before) break;
    }
    return out;
}
/* The values of a shorthand: split on the spaces that are not inside a function. */
function parts(value) {
    const out = [''];
    let depth = 0;
    [...value].forEach((char) => {
        if (char === '(') depth += 1;
        if (char === ')') depth -= 1;
        if (char === ' ' && depth === 0) out.push('');
        else out[out.length - 1] += char;
    });
    return out.filter(Boolean);
}
const px = (value, env) => {
    const out = computed(value, env);
    if (!/^-?[\d.]+(px)?$/.test(out)) throw new Error(`"${value}" is not one length (got "${out}")`);
    return parseFloat(out);
};

const board = (selector, property, look, extra) => px(declared(BOARD, selector, property), boardEnv(look, extra));
const boardText = (selector, property, look) => computed(declared(BOARD, selector, property), boardEnv(look));
const boardOnPhone = (selector, property) => px(inMedia(BOARD, PHONE, selector, property) || declared(BOARD, selector, property), boardEnv('phone'));
const table = (selector, property, look, extra) => px(declared(TABLE, selector, property), tableEnv(look, extra));
const tableText = (selector, property, look) => computed(declared(TABLE, selector, property), tableEnv(look));

/* Drops var(...) and calc(...) with everything inside them, so what is left of a value is only what no token can reach. */
const outsideFunctions = (value) => {
    let out = '';
    let depth = 0;
    for (let i = 0; i < value.length; i += 1) {
        if (depth === 0 && /^(var|calc|min|max)\(/.test(value.slice(i))) {
            i = value.indexOf('(', i);
            depth = 1;
        } else if (depth > 0) {
            if (value[i] === '(') depth += 1;
            if (value[i] === ')') depth -= 1;
        } else {
            out += value[i];
        }
    }
    return out;
};
const everyDeclaration = (css) => [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].flatMap(([, selector, body]) => body.split(';')
    .map((d) => d.trim())
    .filter(Boolean)
    .map((d) => ({ selector: selector.trim(), property: d.slice(0, d.indexOf(':')).trim(), value: d.slice(d.indexOf(':') + 1).trim() })));

const classesOf = (rel) => {
    const template = templateOf(rel);
    const fixed = [...template.matchAll(/\bclass="([^"]*)"/g)].flatMap((m) => m[1].split(/\s+/));
    const bound = [...template.matchAll(/:class="([^"]*)"/g)].flatMap((m) => [...m[1].matchAll(/'([\w\s-]+)'/g)].flatMap((quoted) => quoted[1].split(/\s+/)));
    return [...fixed, ...bound].filter(Boolean);
};

describe('the converted files', () => {
    const HEX = /#[0-9a-fA-F]{3,8}\b(?![-\w])/g;
    const LEGACY = /^(bg-white|btn-white|black|blue|gray\d*|GunPowder|font-size-\d+|font-weight-\d+|border-radius-\d+-(px|per)|[pm][trblxy]?-{1,2}\d+px|m[trblxy]?-\d+)$/;

    it.each([...SHEETS, ...COMPONENTS])('%s names no hex colour', (rel) => {
        expect(withoutComments(read(rel)).replace(/href="#"/g, '').match(HEX) || []).toEqual([]);
    });

    it.each([...SHEETS, ...COMPONENTS])('%s paints with no rgb() colour', (rel) => {
        expect(styleOf(rel).match(/rgba?\([^)]*\)/g) || []).toEqual([]);
        expect(templateOf(rel).match(/rgba?\([^)]*\)/g) || []).toEqual([]);
    });

    it.each([...SHEETS, CREATE, BOARD_VIEW])('%s sets no font size a look cannot change', (rel) => {
        const fixed = everyDeclaration(styleOf(rel))
            .filter(({ property }) => property === 'font' || property === 'font-size')
            .filter(({ value }) => /\d(px|rem|em)\b/.test(outsideFunctions(value)))
            .map(({ selector, property, value }) => `${selector} { ${property}: ${value} }`);
        expect(fixed).toEqual([]);
    });

    it.each([...SHEETS, CREATE, BOARD_VIEW])('%s reads no token the classic look un-sets without a fallback', (rel) => {
        const css = styleOf(rel);
        expect(UNSET_IN_CLASSIC.length).toBeGreaterThan(15);
        expect(UNSET_IN_CLASSIC.filter((name) => new RegExp(`var\\(\\s*${name}\\s*\\)`).test(css))).toEqual([]);
    });

    it.each([...SHEETS, ...COMPONENTS])('%s never sets text in --ink-3', (rel) => {
        expect(styleOf(rel)).not.toMatch(/(^|[;{\s])color\s*:\s*var\(--ink-3\)/);
    });

    it.each(COMPONENTS)('%s carries no legacy size or colour class', (rel) => {
        expect(classesOf(rel).filter((name) => LEGACY.test(name))).toEqual([]);
    });

    it('the card, the column and the create form size nothing from an inline style', () => {
        [CARD, COLUMNS, CREATE, BOARD_VIEW].forEach((rel) => {
            expect(templateOf(rel).match(/style="[^"]*\d+px[^"]*"/g) || [], rel).toEqual([]);
        });
        expect(templateOf(CARD)).not.toMatch(/:style="`/);
        expect(templateOf(CREATE)).not.toMatch(/fontSize/);
    });

    it('the icons on a card are drawn in the text colour, so they read in either theme', () => {
        const card = templateOf(CARD);
        expect(card.match(/<img\b[^>]*>/g).every((img) => /inventoryIcon|deleteIcon/.test(img))).toBe(true);
        ['option-list__dots', 'card-icon--calendar', 'card-icon--subtasks', 'card-icon--comments'].forEach((icon) => {
            expect(card, icon).toMatch(new RegExp(`class="ah-mask-icon[^"]*\\b${icon}"[^>]*:style="maskOf\\(`));
        });
        expect(templateOf(COLUMNS)).toMatch(/class="ah-mask-icon add-task-icon" :style="maskOf\(plusIcon\)"/);
        expect(declared(BOARD, '.kanban-board', 'color-scheme')).toBe('var(--scheme)');
    });
});

describe('the board reads the tokens', () => {
    it.each([
        ['.kanban-board', '--kb-card-pad-y', 'var(--card-pad-y, 10px)'],
        ['.kanban-board', '--kb-card-pad-x', 'var(--card-pad-x, 12px)'],
        ['.kanban-board', '--kb-gap', 'var(--gap-row, 7px)'],
        ['.kanban-board', '--kb-foot-gap', 'var(--gap-row, 10px)'],
        ['.kanban-board', '--kb-title-size', 'var(--fs-md, 13px)'],
        ['.kanban-board', '--kb-title-line', 'calc(var(--kb-title-size) * var(--lh-snug, 1.35))'],
        ['.kanban-board', 'gap', 'var(--gap-stack, 12px)'],
        ['.kanban-board', 'padding', 'var(--page-pad-y, 16px) var(--page-pad-x, 20px)'],
        ['.kanban-board .kanban-column', 'gap', 'var(--sp-3)'],
        ['.kanban-board .kanban-cards', 'gap', 'var(--sp-3)'],
        ['.kanban-board .column-head', 'min-height', 'var(--hit-min)'],
        ['.kanban-board .column-head', 'gap', 'var(--gap-row, 7px)'],
        ['.kanban-board .column-title', 'font-size', 'var(--fs-md, 12.5px)'],
        ['.kanban-board .column-title', 'font-weight', 'var(--fw-title, 600)'],
        ['.kanban-board .task-count', 'font', '600 var(--fs-xs, 10.5px)/1 var(--font-mono)'],
        ['.kanban-board .column-empty', 'font', 'var(--text-small)'],
        ['.kanban-board .column-empty', 'border-radius', 'var(--r-lg, 10px)'],
        ['.kanban-board .kanban-card', 'padding', 'var(--kb-card-pad-y) var(--kb-card-pad-x)'],
        ['.kanban-board .kanban-card', 'border-radius', 'var(--r-lg, 10px)'],
        ['.kanban-board .kanban-card', 'box-shadow', 'var(--shadow-card)'],
        ['.kanban-board .kanban-card', 'font-size', 'var(--fs-sm, 12.5px)'],
        ['.kanban-board .kanban-card .card-title', 'font', 'var(--fw-strong, 500) var(--kb-title-size)/var(--kb-title-line) var(--font-ui)'],
        ['.kanban-board .card-key', 'font', '600 var(--fs-2xs, 9.5px)/1 var(--font-mono)'],
        ['.kanban-board .card-foot', 'min-height', 'var(--hit-min)'],
        ['.kanban-board .card-foot', 'margin-top', 'var(--kb-foot-gap)'],
        ['.kanban-board .card-foot', 'gap', 'var(--gap-row, 5px)'],
        ['.kanban-board .card-meta', 'margin-top', 'var(--kb-gap)'],
        ['.kanban-board .card-fields', 'margin', 'var(--kb-gap) 0 0'],
        ['.kanban-board .card-chip', 'font', 'var(--fw-strong, 600) var(--chip-font)/1 var(--font-ui)'],
        ['.kanban-board .card-chip', 'border-width', 'var(--kb-chip-inset) 0'],
        ['.kanban-board .add-task-section', 'border-radius', 'var(--r-lg, 10px)'],
        ['.kanban-board .more-count', 'font-size', 'var(--fs-sm, 12px)'],
        ['.kanban-board .card-progress', 'background', 'var(--track)'],
        ['.kanban-board-skeleton', 'gap', 'var(--gap-stack, 12px)'],
        ['.kanban-card-skeleton', 'border-radius', 'var(--r-lg, 10px)'],
    ])('%s { %s } is %s', (selector, property, expected) => {
        expect(declared(BOARD, selector, property)).toBe(expected);
    });

    it('the create form and the bar above the board read them too', () => {
        expect(declared(CREATE, '.board-create', 'padding')).toBe('var(--card-pad-y, 15px) var(--card-pad-x, 15px)');
        expect(declared(CREATE, '.board-create__sprint', 'font-size')).toBe('var(--fs-md, 13px)');
        expect(declared(CREATE, '.board-create__error', 'font-size')).toBe('var(--fs-xs, 11px)');
        expect(declared(BOARD_VIEW, '.board-card-fields', 'padding')).toBe('var(--sp-2) var(--page-pad-x, 20px) 0');
        expect(declared(BOARD_VIEW, '.board-card-fields', 'gap')).toBe('var(--sp-3)');
    });

    it('the avatar on a card is the look\'s avatar', () => {
        expect(templateOf(CARD)).toMatch(/<Assignee[\s\S]{0,400}imageWidth="var\(--avatar-size\)"/);
        expect(templateOf(CREATE)).toMatch(/<Assignee[\s\S]{0,600}imageWidth="var\(--avatar-size\)"/);
        expect(declared(BOARD, '.kanban-board .card-assignee .add__user', 'min-width')).toBe('0');
    });
});

const titleLine = (look) => px('var(--kb-title-line)', boardEnv(look));
const cardPadY = (look) => px('var(--kb-card-pad-y)', boardEnv(look));
/* The card's border, its padding, the title and the meta row with the gap above it. */
const cardHeight = (look, lines) => Math.round((2 + 2 * cardPadY(look) + lines * titleLine(look) + board('.kanban-board .card-foot', 'margin-top', look) + board('.kanban-board .card-foot', 'min-height', look)) * 100) / 100;
const chipDrawn = (look, selector = '.kanban-board .card-chip') => board(selector, 'min-height', look) - 2 * px(parts(declared(BOARD, selector, 'border-width'))[0], boardEnv(look));

describe('a board card in each look', () => {
    it.each([
        ['dense', '10px 12px', 6, '500 13px/16.25px var(--font-ui)'],
        ['compact', '6px 8px', 6, '500 12px/15px var(--font-ui)'],
        ['classic', '10px 12px', 10, '500 13px/17.55px var(--font-ui)'],
        ['a', '14px 16px', 12, '600 13px/16.9px var(--font-ui)'],
        ['c', '18px 20px', 16, '600 14px/19.6px var(--font-ui)'],
    ])('%s: padding %s, radius %spx, title %s', (look, padding, radius, title) => {
        expect(boardText('.kanban-board .kanban-card', 'padding', look)).toBe(padding);
        expect(board('.kanban-board .kanban-card', 'border-radius', look)).toBe(radius);
        expect(boardText('.kanban-board .kanban-card .card-title', 'font', look)).toBe(title);
    });

    it('holds a title of two lines and one meta row', () => {
        expect(declared(BOARD, '.kanban-board .kanban-card .card-title', '-webkit-line-clamp')).toBe('2');
        expect(cardHeight('dense', 1)).toBe(66.25);
        expect(cardHeight('dense', 2)).toBe(82.5);
    });

    it('is tighter in the dense look than it was, and compact tightens it again', () => {
        const before = 92.1;
        expect(cardHeight('dense', 2)).toBeLessThan(before);
        expect(cardHeight('compact', 2)).toBe(70);
        expect(cardHeight('compact', 2)).toBeLessThan(cardHeight('dense', 2));
        expect(cardHeight('classic', 2)).toBe(91.1);
        expect(Math.abs(cardHeight('classic', 2) - before)).toBeLessThanOrEqual(1);
    });

    it('grows with the roomier looks', () => {
        expect(cardHeight('a', 2)).toBeGreaterThan(cardHeight('dense', 2));
        expect(cardHeight('c', 2)).toBeGreaterThan(cardHeight('a', 2));
    });

    it.each([
        ['dense', 10, 6, 24],
        ['compact', 10, 6, 24],
        ['classic', 12, 8, 24],
        ['a', 16, 8, 24],
        ['c', 20, 12, 24],
    ])('%s: columns %spx apart, cards %spx apart, a %spx column header', (look, gutter, between, head) => {
        expect(board('.kanban-board', 'gap', look)).toBe(gutter);
        expect(board('.kanban-board .kanban-cards', 'gap', look)).toBe(between);
        expect(board('.kanban-board .column-head', 'min-height', look)).toBe(head);
    });

    it.each([
        ['dense', 20, '500 11px/1 var(--font-ui)', 22],
        ['compact', 18, '500 10.5px/1 var(--font-ui)', 20],
        ['classic', 22, '600 11.5px/1 var(--font-ui)', 24],
        ['a', 22, '600 11.5px/1 var(--font-ui)', 24],
        ['c', 24, '600 12px/1 var(--font-ui)', 28],
    ])('%s: chips are drawn %spx tall in %s, beside a %spx avatar', (look, chip, font, avatar) => {
        expect(chipDrawn(look)).toBe(chip);
        expect(chipDrawn(look)).toBe(px('var(--chip-h)', LOOK[look]));
        expect(boardText('.kanban-board .card-chip', 'font', look)).toBe(font);
        expect(px('var(--avatar-size)', LOOK[look])).toBe(avatar);
    });

    it('the due date, the priority and the subtask count are that chip', () => {
        const card = templateOf(CARD);
        expect(card).toMatch(/class="calendar-trigger calendar-trigger--button card-chip"/);
        expect(card).toMatch(/<span v-else class="card-chip" :title="dueDateFull">/);
        expect(card).toMatch(/class="card-chip card-subtasks-toggle"/);
        const chip = withoutMedia(boardSheet).match(/([^{}]+)\{[^{}]*border-width:\s*var\(--kb-chip-inset\) 0;[^{}]*font: var\(--fw-strong, 600\) var\(--chip-font\)/)[1];
        expect(chip.split(',').map((s) => s.trim())).toEqual(['.kanban-board .card-chip', '.kanban-board .priority__compo .priority__component > :first-child']);
    });

    it('the count in a column header is a chip too', () => {
        DESKTOP.forEach((look) => expect(chipDrawn(look, '.kanban-board .task-count'), look).toBe(px('var(--chip-h)', LOOK[look])));
    });

    it('a phone keeps the comfortable card whatever the view\'s density', () => {
        expect(mediaBlocks(boardSheet, PHONE)).not.toMatch(/data-density/);
        expect(mediaBlocks(boardSheet, WIDE)).toMatch(/\[data-density="compact"\] \.kanban-board\s*\{/);
        expect(withoutMedia(boardSheet)).not.toMatch(/data-density/);
        expect(tokens).toMatch(/@media \(min-width: 768px\) \{\s*\[data-density="compact"\] \{/);
    });

    it('the board puts the view\'s density on its root and shows the control beside the field chooser', () => {
        const view = read(BOARD_VIEW);
        expect(view).toMatch(/<div v-else class="board-view" :data-density="density">/);
        expect(view).toMatch(/<ViewColumnChooser[\s\S]*?\/>\s*<ViewDensityControl :model-value="density" @update:model-value="setDensity" \/>/);
        expect(view).toMatch(/const \{ density, setDensity \} = useViewSettings\(\);/);
    });

    it('a card in a full column keeps its height', () => {
        expect(declared(BOARD, '.kanban-board .kanban-card', 'flex-shrink')).toBe('0');
    });
});

/* axe's target-size rule (WCAG 2.5.8), which the e2e accessibility suite runs: a control is at
   least 24 by 24 px, or its centre is at least 12px from the nearest edge of every other control. */
describe('the board controls keep a full target', () => {
    const FLOOR = 24;
    const BOTH = [
        ['the card menu', '.kanban-card .option-list__trigger', 'width', 'height'],
        ['the card checkbox', '.kanban-card-multi-select', 'width', 'height'],
        ['a column\'s count', '.kanban-board .task-count', 'min-width', 'min-height'],
        ['a column\'s add button', '.kanban-board .add-task-btn', 'width', 'height'],
        ['a chip that is a control', '.kanban-board .card-chip', 'min-width', 'min-height'],
        ['the subtask count', '.kanban-board .card-subtasks-toggle', 'min-width', 'min-height'],
        ['the comment count', '.kanban-board .board-task-comment-count', 'min-width', 'min-height'],
        ['the assignee', '.kanban-board .card-assignee .assignee__row-btn', 'min-width', 'min-height'],
        ['the empty assignee', '.kanban-board .card-assignee .assignee__add-btn', 'min-width', 'min-height'],
        ['a subtask\'s disclosure', '.kanban-board .card-subtask__disclose', 'width', 'height'],
        ['a subtask\'s name', '.kanban-board .card-subtask__name', 'min-width', 'min-height'],
        ['a subtask\'s add button', '.kanban-board .card-subtask__add', 'width', 'height'],
    ];

    it.each(DESKTOP)('--hit-min is the floor in %s, and no density lowers it', (look) => {
        expect(px('var(--hit-min)', LOOK[look])).toBeGreaterThanOrEqual(FLOOR);
    });

    it.each(BOTH)('%s is 24px or more each way in every look, and 40px on a phone', (_, selector, wide, tall) => {
        [wide, tall].forEach((side) => {
            expect(declared(BOARD, selector, side), `${selector} { ${side} }`).toContain('var(--hit-min)');
            DESKTOP.forEach((look) => expect(board(selector, side, look), `${look} ${side}`).toBeGreaterThanOrEqual(FLOOR));
            expect(boardOnPhone(selector, side), `phone ${side}`).toBeGreaterThanOrEqual(40);
        });
    });

    it('the rename field, Load more and the create form\'s close button are as tall as the floor', () => {
        expect(declared(BOARD, '.kanban-board .kanban-card .card-rename', 'min-height')).toBe('var(--hit-min)');
        expect(declared(BOARD, '.kanban-board .more-count', 'min-height')).toBe('var(--hit-min)');
        ['width', 'height'].forEach((side) => expect(declared(CREATE, '.board-create__close', side)).toBe('var(--hit-min)'));
    });

    it('the comment count and the subtask count beside it are both full targets', () => {
        const card = templateOf(CARD);
        expect(card).toMatch(/class="card-chip card-subtasks-toggle"[\s\S]*?<\/button>\s*<button\s+type="button"\s+class="board-task-comment-count"/);
        expect(declared(BOARD, '.kanban-board .board-task-comment-count', 'display')).toBe('inline-flex');
    });

    it('the meta row is as tall as its controls, so none of them overlaps the title', () => {
        DESKTOP.forEach((look) => expect(board('.kanban-board .card-foot', 'min-height', look)).toBe(px('var(--hit-min)', LOOK[look])));
        expect(boardOnPhone('.kanban-board .card-foot', 'min-height')).toBe(40);
    });

    it('the menu is centred on the title\'s first line and ends on the card\'s content edge', () => {
        expect(declared(BOARD, '.kanban-card .option-list', 'top')).toBe('calc((var(--kb-title-line) - var(--hit-min)) / 2)');
        expect(board('.kanban-card .option-list', 'top', 'dense')).toBe(-3.875);
        expect(board('.kanban-card .option-list', 'right', 'dense')).toBe(-2);
        expect(Math.abs(board('.kanban-card .option-list', 'top', 'dense'))).toBeLessThanOrEqual(cardPadY('dense'));
    });

    it('on a phone the title row is as tall as the checkbox and the menu in it, and the meta row folds', () => {
        const phone = mediaBlocks(boardSheet, PHONE);
        expect(declarations(phone, '.kanban-board .card-title-row')['min-height']).toBe('var(--hit-min)');
        expect(declarations(phone, '.kanban-card .option-list').top).toBe('0');
        expect(declarations(phone, '.kanban-card-multi-select')['margin-top']).toBe('0');
        expect(declarations(phone, '.kanban-board .card-foot')['flex-wrap']).toBe('wrap');
    });
});

describe('the subtasks inside a board card keep room for the name', () => {
    const column = (look) => (look === 'phone'
        ? Number(inMedia(BOARD, PHONE, '.kanban-board .kanban-column', 'width').match(/min\((\d+)px/)[1])
        : board('.kanban-board .kanban-column', 'width', look));
    const sidePadding = (look) => (look === 'phone'
        ? px(inMedia(BOARD, PHONE, '.kanban-board .kanban-card', 'padding'), boardEnv('phone'))
        : px('var(--kb-card-pad-x)', boardEnv(look)));
    const part = (selector, property, look, extra) => board(selector, property, look, extra);
    const room = (look, extra = {}) => {
        const inner = column(look) - 2 - 2 * sidePadding(look);
        const gap = part('.kanban-board .card-subtask__row', 'gap', look, extra);
        const slot = part('.kanban-board .card-subtask__disclose', 'width', look, extra);
        const dot = part('.kanban-board .card-subtask__dot', 'width', look, extra);
        const add = part('.kanban-board .card-subtask__add', 'width', look, extra);
        const indent = part('.kanban-board .card-subtask__row', 'padding-left', look, { ...extra, '--card-depth': '1' });
        return { levelTwo: inner - slot - dot - add - 3 * gap, levelThree: inner - indent - slot - dot - 2 * gap };
    };

    it('the card is 262px wide, and 236px at most on a phone', () => {
        expect(column('dense')).toBe(262);
        expect(column('phone')).toBe(236);
    });

    it.each(DESKTOP)('%s: 100px or more on both nested levels of a 262px card', (look) => {
        expect(room(look).levelTwo).toBeGreaterThanOrEqual(100);
        expect(room(look).levelThree).toBeGreaterThanOrEqual(100);
    });

    it.each(DESKTOP)('%s: still 100px or more with 40px targets', (look) => {
        const touch = room(look, { '--hit-min': '40px' });
        expect(touch.levelTwo).toBeGreaterThanOrEqual(100);
        expect(touch.levelThree).toBeGreaterThanOrEqual(100);
    });

    it('on a phone, with its narrower card and 40px targets, the row closes its gaps and keeps 100px or more', () => {
        expect(px('var(--hit-min)', boardEnv('phone'))).toBe(40);
        expect(declared(BOARD, '.kanban-board .card-subtask__row', 'gap')).toBe('var(--kb-sub-gap, var(--sp-2))');
        expect(part('.kanban-board .card-subtask__row', 'gap', 'phone')).toBeLessThan(part('.kanban-board .card-subtask__row', 'gap', 'dense'));
        expect(room('phone').levelTwo).toBe(118);
        expect(room('phone').levelThree).toBe(144);
    });
});

const NAME_TRACK = Number(gridTracks('table', []).match(/minmax\((\d+)px/)[1]);
const rowPad = (look) => (look === 'classic'
    ? px(declarations(withoutMedia(styleOf(TABLE)), ':root[data-variant="classic"] .tv2__row')['padding-top'], tableEnv('classic'))
    : px(parts(declared(TABLE, '.tv2__row', 'padding'))[0], tableEnv(look)));
/* A row holds 24px controls, so its content is as tall as the taller of them and its own floor. */
const rowHeight = (look) => 2 * rowPad(look) + Math.max(table('.tv2__row', 'min-height', look), table('.tv2__disclose', 'height', look));
const headHeight = (look) => 2 * px(parts(declared(TABLE, '.tv2__head', 'padding'))[0], tableEnv(look)) + table('.tv2__sort', 'min-height', look);

describe('the table reads the tokens', () => {
    it.each([
        ['.tv2', '--tv2-pad-x', 'var(--cell-pad-x, 14px)'],
        ['.tv2', '--tv2-gutter', 'var(--page-pad-x, 20px)'],
        ['.tv2__bar', 'padding', 'var(--page-pad-y, 14px) var(--tv2-gutter) 0'],
        ['.tv2__add', 'height', 'max(var(--control-h, 32px), var(--hit-min))'],
        ['.tv2__add', 'font', '400 var(--fs-sm, 12.5px)/1 var(--font-ui)'],
        ['.tv2__scroll', 'padding', 'var(--page-pad-y, 14px) var(--tv2-gutter) var(--sp-9)'],
        ['.tv2__scroll', 'font-size', 'var(--row-font)'],
        ['.tv2__grid', 'border-radius', 'var(--r-card)'],
        ['.tv2__head', 'padding', 'var(--cell-pad-y) var(--tv2-pad-x)'],
        ['.tv2__head', 'gap', 'var(--tv2-gap)'],
        ['.tv2__head', 'font', '600 var(--fs-xs, 10.5px)/1.2 var(--font-mono)'],
        ['.tv2__row', 'min-height', 'calc(var(--row-h) - 2 * var(--cell-pad-y))'],
        ['.tv2__row', 'padding', 'var(--cell-pad-y) var(--tv2-pad-x)'],
        ['.tv2__row', 'gap', 'var(--tv2-gap)'],
        ['.tv2__name', 'font', 'var(--fw-strong, 600) var(--row-font)/var(--lh-snug, 1.3) var(--font-ui)'],
        ['.tv2__sprint-head', 'min-height', 'var(--row-h)'],
        ['.tv2__sprint-head', 'padding', '0 var(--tv2-pad-x)'],
        ['.tv2__sprint-name', 'font', 'var(--text-h3)'],
        ['.tv2__group-cell', 'padding', 'calc(var(--cell-pad-y) - 1px) var(--tv2-pad-x)'],
        ['.tv2__group-cell', 'font-weight', 'var(--fw-title, 600)'],
        ['.tv2__gen', 'min-height', 'var(--hit-min)'],
        ['.tv2__gen', 'font', '400 calc(var(--row-font) - .5px)/1 var(--font-ui)'],
        ['.tv2__summary', 'line-height', 'var(--lh-body, 1.4)'],
        ['.tv2__skeleton', 'height', 'var(--row-h)'],
    ])('%s { %s } is %s', (selector, property, expected) => {
        expect(declared(TABLE, selector, property)).toBe(expected);
    });

    it('never branches on the density: the tokens carry it', () => {
        expect(styleOf(TABLE)).not.toMatch(/data-density/);
    });
});

describe('a table row in each look', () => {
    it.each([
        ['dense', 32, 32, '500 13px/1.25 var(--font-ui)'],
        ['compact', 28, 28, '500 12px/1.25 var(--font-ui)'],
        ['a', 40, 40, '600 13px/1.3 var(--font-ui)'],
        ['c', 48, 48, '600 14px/1.4 var(--font-ui)'],
    ])('%s: a %spx row under a %spx header, the name in %s', (look, row, head, name) => {
        expect(rowHeight(look)).toBe(row);
        expect(rowHeight(look)).toBe(px('var(--row-h)', LOOK[look]));
        expect(headHeight(look)).toBe(head);
        expect(tableText('.tv2__name', 'font', look)).toBe(name);
    });

    it('classic keeps the 44px row, the 42px header and the 12.5px name it had', () => {
        expect(styleOf(TABLE)).toMatch(/:root\[data-variant="classic"\] \.tv2__row\s*\{\s*padding-top: calc\(var\(--cell-pad-y\) \+ 1px\); padding-bottom: calc\(var\(--cell-pad-y\) \+ 1px\);\s*\}/);
        expect(rowPad('classic')).toBe(10);
        expect(rowHeight('classic')).toBe(44);
        expect(headHeight('classic')).toBe(42);
        expect(tableText('.tv2__name', 'font', 'classic')).toBe('600 12.5px/1.3 var(--font-ui)');
        expect(parts(tableText('.tv2__row', 'padding', 'classic'))[1]).toBe('14px');
        expect(tableText('.tv2__scroll', 'padding', 'classic')).toBe('14px 20px 24px');
    });

    it.each([
        ['dense', '4px 10px', 32, '12px 16px 20px'],
        ['compact', '2px 10px', 28, '12px 16px 20px'],
        ['a', '8px 12px', 40, '20px 20px 24px'],
        ['c', '12px 16px', 48, '24px 28px 32px'],
    ])('%s: cells padded %s, a %spx sprint heading, the page inset %s', (look, cell, sprint, inset) => {
        expect(tableText('.tv2__row', 'padding', look)).toBe(cell);
        expect(tableText('.tv2__head', 'padding', look)).toBe(cell);
        expect(table('.tv2__sprint-head', 'min-height', look)).toBe(sprint);
        expect(tableText('.tv2__scroll', 'padding', look)).toBe(inset);
    });

    it('a group row is a little shorter than a task row', () => {
        const group = (look) => table('.tv2__group-cell', 'min-height', look) + 2 * px(parts(declared(TABLE, '.tv2__group-cell', 'padding'))[0], tableEnv(look));
        expect(group('dense')).toBe(30);
        expect(group('compact')).toBe(26);
        expect(group('dense')).toBeLessThan(rowHeight('dense'));
    });
});

describe('every chip in a table row follows the density', () => {
    const statusDrawn = (look) => table('.tv2 button.lv2__status-chip', 'height', look) - 2 * px(parts(declared(TABLE, '.tv2 button.lv2__status-chip', 'border-width'))[0], tableEnv(look));

    it.each([
        ['dense', 20, '600 11px/1 var(--font-ui)'],
        ['compact', 18, '600 10.5px/1 var(--font-ui)'],
        ['classic', 22, '600 11.5px/1 var(--font-ui)'],
        ['a', 22, '600 11.5px/1 var(--font-ui)'],
        ['c', 24, '600 12px/1 var(--font-ui)'],
    ])('%s: the status chip is drawn %spx tall in %s, like the priority chip beside it', (look, height, font) => {
        expect(statusDrawn(look)).toBe(height);
        expect(px(declared('assets/css/tokens.css', '.ah-chip', 'height'), LOOK[look])).toBe(height);
        expect(computed(declared('assets/css/tokens.css', '.ah-chip', 'font'), LOOK[look])).toBe(font);
    });

    it('the status chip keeps the chip type: the table no longer hands it the row\'s', () => {
        const chip = { ...declarations(withoutMedia(styleOf(TABLE)), '.tv2 .lv2__status-chip'), ...declarations(withoutMedia(styleOf(TABLE)), '.tv2 button.lv2__status-chip') };
        expect(chip.font).toBeUndefined();
        expect(chip['font-size']).toBeUndefined();
        expect(chip['min-height']).toBeUndefined();
        expect(chip['line-height']).toBe('var(--chip-h)');
        expect(read('views/Projects/ListView/ListStatusCircle.vue')).toMatch(/class="ah-chip ah-status-ink lv2__status-chip"/);
    });

    it('as a button it is still a full target: the extra height is a transparent border the colour stops at', () => {
        DESKTOP.forEach((look) => expect(table('.tv2 button.lv2__status-chip', 'height', look), look).toBeGreaterThanOrEqual(24));
        expect(table('.tv2 button.lv2__status-chip', 'height', 'phone')).toBe(40);
        expect(declared(TABLE, '.tv2 button.lv2__status-chip', 'border')).toBe('solid transparent');
        expect(declared(TABLE, '.tv2 button.lv2__status-chip', 'background-clip')).toBe('padding-box !important');
    });

    it('the area chip is as tall as the others', () => {
        expect(declared(TABLE, '.tv2 .tv2__area', 'line-height')).toBe('var(--chip-h)');
    });
});

describe('the table controls keep a full target', () => {
    const FLOOR = 24;

    it.each([
        ['a row\'s disclosure', '.tv2__disclose', ['width', 'height']],
        ['a task name', '.tv2__name', ['min-height']],
        ['a borrowed List cell button', '.tv2 .lv2__cell-btn', ['min-width', 'min-height']],
        ['a column\'s sort', '.tv2__sort', ['min-height']],
        ['Generate', '.tv2__gen', ['min-height']],
        ['a group\'s select-all', '.tv2__group-select', ['width', 'height']],
        ['New task', '.tv2__add', ['height']],
    ])('%s is 24px or more in every look, and 40px on a phone', (_, selector, sides) => {
        sides.forEach((side) => {
            DESKTOP.forEach((look) => expect(table(selector, side, look), `${look} ${side}`).toBeGreaterThanOrEqual(FLOOR));
            expect(table(selector, side, 'phone'), `phone ${side}`).toBeGreaterThanOrEqual(40);
        });
    });

    it('the row checkbox is drawn 15px and keeps its centre 12px or more from the disclosure beside it', () => {
        const box = px('var(--tv2-check)', tableEnv('dense'));
        expect(box).toBe(15);
        DESKTOP.forEach((look) => {
            expect(px('var(--tv2-select-w)', tableEnv(look)) - box / 2 + px('var(--tv2-gap)', tableEnv(look)), look).toBeGreaterThanOrEqual(FLOOR / 2);
        });
        expect(templateOf(TABLE_ROW)).toMatch(/class="tv2__c-select" data-col="select"[\s\S]{0,200}class="ah-check"/);
    });

    it('the group\'s select-all sits in a full-size label, on the x of the row checkboxes', () => {
        expect(templateOf(TABLE_GROUP)).toMatch(/<label v-if="canGroupSelect && groupTaskIds\.length" class="tv2__group-select" @click\.stop>\s*<input\s+type="checkbox"\s+class="ah-check"/);
        DESKTOP.forEach((look) => {
            const label = table('.tv2__group-select', 'width', look);
            const inset = px(parts(declared(TABLE, '.tv2__group-select', 'margin'))[3], tableEnv(look));
            expect(inset + (label - 15) / 2, look).toBe(0);
        });
        expect(declared(TABLE, '.tv2__group-cell', 'padding')).toContain('var(--tv2-pad-x)');
    });

    it('there is no column resize handle to size: a column\'s width comes from its track', () => {
        expect(styleOf(TABLE)).not.toMatch(/resiz/);
        [TABLE_VIEW, TABLE_ROW, TABLE_GROUP].forEach((rel) => expect(read(rel), rel).not.toMatch(/resiz/i));
    });
});

describe('the table\'s first columns', () => {
    const wide = mediaBlocks(styleOf(TABLE), WIDE);
    const stuck = (selector, property, look) => px(declarations(wide, selector)[property], tableEnv(look));

    it('the checkbox and the name are sticky from tablet width up', () => {
        expect(declarations(wide, '.tv2__c-select').position).toBe('sticky');
        expect(declarations(wide, '.tv2__c-name').position).toBe('sticky');
        expect(declared(TABLE, '.tv2__c-name', 'position')).toBe('');
        expect(mediaBlocks(styleOf(TABLE), PHONE)).not.toMatch(/tv2__c-/);
    });

    it('the header and every row carry them, nested rows included', () => {
        const head = templateOf(TABLE_VIEW);
        expect(head).toMatch(/<span role="columnheader" class="tv2__c-select"><\/span>\s*<span role="columnheader" class="tv2__head-name tv2__c-name"/);
        const row = templateOf(TABLE_ROW);
        expect(row).toMatch(/<span role="cell" class="tv2__c-select" data-col="select"/);
        expect(row).toMatch(/<span role="cell" class="tv2__name-cell tv2__c-name" data-col="name"/);
        expect(templateOf(TABLE_SUBTASKS)).toMatch(/<TableRow\b/);
    });

    it.each(DESKTOP)('%s: the checkbox reaches the scroller\'s edge and the name starts where it ends', (look) => {
        const gutter = px('var(--tv2-gutter)', tableEnv(look));
        const pad = px('var(--tv2-pad-x)', tableEnv(look));
        expect(stuck('.tv2__c-select', 'left', look)).toBe(-gutter);
        const margin = parts(declarations(wide, '.tv2__c-select').margin).map((part) => px(part, tableEnv(look)));
        const padding = parts(declarations(wide, '.tv2__c-select').padding).map((part) => px(part, tableEnv(look)));
        expect(margin).toEqual([0, -10, 0, -pad]);
        expect(padding).toEqual([0, 10, 0, pad]);
        const selectBox = pad + 28 + 10;
        expect(stuck('.tv2__c-name', 'left', look) - stuck('.tv2__c-select', 'left', look)).toBe(selectBox);
    });

    it('they are opaque in the row\'s own colour, hover and selection included', () => {
        expect(declarations(wide, '.tv2__c-select').background).toBe('linear-gradient(var(--tv2-row-tint), var(--tv2-row-tint)) var(--surface)');
        expect(declared(TABLE, '.tv2__row', '--tv2-row-tint')).toBe('transparent');
        expect(declared(TABLE, '.tv2__row:hover', '--tv2-row-tint')).toBe('var(--surface-hover)');
        expect(declared(TABLE, '.tv2__row.is-selected', '--tv2-row-tint')).toBe('var(--brand-tint)');
        expect(declarations(wide, '.tv2__head > .tv2__c-select').background).toBe('var(--surface-2)');
        expect(declarations(wide, '.tv2__c-select')['align-self']).toBe('stretch');
    });

    it('a sprint\'s and a group\'s label stay on the left with them', () => {
        expect(declarations(wide, '.tv2__sprint-label').position).toBe('sticky');
        expect(declarations(wide, '.tv2__group-cell').position).toBe('sticky');
        expect(templateOf(TABLE_VIEW)).toMatch(/class="tv2__sprint-head"[\s\S]{0,260}<span class="tv2__sprint-label">\s*<span class="tv2__caret"/);
        expect(declared(TABLE, '.tv2__group', 'background')).toBe('var(--surface-2)');
    });

    it('nothing clips the grid, so the header still sticks and its menus still open over the rows', () => {
        expect(declared(TABLE, '.tv2__grid', 'overflow')).toBe('');
        expect(declared(TABLE, '.tv2__head', 'position')).toBe('sticky');
    });

    it('the header sticks to the scroller\'s top edge: its offset takes the top inset back', () => {
        expect(declared(TABLE, '.tv2__head', 'top')).toBe('calc(0px - var(--page-pad-y, 14px))');
        DESKTOP.forEach((look) => {
            expect(table('.tv2__head', 'top', look) + px(parts(declared(TABLE, '.tv2__scroll', 'padding'))[0], tableEnv(look)), look).toBe(0);
        });
        const phone = mediaBlocks(styleOf(TABLE), PHONE);
        expect(px(declarations(phone, '.tv2__head').top, tableEnv('phone')) + px(parts(declarations(phone, '.tv2__scroll').padding)[0], tableEnv('phone'))).toBe(0);
    });
});

describe('the table\'s name column', () => {
    const before = (look, depth, extra) => table('.tv2__name-cell', 'padding-left', look, { ...extra, '--tv2-depth': String(depth) })
        + table('.tv2__disclose', 'width', look, extra) + table('.tv2__name-cell', 'gap', look, extra);

    it('is 220px at least, whatever else is shown', () => {
        expect(NAME_TRACK).toBe(220);
        expect(gridTracks('table', [])).toBe('28px minmax(220px, 1fr)');
        expect(px('var(--tv2-select-w)', tableEnv('dense'))).toBe(28);
    });

    it.each(DESKTOP)('%s: the deepest row still keeps the name its floor', (look) => {
        expect(NAME_TRACK - before(look, 2)).toBeGreaterThanOrEqual(px('var(--row-name-min)', LOOK[look]));
    });

    it('with 40px targets the deepest name keeps 100px or more', () => {
        expect(NAME_TRACK - before('phone', 2)).toBeGreaterThanOrEqual(100);
        expect(NAME_TRACK - before('c', 2, { '--hit-min': '40px' })).toBeGreaterThanOrEqual(100);
    });

    it.each(DESKTOP)('%s: every row keeps the disclosure\'s 24px, so names line up level by level', (look) => {
        expect(table('.tv2__disclose', 'width', look)).toBe(24);
        expect(declared(TABLE, '.tv2__disclose--none', 'visibility')).toBe('hidden');
        const step = px('var(--row-indent)', LOOK[look]);
        expect(before(look, 1) - before(look, 0)).toBe(step);
        expect(before(look, 2) - before(look, 1)).toBe(step);
        expect(templateOf(TABLE_ROW)).toMatch(/<span v-else class="tv2__disclose tv2__disclose--none" aria-hidden="true"><\/span>/);
    });
});
