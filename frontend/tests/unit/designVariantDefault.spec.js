import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { mount } from '@vue/test-utils';
import { createStore } from 'vuex';

vi.mock('@/services', () => ({ apiRequestWithoutCompnay: vi.fn(() => Promise.resolve()) }));

import en from '@/locales/en';
import * as shell from '@/components/organisms/Shell/shellState';
import DesignVariantPicker from '@/views/Settings/MySettings/DesignVariantPicker.vue';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.resolve(HERE, '../../src');
const read = (rel) => fs.readFileSync(path.join(SRC, rel), 'utf8');
const withoutComments = (css) => css.replace(/\/\*[\s\S]*?\*\//g, '');

const tokens = withoutComments(read('assets/css/tokens.css'));
const block = (selector) => {
    const start = tokens.indexOf(`${selector} {`);
    return start === -1 ? '' : tokens.slice(start + selector.length + 2, tokens.indexOf('}', start));
};
const declared = (body) => Object.fromEntries([...body.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)].map((m) => [m[1], m[2].trim()]));

const base = declared(block(':root'));
const darkTheme = declared(block(':root[data-theme="dark"]'));
const LOOKS = ['a', 'b', 'c', 'classic'];
const look = Object.fromEntries(LOOKS.map((name) => [name, declared(block(`:root[data-variant="${name}"]`))]));

/* What <html> ends up with: the base, then the theme, then the chosen look. The dark block sits
   before the looks in the file and weighs the same, so a look wins over it. */
const cascade = ({ dark = false, variant = '' } = {}) => ({ ...base, ...(dark ? darkTheme : {}), ...(variant ? look[variant] : {}) });
const value = (map, name) => {
    const raw = map[name];
    if (raw === undefined || raw === 'initial') return undefined;
    return raw.replace(/var\((--[\w-]+)\)/g, (_, ref) => value(map, ref));
};

const THEMES = [['light', false], ['dark', true]];
const ruleBody = (css, selector) => {
    const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const match = new RegExp(`(^|[\\s,}])${escaped}\\s*\\{([^}]*)\\}`, 'm').exec(withoutComments(css));
    return match ? match[2] : '';
};

describe.each(THEMES)('with no stored look, in %s', (_, dark) => {
    const html = cascade({ dark });

    it('the root computes the dense row, type and radii', () => {
        expect(value(html, '--row-h')).toBe('32px');
        expect(value(html, '--cell-pad-y')).toBe('4px');
        expect(value(html, '--row-font')).toBe('13px');
        expect(value(html, '--fs-md')).toBe('13px');
        expect(value(html, '--fw-strong')).toBe('500');
        expect(value(html, '--r-chip')).toBe('3px');
        expect(value(html, '--r-input')).toBe('4px');
        expect(value(html, '--r-card')).toBe('6px');
        expect(value(html, '--r-modal')).toBe('8px');
        expect(value(html, '--shadow-card')).toBe('none');
        expect(value(html, '--control-h')).toBe('26px');
        expect(value(html, '--toolbar-h')).toBe('44px');
    });

    it('is the same as a stored b, token for token', () => {
        const stored = cascade({ dark, variant: 'b' });
        const differs = Object.keys(look.b).filter((name) => value(html, name) !== value(stored, name));
        expect(Object.keys(look.b).length).toBeGreaterThan(40);
        expect(differs).toEqual([]);
    });

    it.each([
        ['a', '40px', '13px', '12px'],
        ['b', '32px', '13px', '6px'],
        ['c', '48px', '14px', '16px'],
        ['classic', '36px', '12.5px', '12px'],
    ])('a stored %s computes its own row, type and card radius', (variant, rowHeight, rowFont, cardRadius) => {
        const stored = cascade({ dark, variant });
        expect(value(stored, '--row-h')).toBe(rowHeight);
        expect(value(stored, '--row-font')).toBe(rowFont);
        expect(value(stored, '--r-card')).toBe(cardRadius);
    });
});

