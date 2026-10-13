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
    sourceType: 'proposal', sourceId: id, proposalId: id, kind: 'proposal', agentName: 'Reviewer', source: '', requestedBy: '',
    what: `Tidy ${id}`, why: `Because ${id}`, changes: [change(`Comment on ${id}`), change(`Second on ${id}`)],
    gate: null, locked: false, editable: true, createdAt: '2026-09-28T09:00:00.000Z', unread: true, ...over,
});

const done = (data = {}) => Promise.resolve({ data: { status: true, data: { applied: [{ ok: true }], undoUntil: '2026-09-28T09:15:00.000Z', ...data } } });
const refused = (statusText) => Promise.reject(Object.assign(new Error('Request failed'), { response: { data: { status: false, statusText } } }));

let wrapper;
const mountQueue = (proposals) => {
    const i18n = createI18n({ legacy: false, locale: 'en', messages: { en }, missingWarn: false, fallbackWarn: false });
    wrapper = mount(ApprovalQueue, { attachTo: document.body, props: { proposals }, global: { plugins: [i18n], stubs: { ShellIcon: true } } });
    return wrapper;
};
const rowOf = (id) => wrapper.find(`[data-test="queue-row"][data-id="${id}"]`);
const decided = () => (wrapper.emitted('decided') || []).map(([payload]) => payload);

beforeEach(() => { sendProposalDecision.mockReset(); sendProposalDecision.mockImplementation(() => done()); });
afterEach(() => { wrapper?.unmount(); wrapper = null; });

