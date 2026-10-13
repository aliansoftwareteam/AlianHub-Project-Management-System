import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { describe, expect, it } from 'vitest';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.resolve(HERE, '../../src');
const read = (rel) => fs.readFileSync(path.join(SRC, rel), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');

const tokens = read('assets/css/tokens.css');

const rulesOf = (css) => [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map(([, selectors, body]) => ({
    selectors: selectors.split(',').map((s) => s.trim()),
    body
}));
const bodyOf = (css, selector) => rulesOf(css).filter((rule) => rule.selectors.includes(selector)).map((rule) => rule.body).join('\n');

const blocksOf = (css, opener) => {
    const blocks = [];
    let at = css.indexOf(opener);
    while (at !== -1) {
        let depth = 0;
        let end = css.indexOf('{', at);
        for (; end < css.length; end += 1) {
            if (css[end] === '{') depth += 1;
            if (css[end] === '}' && --depth === 0) break;
        }
        blocks.push(css.slice(css.indexOf('{', at) + 1, end));
        at = css.indexOf(opener, end);
    }
    return blocks;
};

const reducedMotion = blocksOf(tokens, '@media (prefers-reduced-motion: reduce)');
const outsideMedia = blocksOf(tokens, '@media').reduce((css, block) => css.replace(block, ''), tokens);
const rootTokens = Object.fromEntries(rulesOf(outsideMedia)
    .filter((rule) => rule.selectors.includes(':root'))
    .flatMap((rule) => [...rule.body.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)].map((m) => [m[1], m[2].trim()])));
const durations = Object.keys(rootTokens).filter((name) => name.startsWith('--motion-'));

const HARD_CODED_TIME = /(?<![\w.-])\d*\.?\d+m?s\b/;
const timed = (body) => [...body.matchAll(/(?:transition|animation)(?:-duration)?\s*:\s*([^;]+);/g)].map((m) => m[1]);

describe('the motion tokens', () => {
    it('are two or three durations and one or two easings', () => {
        expect(durations.sort()).toEqual(['--motion-base', '--motion-fast', '--motion-slow']);
        durations.forEach((name) => expect(rootTokens[name], name).toMatch(/^\d+ms$/));
        expect(parseFloat(rootTokens['--motion-fast'])).toBeLessThan(parseFloat(rootTokens['--motion-base']));
        expect(parseFloat(rootTokens['--motion-base'])).toBeLessThan(parseFloat(rootTokens['--motion-slow']));
        expect(parseFloat(rootTokens['--motion-slow'])).toBeLessThanOrEqual(300);
        ['--ease-out', '--ease-in-out'].forEach((name) => expect(rootTokens[name], name).toMatch(/^cubic-bezier\(/));
    });

    it('carry the older names, so the screens written against those follow the same clock', () => {
        expect(rootTokens['--t-state']).toBe('var(--motion-base)');
        expect(rootTokens['--t-panel']).toBe('var(--motion-slow)');
        expect(rootTokens['--ease']).toBe('var(--ease-out)');
    });

    it('all drop to 0.01ms in one prefers-reduced-motion block, so no component opts out by itself', () => {
        const resetting = reducedMotion.filter((block) => /--motion-[\w-]+\s*:/.test(block));
        expect(resetting).toHaveLength(1);
        const reset = bodyOf(resetting[0], ':root');
        durations.forEach((name) => {
            expect(reset, name).toMatch(new RegExp(`${name}:\\s*0?\\.01ms\\s*;`));
        });
    });

    it('are not redefined by a look, a theme or an accent', () => {
        const elsewhere = rulesOf(tokens).filter((rule) => !rule.selectors.includes(':root') && /--motion-[\w-]+\s*:/.test(rule.body));
        expect(elsewhere.map((rule) => rule.selectors.join(', '))).toEqual([]);
    });
});

describe('the shared entrance keyframes', () => {
    const keyframes = Object.fromEntries(blocksOf(tokens, '@keyframes ah-').map((block, i) => [
        [...tokens.matchAll(/@keyframes (ah-[\w-]+)/g)][i][1],
        block
    ]));

    it.each(['ah-fade-in', 'ah-drop-in', 'ah-rise-in'])('%s moves opacity and a few pixels, nothing that changes layout', (name) => {
        expect(keyframes[name]).toBeTruthy();
        const properties = [...keyframes[name].matchAll(/([\w-]+)\s*:\s*([^;]+);/g)].map((m) => [m[1], m[2].trim()]);
        expect(properties.length).toBeGreaterThan(0);
        properties.forEach(([property, value]) => {
            expect(['opacity', 'translate']).toContain(property);
            if (property === 'translate') {
                (value.match(/-?\d*\.?\d+px/g) || []).forEach((px) => expect(Math.abs(parseFloat(px))).toBeLessThanOrEqual(8));
                expect(value).not.toMatch(/%|vw|vh|rem/);
            }
        });
    });
});

describe('the shared overlays move on the motion tokens', () => {
    const style = (rel) => { const file = read(rel); return rel.endsWith('.vue') ? file.slice(file.indexOf('>', file.indexOf('<style')) + 1) : file; };

    it.each([
        ['the menu', 'assets/css/tokens.css', '.ah-pop', /animation:\s*ah-drop-in var\(--motion-fast\) var\(--ease-out\)/],
        ['the menu fade', 'assets/css/tokens.css', '.ah-fade-enter-active', /transition:\s*opacity var\(--motion-base\) var\(--ease-out\)/],
        ['the drawer slide', 'assets/css/tokens.css', '.ah-slide-right-enter-active', /transition:\s*transform var\(--motion-slow\) var\(--ease-out\), opacity var\(--motion-slow\) var\(--ease-out\)/],
        ['the task drawer', 'components/organisms/TaskDetailOverlay/style.css', '.ah-detail-enter-active', /transition:\s*opacity var\(--motion-slow\) var\(--ease-out\)/],
        ['the task drawer panel', 'components/organisms/TaskDetailOverlay/style.css', '.ah-detail-enter-active .ah-detail__panel', /transition:\s*transform var\(--motion-slow\) var\(--ease-out\)/],
        ['the confirm dialog backdrop', 'components/atom/ConfirmDelete/ConfirmDelete.vue', '.cd__wrap', /animation:\s*ah-fade-in var\(--motion-base\) var\(--ease-out\)/],
        ['the confirm dialog', 'components/atom/ConfirmDelete/ConfirmDelete.vue', '.cd', /animation:\s*ah-rise-in var\(--motion-base\) var\(--ease-out\)/],
        ['the toast', 'components/molecules/UndoToast/UndoToast.vue', '.ah-undo-toast', /animation:\s*ah-rise-in var\(--motion-base\) var\(--ease-out\)/],
        ['the tooltip', 'components/molecules/ToolTip/style.css', '.tooltip-fade-enter-active', /transition:\s*opacity var\(--motion-fast\) var\(--ease-out\), transform var\(--motion-fast\) var\(--ease-out\)/],
    ])('%s (%s %s)', (_, file, selector, expected) => {
        const body = bodyOf(style(file), selector);
        expect(body).toMatch(expected);
        timed(body).forEach((value) => expect(value).not.toMatch(HARD_CODED_TIME));
    });

    it.each([
        'components/atom/ConfirmDelete/ConfirmDelete.vue',
        'components/molecules/UndoToast/UndoToast.vue',
        'components/molecules/ToolTip/style.css',
    ])('%s hard-codes no duration', (file) => {
        const offenders = rulesOf(style(file)).flatMap((rule) => timed(rule.body).filter((value) => HARD_CODED_TIME.test(value)));
        expect(offenders).toEqual([]);
    });

    it('a leaving overlay mirrors its entrance, so nothing needs its own leave timing', () => {
        const css = read('components/organisms/TaskDetailOverlay/style.css');
        expect(rulesOf(css).some((rule) => rule.selectors.includes('.ah-detail-enter-active') && rule.selectors.includes('.ah-detail-leave-active'))).toBe(true);
        expect(rulesOf(tokens).some((rule) => rule.selectors.includes('.ah-fade-enter-active') && rule.selectors.includes('.ah-fade-leave-active'))).toBe(true);
    });
});
