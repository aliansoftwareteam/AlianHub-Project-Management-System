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

const PROJECT = '64b000000000000000000001';
const stored = { _id: PROJECT, ProjectName: 'Launch', isPrivateSpace: true };
const added = [{ snap: null, privateSnap: false, op: 'added', data: { ...stored, id: PROJECT, isExpanded: false } }];
const proposal = {
    _id: 'p1', agentName: 'Claude (MCP)', source: 'mcp', what: 'project.create', why: 'Asked for it.', status: 'pending', createdAt: '2026-10-02T09:00:00Z',
    changes: [{ action: 'project.create', params: { name: 'Launch' }, label: 'project.create via MCP', reversible: true }],
};

let seen;
let wrapper;

const i18n = () => createI18n({ legacy: false, locale: 'en', messages: { en }, missingWarn: false, fallbackWarn: false });
const store = () => createStore({ modules: {
    settings: { namespaced: true, getters: { companyUserDetail: () => ({ roleType: 1 }) } },
    projectData: { namespaced: true, mutations: { mutateProjects: (state, payload) => { seen.push(payload); } } },
} });

const serve = (type, url) => {
    if (type === 'get' && url === `/api/v1/project/${PROJECT}`) return Promise.resolve({ data: stored });
    if (type === 'get' && String(url).includes('/agents/proposals')) return Promise.resolve({ data: { status: true, data: [proposal], counts: { waiting: 1 } } });
    if (type === 'post' && String(url).endsWith('/p1/approve')) return Promise.resolve({ data: { status: true, data: { applied: [{ action: 'project.create', ok: true, result: { projectId: PROJECT, name: 'Launch' } }] } } });
    return Promise.resolve({ data: { status: true, data: [] } });
};

beforeEach(() => {
    seen = [];
    apiRequest.mockReset();
    apiRequest.mockImplementation(serve);
    resetAiAvailability();
    applyAiAvailability({ state: AI_STATE.ON });
});
afterEach(() => { wrapper?.unmount(); wrapper = null; document.body.innerHTML = ''; });

describe('a new project approved outside the Inbox shows without a reload', () => {
    it('from the Home "Waiting on you" card', async () => {
        const router = createRouter({ history: createMemoryHistory(), routes: [{ path: '/:cid', name: 'Home', component: { render: () => null } }] });
        await router.push('/company-1');
        wrapper = mount(WaitingOnYouCard, { global: { plugins: [store(), router, i18n()] } });
        await flushPromises();
        await wrapper.find('[data-test="waiting-approve"]').trigger('click');
        await flushPromises();
        expect(seen).toEqual([added]);
    });

    it('from the Approvals page', async () => {
        wrapper = mount(Approvals, { attachTo: document.body, global: { plugins: [store(), i18n()] } });
        await flushPromises();
        await wrapper.find('.ap__card--agent .ah-btn--primary').trigger('click');
        await flushPromises();
        expect(seen).toEqual([added]);
    });
});