describe('a row of the approval queue', () => {
    it('says who proposes, what, why and each change', () => {
        mountQueue([row('p1', { agentName: 'Claude', source: 'mcp', requestedBy: 'u-priya', editable: false, changes: [change('Close the task', { reversible: false })] })]);
        const text = rowOf('p1').text();
        expect(text).toContain('Claude, for Priya');
        expect(text).toContain('Tidy p1');
        expect(text).toContain('Because p1');
        expect(text).toContain('Close the task');
        expect(rowOf('p1').find('[data-test="queue-permanent"]').exists()).toBe(true);
    });

    it('shows a Slack message with its channel and exact text', () => {
        const slack = { action: 'slack.message.post', params: { channelName: 'launch', channelId: 'C1', text: 'We ship on Friday' }, label: 'Post to #launch', reversible: false };
        mountQueue([row('p1', { changes: [slack] })]);
        expect(rowOf('p1').find('[data-test="slack-post-channel"]').text()).toContain('launch');
        expect(rowOf('p1').find('[data-test="slack-post-text"]').text()).toBe('We ship on Friday');
    });

    it('is locked, with nothing to press, when it needs an owner or admin', () => {
        mountQueue([row('p1', { gate: 'owner_admin', locked: true })]);
        expect(rowOf('p1').find('[data-test="queue-locked"]').exists()).toBe(true);
        expect(rowOf('p1').findAll('button')).toHaveLength(0);
        expect(rowOf('p1').find('[data-test="queue-select"]').exists()).toBe(false);
    });

    /* [what the row is, the fields the server sends, the chip, the note under it, whether Decline is offered] */
    it.each([
        ['one that needs an owner or admin', { gate: 'owner_admin', locked: true, lockedWhy: 'owner_admin', mayDecline: false }, en.Inbox.queue_locked, en.Ai.gate_locked, false],
        ['one whose change the reader may not make by hand', { locked: true, lockedWhy: 'own_rights', mayDecline: false }, en.Inbox.queue_locked_rights, en.Ai.rights_locked, false],
        ['one the reader\'s own agent asked for', { locked: true, lockedWhy: 'own_rights', mayDecline: true }, en.Inbox.queue_locked_rights, en.Ai.rights_locked, true],
    ])('a locked row says why and never offers Approve: %s', async (_what, fields, chip, note, declines) => {
        mountQueue([row('p1', fields)]);
        expect(rowOf('p1').find('[data-test="queue-locked"]').text()).toBe(chip);
        expect(rowOf('p1').find('[data-test="queue-locked-note"]').text()).toBe(note);
        expect(rowOf('p1').find('[data-test="queue-approve"]').exists()).toBe(false);
        expect(rowOf('p1').find('[data-test="queue-select"]').exists()).toBe(false);
        expect(rowOf('p1').find('[data-test="queue-decline"]').exists()).toBe(declines);
        if (!declines) return;
        await rowOf('p1').find('[data-test="queue-decline"]').trigger('click');
        await rowOf('p1').find('[data-test="queue-decline-skip"]').trigger('click');
        await flushPromises();
        expect(sendProposalDecision).toHaveBeenCalledWith('p1', 'decline', {});
        expect(decided()).toEqual([expect.objectContaining({ id: 'p1', verb: 'decline' })]);
    });

    it('approves as filed', async () => {
        mountQueue([row('p1')]);
        await rowOf('p1').find('[data-test="queue-approve"]').trigger('click');
        await flushPromises();
        expect(sendProposalDecision).toHaveBeenCalledWith('p1', 'approve', {});
        expect(decided()).toEqual([expect.objectContaining({ id: 'p1', verb: 'approve', undo: true })]);
    });

    it('edits, then approves only the changes that were kept', async () => {
        mountQueue([row('p1')]);
        await rowOf('p1').find('[data-test="queue-edit"]').trigger('click');
        await rowOf('p1').findAll('[data-test="queue-drop"]')[1].trigger('click');
        await rowOf('p1').find('[data-test="queue-approve"]').trigger('click');
        await flushPromises();
        expect(sendProposalDecision).toHaveBeenCalledWith('p1', 'approve', { changes: [change('Comment on p1')] });
    });

    it('offers no edit for a change a connected agent filed', () => {
        mountQueue([row('p1', { source: 'mcp', editable: false })]);
        expect(rowOf('p1').find('[data-test="queue-edit"]').exists()).toBe(false);
        expect(rowOf('p1').find('[data-test="queue-approve"]').exists()).toBe(true);
    });

    it('declines with a reason picked from the list', async () => {
        mountQueue([row('p1')]);
        await rowOf('p1').find('[data-test="queue-decline"]').trigger('click');
        await rowOf('p1').find('[data-reason="wrong_tone"]').trigger('click');
        await rowOf('p1').find('[data-test="queue-decline-send"]').trigger('click');
        await flushPromises();
        expect(sendProposalDecision).toHaveBeenCalledWith('p1', 'decline', { reason: 'wrong_tone' });
        expect(decided()).toEqual([expect.objectContaining({ id: 'p1', verb: 'decline' })]);
    });

    it('declines with a reason in the person\'s own words, or with none', async () => {
        mountQueue([row('p1'), row('p2')]);
        await rowOf('p1').find('[data-test="queue-decline"]').trigger('click');
        await rowOf('p1').find('[data-test="queue-decline-note"]').setValue('The client asked us to wait');
        await rowOf('p1').find('[data-test="queue-decline-send"]').trigger('click');
        await flushPromises();
        expect(sendProposalDecision).toHaveBeenCalledWith('p1', 'decline', { reason: 'The client asked us to wait' });
        await rowOf('p2').find('[data-test="queue-decline"]').trigger('click');
        await rowOf('p2').find('[data-test="queue-decline-skip"]').trigger('click');
        await flushPromises();
        expect(sendProposalDecision).toHaveBeenLastCalledWith('p2', 'decline', {});
    });

    it('keeps the row and says why when the server refuses', async () => {
        sendProposalDecision.mockImplementation(() => refused('The approver may not make this change.'));
        mountQueue([row('p1')]);
        await rowOf('p1').find('[data-test="queue-approve"]').trigger('click');
        await flushPromises();
        expect(decided()).toEqual([]);
        expect(rowOf('p1').find('[data-test="queue-row-error"]').text()).toContain('The approver may not make this change.');
    });
});

