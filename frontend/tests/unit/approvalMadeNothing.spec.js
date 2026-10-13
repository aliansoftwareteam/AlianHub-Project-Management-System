import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import { createStore } from 'vuex';
import { createI18n } from 'vue-i18n';
import { createMemoryHistory, createRouter } from 'vue-router';
import en from '@/locales/en';

const { apiRequest, toast } = vi.hoisted(() => ({ apiRequest: vi.fn(), toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() } }));

vi.mock('@/services', () => ({ apiRequest }));
vi.mock('vue-toast-notification', () => ({ useToast: () => toast }));
vi.mock('@/locales/main', () => ({ i18n: { global: { t: (key) => key } } }));
vi.mock('@/store/index', () => ({ default: { getters: {} } }));
vi.mock('@/components/organisms/Shell/ShellIcon.vue', () => ({ default: { name: 'ShellIcon', render: () => null } }));

import WaitingOnYouCard from '@/components/molecules/Home/WaitingOnYouCard.vue';
import Approvals from '@/views/Approvals/Approvals.vue';
import { AI_STATE, applyAiAvailability, resetAiAvailability } from '@/composable/aiAvailability';

const WHY = 'That project has no statuses yet.';
const proposal = {
    _id: 'p1', agentName: 'Claude (MCP)', source: 'mcp', what: 'subtask.add', why: 'Asked for it.', status: 'pending', createdAt: '2026-10-08T09:00:00Z',
    changes: [{ action: 'subtask.add', params: { taskId: '64b000000000000000000002', title: 'Child' }, label: 'subtask.create via MCP', reversible: true }],
};
const madeNothing = {
    status: true,
    statusText: `Approved, but nothing was made. subtask.create via MCP: ${WHY}`,
    data: { applied: [{ action: 'subtask.add', ok: false, error: WHY }], proposal: { ...proposal, status: 'approved', notMade: [{ part: '', name: 'subtask.create via MCP', error: WHY }] } },
};

let wrapper;

const i18n = () => createI18n({ legacy: false, locale: 'en', messages: { en }, missingWarn: false, fallbackWarn: false });
const store = () => createStore({ modules: {
    settings: { namespaced: true, getters: { companyUserDetail: () => ({ roleType: 1 }) } },
    projectData: { namespaced: true, mutations: { mutateProjects: () => {} } },
} });

const serve = (type, url) => {
    if (type === 'get' && String(url).includes('/agents/proposals')) return Promise.resolve({ data: { status: true, data: [proposal], counts: { waiting: 1 } } });
    if (type === 'post' && String(url).endsWith('/p1/approve')) return Promise.resolve({ data: madeNothing });
    return Promise.resolve({ data: { status: true, data: [] } });
};

beforeEach(() => {
    apiRequest.mockReset();
    apiRequest.mockImplementation(serve);
    Object.values(toast).forEach((fn) => fn.mockReset());
    resetAiAvailability();
    applyAiAvailability({ state: AI_STATE.ON });
});
afterEach(() => { wrapper?.unmount(); wrapper = null; document.body.innerHTML = ''; });

describe('an approval that made nothing does not say it is done', () => {
    it('on the Home "Waiting on you" card', async () => {
        const router = createRouter({ history: createMemoryHistory(), routes: [{ path: '/:cid', name: 'Home', component: { render: () => null } }] });
        await router.push('/company-1');
        wrapper = mount(WaitingOnYouCard, { global: { plugins: [store(), router, i18n()] } });
        await flushPromises();
        await wrapper.find('[data-test="waiting-approve"]').trigger('click');
        await flushPromises();
        expect(toast.success).not.toHaveBeenCalled();
        expect(toast.error).toHaveBeenCalledWith(`Approved, but 1 change(s) could not be carried out: ${WHY}`, expect.anything());
    });

    it('on the Approvals page', async () => {
        wrapper = mount(Approvals, { attachTo: document.body, global: { plugins: [store(), i18n()] } });
        await flushPromises();
        await wrapper.find('.ap__card--agent .ah-btn--primary').trigger('click');
        await flushPromises();
        expect(wrapper.find('.tv-error').text()).toBe(`Approved, but 1 change(s) could not be carried out: ${WHY}`);
        expect(wrapper.text()).not.toContain(en.Time.approved_ok);
    });
});
