/* The project page's chrome (filter toolbar, tree, tree panel, saved-view bar) and the shared tab,
   card and text primitives, read from the stylesheets: every size follows the look, the classic
   look still computes the sizes it had, and compact is tighter than the default. */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { describe, expect, it } from 'vitest';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.resolve(HERE, '../../src');
const read = (rel) => fs.readFileSync(path.join(SRC, rel), 'utf8');
const withoutComments = (css) => css.replace(/\/\*[\s\S]*?\*\//g, '');
const styleOf = (rel) => withoutComments(rel.endsWith('.vue')
    ? [...read(rel).matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)].map((m) => m[1]).join('\n')
    : read(rel));
const templateOf = (rel) => read(rel).slice(0, read(rel).indexOf('<script'));

const TOOLBAR = 'views/Projects/components/ProjectFiltersToolbar.vue';
const TOOLBAR_CSS = 'views/Projects/components/project-filters.css';
const HEADER_CSS = 'views/Projects/components/project-header.css';
const DONE_BY_CSS = 'components/molecules/Provenance/style.css';
const TREE = 'components/molecules/ProjectTree/ProjectTree.vue';
const TREE_MENU = 'components/molecules/ProjectTree/FolderRowMenu.vue';
const TREE_RENAME = 'components/molecules/ProjectTree/FolderRenameInput.vue';
const TREE_PANEL = 'views/Projects/components/ProjectTreePanel.vue';
const SAVED_VIEW_BAR = 'views/Projects/components/SavedViewBar.vue';
const PAGE = 'views/Projects/Projects.vue';
const CONVERTED = [TOOLBAR_CSS, TREE, TREE_MENU, TREE_RENAME, TREE_PANEL, SAVED_VIEW_BAR];

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
const onPhone = (rel, selector, property) => declarations(mediaBlocks(styleOf(rel), '(max-width: 767px)'), selector)[property] || '';

const tokens = withoutComments(read('assets/css/tokens.css'));
const block = (selector) => {
    const start = tokens.indexOf(`${selector} {`);
    return start === -1 ? '' : tokens.slice(start + selector.length + 2, tokens.indexOf('}', start));
};
const custom = (body) => Object.fromEntries([...body.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)].map((m) => [m[1], m[2].trim()]));

const base = custom(block(':root'));
const phoneAt = tokens.indexOf('@media (max-width: 767px) {\n    body {');
const phoneBody = tokens.slice(phoneAt, tokens.indexOf('}', phoneAt));
const compactAt = tokens.indexOf('[data-density="compact"]');
const ENV = {
    dense: base,
    compact: { ...base, ...custom(tokens.slice(compactAt, tokens.indexOf('}', compactAt))) },
    classic: { ...base, ...custom(block(':root[data-variant="classic"]')) },
    a: { ...base, ...custom(block(':root[data-variant="a"]')) },
    c: { ...base, ...custom(block(':root[data-variant="c"]')) },
    phone: { ...base, ...custom(phoneBody) },
};
const UNSET_IN_CLASSIC = Object.keys(ENV.classic).filter((name) => ENV.classic[name] === 'initial');