describe('the classic look is the look before dense became the default', () => {
    const FORMER = {
        '--sp-1': '4px', '--sp-2': '6px', '--sp-3': '8px', '--sp-4': '10px', '--sp-5': '12px', '--sp-6': '14px', '--sp-7': '16px', '--sp-8': '20px', '--sp-9': '24px',
        '--r-chip': '6px', '--r-input': '8px', '--r-card': '12px', '--r-modal': '16px',
        '--shadow-pop': '0 18px 44px rgba(0, 0, 0, .18)', '--toolbar-h': '52px',
        '--row-h': '36px', '--cell-pad-y': '9px', '--row-font': '12.5px',
        '--avatar-size': '24px', '--avatar-font': '11px', '--chip-h': '22px', '--chip-font': '11.5px', '--hit-min': '24px',
    };

    it.each(Object.entries(FORMER))('%s is %s again', (name, former) => {
        expect(look.classic[name]).toBe(former);
    });

    it.each(THEMES)('draws the card shadow it had in %s', (_, dark) => {
        const html = cascade({ dark, variant: 'classic' });
        expect(value(html, '--shadow-card')).toBe(`0 2px 6px ${dark ? 'rgba(0, 0, 0, .3)' : 'rgba(0, 0, 0, .04)'}`);
    });

    it('un-sets every token the old base did not have, so each rule falls back to its former value', () => {
        const unset = Object.keys(look.classic).filter((name) => look.classic[name] === 'initial');
        expect(unset.length).toBeGreaterThan(15);
        ['--fs-md', '--fs-lg', '--lh-body', '--fw-title', '--r-lg', '--control-h', '--control-h-lg', '--card-pad-y', '--page-pad-x', '--gap-stack', '--cell-pad-x', '--shadow-panel', '--shadow-surface'].forEach((name) => {
            expect(unset, name).toContain(name);
        });
        expect(Object.keys(look.b).filter((name) => !(name in look.classic))).toEqual([]);
    });

    it('no shared rule or project header rule reads one of those tokens without a fallback', () => {
        const unset = Object.keys(look.classic).filter((name) => look.classic[name] === 'initial');
        const rules = tokens.replace(/:root[^{]*\{[^}]*\}/g, '') + withoutComments(read('views/Projects/components/project-header.css'));
        expect(unset.filter((name) => new RegExp(`var\\(\\s*${name}\\s*\\)`).test(rules))).toEqual([]);
    });
});

describe('compact density against the dense default', () => {
    const compactAt = tokens.indexOf('[data-density="compact"]');
    const compact = declared(tokens.slice(compactAt, tokens.indexOf('}', compactAt)));

    it.each(['--row-h', '--cell-pad-y', '--row-font', '--avatar-size', '--avatar-font', '--chip-h', '--chip-font'])('%s is smaller in a compact view', (name) => {
        expect(parseFloat(compact[name])).toBeLessThan(parseFloat(value(cascade(), name)));
    });

    it('a compact row still holds the 24px target', () => {
        expect(parseFloat(compact['--row-h']) - 2 * parseFloat(compact['--cell-pad-y'])).toBeGreaterThanOrEqual(24);
    });

    it('the control still offers Comfortable and Compact', () => {
        expect(en.ViewDensity).toMatchObject({ comfortable: 'Comfortable', compact: 'Compact' });
    });
});