describe('approving several at once', () => {
    const tick = (id) => rowOf(id).find('[data-test="queue-select"]').setValue(true);

    it('shows the full list first, then approves each one by one and reports each result', async () => {
        sendProposalDecision.mockImplementation((id) => (id === 'p2' ? refused('This agent was deleted.') : done()));
        mountQueue([row('p1'), row('p2'), row('p3'), row('p4')]);
        await tick('p1'); await tick('p2'); await tick('p3');
        await wrapper.find('[data-test="queue-bulk-review"]').trigger('click');
        expect(sendProposalDecision).not.toHaveBeenCalled();
        const shown = wrapper.findAll('[data-test="queue-review-item"]').map((item) => item.text());
        expect(shown).toHaveLength(3);
        expect(shown[0]).toContain('Tidy p1');
        expect(shown[0]).toContain('Second on p1');
        expect(shown.join(' ')).not.toContain('Tidy p4');

        await wrapper.find('[data-test="queue-bulk-confirm"]').trigger('click');
        await flushPromises();
        expect(sendProposalDecision.mock.calls.map(([id, verb]) => `${verb} ${id}`)).toEqual(['approve p1', 'approve p2', 'approve p3']);
        expect(decided().map((d) => d.id)).toEqual(['p1', 'p3']);
        expect(rowOf('p2').find('[data-test="queue-row-error"]').text()).toContain('This agent was deleted.');
        expect(wrapper.find('[data-test="queue-summary"]').text()).toContain('2 of 3');
    });

    it('approves nothing that left the queue after the list was shown, and nothing that was not ticked', async () => {
        mountQueue([row('p1'), row('p2'), row('p3')]);
        await tick('p1'); await tick('p2');
        await wrapper.find('[data-test="queue-bulk-review"]').trigger('click');
        await wrapper.setProps({ proposals: [row('p1'), row('p3'), row('p5')] });
        await wrapper.find('[data-test="queue-bulk-confirm"]').trigger('click');
        await flushPromises();
        expect(sendProposalDecision.mock.calls.map(([id]) => id)).toEqual(['p1']);
    });

    it('selects every row that can be decided, never a locked one', async () => {
        mountQueue([row('p1'), row('p2', { locked: true, gate: 'owner_admin' }), row('p3')]);
        await wrapper.find('[data-test="queue-select-all"]').setValue(true);
        await wrapper.find('[data-test="queue-bulk-review"]').trigger('click');
        expect(wrapper.findAll('[data-test="queue-review-item"]')).toHaveLength(2);
        await wrapper.find('[data-test="queue-bulk-cancel"]').trigger('click');
        expect(wrapper.find('[data-test="queue-review"]').exists()).toBe(false);
        expect(sendProposalDecision).not.toHaveBeenCalled();
    });

    it('says so when a proposal was approved but one of its changes could not be carried out', async () => {
        sendProposalDecision.mockImplementation(() => done({ applied: [{ ok: true }, { ok: false, error: 'The task was deleted.' }] }));
        mountQueue([row('p1'), row('p2')]);
        await tick('p1'); await tick('p2');
        await wrapper.find('[data-test="queue-bulk-review"]').trigger('click');
        await wrapper.find('[data-test="queue-bulk-confirm"]').trigger('click');
        await flushPromises();
        expect(decided().map((d) => d.id)).toEqual(['p1', 'p2']);
        expect(wrapper.find('[data-test="queue-summary"]').text()).toContain('The task was deleted.');
    });

    it('labels every control for a screen reader', () => {
        mountQueue([row('p1'), row('p2')]);
        expect(rowOf('p1').find('[data-test="queue-select"]').attributes('aria-label')).toContain('Tidy p1');
        expect(rowOf('p1').find('[data-test="queue-approve"]').attributes('aria-label')).toContain('Tidy p1');
        expect(rowOf('p1').find('[data-test="queue-decline"]').attributes('aria-label')).toContain('Tidy p1');
    });
});
