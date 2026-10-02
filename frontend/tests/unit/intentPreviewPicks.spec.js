import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import { createI18n } from 'vue-i18n';
import en from '@/locales/en';

const { sendProposalDecision } = vi.hoisted(() => ({ sendProposalDecision: vi.fn() }));

vi.mock('@/composable/agentProposals', () => ({ sendProposalDecision }));
vi.mock('@/composable', () => ({ useGetterFunctions: () => ({ getUser: () => null }) }));

import IntentPreview from '@/components/molecules/IntentPreview/IntentPreview.vue';
import ApprovalQueue from '@/views/Inbox/ApprovalQueue.vue';
import { canChoose, chosenParts, pickNames, toggled } from '@/components/molecules/IntentPreview/planPicks';

const i18n = () => createI18n({ legacy: false, locale: 'en', messages: { en }, missingWarn: false, fallbackWarn: false });

const plan = () => ({
    kind: 'setup',
    title: 'Website',
    lines: [
        { kind: 'place', project: 'Website', list: '' },
        { kind: 'newStatuses', names: ['In Review', 'Blocked'], picks: ['statuses:0', 'statuses:1'] },
        { kind: 'newLists', names: ['Backlog'], picks: ['lists:0'] },
        { kind: 'field', name: 'Budget', type: 'money', options: [], pick: 'fields:0' },
        { kind: 'field', name: 'Region', type: 'text', options: [], pick: 'fields:1' },
        { kind: 'planView', name: 'Costs', layout: 'board', pick: 'views:0' },
        { kind: 'columns', names: ['Budget'], others: 0, under: 'views:0' },
    ],
    needs: { 'views:0': ['fields:0'] },
});

let wrapper;
afterEach(() => { wrapper?.unmount(); wrapper = null; });

describe('which parts of a plan are kept', () => {
    it('offers a choice only for a card whose lines name parts', () => {
        expect(canChoose(plan())).toBe(true);
        expect(canChoose({ kind: 'view', title: 'Mine', lines: [{ kind: 'layout', value: 'board' }] })).toBe(false);
        expect(canChoose(null)).toBe(false);
    });

    it('leaves out what cannot be made without a part that is left out, and brings back what a kept part needs', () => {
        expect(toggled(plan(), [], 'lists:0')).toEqual(['lists:0']);
        expect(toggled(plan(), [], 'fields:0')).toEqual(['fields:0', 'views:0']);
        expect(toggled(plan(), ['fields:0', 'views:0'], 'views:0')).toEqual([]);
        expect(toggled(plan(), ['fields:0', 'views:0'], 'fields:0')).toEqual(['views:0']);
        expect(toggled(plan(), ['views:0'], 'views:0')).toEqual([]);
    });

    it('ignores a part the card does not have', () => {
        expect(toggled(plan(), [], 'tasks:9')).toEqual([]);
        expect(toggled(plan(), ['members:0'], 'lists:0')).toEqual(['lists:0']);
    });

    it('sends the places kept for every kind of part on the card, and nothing while all are kept', () => {
        expect(chosenParts(plan(), [])).toBeNull();
        expect(chosenParts(plan(), undefined)).toBeNull();
        expect(chosenParts(plan(), ['statuses:1', 'lists:0'])).toEqual({ statuses: [0], lists: [], fields: [0, 1], views: [0] });
        expect(chosenParts({ kind: 'view', lines: [] }, ['statuses:0'])).toBeNull();
    });

    it('knows each part by the name its line shows', () => {
        expect(Object.fromEntries(pickNames(plan()))).toEqual({ 'statuses:0': 'In Review', 'statuses:1': 'Blocked', 'lists:0': 'Backlog', 'fields:0': 'Budget', 'fields:1': 'Region', 'views:0': 'Costs' });
    });
});

