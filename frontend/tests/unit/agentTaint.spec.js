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
import AgentRunReplay from '@/views/Ai/AgentRunReplay.vue';
import AiInbox from '@/views/Ai/AiInbox.vue';
import AuditLog from '@/views/Settings/Audit/AuditLog.vue';
import en from '@/locales/en.js';

/* Sprint 8 slice 6: a run that read external content says so wherever its work is shown. */

const i18n = config.global.plugins[0];
i18n.global.setLocaleMessage('en', en);
const t = i18n.global.t;

const ok = (data, extra = {}) => Promise.resolve({ data: { status: true, data, ...extra } });
const sources = [{ kind: 'fetch', ref: 'example.com', at: '2026-09-18T10:00:00Z' }, { kind: 'form', ref: '6f0000000000000000000f01', at: '2026-09-18T10:00:01Z' }];
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

describe('the run view', () => {
    const run = { _id: 'r1', status: 'done', startedBy: 'u1', decisions: [{ action: 'task.create', decision: 'propose', reason: 'task.create reaches the whole project; the run read external content (fetch example.com)' }] };

    it('shows the marker, the reason and each source with its kind and reference', async () => {
        const wrapper = await mountDetail({ ...run, tainted: true, taintSources: sources });
        const block = wrapper.find('[data-test="tainted"]');
        expect(block.exists()).toBe(true);
        expect(block.find('[data-test="tainted-chip"]').text()).toBe('Read external content');
        expect(block.find('[data-test="tainted-reason"]').text()).toBe(en.Audit.tainted_reason);
        expect(block.findAll('[data-test="taint-source"]').map((li) => li.findAll('span').map((s) => s.text()).join(' '))).toEqual(['Web page example.com', 'Form submission 6f0000000000000000000f01']);
        expect(wrapper.text()).toContain('the run read external content (fetch example.com)');
    });

    it('shows nothing of it for a run that read no external content', async () => {
        const wrapper = await mountDetail(run);
        expect(wrapper.find('[data-test="tainted"]').exists()).toBe(false);
        expect(wrapper.text()).not.toContain('Read external content');
    });
});

describe('the replay', () => {
    const call = (over = {}) => ({ _id: 'rp1', model: 'gpt-4.1', usage: { inputTokens: 10, outputTokens: 5 }, costUsd: 0.001, durationMs: 12, status: 'ok', system: 's', messages: [], retrievedChunkIds: [], response: 'r', promptHash: 'h', truncated: false, ...over });

    it('marks a call made from a tainted run, and not one made from a clean run', async () => {
        apiRequest.mockImplementation(() => ok([call({ tainted: true, taintSources: sources }), call({ _id: 'rp2' })]));
        const wrapper = mount(AgentRunReplay, { props: { runId: 'r1', replayId: 'rp1' }, global: { mocks: { $t: t } } });
        await flushPromises();
        const rows = wrapper.findAll('[data-test="replay-call"]');
        expect(rows[0].find('[data-test="replay-tainted"]').text()).toBe('Read external content');
        expect(rows[0].find('[data-test="replay-tainted"]').attributes('title')).toBe('Web page example.com · Form submission 6f0000000000000000000f01');
        expect(rows[1].find('[data-test="replay-tainted"]').exists()).toBe(false);
    });
});

describe('the proposal card', () => {
    const proposal = { _id: 'pr1', agentName: 'Planner', what: 'Create a follow-up task', why: 'planned', status: 'pending', changes: [{ label: 'Task: Follow up', reversible: true }], createdAt: new Date().toISOString() };

    it('says the proposal needs approval because the run read external content, and names the sources', async () => {
        const wrapper = await mountInbox({ ...proposal, taint: { sources, reason: 'the run read external content (fetch example.com, form 6f0000000000000000000f01)' } });
        expect(wrapper.find('[data-test="proposal-tainted"]').text()).toBe('Read external content');
        const banner = wrapper.find('[data-test="taint-reason"]');
        expect(banner.exists()).toBe(true);
        expect(banner.text()).toContain(en.Audit.tainted_reason);
        expect(banner.find('[data-test="taint-sources"]').text()).toBe('Web page example.com · Form submission 6f0000000000000000000f01');
    });

    it('shows no such note on a proposal from a clean run', async () => {
        const wrapper = await mountInbox(proposal);
        expect(wrapper.find('[data-test="proposal-tainted"]').exists()).toBe(false);
        expect(wrapper.find('[data-test="taint-reason"]').exists()).toBe(false);
    });
});

describe('the audit log', () => {
    const row = (id, meta) => ({ _id: id, action: 'agent.action', actorId: 'a1', actorName: 'Planner', createdAt: new Date().toISOString(), meta: { actorType: 'agent', action: 'task.comment', reason: 'plan finding', runId: '6f0000000000000000000e01', ...meta } });

    it('marks the rows of a tainted run with the sources as the tooltip', async () => {
        apiRequest.mockResolvedValue({ data: { status: true, data: [row('a', { tainted: true, taintSources: sources }), row('b', {})], metadata: { total: 2, page: 1, totalPages: 1 } } });
        const wrapper = mount(AuditLog, { global: { mocks: { $t: t } } });
        await flushPromises();
        const marks = wrapper.findAll('[data-test="tainted"]');
        expect(marks).toHaveLength(1);
        expect(marks[0].text()).toBe('Read external content');
        expect(marks[0].attributes('title')).toBe('Web page example.com · Form submission 6f0000000000000000000f01');
    });
});
