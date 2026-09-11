import { beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';

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

import AgentRevisionHistory from '@/views/Ai/AgentRevisionHistory.vue';

const ok = (data) => Promise.resolve({ data: { status: true, data } });
const at = '2026-09-01T10:00:00.000Z';
const revisions = () => [
    { n: 1, state: 'superseded', source: 'migration', createdBy: 'u1', createdByName: 'Mira', createdAt: at, snapshot: { name: 'Reviewer', autonomy: 1, allowedActions: ['task.comment'] } },
    { n: 2, state: 'live', source: 'save', createdBy: 'u2', createdByName: 'Omar', createdAt: at, snapshot: { name: 'Reviewer', autonomy: 2, allowedActions: ['task.comment'] } },
    { n: 3, state: 'candidate', source: 'draft', note: 'try L3', createdBy: 'u2', createdByName: 'Omar', createdAt: at, snapshot: { name: 'Reviewer', autonomy: 3, allowedActions: ['task.comment', 'subtask.create'] } }
];

const mountPanel = async (props = {}) => {
    apiRequest.mockImplementation((type, url) => {
        if (type === 'post' && url.endsWith('/promote')) return ok({ revision: { n: 3, state: 'live' }, from: 2 });
        if (type === 'post' && url.endsWith('/rollback')) return ok({ revision: { n: 4, state: 'live' }, from: 2, rollbackOf: 1 });
        return ok(revisions());
    });
    const wrapper = mount(AgentRevisionHistory, { props: { agentId: 'a1', ...props }, global: { mocks: { $t: echo } } });
    await flushPromises();
    return wrapper;
};

describe('AgentRevisionHistory', () => {
    beforeEach(() => { apiRequest.mockReset(); toast.success.mockReset(); toast.error.mockReset(); });

    it('lists every revision newest first with state, who, when and what changed', async () => {
        const wrapper = await mountPanel();
        expect(apiRequest).toHaveBeenCalledWith('get', '/api/v2/agents/a1/revisions', undefined);
        const rows = wrapper.findAll('.ai-revisions__row');
        expect(rows.map((r) => r.attributes('data-test'))).toEqual(['revision-3', 'revision-2', 'revision-1']);
        expect(rows[0].find('[data-test="state"]').text()).toBe('Ai.revision_state_candidate');
        expect(rows[0].text()).toContain('Omar');
        expect(rows[0].text()).toContain('try L3');
        expect(rows[0].find('[data-test="what"]').text()).toContain('Ai.revision_what_changed {"fields":"allowedActions, autonomy"}');
        expect(rows[1].classes()).toContain('is-live');
        expect(rows[2].find('[data-test="what"]').text()).toBe('Ai.revision_what_first');
    });

    it('names the consequence in each control: promote replaces the live one, rollback creates a copy', async () => {
        const wrapper = await mountPanel();
        const promote = wrapper.find('[data-test="revision-3"] [data-test="promote"]');
        expect(promote.text()).toBe('Ai.revision_promote {"n":3,"live":2}');
        const rollback = wrapper.find('[data-test="revision-1"] [data-test="rollback"]');
        expect(rollback.text()).toBe('Ai.revision_rollback {"n":1,"next":4}');
        expect(wrapper.find('[data-test="revision-2"] button').exists()).toBe(false);
    });

    it('opens on live against the previous revision and diffs any pair picked', async () => {
        const wrapper = await mountPanel();
        expect(wrapper.find('[data-test="diff"] .ah-label').text()).toBe('Ai.revision_diff_title {"from":"Ai.revision_n {\\"n\\":1}","to":"Ai.revision_n {\\"n\\":2}"}');
        let rows = wrapper.findAll('[data-test="diff-row"]');
        expect(rows).toHaveLength(1);
        expect(rows[0].text()).toContain('autonomy');
        await wrapper.find('[data-test="revision-3"] input[name="rev-to"]').setValue(true);
        rows = wrapper.findAll('[data-test="diff-row"]');
        expect(rows.map((r) => r.find('.ah-mono').text())).toEqual(['allowedActions', 'autonomy']);
        expect(rows[0].find('.ai-revisions__to').text()).toBe('task.comment, subtask.create');
    });

    it('a highlighted revision is marked and compared against the one before it', async () => {
        const wrapper = await mountPanel({ highlight: 3 });
        expect(wrapper.find('[data-test="revision-3"]').classes()).toContain('is-highlight');
        expect(wrapper.find('[data-test="diff"] .ah-label').text()).toContain('"to":"Ai.revision_n {\\"n\\":3}"');
    });

    it('promote and rollback are one click each, reload the list and tell the parent', async () => {
        const wrapper = await mountPanel();
        await wrapper.find('[data-test="revision-3"] [data-test="promote"]').trigger('click');
        await flushPromises();
        expect(apiRequest).toHaveBeenCalledWith('post', '/api/v2/agents/a1/revisions/3/promote', {});
        expect(toast.success).toHaveBeenCalledWith('Ai.revision_promoted {"n":3,"live":3}', expect.anything());
        expect(wrapper.emitted('changed')).toHaveLength(1);

        await wrapper.find('[data-test="revision-1"] [data-test="rollback"]').trigger('click');
        await flushPromises();
        expect(apiRequest).toHaveBeenCalledWith('post', '/api/v2/agents/a1/revisions/1/rollback', {});
        expect(toast.success).toHaveBeenCalledWith('Ai.revision_rolled_back {"n":1,"live":4}', expect.anything());
        expect(wrapper.emitted('changed')).toHaveLength(2);
        expect(apiRequest.mock.calls.filter(([type]) => type === 'get')).toHaveLength(3);
    });

    it('shows the refusal when the server declines', async () => {
        apiRequest.mockImplementation((type) => {
            if (type === 'post') return Promise.reject(Object.assign(new Error('Request failed with status code 409'), { response: { status: 409, data: { status: false, statusText: 'Revision 1 is superseded; roll back to it instead.' } } }));
            return ok(revisions());
        });
        const wrapper = mount(AgentRevisionHistory, { props: { agentId: 'a1' }, global: { mocks: { $t: echo } } });
        await flushPromises();
        await wrapper.find('[data-test="revision-3"] [data-test="promote"]').trigger('click');
        await flushPromises();
        expect(toast.error).toHaveBeenCalledWith('Revision 1 is superseded; roll back to it instead.', expect.anything());
        expect(wrapper.emitted('changed')).toBeUndefined();
    });
});