describe('the preview card of a plan the person can choose from', () => {
    const mountCard = (props) => {
        wrapper = mount(IntentPreview, { attachTo: document.body, props: { preview: plan(), ...props }, global: { plugins: [i18n()], stubs: { ShellIcon: true } } });
        return wrapper;
    };
    const box = (key) => wrapper.find(`[data-test="intent-pick"][data-pick="${key}"]`);
    const lineText = (kind) => wrapper.findAll(`[data-test="intent-line"][data-kind="${kind}"]`).map((el) => el.find('dd').text());

    it('stays a plain list where nothing can be chosen', () => {
        mountCard({});
        expect(wrapper.findAll('[data-test="intent-pick"]')).toHaveLength(0);
        expect(wrapper.find('[data-test="intent-pick-hint"]').exists()).toBe(false);
        expect(lineText('newStatuses')).toEqual(['In Review, Blocked']);
    });

    it('gives each status, list, field and view a ticked box that carries its name', () => {
        mountCard({ choosable: true });
        const boxes = wrapper.findAll('[data-test="intent-pick"]');
        expect(boxes.map((el) => el.attributes('data-pick'))).toEqual(['statuses:0', 'statuses:1', 'lists:0', 'fields:0', 'fields:1', 'views:0']);
        expect(boxes.every((el) => el.element.checked)).toBe(true);
        expect(boxes.map((el) => el.element.closest('label').textContent.trim())).toEqual(['In Review', 'Blocked', 'Backlog', 'Budget: Money', 'Region: Text', 'Costs: Board']);
        expect(wrapper.find('[data-test="intent-pick-hint"]').text()).toBe('Untick anything you do not want. Only what is ticked is made.');
        expect(wrapper.findAll('[data-test="intent-line"][data-kind="columns"] input')).toHaveLength(0);
    });

    it('unticking a field also unticks the view that shows it, and says so', async () => {
        mountCard({ choosable: true });
        await box('fields:0').trigger('change');
        expect(wrapper.emitted('update:leftOut')).toEqual([[['fields:0', 'views:0']]]);
        expect(wrapper.find('[data-test="intent-pick-also"]').text()).toBe('Costs is left out too: it needs “Budget”.');
        expect(wrapper.find('[data-test="intent-pick-also"]').attributes('role')).toBe('status');
    });

    it('draws what is left out as unticked and struck through, with the lines under it', async () => {
        mountCard({ choosable: true, leftOut: ['statuses:1', 'views:0'] });
        expect(box('statuses:1').element.checked).toBe(false);
        expect(box('statuses:0').element.checked).toBe(true);
        expect(box('views:0').element.checked).toBe(false);
        expect(box('statuses:1').element.closest('label').classList.contains('is-out')).toBe(true);
        expect(wrapper.find('[data-test="intent-line"][data-kind="columns"]').classes()).toContain('is-out');
        expect(wrapper.find('[data-test="intent-line"][data-kind="planView"]').classes()).toContain('is-out');
        expect(wrapper.find('[data-test="intent-line"][data-kind="field"]').classes()).not.toContain('is-out');
    });

    it('ticking a view back brings back the field it needs, and says so', async () => {
        mountCard({ choosable: true, leftOut: ['fields:0', 'views:0'] });
        await box('views:0').trigger('change');
        expect(wrapper.emitted('update:leftOut')).toEqual([[[]]]);
        expect(wrapper.find('[data-test="intent-pick-also"]').text()).toBe('Budget is kept too: “Costs” needs it.');
    });

    it('says nothing more when a part stands alone, and holds every box while a decision is being sent', async () => {
        mountCard({ choosable: true, disabled: true });
        expect(wrapper.findAll('[data-test="intent-pick"]').every((el) => el.element.disabled)).toBe(true);
        await wrapper.setProps({ disabled: false });
        await box('lists:0').trigger('change');
        expect(wrapper.emitted('update:leftOut')).toEqual([[['lists:0']]]);
        expect(wrapper.find('[data-test="intent-pick-also"]').exists()).toBe(false);
    });
});