describe('on a phone', () => {
    const phone = tokens.slice(tokens.indexOf('@media (max-width: 767px) {\n    body {'));

    it('the hit target floor is 40px whatever the look or the density', () => {
        expect(phone).toMatch(/^@media \(max-width: 767px\) \{\s*body \{[^}]*--hit-min:\s*40px;/);
        LOOKS.forEach((name) => expect(look[name]['--hit-min'], name).toBe('24px'));
        const compactAt = tokens.indexOf('[data-density="compact"]');
        expect(tokens.slice(compactAt, tokens.indexOf('}', compactAt))).not.toContain('--hit-min');
        expect(tokens.slice(0, compactAt).trimEnd()).toMatch(/@media \(min-width: 768px\) \{$/);
    });

    it.each([['.ah-btn', '36px'], ['.ah-btn--sm', '30px'], ['.ah-btn--lg', '42px'], ['.ah-input', '38px']])('%s keeps its %s height', (selector, height) => {
        expect(ruleBody(phone, selector)).toMatch(new RegExp(`height:\\s*${height}`));
    });
});

describe('the shared primitives follow the look', () => {
    const reads = (selector, property, expected) => {
        const body = ruleBody(tokens, selector);
        const match = new RegExp(`(^|[;\\s])${property}\\s*:\\s*([^;]+)`).exec(body);
        expect(match ? match[2].trim() : '', `${selector} { ${property} }`).toContain(expected);
    };

    it.each([
        ['.ah-btn', 'height', 'var(--control-h-lg, 36px)'],
        ['.ah-btn', 'font', 'var(--fs-md, 13px)'],
        ['.ah-btn', 'padding', 'var(--sp-6)'],
        ['.ah-btn--sm', 'height', 'var(--control-h, 30px)'],
        ['.ah-btn--sm', 'font-size', 'var(--fs-sm, 12.5px)'],
        ['.ah-btn--lg', 'height', 'var(--control-h-lg, 36px)'],
        ['.ah-btn--lg', 'font-size', 'var(--fs-lg, 14px)'],
        ['.ah-input', 'height', 'var(--control-h-lg, 36px)'],
        ['.ah-input', 'font', 'var(--fs-md, 13.5px)'],
        ['.ah-chip', 'height', 'var(--chip-h)'],
        ['.ah-chip', 'font', 'var(--chip-font)'],
        ['.ah-avatar', 'width', 'var(--avatar-size)'],
        ['.ah-avatar', 'font', 'var(--avatar-font)'],
    ])('%s { %s } reads %s', reads);
});

describe('the project header follows the look', () => {
    const css = read('views/Projects/components/project-header.css');
    const fixedFontSizes = [...withoutComments(css).matchAll(/([^{}]+)\{([^{}]*)\}/g)].flatMap(([, selector, body]) => body.split(';')
        .map((d) => d.trim())
        .filter((d) => /^font(-size)?\s*:/.test(d))
        .filter((d) => /\d(px|rem|em)\b/.test(d.replace(/var\([^()]*(\([^()]*\))?[^()]*\)/g, '')))
        .map((d) => `${selector.trim()} { ${d} }`));

    it('sets no font size a look cannot change', () => {
        expect(fixedFontSizes).toEqual([]);
    });

    it.each([
        ['.ph2__bar', 'min-height', 'var(--toolbar-h)'],
        ['.ph2__bar', 'padding', 'var(--page-pad-x, 20px)'],
        ['.ph2__bar', 'font', 'var(--fs-md, 12.5px)'],
        ['.ph2__project', 'font', 'var(--fs-lg, 14px)'],
        ['.ph2__viewrow', 'min-height', 'var(--control-h-lg, 38px)'],
        ['.ph2__viewrow', 'padding', 'var(--page-pad-x, 20px)'],
        ['.ph2__tab', 'font', 'var(--fs-md, 12.5px)'],
    ])('%s { %s } reads %s', (selector, property, expected) => {
        const match = new RegExp(`(^|[;\\s])${property}\\s*:\\s*([^;]+)`).exec(ruleBody(css, selector));
        expect(match ? match[2].trim() : '').toContain(expected);
    });
});

describe('the look that is applied', () => {
    const html = document.documentElement;
    afterEach(() => {
        window.history.replaceState(null, '', '/');
        localStorage.clear();
        html.removeAttribute('data-variant');
    });

    it('names dense as the default and offers the former look as a fourth choice', () => {
        expect(shell.DEFAULT_VARIANT).toBe('b');
        expect(shell.VARIANT_CHOICES).toEqual(['a', 'b', 'c', 'classic']);
    });

    it('needs no attribute for the default, so nothing flashes on load', () => {
        shell.initTheme();
        expect(html.hasAttribute('data-variant')).toBe(false);
        expect(shell.activeVariant()).toBe('b');
    });

    it.each(['a', 'b', 'c', 'classic'])('applies a stored %s', (stored) => {
        localStorage.setItem('ah.variant', stored);
        shell.initTheme();
        expect(html.getAttribute('data-variant')).toBe(stored);
        expect(shell.activeVariant()).toBe(stored);
    });

    it('takes the former look from a link', () => {
        window.history.replaceState(null, '', '/#/company-1/home?variant=classic');
        shell.initTheme();
        expect(html.getAttribute('data-variant')).toBe('classic');
    });
});

describe('Settings → Appearance → the look picker', () => {
    const mountPicker = () => mount(DesignVariantPicker, {
        global: { plugins: [createStore({ modules: { settings: { namespaced: true, getters: { companyUserDetail: () => ({ roleType: 1 }) } } } })] },
    });
    const radio = (wrapper, name) => wrapper.find(`input[type="radio"][value="${name}"]`);
    afterEach(() => {
        shell.applyVariant('');
        localStorage.clear();
    });

    it('lists the default first, then the three previews', () => {
        expect(mountPicker().findAll('input[type="radio"]').map((r) => r.element.value)).toEqual(['b', 'a', 'c', 'classic']);
    });

    it('marks the default card when nothing is stored', () => {
        const wrapper = mountPicker();
        expect(radio(wrapper, 'b').element.checked).toBe(true);
        expect(radio(wrapper, 'b').element.closest('label').classList.contains('is-active')).toBe(true);
        expect(radio(wrapper, 'b').element.closest('label').textContent).toContain('Settings.variant_dense');
        expect(wrapper.find('[data-test="variant-off"]').exists()).toBe(false);
    });

    it('says in English which one is the default', () => {
        expect(en.Settings.variant_dense).toBe('Dense (default)');
        expect(en.Settings.variant_classic).toBe('Classic');
        expect(en.Settings.variant_default).toMatch(/default/i);
    });

    it('picking the default stores nothing, so it follows the default from then on', async () => {
        const wrapper = mountPicker();
        await radio(wrapper, 'c').setValue(true);
        expect(localStorage.getItem('ah.variant')).toBe('c');
        await radio(wrapper, 'b').setValue(true);
        expect(localStorage.getItem('ah.variant')).toBeNull();
        expect(document.documentElement.hasAttribute('data-variant')).toBe(false);
        expect(radio(wrapper, 'b').element.checked).toBe(true);
    });

    it('a browser that stored b before still shows the default card, with no way back offered', () => {
        shell.applyVariant('b');
        const wrapper = mountPicker();
        expect(radio(wrapper, 'b').element.checked).toBe(true);
        expect(wrapper.find('[data-test="variant-off"]').exists()).toBe(false);
    });
});
