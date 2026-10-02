import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import { createI18n } from 'vue-i18n';
import en from '@/locales/en';

const { sendProposalDecision } = vi.hoisted(() => ({ sendProposalDecision: vi.fn() }));

vi.mock('@/composable/agentProposals', () => ({ sendProposalDecision }));
vi.mock('@/composable', () => ({ useGetterFunctions: () => ({ getUser: () => null }) }));

import IntentPreview from '@/components/molecules/IntentPreview/IntentPreview.vue';
import ApprovalQueue from '@/views/Inbox/ApprovalQueue.vue';
import { canChoose, chosenParts, hiddenParts, keptCounts, lockReason, partsChoice } from '@/components/molecules/IntentPreview/planPicks';

const i18n = () => createI18n({ legacy: false, locale: 'en', messages: { en }, missingWarn: false, fallbackWarn: false });

const OWNER_NOTE = 'An owner or admin approves this part';
const ROLE_NOTE = 'Someone whose role may make this approves this part';

/* A member's card: a status new to the company, lists their role may not make, and a task that needs one of those lists. */
const forMember = () => ({
    kind: 'setup',
    title: 'Website',
    lines: [
        { kind: 'place', project: 'Website', list: '' },
        { kind: 'newStatuses', names: ['In Review', 'Blocked'], picks: ['statuses:0', 'statuses:1'] },
        { kind: 'newLists', names: ['Backlog', 'Later'], picks: ['lists:0', 'lists:1'] },
        { kind: 'field', name: 'Budget', type: 'money', options: [], pick: 'fields:0' },
        { kind: 'planTask', name: 'Write the brief', list: 'Backlog', status: '', assignee: '', hidden: 0, due: '', pick: 'tasks:0' },
    ],
    needs: { 'tasks:0': ['lists:0'] },
    locked: ['statuses:1', 'lists:0', 'lists:1'],
    lockedWhy: { 'statuses:1': 'owner_admin', 'lists:0': 'own_rights', 'lists:1': 'own_rights' },
});

/* A card with parts that have nothing to show: one the server names, and lines that come without words. */
const withBlanks = () => ({
    kind: 'setup',
    title: 'Website',
    lines: [
        { kind: 'newLists', names: ['Backlog', ''], picks: ['lists:0', 'lists:1'] },
        { kind: 'field', name: 'Budget', type: 'money', options: [], pick: 'fields:0' },
        { kind: 'field', name: '', type: 'text', options: [], pick: 'fields:1' },
        { kind: 'planRule', pick: 'rules:0' },
        { kind: 'someKindThisPageDoesNotKnow', name: 'Later', pick: 'tasks:0' },
    ],
    needs: {},
    blank: ['views:0'],
});

const row = (id, preview, over = {}) => ({
    sourceType: 'proposal', sourceId: id, proposalId: id, kind: 'proposal', agentName: 'Claude', source: 'mcp', requestedBy: '', what: 'project.setup', why: 'Because',
    changes: [{ action: 'project.setup', label: 'Set up the project', reversible: true, preview }], gate: null, locked: false, editable: false, createdAt: '2026-10-02T09:00:00.000Z', unread: true, ...over,
});
const answered = (data) => () => Promise.resolve({ data: { status: true, data: { applied: [{ ok: true }], undoUntil: '2026-10-02T09:15:00.000Z', ...data } } });

let wrapper;
afterEach(() => { wrapper?.unmount(); wrapper = null; });
beforeEach(() => { sendProposalDecision.mockReset(); sendProposalDecision.mockImplementation(answered({})); });

const mountCard = (preview, props = { choosable: true }) => {
    wrapper = mount(IntentPreview, { attachTo: document.body, props: { preview, ...props }, global: { plugins: [i18n()], stubs: { ShellIcon: true } } });
    return wrapper;
};
const mountQueue = (proposals) => {
    wrapper = mount(ApprovalQueue, { attachTo: document.body, props: { proposals }, global: { plugins: [i18n()], stubs: { ShellIcon: true } } });
    return wrapper;
};
const box = (key) => wrapper.find(`[data-test="intent-pick"][data-pick="${key}"]`);
const noteOf = (key) => box(key).element.closest('label').querySelector('[data-test="intent-pick-locked"]')?.textContent.trim() || '';

