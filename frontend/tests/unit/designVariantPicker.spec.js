import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { mount } from '@vue/test-utils';
import { createStore } from 'vuex';

vi.mock('@/services', () => ({ apiRequestWithoutCompnay: vi.fn(() => Promise.resolve()) }));

import { applyVariant } from '@/components/organisms/Shell/shellState';
import DesignVariantPicker from '@/views/Settings/MySettings/DesignVariantPicker.vue';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.resolve(HERE, '../../src');

const html = document.documentElement;

const mountAs = (roleType) => {
    const store = createStore({
        modules: { settings: { namespaced: true, getters: { companyUserDetail: () => ({ roleType }) } } }
    });
    return mount(DesignVariantPicker, { global: { plugins: [store] } });
};

afterEach(() => {
    applyVariant('');
    localStorage.clear();
});

const LABEL = { a: 'Settings.variant_regular', b: 'Settings.variant_dense', c: 'Settings.variant_c', classic: 'Settings.variant_classic' };
const HINT = { a: 'Settings.variant_regular_hint', b: 'Settings.variant_b_hint', c: 'Settings.variant_c_hint', classic: 'Settings.variant_classic_hint' };

describe('Settings → Appearance → Look', () => {
    const radios = (wrapper) => wrapper.findAll('input[type="radio"]');
    const radio = (wrapper, value) => wrapper.find(`input[type="radio"][value="${value}"]`);

    it.each([[1, 'the owner'], [2, 'an admin']])('shows four radio cards to role %s (%s), the default one checked', (roleType) => {
        const wrapper = mountAs(roleType);
        expect(wrapper.text()).toContain('Settings.look_title');
        expect(wrapper.text()).toContain('Settings.look_note');
        expect(wrapper.find('[role="radiogroup"]').exists()).toBe(true);
        expect(radios(wrapper).map((r) => r.element.value)).toEqual(['b', 'a', 'c', 'classic']);
        expect(new Set(radios(wrapper).map((r) => r.element.name)).size).toBe(1);
        radios(wrapper).forEach((r) => {
            const card = r.element.closest('label');
            expect(card.textContent).toContain(LABEL[r.element.value]);
            expect(card.textContent).toContain(HINT[r.element.value]);
            expect(r.element.checked).toBe(r.element.value === 'b');
        });
    });

    it.each([[3, 'a member'], [0, 'a guest'], [undefined, 'someone with no role yet']])('shows nothing to role %s (%s)', (roleType) => {
        const wrapper = mountAs(roleType);
        expect(radios(wrapper)).toHaveLength(0);
        expect(wrapper.text()).toBe('');
    });

    it('applies the chosen variant at once and marks its card', async () => {
        const wrapper = mountAs(1);
        await radio(wrapper, 'a').setValue(true);
        expect(html.getAttribute('data-variant')).toBe('a');
        expect(localStorage.getItem('ah.variant')).toBe('a');
        expect(radio(wrapper, 'a').element.checked).toBe(true);
        expect(radio(wrapper, 'a').element.closest('label').classList.contains('is-active')).toBe(true);
        expect(radio(wrapper, 'b').element.checked).toBe(false);
    });

    it('opens on the variant already in use', () => {
        applyVariant('c');
        const wrapper = mountAs(2);
        expect(radio(wrapper, 'c').element.checked).toBe(true);
    });

    it('offers a way back to the default look only while another one is on', async () => {
        const wrapper = mountAs(2);
        expect(wrapper.find('[data-test="variant-off"]').exists()).toBe(false);
        await radio(wrapper, 'c').setValue(true);
        await wrapper.find('[data-test="variant-off"]').trigger('click');
        expect(html.hasAttribute('data-variant')).toBe(false);
        expect(localStorage.getItem('ah.variant')).toBeNull();
        expect(radio(wrapper, 'c').element.checked).toBe(false);
        expect(wrapper.find('[data-test="variant-off"]').exists()).toBe(false);
    });

    it('sits in the Appearance card of My Settings', () => {
        const page = fs.readFileSync(path.join(SRC, 'views/Settings/MySettings/MySettings.vue'), 'utf8');
        const appearance = page.slice(page.indexOf("$t('Settings.theme')"), page.indexOf('data-test="keyboard-prefs"'));
        expect(appearance).toContain('<DesignVariantPicker');
    });
});
