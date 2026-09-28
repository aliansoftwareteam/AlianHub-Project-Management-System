import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import { createStore } from 'vuex';
import { createI18n } from 'vue-i18n';
import { createMemoryHistory, createRouter } from 'vue-router';
import en from '@/locales/en';

const { apiRequest } = vi.hoisted(() => ({ apiRequest: vi.fn() }));

vi.mock('@/services', () => ({ apiRequest }));
vi.mock('@/locales/main', () => ({ i18n: { global: { t: (key) => key } } }));
vi.mock('@/store/index', () => ({ default: { getters: {} } }));
vi.mock('@/components/organisms/Shell/ShellIcon.vue', () => ({ default: { name: 'ShellIcon', render: () => null } }));

import WaitingOnYouCard from '@/components/molecules/Home/WaitingOnYouCard.vue';
import Approvals from '@/views/Approvals/Approvals.vue';
import { AI_STATE, applyAiAvailability, resetAiAvailability } from '@/composable/aiAvailability';

const RAW = 'pr.summary: 1 change(s) on AR-1';
const PLAIN = 'Summarise a pull request · 1 change on AR-1';
const RAW_MANY = 'brief.parse: 7 change(s) on AP-116';
const PLAIN_MANY = 'Break a brief into subtasks · 7 changes on AP-116';

const i18n = () => createI18n({ legacy: false, locale: 'en', messages: { en }, missingWarn: false, fallbackWarn: false });
const store = () => createStore({ modules: { settings: { namespaced: true, getters: { companyUserDetail: () => ({ roleType: 1 }) } } } });

const proposal = (id, what) => ({
    _id: id, agentName: 'Reviewer', what, why: 'Because.', status: 'pending', createdAt: '2026-09-28T09:00:00Z',
    changes: [{ action: 'task.comment', label: 'Comment on AR-1', reversible: true }]
});
const PROPOSALS = [proposal('p1', RAW), proposal('p2', RAW_MANY)];

const serve = (type, url) => {
    if (type === 'get' && String(url).includes('/agents/proposals')) return Promise.resolve({ data: { status: true, data: PROPOSALS, counts: { waiting: PROPOSALS.length } } });
    return Promise.resolve({ data: { status: true, data: [] } });
};

let wrapper;
beforeEach(() => {
    apiRequest.mockReset();
    apiRequest.mockImplementation(serve);
    resetAiAvailability();
    applyAiAvailability({ state: AI_STATE.ON });
});
afterEach(() => { wrapper?.unmount(); wrapper = null; document.body.innerHTML = ''; });

describe('a proposal reads in plain words wherever its title shows', () => {
    it('on the Home "Waiting on you" card, and in its button labels', async () => {
        const router = createRouter({ history: createMemoryHistory(), routes: [{ path: '/:cid', name: 'Home', component: { render: () => null } }] });
        await router.push('/company-1');
        wrapper = mount(WaitingOnYouCard, { global: { plugins: [store(), router, i18n()] } });
        await flushPromises();
        const titles = wrapper.findAll('.hwait__what').map((w) => w.text()).sort();
        expect(titles).toEqual([PLAIN_MANY, PLAIN]);
        expect(wrapper.html()).not.toContain('change(s)');
        expect(wrapper.html()).not.toContain('pr.summary');
    });

    it('in the Approvals list and its Why dialog', async () => {
        wrapper = mount(Approvals, { attachTo: document.body, global: { plugins: [store(), i18n()] } });
        await flushPromises();
        const titles = wrapper.findAll('.ap__card--agent .ap__title').map((w) => w.text()).sort();
        expect(titles).toEqual([PLAIN_MANY, PLAIN]);

        await wrapper.find('[data-test="proposal-why"]').trigger('click');
        await flushPromises();
        const dialog = document.body.querySelector('[data-test="proposal-why-dialog"]');
        expect([PLAIN, PLAIN_MANY]).toContain(dialog.querySelector('.apw__what').textContent.trim());
        expect(document.body.innerHTML).not.toContain('change(s)');
    });
});
