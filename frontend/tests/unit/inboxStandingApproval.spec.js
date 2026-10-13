import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import { createI18n } from 'vue-i18n';
import en from '@/locales/en';

const { sendProposalDecision } = vi.hoisted(() => ({ sendProposalDecision: vi.fn() }));

vi.mock('@/composable/agentProposals', () => ({ sendProposalDecision }));
vi.mock('@/composable', () => ({
    useGetterFunctions: () => ({ getUser: (id) => (id === 'u-priya' ? { Employee_Name: 'Priya' } : null) }),
}));

import ApprovalQueue from '@/views/Inbox/ApprovalQueue.vue';

const change = (label, over = {}) => ({ action: 'task.comment', params: { taskId: 't1', body: label }, label, reversible: true, ...over });
const row = (id, over = {}) => ({
    sourceType: 'proposal', sourceId: id, proposalId: id, kind: 'proposal', agentName: 'Claude', source: 'mcp', requestedBy: 'u-priya',
    what: `Tidy ${id}`, why: `Because ${id}`, changes: [change(`Comment on ${id}`)], gate: null, locked: false, editable: false,
    always: true, alwaysKind: 'Comment on a task', createdAt: '2026-09-28T09:00:00.000Z', unread: true, ...over,
});
const STANDING = { id: 's1', action: 'task.comment', expiresAt: '2026-12-27T09:00:00.000Z' };
const done = (data = {}) => Promise.resolve({ data: { status: true, data: { applied: [{ ok: true }], undoUntil: '2026-09-28T09:15:00.000Z', ...data } } });
const refused = (statusText) => Promise.reject(Object.assign(new Error('Request failed'), { response: { data: { status: false, statusText } } }));

let wrapper;
const mountQueue = (proposals, applied = []) => {
    const i18n = createI18n({ legacy: false, locale: 'en', messages: { en }, missingWarn: false, fallbackWarn: false });
    wrapper = mount(ApprovalQueue, { attachTo: document.body, props: { proposals, applied }, global: { plugins: [i18n], stubs: { ShellIcon: true } } });
    return wrapper;
};
const rowOf = (id) => wrapper.find(`[data-test="queue-row"][data-id="${id}"]`);
const emitted = (name) => (wrapper.emitted(name) || []).map(([payload]) => payload);

beforeEach(() => { sendProposalDecision.mockReset(); sendProposalDecision.mockImplementation(() => done({ standing: STANDING })); });
afterEach(() => { wrapper?.unmount(); wrapper = null; });

