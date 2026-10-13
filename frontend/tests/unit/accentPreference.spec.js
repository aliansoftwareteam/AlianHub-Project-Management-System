import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { mount } from '@vue/test-utils';

vi.mock('@/services', () => ({ apiRequestWithoutCompnay: vi.fn(() => Promise.resolve()) }));

import { applyAccent, applyContrast, initTheme, shellState } from '@/components/organisms/Shell/shellState';
import { ACCENT_CHOICES, DEFAULT_ACCENT } from '@/components/organisms/Shell/accents';
import AccentPicker from '@/views/Settings/MySettings/AccentPicker.vue';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.resolve(HERE, '../../src');
const read = (rel) => fs.readFileSync(path.join(SRC, rel), 'utf8');

const html = document.documentElement;
const OTHER = ACCENT_CHOICES.find((accent) => accent !== DEFAULT_ACCENT);

afterEach(() => {
    applyAccent('');
    applyContrast('standard');
    localStorage.clear();
});

describe('the accent attribute', () => {
    it('is absent when nothing is stored, so the app wears the default with no attribute', () => {
        initTheme();
        expect(html.hasAttribute('data-accent')).toBe(false);
        expect(shellState.accent).toBe(DEFAULT_ACCENT);
        expect(localStorage.getItem('ah.accent')).toBeNull();
    });

    it.each(ACCENT_CHOICES.filter((accent) => accent !== DEFAULT_ACCENT))('is set and remembered when %s is chosen', (accent) => {
        applyAccent(accent);
        expect(html.getAttribute('data-accent')).toBe(accent);
        expect(shellState.accent).toBe(accent);
        expect(localStorage.getItem('ah.accent')).toBe(accent);
    });

    it('is restored on start from what was stored', () => {
        localStorage.setItem('ah.accent', OTHER);
        initTheme();
        expect(html.getAttribute('data-accent')).toBe(OTHER);
        expect(shellState.accent).toBe(OTHER);
    });

    it.each(['kiln', '', '"><script>', 'BLUE'])('falls back to the default when %j is stored', (stored) => {
        applyAccent(OTHER);
        localStorage.setItem('ah.accent', stored);
        initTheme();
        expect(html.hasAttribute('data-accent')).toBe(false);
        expect(shellState.accent).toBe(DEFAULT_ACCENT);
    });

    it('stores nothing for the default, so this browser keeps following whatever the default is', () => {
        applyAccent(OTHER);
        applyAccent(DEFAULT_ACCENT);
        expect(html.hasAttribute('data-accent')).toBe(false);
        expect(localStorage.getItem('ah.accent')).toBeNull();
    });

    it('leaves the theme and the look alone', () => {
        initTheme();
        const theme = html.getAttribute('data-theme');
        applyAccent(OTHER);
        expect(html.getAttribute('data-theme')).toBe(theme);
        expect(html.hasAttribute('data-variant')).toBe(false);
    });
});

describe('Settings → Appearance → Accent', () => {
    const radios = (wrapper) => wrapper.findAll('input[type="radio"]');
    const radio = (wrapper, value) => wrapper.find(`input[type="radio"][value="${value}"]`);

    it('offers every accent as a radio with its own name, the default one checked', () => {
        const wrapper = mount(AccentPicker);
        const group = wrapper.find('[role="radiogroup"]');
        expect(wrapper.find(`#${group.attributes('aria-labelledby')}`).text()).toBe('Settings.accent');
        expect(radios(wrapper).map((r) => r.element.value)).toEqual(ACCENT_CHOICES);
        expect(new Set(radios(wrapper).map((r) => r.element.name)).size).toBe(1);
        radios(wrapper).forEach((r) => {
            expect(r.attributes('aria-label')).toBe(`Settings.accent_${r.element.value}`);
            expect(r.element.closest('label').getAttribute('data-accent-swatch')).toBe(r.element.value);
            expect(r.element.checked).toBe(r.element.value === DEFAULT_ACCENT);
        });
    });

    it('names every accent in the English locale', async () => {
        const { default: en } = await import('@/locales/en.js');
        ['accent', 'accent_hint', 'accent_high_contrast', ...ACCENT_CHOICES.map((accent) => `accent_${accent}`)].forEach((key) => {
            expect(en.Settings[key], key).toBeTruthy();
        });
    });

    it('applies the chosen accent at once and marks it', async () => {
        const wrapper = mount(AccentPicker);
        await radio(wrapper, OTHER).setValue(true);
        expect(html.getAttribute('data-accent')).toBe(OTHER);
        expect(localStorage.getItem('ah.accent')).toBe(OTHER);
        expect(radio(wrapper, OTHER).element.checked).toBe(true);
        expect(radio(wrapper, DEFAULT_ACCENT).element.checked).toBe(false);
    });

    it('opens on the accent already in use', () => {
        applyAccent(OTHER);
        expect(radio(mount(AccentPicker), OTHER).element.checked).toBe(true);
    });

    it('says the accent is waiting while high contrast is on', () => {
        expect(mount(AccentPicker).text()).toContain('Settings.accent_hint');
        applyContrast('high');
        expect(mount(AccentPicker).text()).toContain('Settings.accent_high_contrast');
    });

    it('sits in the Appearance card of My Settings', () => {
        const page = read('views/Settings/MySettings/MySettings.vue');
        const appearance = page.slice(page.indexOf("$t('Settings.theme')"), page.indexOf('data-test="keyboard-prefs"'));
        expect(appearance).toContain('<AccentPicker');
    });

    describe('the swatch styles', () => {
        const vue = read('views/Settings/MySettings/AccentPicker.vue');
        const css = vue.slice(vue.indexOf('<style'));
        const rule = (selector) => {
            const start = css.indexOf(`${selector} {`);
            return start === -1 ? '' : css.slice(start, css.indexOf('}', start));
        };

        it('give each swatch a target of 24 px or more that follows the touch floor', () => {
            const size = /(\d+)px,\s*var\(--hit-min/;
            ['width', 'height'].forEach((side) => {
                const match = new RegExp(`${side}:\\s*max\\(${size.source}`).exec(rule('.ms-accent__swatch'));
                expect(match, side).not.toBeNull();
                expect(Number(match[1])).toBeGreaterThanOrEqual(24);
            });
        });

        it('keep the radio focusable and over the whole swatch', () => {
            const input = rule('.ms-accent__input');
            expect(input).toMatch(/opacity:\s*0/);
            expect(input).toMatch(/inset:\s*0/);
            expect(input).not.toMatch(/display:\s*none|visibility:\s*hidden/);
            expect(rule('.ms-accent__input:focus-visible + .ms-accent__dot')).toMatch(/outline:\s*2px solid var\(--ink\)/);
        });

        it('mark the chosen swatch with a tick and a ring, not by colour alone', () => {
            expect(rule('.ms-accent__input:checked + .ms-accent__dot::after')).toMatch(/border:\s*2px solid var\(--on-brand\)/);
            expect(rule('.ms-accent__input:checked + .ms-accent__dot')).toMatch(/box-shadow:/);
        });

        it('fill each swatch from the brand token and use no literal colour', () => {
            expect(rule('.ms-accent__dot')).toMatch(/background:\s*var\(--brand\)/);
            expect(css).not.toMatch(/#[0-9a-f]{3,8}\b|rgba?\(/i);
        });
    });
});
