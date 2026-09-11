import { beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount, RouterLinkStub } from '@vue/test-utils';
import { createStore } from 'vuex';
import { ref } from 'vue';

const { apiRequest, toast, echo } = vi.hoisted(() => ({
    apiRequest: vi.fn(),
    toast: { success: vi.fn(), error: vi.fn() },
    echo: (key, params) => (params ? `${key} ${JSON.stringify(params)}` : key)
}));

vi.mock('@/services', () => ({ apiRequest }));
vi.mock('@/locales/main', () => ({ i18n: { global: { t: (key) => `t:${key}` } } }));
vi.mock('@/components/organisms/Shell/shellState', () => ({ shellState: { agentsRunning: 0 } }));
vi.mock('vue-toast-notification', () => ({ useToast: () => toast }));
vi.mock('vue-i18n', async (importOriginal) => ({ ...(await importOriginal()), useI18n: () => ({ t: echo }) }));

import AgentRunDetail from '@/views/Ai/AgentRunDetail.vue';

const ok = (data) => Promise.resolve({ data: { status: true, data } });
const httpError = (status, statusText) => Object.assign(new Error(`Request failed with status code ${status}`), { response: { status, data: { status: false, statusText } } });

const future = new Date(Date.now() + 3600e3).toISOString();
const run = {
    _id: 'r1', status: 'done', startedBy: 'u1', windowEndsAt: future,
    decisions: [
        { action: 'task.comment', decision: 'act', reason: 'reversible, one task' },
        { action: 'task.sprint.move', decision: 'propose', reason: 'reaches the project' },
        { action: 'task.delete', decision: 'refuse', reason: 'never available' }
    ]
};

const storeFor = (roleType) => createStore({ modules: { settings: { namespaced: true, getters: { companyUserDetail: () => ({ roleType }) } } } });

const mountDetail = async ({ roleType = 3, userId = 'u1', payload = { run, audit: [] } } = {}) => {
    apiRequest.mockImplementation((type, url) => {
        if (type === 'post' && url.endsWith('/revert')) return ok({ reverted: 2, failed: [{ action: 'task.sprint.move', reason: 'sprint closed' }], windowEndsAt: future });
        return ok(payload);
    });
    const wrapper = mount(AgentRunDetail, { props: { runId: 'r1' }, global: { plugins: [storeFor(roleType)], provide: { $userId: ref(userId), $companyId: ref('company-1') }, mocks: { $t: echo }, stubs: { RouterLink: RouterLinkStub } } });
    await flushPromises();
    return wrapper;
};

