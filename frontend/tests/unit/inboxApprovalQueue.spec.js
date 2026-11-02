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

describe('a write to a connected app', () => {
    const KEY = 'google.calendar.events.create';
    const card = (over = {}) => ({
        provider: 'google', tool: KEY, label: 'Connectors.tool.googleCalendarEventsCreate', target: '', targetLabel: 'Connectors.card.primaryCalendar', title: 'Board review', text: 'First line\nSecond line',
        attachments: ['agenda.pdf'], rows: [{ label: 'Connectors.card.where', value: 'Room 4' }, { label: 'Connectors.card.notifyAttendees', valueLabel: 'Connectors.card.no' }],
        fields: [{ param: 'summary', label: 'Connectors.card.title' }, { param: 'location', label: 'Connectors.card.where' }, { param: 'description', label: 'Connectors.card.description', long: true }],
        ...over,
    });
    const write = (over = {}) => ({ action: KEY, params: { summary: 'Board review', connectionId: 'c1' }, label: 'Board review', reversible: false, card: card(), ...over });
    const cardOf = (id) => rowOf(id).find('[data-test="connector-card"]');
    const saveEdit = async (id) => { await rowOf(id).find('[data-test="queue-approve"]').trigger('click'); await flushPromises(); };

    it('shows where it goes, its title, its whole text, its details and its attachments', () => {
        mountQueue([row('p1', { changes: [write()] })]);
        const shown = cardOf('p1');
        expect(shown.find('[data-test="connector-card-tool"]').text()).toBe(en.Connectors.tool.googleCalendarEventsCreate);
        expect(shown.find('[data-test="connector-card-target"]').text()).toBe(en.Connectors.card.primaryCalendar);
        expect(shown.find('[data-test="connector-card-title"]').text()).toBe('Board review');
        expect(shown.find('[data-test="connector-card-text"]').element.textContent).toBe('First line\nSecond line');
        expect(shown.findAll('[data-test="connector-card-row"]').map((r) => r.text())).toEqual(['Room 4', en.Connectors.card.no]);
        expect(shown.find('[data-test="connector-card-attachment"]').text()).toBe('agenda.pdf');
    });

    it('names a target the tool gives as text', () => {
        mountQueue([row('p1', { changes: [write({ card: card({ target: 'team@acme.test', targetLabel: undefined }) })] })]);
        expect(cardOf('p1').find('[data-test="connector-card-target"]').text()).toBe('team@acme.test');
    });

    it('is under no other change', () => {
        mountQueue([row('p1', { changes: [change('Comment')] })]);
        expect(cardOf('p1').exists()).toBe(false);
    });

    it('for anyone but the connection\'s owner shows the card, says why, and offers no Approve', () => {
        mountQueue([row('p1', { gate: 'connection_owner', changes: [write({ params: undefined })], locked: true, lockedWhy: 'connection_owner', mayDecline: true })]);
        expect(cardOf('p1').exists()).toBe(true);
        expect(rowOf('p1').find('[data-test="queue-locked"]').text()).toBe(en.Connectors.approval.locked);
        expect(rowOf('p1').find('[data-test="queue-locked-note"]').text()).toBe(en.Connectors.approval.locked_note);
        expect(rowOf('p1').find('[data-test="queue-approve"]').exists()).toBe(false);
        expect(rowOf('p1').find('[data-test="queue-decline"]').exists()).toBe(true);
    });

    it('for its owner approves as it stands', async () => {
        mountQueue([row('p1', { gate: 'connection_owner', changes: [write()] })]);
        expect(rowOf('p1').find('[data-test="queue-approve"]').text()).toBe(en.Inbox.approve);
        await saveEdit('p1');
        expect(sendProposalDecision).toHaveBeenCalledWith('p1', 'approve', { revision: 0 });
    });

    it('names the card it read, so a write edited elsewhere is refused rather than sent', async () => {
        mountQueue([row('p1', { revision: 3, changes: [write()] })]);
        await saveEdit('p1');
        expect(sendProposalDecision).toHaveBeenCalledWith('p1', 'approve', { revision: 3 });
    });

    it('shows the card in a bulk review before approving', async () => {
        mountQueue([row('p1', { changes: [write()] }), row('p2')]);
        await wrapper.find('[data-test="queue-select-all"]').setValue(true);
        await wrapper.find('[data-test="queue-bulk-review"]').trigger('click');
        expect(wrapper.find('[data-test="queue-review-item"] [data-test="connector-card-text"]').exists()).toBe(true);
    });

    describe('edited by its owner', () => {
        const editing = async () => {
            mountQueue([row('p1', { gate: 'connection_owner', changes: [write()] })]);
            await rowOf('p1').find('[data-test="queue-edit"]').trigger('click');
        };
        const NEW_CARD = card({ title: 'Board review, moved' });
        const reshown = () => Promise.resolve({ data: { status: true, data: { applied: [], reshown: true, proposal: { changes: [write({ params: { summary: 'Board review, moved', connectionId: 'c1' }, card: NEW_CARD })] } } } });

        it('offers each field the tool allows, filled from what was filed', async () => {
            await editing();
            expect(cardOf('p1').find('[data-test="connector-field-summary"]').element.value).toBe('Board review');
            expect(cardOf('p1').find('[data-test="connector-field-description"]').element.tagName).toBe('TEXTAREA');
        });

        it('says what form a field takes when the tool gives a hint', async () => {
            mountQueue([row('p1', { changes: [write({ card: card({ fields: [{ param: 'start', label: 'Connectors.card.start', hint: 'Connectors.card.timeHint' }] }) })] })]);
            await rowOf('p1').find('[data-test="queue-edit"]').trigger('click');
            expect(cardOf('p1').find('[data-test="connector-field-hint"]').text()).toBe(en.Connectors.card.timeHint);
        });

        it('with nothing changed still approves as filed', async () => {
            await editing();
            expect(rowOf('p1').find('[data-test="queue-approve"]').text()).toBe(en.Inbox.approve);
            await saveEdit('p1');
            expect(sendProposalDecision).toHaveBeenCalledWith('p1', 'approve', { revision: 0 });
        });

        it('checks the edit on Done, so the old card never sits beside an Approve that sends the old text', async () => {
            sendProposalDecision.mockImplementation(reshown);
            await editing();
            await cardOf('p1').find('[data-test="connector-field-summary"]').setValue('Board review, moved');
            await rowOf('p1').find('[data-test="queue-edit"]').trigger('click');
            await flushPromises();
            expect(sendProposalDecision.mock.calls[0][2].changes[0].params.summary).toBe('Board review, moved');
            expect(wrapper.emitted('reshown')).toHaveLength(1);
        });

        it('closes on Done with nothing sent when nothing changed', async () => {
            await editing();
            await rowOf('p1').find('[data-test="queue-edit"]').trigger('click');
            expect(sendProposalDecision).not.toHaveBeenCalled();
            expect(cardOf('p1').find('[data-test="connector-card-form"]').exists()).toBe(false);
        });

        it('says Approve, not check again, once the write itself is dropped', async () => {
            mountQueue([row('p1', { changes: [write(), change('Comment')] })]);
            await rowOf('p1').find('[data-test="queue-edit"]').trigger('click');
            await rowOf('p1').findAll('[data-test="queue-drop"]')[0].trigger('click');
            expect(rowOf('p1').find('[data-test="queue-approve"]').text()).toBe(en.Inbox.approve);
        });

        it('sends the retyped params and never the card, says it will check first, and shows the new card without sending', async () => {
            sendProposalDecision.mockImplementation(reshown);
            await editing();
            await cardOf('p1').find('[data-test="connector-field-summary"]').setValue('Board review, moved');
            expect(rowOf('p1').find('[data-test="queue-approve"]').text()).toBe(en.Connectors.approval.check_again);
            await saveEdit('p1');
            const [, verb, body] = sendProposalDecision.mock.calls[0];
            expect(verb).toBe('approve');
            expect(body.changes[0].params).toEqual({ summary: 'Board review, moved', connectionId: 'c1' });
            expect(body.changes[0].card).toBeUndefined();
            expect(decided()).toEqual([]);
            expect(wrapper.emitted('reshown')[0][0]).toMatchObject({ id: 'p1', changes: [{ card: NEW_CARD }] });
            expect(wrapper.find('[data-test="queue-summary"]').text()).toBe(en.Connectors.approval.reshown);
            expect(cardOf('p1').find('[data-test="connector-card-form"]').exists()).toBe(false);
        });

        it('leaves a field it never named unnamed when typed in and emptied, since a blank clears it', async () => {
            await editing();
            const where = cardOf('p1').find('[data-test="connector-field-location"]');
            await where.setValue('Room 4');
            await where.setValue('');
            expect(rowOf('p1').find('[data-test="queue-approve"]').text()).toBe(en.Inbox.approve);
        });

        it('sends a blank for a named field emptied on purpose', async () => {
            sendProposalDecision.mockImplementation(reshown);
            await editing();
            await cardOf('p1').find('[data-test="connector-field-summary"]').setValue('');
            await saveEdit('p1');
            expect(sendProposalDecision.mock.calls[0][2].changes[0].params.summary).toBe('');
        });

        it('keeps the form and says why when the server refuses the edit', async () => {
            sendProposalDecision.mockImplementation(() => refused('google.calendar.events.create: start is not valid'));
            await editing();
            await cardOf('p1').find('[data-test="connector-field-summary"]').setValue('Moved');
            await saveEdit('p1');
            expect(rowOf('p1').find('[data-test="queue-row-error"]').text()).toContain('start is not valid');
            expect(cardOf('p1').find('[data-test="connector-card-form"]').exists()).toBe(true);
        });
    });

    it('shows no fields to an owner of a tool with none to retype, and they can still approve', async () => {
        mountQueue([row('p1', { changes: [write({ card: card({ fields: undefined }) })] })]);
        await rowOf('p1').find('[data-test="queue-edit"]').trigger('click');
        expect(cardOf('p1').find('[data-test="connector-card-form"]').exists()).toBe(false);
        expect(cardOf('p1').find('[data-test="connector-card-title"]').exists()).toBe(true);
    });
});

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
