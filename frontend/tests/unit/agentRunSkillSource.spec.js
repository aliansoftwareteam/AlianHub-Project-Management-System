import { beforeEach, describe, expect, it, vi } from 'vitest';
import { config, flushPromises, mount, RouterLinkStub } from '@vue/test-utils';
import { createStore } from 'vuex';
import { ref } from 'vue';

const { apiRequest, toast } = vi.hoisted(() => ({ apiRequest: vi.fn(), toast: { success: vi.fn(), error: vi.fn() } }));

vi.mock('@/services', () => ({ apiRequest }));
vi.mock('@/locales/main', () => ({ i18n: { global: { t: (key) => `t:${key}` } } }));
vi.mock('@/components/organisms/Shell/shellState', () => ({ shellState: { agentsRunning: 0 } }));
vi.mock('@/components/organisms/Shell/ShellIcon.vue', () => ({ default: { name: 'ShellIcon', render: () => null } }));
vi.mock('@/views/Ai/AiSidebar.vue', () => ({ default: { name: 'AiSidebar', render: () => null } }));
vi.mock('@/composable', () => ({ useGetterFunctions: () => ({ getUser: () => null }) }));
vi.mock('vue-router', () => ({ useRoute: () => ({ query: {} }) }));
vi.mock('vue-toast-notification', () => ({ useToast: () => toast }));

import AgentRunDetail from '@/views/Ai/AgentRunDetail.vue';
import AiInbox from '@/views/Ai/AiInbox.vue';
import en from '@/locales/en.js';

const i18n = config.global.plugins[0];
i18n.global.setLocaleMessage('en', en);
const t = i18n.global.t;

const ok = (data, extra = {}) => Promise.resolve({ data: { status: true, data, ...extra } });
const store = createStore({ modules: { settings: { namespaced: true, getters: { companyUserDetail: () => ({ roleType: 1 }) } } } });

const mountDetail = async (run) => {
    apiRequest.mockImplementation((type, url) => (url.endsWith('/replay') ? ok([]) : ok({ run, audit: [] })));
    const wrapper = mount(AgentRunDetail, { props: { runId: 'r1' }, global: { plugins: [store], provide: { $userId: ref('u1'), $companyId: ref('company-1') }, mocks: { $t: t }, stubs: { RouterLink: RouterLinkStub } } });
    await flushPromises();
    return wrapper;
};

const mountInbox = async (proposal) => {
    apiRequest.mockImplementation((type, url) => (url.includes('/proposals') ? ok([proposal], { counts: { waiting: 1 } }) : ok({})));
    const wrapper = mount(AiInbox, { global: { plugins: [store], mocks: { $t: t } } });
    await flushPromises();
    await wrapper.find('.ai-item').trigger('click');
    return wrapper;
};

beforeEach(() => { apiRequest.mockReset(); });

const CASES = [
    [{ kind: 'code' }, 'Built-in (code)'],
    [{ kind: 'seed' }, 'Built-in (data)'],
    [{ kind: 'workspace', version: 3 }, "Your workspace's copy (v3)"]
];

describe('the run view', () => {
    const run = { _id: 'r1', status: 'done', startedBy: 'u1', skill: 'pr.summary', skillRevision: { key: 'pr.summary', hash: 'abc', n: null }, decisions: [] };

    it.each(CASES)('names the skill source %j', async (skillSource, label) => {
        const wrapper = await mountDetail({ ...run, skillSource });
        expect(wrapper.find('[data-test="skill-source"]').text()).toBe(label);
    });

    it('shows no source on a run started before it was recorded', async () => {
        const wrapper = await mountDetail(run);
        expect(wrapper.find('[data-test="skill-source"]').exists()).toBe(false);
    });
});

describe('the proposal in the AI Inbox', () => {
    const proposal = { _id: 'pr1', agentName: 'Reviewer', runId: '6f0000000000000000000e01', what: 'Comment on the PR', why: 'risky change', status: 'pending', changes: [{ label: 'Comment', reversible: true }], createdAt: new Date().toISOString() };

    it.each(CASES)('names the source of the skill its run used %j', async (skillSource, label) => {
        const wrapper = await mountInbox({ ...proposal, skillSource });
        expect(wrapper.find('[data-test="proposal-skill-source"]').text()).toBe(label);
    });

    it('shows no source when the run did not record one', async () => {
        const wrapper = await mountInbox(proposal);
        expect(wrapper.find('[data-test="proposal-skill-source"]').exists()).toBe(false);
    });
});