describe('"Always do this" on a row of the approval queue', () => {
    it('is offered only where the server offers it, and never on a locked row', () => {
        mountQueue([row('p1'), row('p2', { always: false }), row('p3', { locked: true, always: true })]);
        expect(rowOf('p1').find('[data-test="queue-always"]').exists()).toBe(true);
        expect(rowOf('p2').find('[data-test="queue-always"]').exists()).toBe(false);
        expect(rowOf('p3').find('[data-test="queue-always"]').exists()).toBe(false);
    });

    it('says what it will cover, for whom, and how it ends, before anything is sent', async () => {
        mountQueue([row('p1')]);
        await rowOf('p1').find('[data-test="queue-always"]').trigger('click');
        const panel = rowOf('p1').find('[data-test="queue-always-panel"]');
        expect(panel.exists()).toBe(true);
        expect(panel.attributes('role')).toBe('group');
        expect(panel.text()).toContain('Claude, for Priya');
        expect(panel.text()).toContain(en.AgentActions.task_comment);
        expect(panel.text()).toContain('90 days');
        expect(panel.text()).toContain('this project');
        expect(sendProposalDecision).not.toHaveBeenCalled();
        expect(document.activeElement).toBe(panel.element);
    });

    it('sends the approval with the switch on confirm, and says what was kept', async () => {
        mountQueue([row('p1')]);
        await rowOf('p1').find('[data-test="queue-always"]').trigger('click');
        await rowOf('p1').find('[data-test="queue-always-confirm"]').trigger('click');
        await flushPromises();
        expect(sendProposalDecision).toHaveBeenCalledTimes(1);
        expect(sendProposalDecision).toHaveBeenCalledWith('p1', 'approve', { always: true });
        expect(emitted('decided')).toEqual([expect.objectContaining({ id: 'p1', verb: 'approve', undo: true })]);
        expect(wrapper.find('[data-test="queue-summary"]').text()).toContain('Claude');
    });

    it('sends nothing when the person backs out, and the plain Approve stays as it was', async () => {
        mountQueue([row('p1')]);
        await rowOf('p1').find('[data-test="queue-always"]').trigger('click');
        await rowOf('p1').find('[data-test="queue-always-cancel"]').trigger('click');
        expect(rowOf('p1').find('[data-test="queue-always-panel"]').exists()).toBe(false);
        expect(sendProposalDecision).not.toHaveBeenCalled();
        await rowOf('p1').find('[data-test="queue-approve"]').trigger('click');
        await flushPromises();
        expect(sendProposalDecision).toHaveBeenCalledWith('p1', 'approve', {});
    });

    it('keeps the row and shows the reason when the server refuses', async () => {
        sendProposalDecision.mockImplementation(() => refused('This change cannot be approved always: it closes a task.'));
        mountQueue([row('p1')]);
        await rowOf('p1').find('[data-test="queue-always"]').trigger('click');
        await rowOf('p1').find('[data-test="queue-always-confirm"]').trigger('click');
        await flushPromises();
        expect(rowOf('p1').find('[data-test="queue-row-error"]').text()).toContain('cannot be approved always');
        expect(emitted('decided')).toEqual([]);
    });

    it('says so when the change was approved but nothing was kept', async () => {
        sendProposalDecision.mockImplementation(() => done({ applied: [{ ok: false, error: 'Task not found' }], standing: null }));
        mountQueue([row('p1')]);
        await rowOf('p1').find('[data-test="queue-always"]').trigger('click');
        await rowOf('p1').find('[data-test="queue-always-confirm"]').trigger('click');
        await flushPromises();
        expect(wrapper.find('[data-test="queue-summary"]').text()).toContain('Task not found');
        expect(wrapper.find('[data-test="queue-summary"]').text()).not.toContain('will not ask');
    });

    it('is not one of the rows approved together', async () => {
        mountQueue([row('p1'), row('p2')]);
        await wrapper.find('[data-test="queue-select-all"]').setValue(true);
        await wrapper.find('[data-test="queue-bulk-review"]').trigger('click');
        await wrapper.find('[data-test="queue-bulk-confirm"]').trigger('click');
        await flushPromises();
        expect(sendProposalDecision.mock.calls.map(([, , body]) => body)).toEqual([{}, {}]);
    });
});

describe('what a standing approval applied', () => {
    const applied = (id, over = {}) => row(id, { always: false, unread: false, undoUntil: '2026-09-28T09:15:00.000Z', ...over });

    it('is listed as done, with who did it and an Undo', () => {
        mountQueue([], [applied('d1')]);
        const done1 = wrapper.find('[data-test="queue-applied"][data-id="d1"]');
        expect(done1.exists()).toBe(true);
        expect(done1.text()).toContain('Claude, for Priya');
        expect(done1.text()).toContain('Tidy d1');
        expect(done1.find('[data-test="queue-applied-undo"]').attributes('aria-label')).toContain('Tidy d1');
        expect(wrapper.findAll('[data-test="queue-row"]')).toHaveLength(0);
    });

    it('undoes through the same decision call, and tells the page', async () => {
        mountQueue([], [applied('d1')]);
        await wrapper.find('[data-test="queue-applied-undo"]').trigger('click');
        await flushPromises();
        expect(sendProposalDecision).toHaveBeenCalledWith('d1', 'undo', {});
        expect(emitted('undone')).toEqual([{ id: 'd1' }]);
    });

    it('shows why when the undo is refused, and keeps the row', async () => {
        sendProposalDecision.mockImplementation(() => refused('The undo window has closed.'));
        mountQueue([], [applied('d1')]);
        await wrapper.find('[data-test="queue-applied-undo"]').trigger('click');
        await flushPromises();
        expect(wrapper.find('[data-test="queue-applied"]').text()).toContain('The undo window has closed.');
        expect(emitted('undone')).toEqual([]);
    });

    it('shows no such list when there is nothing in it', () => {
        mountQueue([row('p1')]);
        expect(wrapper.find('[data-test="queue-applied-list"]').exists()).toBe(false);
    });
});