describe('approving a plan from the queue', () => {
    const change = (preview) => ({ action: 'project.setup', params: { projectId: 'p-web' }, label: 'Set up the project', reversible: true, preview });
    const row = (id, over = {}) => ({
        sourceType: 'proposal', sourceId: id, proposalId: id, kind: 'proposal', agentName: 'Claude', source: 'mcp', requestedBy: '',
        what: 'project.setup', why: `Because ${id}`, changes: [change(plan())], gate: null, locked: false, editable: false, createdAt: '2026-10-02T09:00:00.000Z', unread: true, ...over,
    });
    const done = () => Promise.resolve({ data: { status: true, data: { applied: [{ ok: true }], undoUntil: '2026-10-02T09:15:00.000Z' } } });
    const mountQueue = (proposals) => {
        wrapper = mount(ApprovalQueue, { attachTo: document.body, props: { proposals }, global: { plugins: [i18n()], stubs: { ShellIcon: true } } });
        return wrapper;
    };
    const rowOf = (id) => wrapper.find(`[data-test="queue-row"][data-id="${id}"]`);
    const untick = (id, key) => rowOf(id).find(`[data-test="intent-pick"][data-pick="${key}"]`).trigger('change');

    beforeEach(() => { sendProposalDecision.mockReset(); sendProposalDecision.mockImplementation(done); });

    it('sends nothing but the approval while every part is ticked', async () => {
        mountQueue([row('p1')]);
        await rowOf('p1').find('[data-test="queue-approve"]').trigger('click');
        await flushPromises();
        expect(sendProposalDecision).toHaveBeenCalledWith('p1', 'approve', {});
    });

    it('sends the places of the parts that stayed ticked, for the change they belong to', async () => {
        mountQueue([row('p1')]);
        await untick('p1', 'statuses:1');
        await untick('p1', 'fields:0');
        expect(rowOf('p1').find('[data-pick="views:0"]').element.checked).toBe(false);
        await rowOf('p1').find('[data-test="queue-approve"]').trigger('click');
        await flushPromises();
        expect(sendProposalDecision).toHaveBeenCalledWith('p1', 'approve', { parts: { 0: { statuses: [0], lists: [0], fields: [1], views: [] } } });
    });

    it('keeps the choice of one proposal away from another', async () => {
        mountQueue([row('p1'), row('p2')]);
        await untick('p1', 'lists:0');
        expect(rowOf('p2').find('[data-pick="lists:0"]').element.checked).toBe(true);
        await rowOf('p2').find('[data-test="queue-approve"]').trigger('click');
        await flushPromises();
        expect(sendProposalDecision).toHaveBeenCalledWith('p2', 'approve', {});
    });

    it('carries the choice into an approval of several at once, and says so in the review', async () => {
        mountQueue([row('p1'), row('p2')]);
        await untick('p1', 'lists:0');
        await wrapper.find('[data-test="queue-select-all"]').setValue(true);
        await wrapper.find('[data-test="queue-bulk-review"]').trigger('click');
        expect(wrapper.findAll('[data-test="queue-review-parts"]')).toHaveLength(1);
        expect(wrapper.find('[data-test="queue-review-parts"]').text()).toBe('Without the parts you unticked.');
        await wrapper.find('[data-test="queue-bulk-confirm"]').trigger('click');
        await flushPromises();
        expect(sendProposalDecision.mock.calls).toEqual([
            ['p1', 'approve', { parts: { 0: { statuses: [0, 1], lists: [], fields: [0, 1], views: [0] } } }],
            ['p2', 'approve', {}],
        ]);
    });

    it('offers no choice on a proposal the person may not approve', () => {
        mountQueue([row('p1', { gate: 'owner_admin', locked: true })]);
        expect(rowOf('p1').findAll('[data-test="intent-pick"]')).toHaveLength(0);
        expect(rowOf('p1').text()).toContain('In Review, Blocked');
    });

    it('shows the refusal of a choice the plan cannot follow, and keeps the row', async () => {
        sendProposalDecision.mockImplementation(() => Promise.reject(Object.assign(new Error('Request failed'), { response: { data: { status: false, statusText: 'Keep at least one part of the plan, or decline it.' } } })));
        mountQueue([row('p1')]);
        await untick('p1', 'lists:0');
        await rowOf('p1').find('[data-test="queue-approve"]').trigger('click');
        await flushPromises();
        expect(rowOf('p1').find('[data-test="queue-row-error"]').text()).toBe('Keep at least one part of the plan, or decline it.');
        expect(rowOf('p1').find('[data-pick="lists:0"]').element.checked).toBe(false);
        expect(wrapper.emitted('decided')).toBeUndefined();
    });
});