describe('AgentRunDetail', () => {
    beforeEach(() => { apiRequest.mockReset(); toast.success.mockReset(); toast.error.mockReset(); });

    it('lists every decision with its chip and reason', async () => {
        const wrapper = await mountDetail();
        const rows = wrapper.findAll('.run-decisions__row');
        expect(rows).toHaveLength(3);
        expect(rows[0].text()).toContain('task.comment');
        expect(rows[0].find('.ah-chip').classes()).toContain('ah-chip--ok');
        expect(rows[0].find('.ah-chip').text()).toBe('Ai.decision_act');
        expect(rows[1].find('.ah-chip').classes()).toContain('ah-chip--warn');
        expect(rows[2].find('.ah-chip').classes()).toContain('ah-chip--danger');
        expect(rows[2].text()).toContain('never available');
    });

    it('offers revert to the starter and to an owner, not to another member', async () => {
        expect((await mountDetail({ userId: 'u1' })).find('button').exists()).toBe(true);
        expect((await mountDetail({ roleType: 1, userId: 'u9' })).find('button').exists()).toBe(true);
        expect((await mountDetail({ userId: 'u9' })).find('button').exists()).toBe(false);
    });

    it('shows the undo deadline while the window is open', async () => {
        const wrapper = await mountDetail({ payload: { run: { ...run, undoUntil: future, undoable: true, undoReason: '' }, audit: [] } });
        expect(wrapper.find('[data-test="undo-deadline"]').text()).toBe(`Ai.undo_until {"at":"${new Date(future).toLocaleString()}"}`);
        expect(wrapper.find('button').attributes('disabled')).toBeUndefined();
        expect(wrapper.find('[data-test="undo-reason"]').exists()).toBe(false);
    });

    it('keeps the control but disables it with the reason once the window has passed', async () => {
        const past = new Date(Date.now() - 3600e3).toISOString();
        const wrapper = await mountDetail({ payload: { run: { ...run, windowEndsAt: past, undoUntil: past, undoable: false, undoReason: 'undo_window_passed' }, audit: [] } });
        expect(wrapper.find('[data-test="undo-deadline"]').text()).toBe(`Ai.undo_window_closed_at {"at":"${new Date(past).toLocaleString()}"}`);
        const button = wrapper.find('button');
        expect(button.exists()).toBe(true);
        expect(button.attributes('disabled')).toBeDefined();
        expect(button.attributes('title')).toBe('Ai.undo_window_passed');
        expect(wrapper.find('[data-test="undo-reason"]').text()).toBe('Ai.undo_window_passed');
        await button.trigger('click');
        expect(apiRequest.mock.calls.some(([type]) => type === 'post')).toBe(false);
    });

    it('hides the control entirely when the caller cannot see the project', async () => {
        const wrapper = await mountDetail({ roleType: 1, payload: { run: { ...run, undoUntil: future, undoable: false, undoReason: 'project_not_visible' }, audit: [] } });
        expect(wrapper.find('button').exists()).toBe(false);
        expect(wrapper.find('[data-test="undo-reason"]').exists()).toBe(false);
        const denied = await mountDetail({ payload: { run: { ...run, undoUntil: future, undoable: false, undoReason: 'not_permitted' }, audit: [] } });
        expect(denied.find('button').exists()).toBe(false);
    });

    it('hides revert once the run is reverted and shows the reverted state', async () => {
        const wrapper = await mountDetail({ payload: { run: { ...run, revertedAt: '2026-09-05T10:00:00Z' }, audit: [] } });
        expect(wrapper.find('button').exists()).toBe(false);
        expect(wrapper.find('.run-detail__head .ah-chip--dark').text()).toContain('Ai.reverted_at');
    });

    it('reverts, reports the partial failure and reloads the run', async () => {
        const wrapper = await mountDetail();
        await wrapper.find('button').trigger('click');
        await flushPromises();
        expect(apiRequest).toHaveBeenCalledWith('post', '/api/v2/agents/runs/r1/revert', {});
        expect(toast.success).toHaveBeenCalled();
        expect(wrapper.find('.run-detail__result').text()).toContain('task.sprint.move');
        expect(wrapper.find('.run-detail__result').text()).toContain('sprint closed');
        expect(wrapper.emitted('reverted')[0][0]).toEqual({ reverted: 2, failed: [{ action: 'task.sprint.move', reason: 'sprint closed' }] });
        expect(apiRequest.mock.calls.filter(([type]) => type === 'get')).toHaveLength(2);
    });

    it('shows the episode above the decisions with the decline reason spelled out', async () => {
        const episode = { proposed: 3, acted: 1, approved: 2, declined: 1, reverted: false, declinedReason: 'too_many_changes' };
        const wrapper = await mountDetail({ payload: { run: { ...run, episode }, audit: [] } });
        const block = wrapper.find('[data-test="episode"]');
        expect(block.exists()).toBe(true);
        expect(block.element.compareDocumentPosition(wrapper.find('.run-decisions').element) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
        expect(block.findAll('li').map((li) => li.text())).toEqual([
            'Ai.episode_proposed {"n":3}',
            'Ai.episode_acted {"n":1}',
            'Ai.episode_approved {"n":2}',
            'Ai.episode_declined_reason {"n":1,"reason":"Ai.decline_reason_too_many_changes"}',
            'Ai.episode_reverted_no'
        ]);
        expect(wrapper.find('[data-test="waiting"]').exists()).toBe(false);

        const free = await mountDetail({ payload: { run: { ...run, episode: { ...episode, declinedReason: 'sprint already locked', reverted: true } }, audit: [] } });
        expect(free.find('[data-test="episode-reverted"]').text()).toBe('Ai.episode_reverted_yes');
        expect(free.find('[data-test="episode-declined"]').text()).toBe('Ai.episode_declined_reason {"n":1,"reason":"sprint already locked"}');

        const quiet = await mountDetail({ payload: { run: { ...run, episode: { ...episode, declined: 0, declinedReason: '' } }, audit: [] } });
        expect(quiet.find('[data-test="episode-declined"]').text()).toBe('Ai.episode_declined {"n":0}');

        const none = await mountDetail();
        expect(none.find('[data-test="episode"]').exists()).toBe(false);
    });

    it('says the run ended before review instead of an all-zero outcome for failed, skipped and stopped runs', async () => {
        const zero = { proposed: 0, acted: 0, approved: 0, declined: 0, reverted: false, declinedReason: '' };
        for (const status of ['failed', 'skipped', 'stopped']) {
            // eslint-disable-next-line no-await-in-loop
            const wrapper = await mountDetail({ payload: { run: { ...run, status, episode: zero }, audit: [] } });
            expect(wrapper.find('[data-test="episode"]').exists()).toBe(false);
            expect(wrapper.find('[data-test="episode-not-reached"]').text()).toBe('Ai.episode_not_reached');
        }

        const done = await mountDetail({ payload: { run: { ...run, episode: zero }, audit: [] } });
        expect(done.find('[data-test="episode"]').exists()).toBe(true);
        expect(done.find('[data-test="episode-not-reached"]').exists()).toBe(false);
    });

    it('says the run continues when a person decides while it waits for approval', async () => {
        const wrapper = await mountDetail({ payload: { run: { ...run, status: 'waiting_approval', windowEndsAt: undefined }, audit: [] } });
        expect(wrapper.find('[data-test="waiting"]').text()).toBe('Ai.episode_waiting');
        expect(wrapper.find('[data-test="episode"]').exists()).toBe(false);
    });

    it('puts the server refusal in the toast when the window has closed', async () => {
        const wrapper = await mountDetail();
        apiRequest.mockImplementation((type) => (type === 'post' ? Promise.reject(httpError(409, 'The undo window closed 3 hours ago.')) : ok({ run, audit: [] })));
        await wrapper.find('button').trigger('click');
        await flushPromises();
        expect(toast.error).toHaveBeenCalledWith('The undo window closed 3 hours ago.', { position: 'top-right' });
    });

    it('shows the pinned agent revision linked to the history panel, with the skill identity', async () => {
        const pinned = { ...run, agentId: 'a1', agentRevision: 2, skill: 'qa-review', skillRevision: { key: 'qa-review', hash: 'abc123def4567890', n: null } };
        const wrapper = await mountDetail({ payload: { run: pinned, audit: [], revision: { n: 2, state: 'superseded', synthetic: false } } });
        const link = wrapper.find('[data-test="revision-link"]');
        expect(link.text()).toBe('Ai.run_revision {"n":2}');
        expect(wrapper.findComponent(RouterLinkStub).props('to')).toEqual({ name: 'AiAgent', params: { cid: 'company-1', id: 'a1' }, query: { rev: 2 }, hash: '#revisions' });
        expect(wrapper.find('[data-test="skill-identity"]').text()).toBe('Ai.run_skill_identity {"key":"qa-review","hash":"abc123def4567890"}');
        expect(wrapper.find('[data-test="revision-zero"]').exists()).toBe(false);
    });

    it('names revision 0 for a run from before revisions and falls back to the skill slug', async () => {
        const wrapper = await mountDetail({ payload: { run: { ...run, skill: 'qa-review' }, audit: [], revision: { n: 0, state: 'live', synthetic: true } } });
        expect(wrapper.find('[data-test="revision-zero"]').text()).toBe('Ai.run_revision_zero');
        expect(wrapper.find('[data-test="revision-link"]').exists()).toBe(false);
        expect(wrapper.find('[data-test="skill-identity"]').text()).toBe('Ai.run_skill_identity_nohash {"key":"qa-review"}');
    });

    it('reads a data-skill revision number once one is pinned', async () => {
        const wrapper = await mountDetail({ payload: { run: { ...run, agentId: 'a1', agentRevision: 5, skillRevision: { key: 'brief.parse', hash: null, n: 3 } }, audit: [] } });
        expect(wrapper.find('[data-test="revision-link"]').text()).toBe('Ai.run_revision {"n":5}');
        expect(wrapper.find('[data-test="skill-identity"]').text()).toBe('Ai.run_skill_identity_n {"key":"brief.parse","n":3}');
    });
});