/* The font families stay as written: a size is what a look changes. */
const FAMILY = /var\((--font-(?:ui|mono))\)/g;
function resolve(value, env) {
    let out = value.replace(FAMILY, '<$1>');
    for (let pass = 0; pass < 24 && out.includes('var('); pass += 1) {
        out = out.replace(/var\(\s*(--[\w-]+)\s*(?:,\s*((?:[^()]|\([^()]*\))*))?\)/, (whole, name, fallback) => {
            if (env[name] !== undefined && env[name] !== 'initial') return env[name];
            if (fallback !== undefined) return fallback.trim();
            throw new Error(`${name} is not set and has no fallback in "${value}"`);
        }).replace(FAMILY, '<$1>');
    }
    return out.replace(/<(--font-(?:ui|mono))>/g, 'var($1)');
}
/* Works out every min(), max() and calc() once the tokens are in, so a value reads as the browser computes it. */
function computed(value, env) {
    let out = resolve(value, env);
    const number = (expression) => {
        const sum = expression.replace(/px/g, '');
        if (!sum.trim() || !/^[\d\s.+\-*/]+$/.test(sum)) throw new Error(`cannot compute "${expression}" in "${value}"`);
        return Function(`return (${sum});`)();
    };
    for (let pass = 0; pass < 24 && /(min|max|calc)\(/.test(out); pass += 1) {
        out = out.replace(/(min|max|calc)\(([^()]*)\)/, (whole, fn, inside) => {
            const parts = inside.split(',').map(number);
            return `${fn === 'calc' ? parts[0] : Math[fn](...parts)}px`;
        });
    }
    return out;
}
const px = (value, env) => {
    const out = computed(value, env);
    if (!/^-?[\d.]+(px)?$/.test(out)) throw new Error(`"${value}" is not one length (got "${out}")`);
    return parseFloat(out);
};
const size = (rel, selector, property, look) => px(declared(rel, selector, property), ENV[look]);
const text = (rel, selector, property, look) => computed(declared(rel, selector, property), ENV[look]);

/* The toolbar sets tokens of its own on its root; a rule inside it reads them. */
const toolbarTokens = () => Object.fromEntries(Object.entries(declarations(withoutMedia(styleOf(TOOLBAR_CSS)), '.pft')).filter(([name]) => name.startsWith('--')));
const inToolbar = (look) => ({ ...ENV[look], ...toolbarTokens() });
const barSize = (selector, property, look, rel = TOOLBAR_CSS) => px(declared(rel, selector, property), inToolbar(look));
const barText = (selector, property, look, rel = TOOLBAR_CSS) => computed(declared(rel, selector, property), inToolbar(look));

describe('the converted stylesheets', () => {
    const HEX = /#[0-9a-fA-F]{3,8}\b(?![-\w])/g;

    it.each([...CONVERTED, TOOLBAR])('%s names no hex colour', (rel) => {
        const source = rel.endsWith('.vue') && rel !== TOOLBAR ? styleOf(rel) : withoutComments(read(rel)).replace(/href="#"/g, '');
        expect(source.match(HEX) || []).toEqual([]);
    });

    it.each(CONVERTED)('%s sets no font size a look cannot change', (rel) => {
        const fixed = [...styleOf(rel).matchAll(/([^{}]+)\{([^{}]*)\}/g)].flatMap(([, selector, body]) => body.split(';')
            .map((d) => d.trim())
            .filter((d) => /^font(-size)?\s*:/.test(d))
            .filter((d) => /\d(px|rem|em)\b/.test(d.replace(/var\([^()]*(\([^()]*\))?[^()]*\)/g, '')))
            .map((d) => `${selector.trim()} { ${d} }`));
        expect(fixed).toEqual([]);
    });

    it.each([...CONVERTED, HEADER_CSS, DONE_BY_CSS])('%s reads no token the classic look un-sets without a fallback', (rel) => {
        const css = styleOf(rel);
        expect(UNSET_IN_CLASSIC.length).toBeGreaterThan(15);
        expect(UNSET_IN_CLASSIC.filter((name) => new RegExp(`var\\(\\s*${name}\\s*\\)`).test(css))).toEqual([]);
    });

    it.each(CONVERTED)('%s never sets text in --ink-3', (rel) => {
        expect(styleOf(rel)).not.toMatch(/(^|[;{\s])color\s*:\s*var\(--ink-3\)/);
    });
});

describe('the filter toolbar markup', () => {
    const template = templateOf(TOOLBAR);
    const classes = [...template.matchAll(/\bclass="([^"]*)"/g)].flatMap((m) => m[1].split(/\s+/)).concat([...template.matchAll(/'([\w-]+)'\s*:/g)].map((m) => m[1]));
    const LEGACY = /^(bg-white|btn-white|black|gray\d*|GunPowder|form-control|border-groupBy|ai_button|assignee-user|assignee-status|font-size-\d+|font-weight-\d+|border-radius-\d+-px|w-545|[pm][trblxy]?-\d+px|m[trbl]-\d+)$/;

    it('carries no legacy size or colour class', () => {
        expect(classes.length).toBeGreaterThan(30);
        expect(classes.filter((name) => LEGACY.test(name))).toEqual([]);
    });

    it('keeps the hooks other code looks for', () => {
        ['task-assigneesearch-groupbywrapper', 'task-filtersearchassignee-wrapper', 'task-filter-assignee', 'manage__filter-users', 'current__dropdown', 'pft__input', 'pft__pill', 'pft__icon-btn', 'pft__search-scope'].forEach((hook) => {
            expect(classes, hook).toContain(hook);
        });
        expect(template).toContain('id="projectviewfiltersearch_driver"');
    });

    it('opens its Search in and More menus as themed panels, like Group by', () => {
        ['searchfilterdropdownoptions_driver', 'group_by', 'more_features'].forEach((id) => {
            expect(template, id).toMatch(new RegExp(`<DropDown\\b[^>]*id="${id}"[^>]*\\bthemed\\b`));
        });
    });

    it('the page no longer sizes the toolbar from its own legacy rules', () => {
        const page = styleOf(PAGE);
        ['.task-filtersearchassignee-wrapper', '.manage__filter-users', '.current__dropdown', '.ai_button', '.main_ai_image', '.show-archived-active'].forEach((selector) => {
            expect(Object.keys(declarations(page, selector)), selector).toEqual([]);
        });
        expect(page).not.toMatch(/\.ai_button/);
    });
});

describe('the filter toolbar reads the tokens', () => {
    it.each([
        ['.pft', '--pft-h', 'min(var(--control-h-lg, 32px), var(--row-h))'],
        ['.pft', '--pft-h-boxed', 'min(var(--control-h-lg, 34px), var(--row-h))'],
        ['.pft', '--pft-fs', 'min(var(--fs-md, 12.5px), var(--row-font))'],
        ['.pft', 'padding', 'min(var(--sp-2), var(--cell-pad-y)) var(--page-pad-x, 20px)'],
        ['.pft', 'font', '400 var(--pft-fs)/var(--lh-body, 1.5) var(--font-ui)'],
        ['.pft .pft__ctl', 'height', 'var(--pft-h)'],
        ['.pft .pft__ctl', 'border-radius', 'var(--r-input)'],
        ['.pft .pft__input', 'height', 'var(--pft-h-boxed)'],
        ['.pft .pft__input', 'border-radius', 'var(--r-input)'],
        ['.pft .pft__icon-btn', 'width', 'var(--pft-h)'],
        ['.pft .pft__icon-btn', 'height', 'var(--pft-h)'],
        ['.pft .pft__seg', 'height', 'var(--pft-h-boxed)'],
        ['.pft .pft__pill', 'padding', '0 var(--sp-4)'],
        ['.pft__search-scope', 'width', 'var(--hit-min)'],
        ['.pft__search-scope', 'height', 'var(--hit-min)'],
        ['.pft__mode-chip', 'height', 'var(--pft-h)'],
        ['.pft .calendar-button', 'height', 'var(--pft-h)'],
    ])('%s { %s } is %s', (selector, property, expected) => {
        expect(declared(TOOLBAR_CSS, selector, property)).toBe(expected);
    });

    it.each(['.pft .pft__pill', '.pft .pft__seg-btn', '.pft .pft__input', '.pft .calendar-button', '.pft__mode-chip', '.pft__filters-btn'])('%s sets its type from the toolbar\'s type token', (selector) => {
        expect(declared(TOOLBAR_CSS, selector, 'font')).toMatch(/var\(--pft-fs\)/);
    });

    it('the Done by select is a toolbar control like the others, and a control on its own elsewhere', () => {
        expect(declared(DONE_BY_CSS, '.pv-filter__select', 'height')).toBe('var(--pft-h, var(--control-h-lg, 32px))');
        expect(declared(DONE_BY_CSS, '.pv-filter__select', 'border-radius')).toBe('var(--r-input)');
        expect(declared(DONE_BY_CSS, '.pv-filter__select', 'font')).toBe('var(--fw-strong, 500) var(--pft-fs, var(--fs-md, 12.5px))/1 var(--font-ui)');
        expect(px(declared(DONE_BY_CSS, '.pv-filter__select', 'height'), ENV.dense)).toBe(32);
    });

    it('paints from the colour tokens only', () => {
        const colours = [...styleOf(TOOLBAR_CSS).matchAll(/(?:^|[;{\s])(?:color|background|background-color|border(?:-color)?)\s*:\s*([^;}]+)/g)].map((m) => m[1].trim());
        expect(colours.length).toBeGreaterThan(20);
        expect(colours.filter((value) => /rgba?\(|#[0-9a-f]{3,8}\b/i.test(value.replace('rgba(0, 0, 0, .45)', '')))).toEqual([]);
    });
});

const BAR_CONTROLS = [
    ['.pft .pft__ctl', 'height'], ['.pft .pft__input', 'height'], ['.pft .pft__icon-btn', 'height'], ['.pft .pft__icon-btn', 'width'],
    ['.pft .pft__seg', 'height'], ['.pft__mode-chip', 'height'], ['.pft .calendar-button', 'height'],
];
const barRow = (look) => 2 * px(declared(TOOLBAR_CSS, '.pft', 'padding').split(/\s+(?=var\(--page-pad-x)/)[0], inToolbar(look)) + barSize('.pft .pft__ctl', 'height', look) + 1;

describe('the filter toolbar in the dense default at 1440px', () => {
    it.each(BAR_CONTROLS)('%s { %s } is the 32px control height', (selector, property) => {
        expect(barSize(selector, property, 'dense')).toBe(32);
        expect(px('var(--control-h-lg)', ENV.dense)).toBe(32);
    });

    it('the filter pill and the Done by select are 32px too', () => {
        expect(barSize('.pft .top-filter-section', 'height', 'dense') + 2).toBe(32);
        expect(barSize('.pv-filter__select', 'height', 'dense', DONE_BY_CSS)).toBe(32);
    });

    it('the row is no taller than the project header bar', () => {
        expect(barRow('dense')).toBeLessThanOrEqual(px('var(--toolbar-h)', ENV.dense));
        expect(barRow('dense')).toBe(41);
        expect(declared(TOOLBAR_CSS, '.pft .task-filtersearchassignee-wrapper', 'padding')).toBe('0 !important');
    });

    it('lines up with the header bar on the page padding', () => {
        expect(barText('.pft', 'padding', 'dense')).toBe('4px 16px');
        expect(computed(declared(HEADER_CSS, '.ph2__bar', 'padding'), ENV.dense)).toBe('0 16px');
    });

    it('sets its controls in the 13px row type', () => {
        expect(barText('.pft .pft__pill', 'font', 'dense')).toBe('500 13px/1 var(--font-ui)');
        expect(barText('.pft .pft__input', 'font', 'dense')).toBe('400 13px/1.4 var(--font-ui)');
        expect(barText('.pv-filter__select', 'font', 'dense', DONE_BY_CSS)).toBe('500 13px/1 var(--font-ui)');
    });
});

describe('the filter toolbar under a compact view', () => {
    it.each(BAR_CONTROLS)('%s { %s } comes down to the compact row', (selector, property) => {
        expect(barSize(selector, property, 'compact')).toBe(28);
        expect(barSize(selector, property, 'compact')).toBeLessThan(barSize(selector, property, 'dense'));
    });

    it('the row is tighter than the default and as tall as the view row above it', () => {
        expect(barText('.pft', 'padding', 'compact')).toBe('2px 16px');
        expect(barRow('compact')).toBeLessThan(barRow('dense'));
        expect(barRow('compact')).toBe(33);
    });

    it('the type and the Done by select follow', () => {
        expect(barText('.pft .pft__pill', 'font', 'compact')).toBe('500 12px/1 var(--font-ui)');
        expect(barSize('.pv-filter__select', 'height', 'compact', DONE_BY_CSS)).toBe(28);
        expect(barSize('.pft .top-filter-section', 'height', 'compact') + 2).toBe(28);
    });

    it('a segment is still a 24px target', () => {
        expect(barSize('.pft .pft__seg-btn', 'height', 'compact')).toBe(24);
    });
});

describe('the filter toolbar in the classic look', () => {
    it.each([
        ['.pft', 'padding', '6px 20px'],
        ['.pft', 'font', '400 12.5px/1.5 var(--font-ui)'],
        ['.pft .task-filtersearchassignee-wrapper', 'gap', '8px 10px'],
        ['.pft .task-filtersearch', 'gap', '8px'],
        ['.pft .task-filter-assignee', 'gap', '6px'],
        ['.pft .pft__ctl', 'height', '32px'],
        ['.pft .pft__ctl', 'border-radius', '8px'],
        ['.pft .pft__input', 'height', '34px'],
        ['.pft .pft__input', 'padding', '0 30px'],
        ['.pft .pft__input', 'font', '400 12.5px/1.5 var(--font-ui)'],
        ['.pft .pft__icon-btn', 'width', '32px'],
        ['.pft .pft__seg', 'height', '34px'],
        ['.pft .pft__seg-btn', 'height', '30px'],
        ['.pft .top-filter-section', 'height', '32px'],
        ['.pft .pft__pill', 'padding', '0 10px'],
        ['.pft .pft__pill', 'gap', '6px'],
        ['.pft .pft__pill', 'font', '400 12.5px/1 var(--font-ui)'],
        ['.pft .pft__seg-btn', 'font', '500 12.5px/1 var(--font-ui)'],
        ['.pft .pft__members', 'margin-left', '15px'],
        ['.pft__search-scope', 'width', '24px'],
        ['.pft__search-scope', 'border-radius', '6px'],
        ['.pft__mode-chip', 'height', '32px'],
        ['.pft .calendar-button', 'height', '32px'],
        ['.pft .monthly-calendar-view', 'font', '600 12.5px/32px var(--font-ui)'],
    ])('%s { %s } is still %s', (selector, property, former) => {
        expect(barText(selector, property, 'classic')).toBe(former);
    });

    it('keeps the inset the legacy wrapper added inside the bar, so the row is as tall as it was', () => {
        const css = styleOf(TOOLBAR_CSS);
        expect(css).toMatch(/:root\[data-variant="classic"\] \.pft:not\(\.pft--phone\) \.task-filtersearchassignee-wrapper\s*\{\s*padding:\s*14px 20px !important;?\s*\}/);
        expect(2 * (6 + 14) + barSize('.pft .pft__input', 'height', 'classic') + 1).toBe(75);
    });

    it('the Done by select is as it was', () => {
        expect(barText('.pv-filter__select', 'height', 'classic', DONE_BY_CSS)).toBe('32px');
        expect(barText('.pv-filter__select', 'padding', 'classic', DONE_BY_CSS)).toBe('0 28px 0 10px');
        expect(barText('.pv-filter__select', 'border-radius', 'classic', DONE_BY_CSS)).toBe('8px');
        expect(barText('.pv-filter__select', 'font', 'classic', DONE_BY_CSS)).toBe('500 12.5px/1 var(--font-ui)');
    });
});

describe('the filter toolbar on a phone', () => {
    const FLOOR = px('var(--hit-min)', ENV.phone);
    const phoneSize = (selector, property, rel = TOOLBAR_CSS) => px(onPhone(rel, selector, property), inToolbar('phone'));

    it('the floor is 40px and above the phone control height', () => {
        expect(FLOOR).toBe(40);
        expect(FLOOR).toBeGreaterThanOrEqual(px('var(--control-h-lg)', ENV.phone));
    });

    it.each(['.pft .pft__ctl', '.pft .pft__ai', '.pft .pft__mode-chip', '.pft .calendar-button', '.pft__search-toggle', '.pft .pft__input'])('%s is as tall as the floor', (selector) => {
        expect(phoneSize(selector, 'height')).toBe(FLOOR);
    });

    it('icon buttons are square at the floor and the filter pill no narrower', () => {
        expect(phoneSize('.pft .pft__icon-btn', 'width')).toBe(FLOOR);
        expect(phoneSize('.pft .top-filter-section', 'min-width')).toBe(FLOOR);
        expect(phoneSize('.pft .top-filter-section', 'height')).toBe(FLOOR);
    });

    it('the Filters button and the Done by select hold the floor', () => {
        expect(barSize('.pft__filters-btn', 'height', 'phone')).toBe(FLOOR);
        expect(phoneSize('.pv-filter__select', 'height', DONE_BY_CSS)).toBe(FLOOR);
    });
});

describe('the project tree reads the tokens', () => {
    it.each([
        [TREE, '.pt-row', 'min-height', 'max(var(--hit-min), calc(var(--row-h) - var(--sp-2)))'],
        [TREE, '.pt-row', 'border-radius', 'var(--r-md, 7px)'],
        [TREE, '.pt-row__link', 'padding', '0 var(--cell-pad-x, 9px)'],
        [TREE, '.pt-row__link', 'font', '400 var(--fs-md, 13px)/var(--lh-snug, 1.3) var(--font-ui)'],
        [TREE, '.pt-row--l2 .pt-row__link', 'font-size', 'var(--row-font)'],
        [TREE, '.pt-row__count', 'font', '400 var(--fs-xs, 11px)/1 var(--font-ui)'],
        [TREE, '.pt-row__chev', 'min-width', 'var(--hit-min)'],
        [TREE, '.pt-row__chev', 'min-height', 'var(--hit-min)'],
        [TREE_MENU, '.pt-row__more', 'min-width', 'var(--hit-min)'],
        [TREE_MENU, '.pt-row__more', 'min-height', 'var(--hit-min)'],
        [TREE_RENAME, '.pt-row__rename', 'font', '400 var(--row-font)/var(--lh-snug, 1.3) var(--font-ui)'],
        [TREE_PANEL, '.ptp', 'padding', 'var(--sp-5) var(--sp-3)'],
        [TREE_PANEL, '.ptp__title', 'font', '600 var(--fs-2xs, 10px)/var(--lh-tight, 1.2) var(--font-mono)'],
    ])('%s: %s { %s } is %s', (rel, selector, property, expected) => {
        expect(declared(rel, selector, property)).toBe(expected);
    });
});

describe('a tree row against a List row', () => {
    const row = (look) => size(TREE, '.pt-row', 'min-height', look);
    const listRow = (look) => px('var(--row-h)', ENV[look]);

    it.each(['dense', 'compact', 'classic', 'a', 'c'])('is no taller than a List row in %s', (look) => {
        expect(row(look)).toBeLessThanOrEqual(listRow(look));
    });

    it('is 28px in the dense default and 30px, as it was, in classic', () => {
        expect(row('dense')).toBe(28);
        expect(row('classic')).toBe(30);
    });

    it('tightens with a compact view, and still holds the 24px target', () => {
        expect(row('compact')).toBeLessThan(row('dense'));
        expect(row('compact')).toBe(24);
        expect(px(declared(TREE, '.pt-row--l2 .pt-row__link', 'font-size'), ENV.compact)).toBeLessThan(px(declared(TREE, '.pt-row--l2 .pt-row__link', 'font-size'), ENV.dense));
    });

    it('is as tall as the touch floor on a phone', () => {
        expect(row('phone')).toBe(40);
    });

    it('the link fills the row, so the whole height is the target', () => {
        expect(declared(TREE, '.pt-row__link', 'align-self')).toBe('stretch');
        expect(declared(TREE, '.pt-row__link', 'align-items')).toBe('center');
    });
});

describe('the project tree in the classic look', () => {
    it.each([
        [TREE, '.pt-row', 'gap', '4px'],
        [TREE, '.pt-row', 'padding', '0 6px 0 0'],
        [TREE, '.pt-row', 'border-radius', '7px'],
        [TREE, '.pt-row__link', 'gap', '8px'],
        [TREE, '.pt-row__link', 'padding', '0 9px'],
        [TREE, '.pt-row__link', 'font', '400 13px/1.3 var(--font-ui)'],
        [TREE, '.pt-row--l2 .pt-row__link', 'font-size', '12.5px'],
        [TREE, '.pt-row--l2 .pt-row__link', 'padding-left', '24px'],
        [TREE, '.pt-row__count', 'font', '400 11px/1 var(--font-ui)'],
        [TREE, '.pt-row__chev', 'min-width', '24px'],
        [TREE, '.pt-row__chev', 'border-radius', '4px'],
        [TREE_MENU, '.pt-row__more', 'min-width', '24px'],
        [TREE_MENU, '.pt-row__more', 'border-radius', '4px'],
        [TREE_MENU, '.pt-menu__card', 'border-radius', '12px'],
        [TREE_MENU, '.pt-menu__text', 'font-size', '13px'],
        [TREE_RENAME, '.pt-row__rename', 'border-radius', '6px'],
        [TREE_RENAME, '.pt-row__rename', 'font', '400 12.5px/1.3 var(--font-ui)'],
        [TREE_PANEL, '.ptp', 'padding', '12px 8px'],
        [TREE_PANEL, '.ptp', 'gap', '8px'],
        [TREE_PANEL, '.ptp__head', 'padding', '0 9px'],
        [TREE_PANEL, '.ptp__head', 'min-height', '24px'],
        [TREE_PANEL, '.ptp__title', 'font', '600 10px/1.2 var(--font-mono)'],
    ])('%s: %s { %s } is still %s', (rel, selector, property, former) => {
        expect(text(rel, selector, property, 'classic')).toBe(former);
    });

    it('steps a subfolder and its lists in by 14px a level, as before', () => {
        expect(size(TREE, '.pt-row--l3 .pt-row__link', 'padding-left', 'classic')).toBe(38);
        expect(size(TREE, '.pt-row--l4 .pt-row__link', 'padding-left', 'classic')).toBe(52);
        expect(size(TREE_RENAME, '.pt-row__rename', 'margin-left', 'classic')).toBe(16);
        expect(size(TREE_RENAME, '.pt-row--l3 .pt-row__rename', 'margin-left', 'classic')).toBe(30);
    });

    it('the rename field and the close button keep their sizes', () => {
        expect(size(TREE_RENAME, '.pt-row__rename', 'height', 'classic')).toBe(26 + 2);
        expect(size(TREE_PANEL, '.ptp__close', 'min-width', 'classic')).toBe(28);
        expect(size(TREE_PANEL, '.ptp__close', 'min-height', 'classic')).toBe(28);
    });
});

/* axe's target-size rule (WCAG 2.5.8), which the e2e accessibility suite runs: a control is at
   least 24 by 24 px, or its centre is at least 12px from the nearest edge of every other control. */
describe('the tree and toolbar controls keep a 24px target', () => {
    const FLOOR = 24;
    const DESKTOP = ['dense', 'compact', 'classic', 'a', 'c'];

    it.each(DESKTOP)('--hit-min is the floor in %s, and no density lowers it', (look) => {
        expect(px('var(--hit-min)', ENV[look])).toBeGreaterThanOrEqual(FLOOR);
    });

    it.each(DESKTOP)('a tree row, its caret and its menu button are full targets in %s', (look) => {
        expect(size(TREE, '.pt-row', 'min-height', look)).toBeGreaterThanOrEqual(FLOOR);
        ['min-width', 'min-height'].forEach((side) => {
            expect(size(TREE, '.pt-row__chev', side, look)).toBeGreaterThanOrEqual(FLOOR);
            expect(size(TREE_MENU, '.pt-row__more', side, look)).toBeGreaterThanOrEqual(FLOOR);
        });
    });

    it.each(DESKTOP)('the 18px star keeps its centre 12px or more from the controls beside it in %s', (look) => {
        const template = templateOf(TREE);
        expect(template).toMatch(/<FavouriteStar\b[^>]*class="pt-row__star"[^>]*:size="12"/s);
        const star = 12 + 2 * 3;
        expect(star / 2 + size(TREE, '.pt-row', 'gap', look)).toBeGreaterThanOrEqual(FLOOR / 2);
    });

    it.each(DESKTOP)('the rename field is a full target in %s and fits its row', (look) => {
        const field = size(TREE_RENAME, '.pt-row__rename', 'height', look);
        expect(field).toBeGreaterThanOrEqual(FLOOR);
        expect(field).toBeLessThanOrEqual(size(TREE, '.pt-row', 'min-height', look));
    });

    it.each(DESKTOP)('toolbar icon buttons, the search scope and the segments are full targets in %s', (look) => {
        expect(barSize('.pft .pft__icon-btn', 'width', look)).toBeGreaterThanOrEqual(FLOOR);
        expect(barSize('.pft .pft__icon-btn', 'height', look)).toBeGreaterThanOrEqual(FLOOR);
        expect(barSize('.pft__search-scope', 'width', look)).toBeGreaterThanOrEqual(FLOOR);
        expect(barSize('.pft__search-scope', 'height', look)).toBeGreaterThanOrEqual(FLOOR);
        expect(barSize('.pft .pft__seg-btn', 'height', look)).toBeGreaterThanOrEqual(FLOOR);
        expect(barSize('.pft__search-scope', 'height', look)).toBeLessThanOrEqual(barSize('.pft .pft__input', 'height', look));
    });

    it.each(DESKTOP)('the panel close button is a full target in %s', (look) => {
        expect(size(TREE_PANEL, '.ptp__close', 'min-width', look)).toBeGreaterThanOrEqual(FLOOR);
        expect(size(TREE_PANEL, '.ptp__close', 'min-height', look)).toBeGreaterThanOrEqual(FLOOR);
    });

    it('on a phone every one of them is at the 40px floor', () => {
        expect(size(TREE, '.pt-row__chev', 'min-height', 'phone')).toBe(40);
        expect(size(TREE_MENU, '.pt-row__more', 'min-height', 'phone')).toBe(40);
        expect(size(TREE_PANEL, '.ptp__close', 'min-height', 'phone')).toBe(40);
        expect(size(TOOLBAR_CSS, '.pft__search-scope', 'height', 'phone')).toBe(40);
    });
});

describe('the chrome follows the open view\'s density', () => {
    const page = read(PAGE);

    it('the page hands a List or Table view\'s density to the tree panel and the toolbar', () => {
        expect(page).toMatch(/const chromeDensity = computed\(\(\) => \(DENSITY_TABS\.includes\(activeTab\.value\) \? savedViews\.density\.value : undefined\)\);/);
        expect(page).toMatch(/const DENSITY_TABS = \['ProjectListView', 'TableView'\];/);
        expect(page).toMatch(/<ProjectTreePanel :density="chromeDensity" \/>/);
        expect(page).toMatch(/<ProjectFiltersToolbar\s+:data-density="chromeDensity"/);
    });

    it('the panel puts it on its root, where the compact tokens apply', () => {
        expect(templateOf(TREE_PANEL)).toMatch(/<aside id="project-tree-panel" class="ptp"[^>]*:data-density="density"/);
        expect(tokens).toMatch(/@media \(min-width: 768px\) \{\s*\[data-density="compact"\] \{/);
    });

    it('the toolbar has one root, so the attribute lands on it', () => {
        const template = templateOf(TOOLBAR).replace(/^<template>\s*/, '').replace(/\s*<\/template>\s*$/, '');
        expect(template.startsWith('<div class="task-assigneesearch-groupbywrapper pft"')).toBe(true);
        expect(template.endsWith('</div>')).toBe(true);
    });
});

describe('the saved-view bar and the header leftovers', () => {
    it.each([
        ['.svb', 'padding', 'var(--sp-2) var(--page-pad-x, 20px)', '6px 20px', '4px 16px'],
        ['.svb', 'gap', 'var(--sp-3) var(--sp-5)', '8px 12px', '6px 10px'],
        ['.svb__btn', 'height', 'var(--control-h, 28px)', '28px', '26px'],
        ['.svb__btn', 'padding', '0 var(--sp-4)', '0 10px', '0 8px'],
        ['.svb__btn', 'border-radius', 'var(--r-input)', '8px', '4px'],
        ['.svb__btn', 'font', 'var(--fw-strong, 500) var(--fs-sm, 12.5px)/1 var(--font-ui)', '500 12.5px/1 var(--font-ui)', '500 11.5px/1 var(--font-ui)'],
        ['.svb__input', 'height', 'var(--control-h, 28px)', '28px', '26px'],
        ['.svb__input', 'border-radius', 'var(--r-input)', '8px', '4px'],
    ])('%s { %s } is %s: %s in classic, %s in dense', (selector, property, source, classic, dense) => {
        expect(declared(SAVED_VIEW_BAR, selector, property)).toBe(source);
        expect(text(SAVED_VIEW_BAR, selector, property, 'classic')).toBe(classic);
        expect(text(SAVED_VIEW_BAR, selector, property, 'dense')).toBe(dense);
    });

    it('a saved-view button is no shorter on a phone than the phone control height', () => {
        expect(size(SAVED_VIEW_BAR, '.svb__btn', 'height', 'phone')).toBe(px('var(--control-h)', ENV.phone));
    });

    it('the watchers button is a small control like the buttons beside it', () => {
        ['width', 'height'].forEach((side) => {
            expect(declared(HEADER_CSS, '.ph2 .open__watcher', side)).toBe('var(--control-h, 30px)');
            expect(computed(declared(HEADER_CSS, '.ph2 .open__watcher', side), ENV.dense)).toBe('26px');
        });
        expect(computed(declared('assets/css/tokens.css', '.ah-btn--sm', 'height'), ENV.dense)).toBe('26px');
    });
});

describe('the shared tab, card and text primitives', () => {
    const TOKENS = 'assets/css/tokens.css';

    it.each([
        ['.ah-tabs', 'border-radius', 'var(--r-input)', '8px', '4px'],
        ['.ah-tab', 'height', 'var(--control-h, 26px)', '26px', '26px'],
        ['.ah-tab', 'padding', '0 var(--sp-4)', '0 10px', '0 8px'],
        ['.ah-tab', 'border-radius', 'var(--r-chip)', '6px', '3px'],
        ['.ah-tab', 'font', 'var(--fw-strong, 600) var(--fs-sm, 12px)/1 var(--font-ui)', '600 12px/1 var(--font-ui)', '500 11.5px/1 var(--font-ui)'],
        ['.ah-card__head', 'padding', 'var(--card-pad-y, 12px) var(--card-pad-x, 16px)', '12px 16px', '10px 12px'],
        ['.ah-card__head', 'gap', 'var(--sp-4)', '10px', '8px'],
        ['.ah-card__body', 'padding', 'var(--card-pad-y, 14px) var(--card-pad-x, 16px)', '14px 16px', '10px 12px'],
    ])('%s { %s } is %s: %s in classic, %s in dense', (selector, property, source, classic, dense) => {
        expect(declared(TOKENS, selector, property)).toBe(source);
        expect(text(TOKENS, selector, property, 'classic')).toBe(classic);
        expect(text(TOKENS, selector, property, 'dense')).toBe(dense);
    });

    it('a tab is no shorter on a phone, where it also keeps its 32px hit area', () => {
        expect(size(TOKENS, '.ah-tab', 'height', 'phone')).toBe(30);
        expect(tokens).toMatch(/\.ah-btn--sm::before, \.ah-tab::before,[^{]*\{[^}]*height:\s*max\(100%, 32px\)/);
    });

    it.each([
        ['--text-h1', '600 20px/1.2 var(--font-ui)', '600 17px/1.2 var(--font-ui)'],
        ['--text-h2', '600 19px/1.2 var(--font-ui)', '600 17px/1.2 var(--font-ui)'],
        ['--text-h3', '600 13.5px/1.3 var(--font-ui)', '600 13px/1.25 var(--font-ui)'],
        ['--text-body', '400 13px/1.5 var(--font-ui)', '400 13px/1.4 var(--font-ui)'],
        ['--text-small', '400 12.5px/1.5 var(--font-ui)', '400 11.5px/1.4 var(--font-ui)'],
        ['--text-label', '600 10.5px/1.2 var(--font-mono)', '600 10.5px/1.2 var(--font-mono)'],
        ['--text-data', '500 11.5px/1.2 var(--font-mono)', '500 11.5px/1.2 var(--font-mono)'],
    ])('%s is %s in classic and %s in dense', (name, classic, dense) => {
        expect(base[name]).toMatch(/var\(--fs-/);
        expect(resolve(base[name], ENV.classic)).toBe(classic);
        expect(resolve(base[name], ENV.dense)).toBe(dense);
    });

    it('the text tokens grow with the airy look', () => {
        expect(resolve(base['--text-small'], ENV.c)).toBe('400 13px/1.6 var(--font-ui)');
        expect(resolve(base['--text-h1'], ENV.c)).toBe('700 24px/1.25 var(--font-ui)');
    });

    it('no look restates a text token, so each follows the type scale it sets', () => {
        ['a', 'b', 'c', 'classic'].forEach((look) => {
            expect(Object.keys(custom(block(`:root[data-variant="${look}"]`))).filter((name) => name.startsWith('--text-')), look).toEqual([]);
        });
    });
});
