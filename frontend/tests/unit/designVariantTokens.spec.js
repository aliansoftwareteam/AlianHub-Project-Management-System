import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { describe, expect, it } from 'vitest';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.resolve(HERE, '../../src');
const read = (rel) => fs.readFileSync(path.join(SRC, rel), 'utf8');

const tokens = read('assets/css/tokens.css');
const SCREENS = [
    'components/molecules/Home/style.css',
    'views/Home/style.css',
    'views/Projects/ListView/style.css',
    'components/organisms/TaskDetailOverlay/style.css',
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
];
const VARIANTS = ['a', 'b', 'c'];

const block = (selector) => {
    const start = tokens.indexOf(`${selector} {`);
    return start === -1 ? '' : tokens.slice(start + selector.length + 2, tokens.indexOf('}', start));
};
const declared = (body) => Object.fromEntries([...body.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)].map((m) => [m[1], m[2].trim()]));

const root = declared(block(':root'));
const dark = declared(block(':root[data-theme="dark"]'));
const highContrast = declared(block(':root.ah-high-contrast'));
const variant = Object.fromEntries(VARIANTS.map((v) => [v, declared(block(`:root[data-variant="${v}"]`))]));
const px = (v, name) => parseFloat(variant[v][name]);
const step = (v, name) => {
    const ref = /^var\((--sp-\d)\)$/.exec(variant[v][name]);
    return ref ? parseFloat(variant[v][ref[1]]) : NaN;
};

describe('the three design variants', () => {
    it.each(VARIANTS)('variant %s is a token set on the root element', (v) => {
        expect(Object.keys(variant[v]).length).toBeGreaterThan(0);
    });

    it('define the same tokens, so switching never leaves one behind', () => {
        const all = [...new Set(VARIANTS.flatMap((v) => Object.keys(variant[v])))].sort();
        VARIANTS.forEach((v) => {
            expect(all.filter((name) => !(name in variant[v])), `missing from variant ${v}`).toEqual([]);
        });
    });

    it('cover type, spacing, radii, elevation, rows and controls', () => {
        const needed = [
            '--fs-xs', '--fs-sm', '--fs-md', '--fs-lg', '--fs-xl',
            '--lh-tight', '--lh-snug', '--lh-body', '--fw-strong', '--fw-title',
            '--sp-1', '--sp-2', '--sp-3', '--sp-4', '--sp-5', '--sp-6', '--sp-7', '--sp-8', '--sp-9',
            '--r-chip', '--r-input', '--r-card', '--r-modal',
            '--shadow-card', '--shadow-surface', '--shadow-pop', '--shadow-panel',
            '--row-h', '--row-font', '--cell-pad-y', '--cell-pad-x',
            '--control-h-sm', '--control-h', '--control-h-lg', '--toolbar-h',
        ];
        expect(needed.filter((name) => !(name in variant.a))).toEqual([]);
    });

    it('leave colours and the brand to the theme', () => {
        const themed = new Set([...Object.keys(dark), ...Object.keys(highContrast)]);
        themed.delete('--shadow-card');
        VARIANTS.forEach((v) => {
            expect(Object.keys(variant[v]).filter((name) => themed.has(name)), `variant ${v}`).toEqual([]);
        });
    });

    it('draw the card shadow in the ink each theme sets, so dark mode keeps its own', () => {
        expect(root['--shadow-ink']).toBeTruthy();
        expect(dark['--shadow-ink']).toBeTruthy();
        VARIANTS.forEach((v) => {
            const shadow = variant[v]['--shadow-card'];
            if (shadow !== 'none') expect(shadow, `variant ${v}`).toContain('var(--shadow-ink)');
        });
    });

    it('keep every spacing role on the variant spacing scale', () => {
        const roles = ['--cell-pad-y', '--cell-pad-x', '--card-pad-y', '--card-pad-x', '--gap-row', '--gap-stack', '--page-pad-y', '--page-pad-x'];
        VARIANTS.forEach((v) => roles.forEach((name) => {
            expect(variant[v][name], `${name} in variant ${v}`).toMatch(/^var\(--sp-\d\)$/);
        }));
    });

    it('A keeps today\'s spacing scale, radii and toolbar', () => {
        ['--sp-1', '--sp-2', '--sp-3', '--sp-4', '--sp-5', '--sp-6', '--sp-7', '--sp-8', '--sp-9', '--r-modal', '--shadow-pop', '--toolbar-h'].forEach((name) => {
            expect(variant.a[name], name).toBe(root[name]);
        });
        expect(variant.a['--shadow-card']).toBe(root['--shadow-card'].replace(/rgba\([^)]*\)/, 'var(--shadow-ink)'));
        expect(variant.a['--shadow-surface']).toBe('none');
        [['--r-chip', '--r-sm'], ['--r-input', '--r-md'], ['--r-card', '--r-lg']].forEach(([shared, own]) => {
            expect(variant.a[shared], shared).toBe(`var(${own})`);
            expect(variant.a[own], own).toBe(root[shared]);
        });
        expect(root['--shadow-card']).toContain(root['--shadow-ink']);
        expect(dark['--shadow-card']).toContain(dark['--shadow-ink']);
    });

    it('A sets type on whole pixels', () => {
        ['--fs-2xs', '--fs-xs', '--fs-sm', '--fs-md', '--fs-lg', '--fs-xl'].forEach((name) => {
            expect(variant.a[name], name).toMatch(/^\d+px$/);
        });
    });

    it('B is compact: 13px base, tighter rows, flat surfaces, smaller radii', () => {
        expect(variant.b['--fs-md']).toBe('13px');
        expect(variant.b['--shadow-card']).toBe('none');
        expect(variant.b['--shadow-panel']).toBe('none');
        expect(variant.b['--shadow-surface']).toBe('none');
        ['--row-h', '--control-h-sm', '--control-h', '--control-h-lg', '--toolbar-h', '--r-sm', '--r-md', '--r-lg', '--r-modal', '--fs-sm', '--fs-lg', '--fs-xl', '--lh-body'].forEach((name) => {
            expect(px('b', name), name).toBeLessThan(px('a', name));
        });
        ['--cell-pad-y', '--cell-pad-x', '--card-pad-y', '--card-pad-x', '--gap-row', '--gap-stack', '--page-pad-y', '--page-pad-x'].forEach((name) => {
            expect(step('b', name), name).toBeLessThan(step('a', name));
        });
    });

    it('C is airy: larger type, more room, rounder corners, a stronger title', () => {
        ['--fs-xs', '--fs-sm', '--fs-md', '--fs-lg', '--fs-xl', '--lh-body', '--row-h', '--control-h-sm', '--control-h', '--control-h-lg', '--toolbar-h', '--r-sm', '--r-md', '--r-lg', '--r-modal'].forEach((name) => {
            expect(px('c', name), name).toBeGreaterThan(px('a', name));
        });
        ['--cell-pad-y', '--cell-pad-x', '--card-pad-y', '--card-pad-x', '--gap-row', '--gap-stack', '--page-pad-y', '--page-pad-x'].forEach((name) => {
            expect(step('c', name), name).toBeGreaterThan(step('a', name));
        });
        expect(Number(variant.c['--fw-title'])).toBeGreaterThan(Number(variant.a['--fw-title']));
        expect(variant.c['--shadow-card'].split('var(--shadow-ink)').length).toBeGreaterThan(2);
        expect(variant.c['--shadow-surface']).toBe('var(--shadow-card)');
    });

    it('a list row is a 24px control plus its cell padding in every variant', () => {
        VARIANTS.forEach((v) => {
            expect(px(v, '--row-h'), `variant ${v}`).toBe(24 + 2 * step(v, '--cell-pad-y'));
        });
    });
});