describe('a part of a plan the person reading may not make', () => {
    it('says for each such part who approves it: an owner or admin, or someone whose role may make it', () => {
        expect(lockReason(forMember(), 'statuses:1')).toBe('owner_admin');
        expect(lockReason(forMember(), 'lists:0')).toBe('own_rights');
        expect(lockReason(forMember(), 'tasks:0')).toBe('');
        expect(lockReason({ ...forMember(), lockedWhy: undefined }, 'lists:0')).toBe('owner_admin');
        mountCard(forMember());
        expect(noteOf('statuses:1')).toBe(OWNER_NOTE);
        expect(noteOf('lists:0')).toBe(ROLE_NOTE);
        expect(noteOf('lists:1')).toBe(ROLE_NOTE);
        expect(noteOf('statuses:0')).toBe('');
        expect(noteOf('tasks:0')).toBe('');
    });

    it('is shown unticked and held, with the part that needs it, and is never one of the parts sent', () => {
        mountCard(forMember());
        for (const key of ['statuses:1', 'lists:0', 'lists:1', 'tasks:0']) {
            expect(box(key).element.checked).toBe(false);
            expect(box(key).element.disabled).toBe(true);
        }
        expect(box('statuses:0').element.checked).toBe(true);
        expect(box('fields:0').element.disabled).toBe(false);
        expect(wrapper.find('[data-test="intent-pick-held"]').text()).toBe('“Write the brief” is left out too: it needs “Backlog”.');
        expect(chosenParts(forMember(), [])).toEqual({ statuses: [0], lists: [], fields: [0], tasks: [] });
        expect(keptCounts(forMember(), []).map((count) => [count.part, count.kept, count.of])).toEqual([['statuses', 1, 2], ['lists', 0, 2], ['tasks', 0, 1]]);
    });

    it('is left out of the approval sent from the queue, which says what stays waiting and asks for the list again', async () => {
        sendProposalDecision.mockImplementation(answered({ left: { waiting: ['p2'], retry: [] } }));
        mountQueue([row('p1', forMember())]);
        await wrapper.find('[data-test="queue-approve"]').trigger('click');
        await flushPromises();
        expect(sendProposalDecision).toHaveBeenCalledWith('p1', 'approve', { parts: { 0: { statuses: [0], lists: [], fields: [0], tasks: [] } } });
        expect(wrapper.find('[data-test="queue-summary"]').text()).toBe('What you may not approve stays waiting for someone who may.');
        expect(wrapper.emitted('decided')[0][0]).toMatchObject({ id: 'p1', verb: 'approve', more: true });
    });

    it('asks for no second read of the list where an approval left nothing behind', async () => {
        mountQueue([row('p1', { ...forMember(), locked: undefined, lockedWhy: undefined })]);
        await wrapper.find('[data-test="queue-approve"]').trigger('click');
        await flushPromises();
        expect(sendProposalDecision).toHaveBeenCalledWith('p1', 'approve', {});
        expect(wrapper.emitted('decided')[0][0].more).toBeUndefined();
        expect(wrapper.find('[data-test="queue-summary"]').exists()).toBe(false);
    });
});

describe('a part this plan cannot make for anyone', () => {
    const PLAN_NOTE = 'This cannot be made through this plan. An owner or admin can add the status in Settings, or ask their own AI.';
    const stuck = () => ({ ...forMember(), locked: ['statuses:1'], lockedWhy: { 'statuses:1': 'not_this_plan' } });

    it('says so in one line on that part, holds it unticked and leaves it out of what is sent', () => {
        expect(lockReason(stuck(), 'statuses:1')).toBe('not_this_plan');
        mountCard(stuck());
        expect(noteOf('statuses:1')).toBe(PLAN_NOTE);
        expect(box('statuses:1').element.checked).toBe(false);
        expect(box('statuses:1').element.disabled).toBe(true);
        expect(box('lists:0').element.disabled).toBe(false);
        expect(chosenParts(stuck(), [])).toEqual({ statuses: [0], lists: [0, 1], fields: [0], tasks: [0] });
    });

    it('is named on a row that holds nothing else, which nobody can approve', () => {
        mountQueue([row('p1', stuck(), { locked: true, lockedWhy: 'not_this_plan', mayDecline: true })]);
        expect(wrapper.find('[data-test="queue-locked"]').text()).toBe('Cannot be made through this plan');
        expect(wrapper.find('[data-test="queue-locked-note"]').text()).toBe('Nothing in this plan can be made through it. Decline it. An owner or admin can add the status in Settings, or ask their own AI.');
        expect(wrapper.find('[data-test="queue-approve"]').exists()).toBe(false);
        expect(wrapper.find('[data-test="queue-decline"]').exists()).toBe(true);
    });
});

