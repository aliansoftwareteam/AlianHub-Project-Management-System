import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { describe, expect, it } from 'vitest';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.resolve(HERE, '../../src');
const read = (rel) => fs.readFileSync(path.join(SRC, rel), 'utf8');

const HOME = 'components/molecules/Home/style.css';
const HOME_VIEW = 'views/Home/style.css';
const LIST = 'views/Projects/ListView/style.css';
const PANEL = 'components/organisms/TaskDetailOverlay/style.css';

const withoutComments = (css) => css.replace(/\/\*[\s\S]*?\*\//g, '');

const ruleBody = (css, selector) => {
    const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const match = new RegExp(`(^|[\\s,}])${escaped}\\s*\\{([^}]*)\\}`, 'm').exec(withoutComments(css));
    return match ? match[2] : '';
};

const declaration = (body, property) => {
    const match = new RegExp(`(^|[;\\s])${property}\\s*:\\s*([^;]+)`).exec(body);
    return match ? match[2].trim() : '';
};

/* Drops var(...) and calc(...) with everything inside them, so what is left of a value is
   only what no token can reach. */
const outsideFunctions = (value) => {
    let out = '';
    let depth = 0;
    for (let i = 0; i < value.length; i += 1) {
        if (depth === 0 && /^(var|calc)\(/.test(value.slice(i))) {
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

const declarations = (css) => [...withoutComments(css).matchAll(/([^{}]+)\{([^{}]*)\}/g)].flatMap(([, selector, body]) =>
    body.split(';').map((d) => d.trim()).filter(Boolean).map((d) => ({ selector: selector.trim(), property: d.slice(0, d.indexOf(':')).trim(), value: d.slice(d.indexOf(':') + 1).trim() })));

const fixedFontSizes = (css) => declarations(css)
    .filter(({ property }) => property === 'font' || property === 'font-size')
    .filter(({ value }) => /\d(px|rem|em)\b/.test(outsideFunctions(value)))
    .map(({ selector, property, value }) => `${selector} { ${property}: ${value} }`);

describe.each([HOME, LIST, PANEL])('%s', (rel) => {
    it('sets no font size a variant cannot change', () => {
        expect(fixedFontSizes(read(rel))).toEqual([]);
    });

    it('draws no shadow a variant cannot change', () => {
        const fixed = declarations(read(rel))
            .filter(({ property, value }) => property === 'box-shadow' && !value.startsWith('inset'))
            .filter(({ value }) => /\d/.test(outsideFunctions(value)))
            .map(({ selector, value }) => `${selector} { box-shadow: ${value} }`);
        expect(fixed).toEqual([]);
    });
});

describe.each([
    'components/molecules/Home/AssignedCommentsCard.vue',
    'components/molecules/Home/HomeCardsMenu.vue',
    'components/molecules/Home/HomeCatalogCard.vue',
    'components/molecules/Home/RecentsCard.vue',
    'components/molecules/Home/StandupCard.vue',
    'components/molecules/Home/WaitingOnYouCard.vue',
    'views/Projects/ListView/ListBulkBar.vue',
    'components/organisms/TaskDetailOverlay/TaskActionItems.vue',
    'components/organisms/TaskDetailOverlay/TaskAiRow.vue',
    'components/organisms/TaskDetailOverlay/TaskAskPanel.vue',
    'components/organisms/TaskDetailOverlay/TaskAssignmentSuggestion.vue',
    'components/organisms/TaskDetailOverlay/TaskRepeatControl.vue',
    'components/organisms/TaskDetailOverlay/TaskTimeSection.vue',
])('%s', (rel) => {
    it('sets no font size a variant cannot change', () => {
        const vue = read(rel);
        const style = vue.slice(vue.lastIndexOf('<style'), vue.lastIndexOf('</style>')).replace(/^<style[^>]*>/, '');
        expect(style).toMatch(/\{/);
        expect(fixedFontSizes(style)).toEqual([]);
    });
});

describe('the reference screens take their density, type and elevation from the variant tokens', () => {
    it.each([
        [HOME, '.ah-page__content', 'padding', ['--page-pad-y', '--page-pad-x']],
        [HOME, '.ah-page .ah-toolbar', 'padding', ['--page-pad-x']],
        [HOME, '.ah-page .ah-toolbar__title', 'font-size', ['--fs-lg']],
        [HOME, '.ah-page .ah-toolbar__title', 'font-weight', ['--fw-title']],
        [HOME, '.ah-tbtn', 'height', ['--control-h']],
        [HOME, '.ah-tbtn', 'border-radius', ['--r-md']],
        [HOME, '.hs-item', 'min-height', ['--control-h']],
        [HOME, '.hc-card', 'padding', ['--card-pad-y', '--card-pad-x']],
        [HOME, '.hc-card', 'gap', ['--gap-row']],
        [HOME, '.hc-card', 'border-radius', ['--r-lg']],
        [HOME, '.hc-card', 'box-shadow', ['--shadow-card']],
        [HOME, '.hc-card__title', 'font', ['--fw-title', '--fs-lg', '--lh-snug']],
        [HOME, '.hc-row', 'font', ['--fs-md', '--lh-snug']],
        [HOME, '.hc-add', 'height', ['--control-h-lg']],
        [HOME, '.hc-timer', 'border-radius', ['--r-lg']],
        [HOME, '.hc-setup', 'border-radius', ['--r-lg']],
        [HOME_VIEW, '.home__content', 'gap', ['--gap-stack']],
        [HOME_VIEW, '.home__grid', 'gap', ['--gap-stack']],
        [HOME_VIEW, '.home__side', 'gap', ['--gap-stack']],

        [LIST, '.lv2__scroll', 'padding', ['--page-pad-x']],
        [LIST, '.lv2__scroll', 'gap', ['--gap-stack']],
        [LIST, '.lv2__scroll', 'font-size', ['--row-font']],
        [LIST, '.lv2__cols', 'padding', ['--cell-pad-x']],
        [LIST, '.lv2__cols', 'font', ['--fs-xs']],
        [LIST, '.lv2__sprint-name', 'font', ['--fw-title', '--fs-xl']],
        [LIST, '.lv2__group-head', 'padding', ['--cell-pad-y', '--cell-pad-x']],
        [LIST, '.lv2__group-name', 'font-weight', ['--fw-strong']],
        [LIST, '.lv2__row', 'padding', ['--cell-pad-y', '--cell-pad-x']],
        [LIST, '.lv2__row', 'min-height', ['--row-h', '--cell-pad-y']],
        [LIST, '.lv2__row.is-sub', 'padding', ['--cell-pad-y', '--cell-pad-x']],
        [LIST, '.lv2__name', 'font', ['--fw-strong', '--row-font', '--lh-snug']],
        [LIST, '.lv2__rename', 'font', ['--fw-strong', '--row-font', '--lh-snug']],
        [LIST, '.lv2__add', 'padding', ['--cell-pad-y', '--cell-pad-x']],
        [LIST, '.lv2__add', 'font-size', ['--row-font']],
        [LIST, '.lv2__skeleton', 'height', ['--cell-pad-y']],
        [LIST, '.lv2__group', 'border-radius', ['--r-card']],
        [LIST, '.lv2__group', 'box-shadow', ['--shadow-surface']],

        [PANEL, '.ah-detail__panel', 'box-shadow', ['--shadow-panel']],
        [PANEL, '.ah-detail__head', 'height', ['--toolbar-h']],
        [PANEL, '.ah-detail__head', 'padding', ['--page-pad-x']],
        [PANEL, '.ah-detail__main', 'padding', ['--page-pad-y', '--page-pad-x']],
        [PANEL, '.ah-detail__main', 'gap', ['--gap-stack']],
        [PANEL, '.ah-detail__title .title-name', 'font', ['--fw-title', '--fs-xl', '--lh-tight']],
        [PANEL, '.ah-detail__chips .ah-chip', 'height', ['--control-h-sm']],
        [PANEL, '.ah-summary', 'padding', ['--card-pad-y', '--card-pad-x']],
        [PANEL, '.ah-summary', 'border-radius', ['--r-lg']],
        [PANEL, '.ah-detail__pane', 'font-size', ['--fs-md']],
        [PANEL, '.ah-detail__pane', 'line-height', ['--lh-body']],
        [PANEL, '.ah-subtasks', 'padding', ['--card-pad-y', '--card-pad-x']],
        [PANEL, '.ah-subtasks', 'gap', ['--gap-row']],
        [PANEL, '.ah-subtasks', 'border-radius', ['--r-lg']],
        [PANEL, '.ah-detail__props', 'padding', ['--card-pad-x']],
        [PANEL, '.ah-detail__props', 'gap', ['--gap-row']],
        [PANEL, '.ah-detail__props', 'font-size', ['--fs-md']],
        [PANEL, '.ah-detail__icon-btn', 'height', ['--control-h-sm']],
        [PANEL, '.ah-timer', 'min-height', ['--control-h-lg']],
    ])('%s %s { %s } reads %j', (rel, selector, property, names) => {
        const value = declaration(ruleBody(read(rel), selector), property);
        names.forEach((name) => expect(value, `${selector} { ${property}: ${value} }`).toContain(`var(${name}`));
    });

    it('keeps the list header on the same x as the cells under it', () => {
        const padding = declaration(ruleBody(read(LIST), '.lv2__cols'), 'padding');
        expect(padding).toContain('calc(var(--cell-pad-x, 12px) + 1px)');
        expect(padding).toContain('calc(var(--cell-pad-x, 12px) + 17px)');
    });
});