describe('with no variant chosen', () => {
    const variantOnly = Object.keys(variant.a).filter((name) => !(name in root));
    const sheets = [...SCREENS.map(read), tokens.replace(/:root\[data-variant="[abc]"\] \{[^}]*\}/g, '')];

    it('the variant-only tokens stay undefined on :root', () => {
        expect(variantOnly.length).toBeGreaterThan(10);
        ['--fs-md', '--fw-title', '--r-lg', '--shadow-panel', '--control-h', '--card-pad-y', '--page-pad-x'].forEach((name) => {
            expect(variantOnly).toContain(name);
        });
    });

    it('every use of a variant-only token falls back to today\'s value', () => {
        const bare = [];
        sheets.forEach((css) => variantOnly.forEach((name) => {
            if (new RegExp(`var\\(\\s*${name}\\s*\\)`).test(css)) bare.push(name);
        }));
        expect(bare).toEqual([]);
    });

    /* The List density setting defines these on :root at today's sizes. One fallback everywhere
       means the screens look the same whether or not it has landed. */
    it.each([['--row-h', '36px'], ['--cell-pad-y', '9px'], ['--row-font', '12.5px']])('%s falls back to %s wherever it is read', (name, value) => {
        const fallbacks = SCREENS.flatMap((rel) => [...read(rel).matchAll(new RegExp(`var\\(${name}, ([^)]+)\\)`, 'g'))].map((m) => m[1]));
        expect(fallbacks.length).toBeGreaterThan(0);
        expect([...new Set(fallbacks)]).toEqual([value]);
    });

    it('every token a screen reads with a fallback is one the variants set', () => {
        const known = new Set([...Object.keys(variant.a), ...Object.keys(root)]);
        const unknown = [];
        SCREENS.forEach((rel) => {
            [...read(rel).matchAll(/var\(\s*(--[\w-]+)\s*,/g)].forEach((m) => {
                if (!known.has(m[1])) unknown.push(`${rel}: ${m[1]}`);
            });
        });
        expect(unknown).toEqual([]);
    });
});