describe('a part that was not made the first time', () => {
    const again = (over = {}) => row('p9', { kind: 'setup', title: 'Website', lines: [{ kind: 'newLists', names: ['Backlog'], picks: ['lists:0'] }], needs: {} }, { retry: { why: 'The server was busy.' }, ...over });

    it('is offered to the person who approved, with why it was not made', async () => {
        mountQueue([again()]);
        expect(wrapper.find('[data-test="queue-retry-note"]').text()).toBe('This was not made the first time, so you can try it once more. Why it was not made: The server was busy.');
        expect(wrapper.find('[data-test="queue-approve"]').exists()).toBe(true);
        await wrapper.find('[data-test="queue-approve"]').trigger('click');
        await flushPromises();
        expect(sendProposalDecision).toHaveBeenCalledWith('p9', 'approve', {});
    });

    it('is shown to anyone else as waiting for that person, with nothing to approve', () => {
        mountQueue([again({ locked: true, lockedWhy: 'first_approver', mayDecline: true })]);
        expect(wrapper.find('[data-test="queue-locked"]').text()).toBe('Waits for the person who approved the plan');
        expect(wrapper.find('[data-test="queue-locked-note"]').text()).toBe('Only the person who approved this plan can try these parts again.');
        expect(wrapper.find('[data-test="queue-retry-note"]').exists()).toBe(false);
        expect(wrapper.find('[data-test="queue-approve"]').exists()).toBe(false);
        expect(wrapper.find('[data-test="queue-decline"]').exists()).toBe(true);
        expect(wrapper.findAll('[data-test="intent-pick"]')).toHaveLength(0);
    });

    it('is said after an approval that left one, beside what could not be carried out', async () => {
        sendProposalDecision.mockImplementation(answered({ applied: [{ ok: true, result: { notMade: [{ part: 'lists', name: 'Backlog', error: 'The server was busy.' }] } }], left: { waiting: [], retry: ['p9'] } }));
        mountQueue([row('p1', forMember())]);
        await wrapper.find('[data-test="queue-approve"]').trigger('click');
        await flushPromises();
        expect(wrapper.find('[data-test="queue-summary"]').text()).toBe('Approved, but 1 change(s) could not be carried out: Backlog: The server was busy. What was not made is listed again, so you can try it once more.');
        expect(wrapper.emitted('decided')[0][0].more).toBe(true);
    });
});

describe('a part with nothing to show', () => {
    it('is not one of the parts of the card, whether the server names it or its line has no words', () => {
        expect(hiddenParts(withBlanks())).toEqual(['views:0', 'lists:1', 'fields:1', 'rules:0', 'tasks:0']);
        expect(hiddenParts(forMember())).toEqual([]);
        expect(hiddenParts(null)).toEqual([]);
        expect(canChoose({ kind: 'setup', lines: [{ kind: 'planRule', pick: 'rules:0' }], blank: ['lists:0'] })).toBe(false);
        expect(keptCounts(withBlanks(), [])).toEqual([]);
    });

    it('is never sent as kept, even while every box on the card is ticked', () => {
        expect(chosenParts(withBlanks(), [])).toEqual({ lists: [0], fields: [0], views: [], rules: [], tasks: [] });
        expect(chosenParts(withBlanks(), ['lists:0'])).toEqual({ lists: [], fields: [0], views: [], rules: [], tasks: [] });
        expect(chosenParts({ kind: 'setup', lines: [{ kind: 'planRule', pick: 'rules:0' }] }, [])).toEqual({ rules: [] });
        expect(partsChoice([{ preview: withBlanks() }, { preview: forMember() }, {}], () => [])).toEqual({
            parts: { 0: { lists: [0], fields: [0], views: [], rules: [], tasks: [] }, 1: { statuses: [0], lists: [], fields: [0], tasks: [] } },
        });
        expect(partsChoice([{ preview: { kind: 'view', lines: [] } }], () => [])).toBeNull();
    });

    it('has no box on the card, which says how many parts are left out for that reason', () => {
        mountCard(withBlanks());
        expect(wrapper.findAll('[data-test="intent-pick"]').map((el) => el.attributes('data-pick'))).toEqual(['lists:0', 'fields:0']);
        expect(wrapper.find('[data-test="intent-pick-hidden"]').text()).toBe('5 parts of this plan have nothing to show, so they are left out.');
        wrapper.unmount();
        mountCard({ ...withBlanks(), blank: undefined, lines: withBlanks().lines.slice(0, 3) });
        expect(wrapper.find('[data-test="intent-pick-hidden"]').text()).toBe('2 parts of this plan have nothing to show, so they are left out.');
        wrapper.unmount();
        mountCard(forMember());
        expect(wrapper.find('[data-test="intent-pick-hidden"]').exists()).toBe(false);
        wrapper.unmount();
        mountCard(withBlanks(), {});
        expect(wrapper.find('[data-test="intent-pick-hidden"]').exists()).toBe(false);
    });

    it('is left out of an approval sent from the queue with every box ticked', async () => {
        mountQueue([row('p1', withBlanks())]);
        await wrapper.find('[data-test="queue-approve"]').trigger('click');
        await flushPromises();
        expect(sendProposalDecision).toHaveBeenCalledWith('p1', 'approve', { parts: { 0: { lists: [0], fields: [0], views: [], rules: [], tasks: [] } } });
    });
});
