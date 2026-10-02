import { afterEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import { createI18n } from 'vue-i18n';
import en from '@/locales/en';

const { sendProposalDecision } = vi.hoisted(() => ({ sendProposalDecision: vi.fn() }));

vi.mock('@/composable/agentProposals', () => ({ sendProposalDecision }));
vi.mock('@/composable', () => ({
    useGetterFunctions: () => ({ getUser: (id) => (id === 'u-priya' ? { Employee_Name: 'Priya' } : null) }),
}));

import IntentPreview from '@/components/molecules/IntentPreview/IntentPreview.vue';
import ApprovalQueue from '@/views/Inbox/ApprovalQueue.vue';

const i18n = () => createI18n({ legacy: false, locale: 'en', messages: { en }, missingWarn: false, fallbackWarn: false });

const task = (n) => ({ taskId: `t${n}`, name: `Bulk ${n}`, projectId: 'p-web', sprintId: 's-4', folderId: '' });
const batch = (over = {}) => ({
    kind: 'batch',
    tasks: 20,
    changes: 23,
    lines: [
        { kind: 'batchChange', what: 'status', count: 20, value: 'To Do', mixed: false },
        { kind: 'batchChange', what: 'title', count: 3, value: '', mixed: true },
        { kind: 'batchTasks', tasks: [1, 2, 3, 4, 5].map(task), others: 15 },
    ],
    ...over,
});
const change = (n, reversible = true) => ({ action: 'task.status.change', params: { taskId: `t${n}` }, label: 'task.status.set via MCP', reversible });
const row = (over = {}) => ({
    sourceType: 'proposal', sourceId: 'p1', proposalId: 'p1', kind: 'proposal', agentName: 'Claude (MCP)', source: 'mcp', requestedBy: 'u-priya',
    what: 'A batch of 23 changes', why: 'Back to the start of the week', changes: [1, 2, 3].map((n) => change(n)), batch: batch(),
    gate: null, locked: false, always: false, editable: false, createdAt: '2026-10-02T09:00:00.000Z', unread: true, ...over,
});

let wrapper;
const mountCard = (preview) => {
    wrapper = mount(IntentPreview, { attachTo: document.body, props: { preview }, global: { plugins: [i18n()], stubs: { ShellIcon: true } } });
    return wrapper;
};
const mountQueue = (proposals) => {
    wrapper = mount(ApprovalQueue, { attachTo: document.body, props: { proposals }, global: { plugins: [i18n()], stubs: { ShellIcon: true } } });
    return wrapper;
};
const lines = () => wrapper.findAll('[data-test="intent-line"]').map((el) => [el.find('dt').text(), el.find('dd').text()]);

afterEach(() => { wrapper?.unmount(); wrapper = null; sendProposalDecision.mockReset(); });

describe('the card for a batch that names several tasks', () => {
    it('says how many tasks, what changes on them, and names the first few with how many more', () => {
        mountCard(batch());
        expect(wrapper.find('[data-test="intent-kind"]').text()).toBe('Several tasks');
        expect(wrapper.find('[data-test="intent-title"]').text()).toBe('20 tasks');
        expect(lines().slice(0, 2)).toEqual([['Status', 'To Do, on 20 tasks'], ['Title', 'Different on each of 3 tasks']]);
        expect(wrapper.findAll('[data-test="intent-open-task"]').map((el) => el.text())).toEqual(['Bulk 1', 'Bulk 2', 'Bulk 3', 'Bulk 4', 'Bulk 5']);
        expect(wrapper.find('[data-test="intent-more"]').text()).toBe('and 15 more');
    });

    it('opens a named task when its name is pressed', async () => {
        mountCard(batch());
        await wrapper.findAll('[data-test="intent-open-task"]')[1].trigger('click');
        expect(wrapper.emitted('open-task')).toEqual([[task(2)]]);
    });

    it('writes a priority, a date and an estimate the way a single change shows them, and counts a kind with no value', () => {
        mountCard(batch({ lines: [
            { kind: 'batchChange', what: 'priority', count: 4, value: 'HIGH', mixed: false },
            { kind: 'batchChange', what: 'due', count: 4, value: '2026-10-09', mixed: false },
            { kind: 'batchChange', what: 'estimate', count: 1, value: 90, mixed: false },
            { kind: 'batchChange', what: 'archive', count: 2, value: '', mixed: false },
            { kind: 'batchChange', what: 'something.new', count: 2, value: '', mixed: false },
        ] }));
        expect(lines()).toEqual([
            ['Priority', 'High, on 4 tasks'], ['Due', 'Oct 9, 2026, on 4 tasks'], ['Estimate', '1 h 30 min, on 1 task'],
            ['Archived', '2 tasks'], ['Other changes', '2 tasks'],
        ]);
    });

    it('counts the tasks the person cannot open and names none of them', () => {
        mountCard(batch({ lines: [{ kind: 'batchTasks', tasks: [], others: 3 }] }));
        expect(wrapper.findAll('[data-test="intent-open-task"]')).toHaveLength(0);
        expect(lines()).toEqual([['Tasks', '3 tasks you cannot open']]);
    });

    it('counts changes when the batch names no task, as with new tasks', () => {
        mountCard(batch({ tasks: 0, changes: 2, lines: [{ kind: 'batchChange', what: 'task', count: 2, value: '', mixed: false }] }));
        expect(wrapper.find('[data-test="intent-title"]').text()).toBe('2 changes');
        expect(lines()).toEqual([['New task', '2 tasks']]);
    });

    it('shows a task name that holds markup as the text it is', () => {
        const attack = '<img src=x onerror="window.__hit = 1">';
        mountCard(batch({ lines: [{ kind: 'batchChange', what: 'status', count: 2, value: attack, mixed: false }, { kind: 'batchTasks', tasks: [{ ...task(1), name: attack }], others: 0 }] }));
        expect(wrapper.find('[data-test="intent-open-task"]').text()).toBe(attack);
        expect(wrapper.find('img').exists()).toBe(false);
        expect(window.__hit).toBeUndefined();
    });
});

describe('a batch in the Inbox approval queue', () => {
    it('is one card with one Approve, not a line for each change, and no "Always do this"', () => {
        mountQueue([row()]);
        expect(wrapper.findAll('[data-test="queue-row"]')).toHaveLength(1);
        expect(wrapper.findAll('[data-test="queue-row"] .aq__change')).toHaveLength(1);
        expect(wrapper.findAll('[data-test="intent-preview"]')).toHaveLength(1);
        expect(wrapper.find('[data-test="queue-row"] .aq__what').text()).toBe('Claude (MCP), for Priya wants to change 20 tasks');
        expect(wrapper.find('[data-test="queue-row"]').text()).not.toContain('via MCP');
        expect(wrapper.findAll('[data-test="queue-approve"]')).toHaveLength(1);
        expect(wrapper.find('[data-test="queue-always"]').exists()).toBe(false);
        expect(wrapper.find('[data-test="queue-edit"]').exists()).toBe(false);
        expect(wrapper.find('[data-test="queue-permanent"]').exists()).toBe(false);
    });

    it('approves the proposal as filed with one call', async () => {
        sendProposalDecision.mockResolvedValue({ data: { status: true, data: { applied: [{ ok: true }, { ok: true }, { ok: true }] } } });
        mountQueue([row()]);
        await wrapper.find('[data-test="queue-approve"]').trigger('click');
        await flushPromises();
        expect(sendProposalDecision).toHaveBeenCalledTimes(1);
        expect(sendProposalDecision).toHaveBeenCalledWith('p1', 'approve', {});
    });

    it('marks the batch when one of its changes cannot be undone', () => {
        mountQueue([row({ changes: [change(1), change(2, false)] })]);
        expect(wrapper.findAll('[data-test="queue-permanent"]')).toHaveLength(1);
    });

    it('passes on which task to open', async () => {
        mountQueue([row()]);
        await wrapper.find('[data-test="intent-open-task"]').trigger('click');
        expect(wrapper.emitted('open-task')).toEqual([[task(1)]]);
    });

    it('is read as one line when several rows are reviewed together', async () => {
        mountQueue([row(), row({ proposalId: 'p2', sourceId: 'p2' })]);
        await wrapper.find('[data-test="queue-select-all"]').setValue(true);
        await wrapper.find('[data-test="queue-bulk-review"]').trigger('click');
        const items = wrapper.findAll('[data-test="queue-review-item"]');
        expect(items).toHaveLength(2);
        expect(items[0].findAll('.aq__change')).toHaveLength(1);
        expect(items[0].find('.aq__change-label').text()).toBe('Several tasks: 20 tasks');
    });
});
