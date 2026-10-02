/* Tenth sweep, defects 8 and 12: what sits on a brand fill reads in dark mode, and Settings > Company holds no
   element the app does not know. */
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { mount } from '@vue/test-utils';
import { createStore } from 'vuex';

vi.mock('@/services', () => ({ apiRequest: vi.fn(), apiRequestWithoutCompnay: vi.fn() }));

import Company from '@/components/molecules/CreateCompany/Company.vue';

const SRC = path.resolve(__dirname, '../../src');
const read = (rel) => fs.readFileSync(path.join(SRC, rel), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
const rules = (css) => [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map(([, selector, body]) => ({ selector: selector.trim(), body }));
const WHITE = /#fff\b|#ffffff\b|\bwhite\b|rgba?\(\s*255\s*,\s*255\s*,\s*255/i;

describe.each([
    ['Notepad', 'components/molecules/Notepad/panel.css', ['.np__htitle', '.np__htitleinput', '.np__hbtn']],
    ['Clips', 'components/molecules/Clips/panel.css', ['.cl__htitle', '.cl__hbtn']]
])('the %s header, which is filled with the brand colour', (name, file, inks) => {
    const css = rules(read(file));
    const header = css.filter((rule) => /__h(title|titleinput|btn)\b/.test(rule.selector));

    it('paints nothing on it in white', () => {
        expect(header.length).toBeGreaterThan(0);
        expect(header.filter((rule) => WHITE.test(rule.body)).map((rule) => rule.selector)).toEqual([]);
    });

    it.each(inks)('takes the ink of %s from --on-brand', (selector) => {
        const rule = css.find((entry) => entry.selector === selector);
        expect(rule.body).toMatch(/(^|[;\s])color:\s*[^;]*var\(--on-brand\)/);
    });
});

describe('the chosen filter of the New project dialog', () => {
    const css = rules(read('components/organisms/CreateProject/style.css'));
    const weight = (selector) => (selector.match(/\.[\w-]+|\[[^\]]+\]|:root/g) || []).length;

    it('is the brand fill with the ink that reads on it', () => {
        const chosen = css.find((rule) => rule.selector === '.ah-cp__filter.is-on');
        expect(chosen.body).toMatch(/background:\s*var\(--brand\)/);
        expect(chosen.body).toMatch(/color:\s*var\(--on-brand\)/);
    });

    it('is not painted over by a rule for the chips of one theme', () => {
        const chosen = weight('.ah-cp__filter.is-on');
        const louder = css.filter((rule) => /\.ah-cp__filter(?![\w-])/.test(rule.selector) && !/is-on/.test(rule.selector) && /background/.test(rule.body) && weight(rule.selector) >= chosen);
        expect(louder.map((rule) => rule.selector)).toEqual([]);
    });

    it('fills the other chips from a token that every theme sets', () => {
        expect(css.find((rule) => rule.selector === '.ah-cp__filter').body).toMatch(/background:\s*var\(--fill\)/);
    });
});

describe('Settings > Company', () => {
    const COMPANIES = [{ _id: 'c1', Cst_CompanyName: 'Local360', Cst_profileImage: '' }];
    const show = () => {
        const unknown = [];
        const store = createStore({ modules: { settings: { namespaced: true, getters: { companies: () => COMPANIES } } } });
        const wrapper = mount(Company, {
            global: {
                plugins: [store],
                provide: { $userId: { value: 'u1' } },
                mocks: { $t: (key) => key },
                stubs: { WasabiIamgeCompp: true },
                config: { warnHandler: (message) => { if (/Failed to resolve component/.test(message)) unknown.push(message); } }
            }
        });
        return { wrapper, unknown };
    };

    it('holds no element the app does not know', () => {
        const { wrapper, unknown } = show();
        expect(unknown).toEqual([]);
        expect(wrapper.html()).not.toMatch(/viewcomponent/i);
        wrapper.unmount();
    });

    it('writes the company name in the ink of the surface it stands on', () => {
        const { wrapper } = show();
        const name = wrapper.findAll('span').find((span) => span.text() === 'Local360');
        expect(name.classes()).toContain('company-name');
        expect(name.classes()).not.toContain('black');
        expect(read('components/molecules/CreateCompany/style.css')).toMatch(/\.company-name\s*\{[^}]*color:\s*var\(--ink\)/);
        wrapper.unmount();
    });
});
