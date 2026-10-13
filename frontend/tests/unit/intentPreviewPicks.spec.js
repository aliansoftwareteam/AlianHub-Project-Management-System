import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import { createI18n } from 'vue-i18n';
import en from '@/locales/en';

const { sendProposalDecision } = vi.hoisted(() => ({ sendProposalDecision: vi.fn() }));

vi.mock('@/composable/agentProposals', () => ({ sendProposalDecision }));
vi.mock('@/composable', () => ({ useGetterFunctions: () => ({ getUser: () => null }) }));

import IntentPreview from '@/components/molecules/IntentPreview/IntentPreview.vue';
import ApprovalQueue from '@/views/Inbox/ApprovalQueue.vue';
import { broughtBack, canChoose, chosenParts, heldWith, keptCounts, lockedParts, pickNames, toggled } from '@/components/molecules/IntentPreview/planPicks';

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

    it('brings back with a part only what left because of it, and only where everything else it needs is kept', () => {
        expect(broughtBack(plan(), ['views:0'], ['views:0'])).toEqual([]);
        expect(broughtBack(plan(), ['fields:0', 'views:0'], ['views:0'])).toEqual(['fields:0', 'views:0']);
        expect(broughtBack(plan(), ['statuses:1', 'views:0'], [])).toEqual(['statuses:1', 'views:0']);
        const chain = { lines: plan().lines, needs: { 'fields:1': ['fields:0'], 'views:0': ['fields:1'] } };
        expect(broughtBack(chain, ['fields:1', 'views:0'], ['views:0', 'fields:1'])).toEqual([]);
    });

    it('counts what is still ticked, for each kind of part that has something left out', () => {
        expect(keptCounts(plan(), [])).toEqual([]);
        expect(keptCounts(plan(), ['statuses:1', 'views:0', 'members:0'])).toEqual([{ part: 'statuses', kept: 1, of: 2 }, { part: 'views', kept: 0, of: 1 }]);
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
        expect(wrapper.find('[data-test="intent-pick-also"]').text()).toBe('“Costs” is left out too: it needs “Budget”.');
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
        expect(box('views:0').element.closest('label').classList.contains('is-out')).toBe(true);
        expect(box('fields:0').element.closest('label').classList.contains('is-out')).toBe(false);
    });

    it('ticking a view back brings back the field it needs, and says so', async () => {
        mountCard({ choosable: true, leftOut: ['fields:0', 'views:0'] });
        await box('views:0').trigger('change');
        expect(wrapper.emitted('update:leftOut')).toEqual([[[]]]);
        expect(wrapper.find('[data-test="intent-pick-also"]').text()).toBe('“Budget” is kept too: “Costs” needs it.');
    });

    it('sets what belongs to a view under its tick box', () => {
        mountCard({ choosable: true });
        expect(wrapper.find('[data-test="intent-line"][data-kind="columns"]').classes()).toContain('is-under');
        expect(wrapper.find('[data-test="intent-line"][data-kind="planView"]').classes()).not.toContain('is-under');
    });

    it('heads several fields once, in the plural', () => {
        mountCard({ choosable: true });
        const fields = wrapper.findAll('[data-test="intent-line"][data-kind="field"]');
        expect(fields.map((el) => el.find('dt').text())).toEqual(['Fields', 'Fields']);
        expect(fields.map((el) => el.classes().includes('is-more'))).toEqual([false, true]);
        expect(wrapper.find('[data-test="intent-line"][data-kind="planView"] dt').text()).toBe('New view');
    });

    it('says how much of each kind is still ticked once something is left out', async () => {
        mountCard({ choosable: true });
        expect(wrapper.find('[data-test="intent-pick-kept"]').exists()).toBe(false);
        await wrapper.setProps({ leftOut: ['statuses:1', 'fields:0', 'views:0'] });
        expect(wrapper.find('[data-test="intent-pick-kept"]').text()).toBe('Ticked: 1 of 2 statuses, 1 of 2 fields, 0 of 1 view.');
    });

    it('ticking a part back brings back what was left out with it, and says so', async () => {
        mountCard({ choosable: true });
        await box('fields:0').trigger('change');
        await wrapper.setProps({ leftOut: ['fields:0', 'views:0'] });
        await box('fields:0').trigger('change');
        expect(wrapper.emitted('update:leftOut')[1]).toEqual([[]]);
        expect(wrapper.find('[data-test="intent-pick-also"]').text()).toBe('“Costs” is back too: it was left out with “Budget”.');
    });

    it('leaves out what the person unticked by hand before, whatever comes back', async () => {
        mountCard({ choosable: true, leftOut: ['views:0'] });
        await box('fields:0').trigger('change');
        expect(wrapper.emitted('update:leftOut')[0]).toEqual([['fields:0', 'views:0']]);
        await wrapper.setProps({ leftOut: ['fields:0', 'views:0'] });
        await box('fields:0').trigger('change');
        expect(wrapper.emitted('update:leftOut')[1]).toEqual([['views:0']]);
        expect(wrapper.find('[data-test="intent-pick-also"]').exists()).toBe(false);
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

describe('the automations and first tasks of a plan on its card', () => {
    const withWork = () => ({
        kind: 'setup',
        title: 'Website',
        lines: [
            { kind: 'newStatuses', names: ['In Review'], picks: ['statuses:0'] },
            { kind: 'newLists', names: ['Backlog'], picks: ['lists:0'] },
            { kind: 'planRule', text: 'When a task moves to In Review, notify its assignees', pick: 'rules:0' },
            { kind: 'planRule', problem: 'I do not know a status called "Nowhere".', pick: 'rules:1' },
            { kind: 'planRule', text: '', pick: 'rules:2' },
            { kind: 'planTask', name: 'Write the brief', list: 'Backlog', status: 'In Review', assignee: 'Ian Insider', hidden: 0, due: '2026-11-02', pick: 'tasks:0' },
            { kind: 'planTask', name: 'Book the kickoff', list: '', status: '', assignee: '', hidden: 1, due: '', pick: 'tasks:1' },
            { kind: 'planTask', name: '<b>Collect</b> the logins', list: '', status: '', assignee: '', hidden: 0, due: '', pick: 'tasks:2' },
            { kind: 'planTask', name: '', pick: 'tasks:3' },
        ],
        needs: { 'rules:0': ['statuses:0'], 'tasks:0': ['lists:0', 'statuses:0'] },
    });
    const mountCard = (props) => {
        wrapper = mount(IntentPreview, { attachTo: document.body, props: { preview: withWork(), ...props }, global: { plugins: [i18n()], stubs: { ShellIcon: true } } });
        return wrapper;
    };
    const rows = (kind) => wrapper.findAll(`[data-test="intent-line"][data-kind="${kind}"]`).map((el) => [el.find('dt').text(), el.find('dd').text()]);

    it('says each automation in its sentence, switched off, or why it cannot be made', () => {
        mountCard({});
        expect(rows('planRule')).toEqual([
            ['Automation', 'When a task moves to In Review, notify its assignees (starts switched off)'],
            ['Automation', 'Cannot be made as written: I do not know a status called "Nowhere".'],
        ]);
    });

    it('says each first task with its list, status, person and day, and draws a name as text', () => {
        mountCard({});
        const tasks = rows('planTask');
        expect(tasks).toHaveLength(3);
        expect(tasks[0][0]).toBe('First task');
        expect(tasks[0][1]).toMatch(/^Write the brief \(list: Backlog, status: In Review, for Ian Insider, due .*2026.*\)$/);
        expect(tasks[1]).toEqual(['First task', 'Book the kickoff (for 1 person not shown)']);
        expect(tasks[2]).toEqual(['First task', '<b>Collect</b> the logins']);
        expect(wrapper.find('b').exists()).toBe(false);
    });

    it('lets each be left out, and leaves out with a status the automation and the task that name it', async () => {
        mountCard({ choosable: true });
        expect(wrapper.findAll('[data-test="intent-pick"]').map((el) => el.attributes('data-pick'))).toEqual(['statuses:0', 'lists:0', 'rules:0', 'rules:1', 'tasks:0', 'tasks:1', 'tasks:2']);
        await wrapper.find('[data-pick="statuses:0"]').trigger('change');
        expect(wrapper.emitted('update:leftOut')).toEqual([[['statuses:0', 'rules:0', 'tasks:0']]]);
        expect(wrapper.find('[data-test="intent-pick-also"]').text()).toBe('“When a task moves to In Review, notify its assignees”, “Write the brief” are left out too: they need “In Review”.');
        expect(chosenParts(withWork(), ['statuses:0', 'rules:0', 'tasks:0'])).toEqual({ statuses: [], lists: [0], rules: [1], tasks: [1, 2] });
    });

    it('brings back with a status the automation that named it, and not the task whose list is still left out', async () => {
        mountCard({ choosable: true });
        const tick = (key) => wrapper.find(`[data-pick="${key}"]`).trigger('change');
        await tick('statuses:0');
        await wrapper.setProps({ leftOut: ['statuses:0', 'rules:0', 'tasks:0'] });
        await tick('lists:0');
        await wrapper.setProps({ leftOut: ['statuses:0', 'lists:0', 'rules:0', 'tasks:0'] });
        await tick('statuses:0');
        expect(wrapper.emitted('update:leftOut')[2]).toEqual([['lists:0', 'tasks:0']]);
        expect(wrapper.find('[data-test="intent-pick-also"]').text()).toBe('“When a task moves to In Review, notify its assignees” is back too: it was left out with “In Review”.');
    });

    it('names an automation that went with a status without the full stop of its sentence', async () => {
        const preview = { ...withWork(), lines: withWork().lines.map((line) => (line.pick === 'rules:0' ? { ...line, text: 'When a task moves to In Review, notify its assignees.' } : line)) };
        mountCard({ choosable: true, preview, leftOut: ['tasks:0'] });
        await wrapper.find('[data-pick="statuses:0"]').trigger('change');
        expect(wrapper.find('[data-test="intent-pick-also"]').text()).toBe('“When a task moves to In Review, notify its assignees” is left out too: it needs “In Review”.');
    });

    it('heads the automations and the first tasks once each', () => {
        mountCard({ choosable: true });
        const heads = (kind) => wrapper.findAll(`[data-test="intent-line"][data-kind="${kind}"]`).map((el) => [el.find('dt').text(), el.classes().includes('is-more')]);
        expect(heads('planRule')).toEqual([['Automations', false], ['Automations', true]]);
        expect(heads('planTask')).toEqual([['First tasks', false], ['First tasks', true], ['First tasks', true]]);
    });
});

describe('a part of a plan that an owner or admin approves', () => {
    const NOTE = 'An owner or admin approves this part';
    const forMember = () => ({
        kind: 'setup',
        title: 'Website',
        lines: [
            { kind: 'newLists', names: ['Backlog'], picks: ['lists:0'] },
            { kind: 'planRule', text: 'When a task is created, notify its assignees', pick: 'rules:0' },
            { kind: 'planTask', name: 'Write the brief', list: 'Backlog', status: '', assignee: '', hidden: 0, due: '', pick: 'tasks:0' },
            { kind: 'planTask', name: 'Collect the logins', list: '', status: '', assignee: '', hidden: 0, due: '', pick: 'tasks:1' },
        ],
        needs: { 'tasks:0': ['lists:0'] },
        locked: ['rules:0', 'tasks:1'],
    });
    const forOwner = () => ({ ...forMember(), locked: undefined });
    const mountCard = (props) => {
        wrapper = mount(IntentPreview, { attachTo: document.body, props: { preview: forMember(), ...props }, global: { plugins: [i18n()], stubs: { ShellIcon: true } } });
        return wrapper;
    };
    const box = (key) => wrapper.find(`[data-test="intent-pick"][data-pick="${key}"]`);
    const line = (key) => box(key).element.closest('[data-test="intent-line"]');

    it('is left out of what is sent whatever is ticked, and cannot be ticked back', () => {
        expect(lockedParts(forMember())).toEqual(['rules:0', 'tasks:1']);
        expect(lockedParts(forOwner())).toEqual([]);
        expect(lockedParts({ ...forMember(), locked: ['rules:9', 7] })).toEqual([]);
        expect(chosenParts(forMember(), [])).toEqual({ lists: [0], rules: [], tasks: [0] });
        expect(chosenParts(forMember(), ['lists:0', 'tasks:0'])).toEqual({ lists: [], rules: [], tasks: [] });
        expect(chosenParts(forOwner(), [])).toBeNull();
        expect(toggled(forMember(), [], 'rules:0')).toEqual([]);
        expect(toggled(forMember(), [], 'lists:0')).toEqual(['lists:0', 'tasks:0']);
    });

    it('leaves out what cannot be made without it', () => {
        const preview = { ...forMember(), needs: { 'tasks:0': ['lists:0', 'rules:0'] }, locked: ['rules:0'] };
        expect(lockedParts(preview)).toEqual(['rules:0', 'tasks:0']);
        expect(chosenParts(preview, [])).toEqual({ lists: [0], rules: [], tasks: [1] });
    });

    it('is shown unticked and held, with a plain line saying who approves it', () => {
        mountCard({ choosable: true });
        expect(box('rules:0').element.checked).toBe(false);
        expect(box('rules:0').element.disabled).toBe(true);
        expect(box('tasks:1').element.checked).toBe(false);
        expect(box('tasks:1').element.disabled).toBe(true);
        expect(line('rules:0').classList.contains('is-out')).toBe(true);
        expect(wrapper.findAll('[data-test="intent-pick-locked"]').map((el) => el.text())).toEqual([NOTE, NOTE]);
        expect(line('rules:0').querySelector('[data-test="intent-pick-locked"]')).not.toBeNull();
        expect(box('rules:0').element.closest('label').textContent).toContain(NOTE);
    });

    it('leaves every other part ticked and free to untick', async () => {
        mountCard({ choosable: true });
        expect(box('lists:0').element.checked).toBe(true);
        expect(box('lists:0').element.disabled).toBe(false);
        expect(box('tasks:0').element.checked).toBe(true);
        expect(line('tasks:0').querySelector('[data-test="intent-pick-locked"]')).toBeNull();
        box('rules:0').element.dispatchEvent(new Event('change'));
        expect(wrapper.emitted('update:leftOut')).toBeUndefined();
        await box('tasks:0').trigger('change');
        expect(wrapper.emitted('update:leftOut')).toEqual([[['tasks:0']]]);
    });

    it('says nothing of it on the card of an owner or admin, or where nothing can be chosen', () => {
        wrapper = mount(IntentPreview, { attachTo: document.body, props: { preview: forOwner(), choosable: true }, global: { plugins: [i18n()], stubs: { ShellIcon: true } } });
        expect(wrapper.findAll('[data-test="intent-pick-locked"]')).toHaveLength(0);
        expect(wrapper.findAll('[data-test="intent-pick"]').every((el) => el.element.checked && !el.element.disabled)).toBe(true);
        wrapper.unmount();
        mountCard({});
        expect(wrapper.findAll('[data-test="intent-pick-locked"]')).toHaveLength(0);
    });

    it('is not sent with a member\'s approval from the queue', async () => {
        sendProposalDecision.mockReset();
        sendProposalDecision.mockImplementation(() => Promise.resolve({ data: { status: true, data: { applied: [{ ok: true }], undoUntil: '2026-10-02T09:15:00.000Z' } } }));
        const row = {
            sourceType: 'proposal', sourceId: 'p1', proposalId: 'p1', kind: 'proposal', agentName: 'Claude', source: 'mcp', requestedBy: '', what: 'project.setup', why: 'Because',
            changes: [{ action: 'project.setup', label: 'Set up the project', reversible: true, preview: forMember() }], gate: null, locked: false, editable: false, createdAt: '2026-10-02T09:00:00.000Z', unread: true,
        };
        wrapper = mount(ApprovalQueue, { attachTo: document.body, props: { proposals: [row] }, global: { plugins: [i18n()], stubs: { ShellIcon: true } } });
        expect(wrapper.find('[data-test="intent-pick-locked"]').text()).toBe(NOTE);
        await wrapper.find('[data-test="queue-approve"]').trigger('click');
        await flushPromises();
        expect(sendProposalDecision).toHaveBeenCalledWith('p1', 'approve', { parts: { 0: { lists: [0], rules: [], tasks: [0] } } });
    });

    it('is not counted as ticked', () => {
        expect(keptCounts(forMember(), [])).toEqual([{ part: 'rules', kept: 0, of: 1 }, { part: 'tasks', kept: 1, of: 2 }]);
        expect(keptCounts(forMember(), ['tasks:0'])).toEqual([{ part: 'rules', kept: 0, of: 1 }, { part: 'tasks', kept: 0, of: 2 }]);
        expect(keptCounts(forOwner(), [])).toEqual([]);
        mountCard({ choosable: true });
        expect(wrapper.find('[data-test="intent-pick-kept"]').text()).toBe('Ticked: 0 of 1 automation, 1 of 2 first tasks.');
    });

    it('is headed with the other parts of its kind, and keeps its line under the shared heading', () => {
        mountCard({ choosable: true });
        const tasks = wrapper.findAll('[data-test="intent-line"][data-kind="planTask"]');
        expect(tasks.map((el) => el.find('dt').text())).toEqual(['First tasks', 'First tasks']);
        expect(tasks[1].classes()).toEqual(expect.arrayContaining(['is-more', 'is-out']));
        expect(tasks[1].find('[data-test="intent-pick-locked"]').text()).toBe(NOTE);
        expect(box('tasks:1').element.closest('label').classList.contains('is-out')).toBe(true);
    });

    describe('beside a part that leaves and comes back', () => {
        const alsoNeedsTheList = () => ({ ...forMember(), needs: { 'tasks:0': ['lists:0'], 'tasks:1': ['lists:0'] } });

        it('is not one of the parts a tick moves', () => {
            expect(toggled(alsoNeedsTheList(), [], 'lists:0')).toEqual(['lists:0', 'tasks:0']);
            expect(toggled(alsoNeedsTheList(), ['lists:0', 'tasks:0', 'tasks:1'], 'tasks:0')).toEqual([]);
            expect(broughtBack(alsoNeedsTheList(), ['tasks:0', 'tasks:1'], ['tasks:0', 'tasks:1'])).toEqual(['tasks:1']);
            expect(chosenParts(alsoNeedsTheList(), [])).toEqual({ lists: [0], rules: [], tasks: [0] });
        });

        it('stays out of the line that says what else was left out, and stays unticked when that part is ticked back', async () => {
            mountCard({ preview: alsoNeedsTheList(), choosable: true });
            await box('lists:0').trigger('change');
            expect(wrapper.emitted('update:leftOut')).toEqual([[['lists:0', 'tasks:0']]]);
            expect(wrapper.find('[data-test="intent-pick-also"]').text()).toBe('“Write the brief” is left out too: it needs “Backlog”.');
            await wrapper.setProps({ leftOut: ['lists:0', 'tasks:0'] });
            await box('lists:0').trigger('change');
            expect(wrapper.emitted('update:leftOut')[1]).toEqual([[]]);
            expect(wrapper.find('[data-test="intent-pick-also"]').text()).toBe('“Write the brief” is back too: it was left out with “Backlog”.');
            await wrapper.setProps({ leftOut: [] });
            expect(box('tasks:0').element.checked).toBe(true);
            expect(box('tasks:1').element.checked).toBe(false);
            expect(box('tasks:1').element.disabled).toBe(true);
            expect(wrapper.find('[data-test="intent-pick-kept"]').text()).toBe('Ticked: 0 of 1 automation, 1 of 2 first tasks.');
        });
    });

    describe('that another part needs', () => {
        const taskNeedsTheRule = () => ({ ...forMember(), needs: { 'tasks:0': ['lists:0', 'rules:0'] }, locked: ['rules:0'] });

        it('holds that part out with it', () => {
            expect(heldWith(taskNeedsTheRule())).toEqual([{ key: 'rules:0', held: ['tasks:0'] }]);
            expect(heldWith(forMember())).toEqual([{ key: 'rules:0', held: [] }, { key: 'tasks:1', held: [] }]);
            expect(heldWith(forOwner())).toEqual([]);
            expect(toggled(taskNeedsTheRule(), [], 'tasks:0')).toEqual([]);
            expect(keptCounts(taskNeedsTheRule(), [])).toEqual([{ part: 'rules', kept: 0, of: 1 }, { part: 'tasks', kept: 1, of: 2 }]);
        });

        it('is named as the reason that part is left out too, from the start', () => {
            mountCard({ preview: taskNeedsTheRule(), choosable: true });
            expect(wrapper.findAll('[data-test="intent-pick-held"]').map((el) => el.text())).toEqual(['“Write the brief” is left out too: it needs “When a task is created, notify its assignees”.']);
            expect(box('tasks:0').element.checked).toBe(false);
            expect(box('tasks:0').element.disabled).toBe(true);
            expect(line('tasks:0').querySelector('[data-test="intent-pick-locked"]')).toBeNull();
            expect(box('tasks:1').element.disabled).toBe(false);
        });

        it('says nothing more where no other part needs it', () => {
            mountCard({ choosable: true });
            expect(wrapper.findAll('[data-test="intent-pick-held"]')).toHaveLength(0);
        });
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
        expect(wrapper.find('[data-test="queue-review-parts"]').text()).toBe('Only what you left ticked: 0 of 1 list.');
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
