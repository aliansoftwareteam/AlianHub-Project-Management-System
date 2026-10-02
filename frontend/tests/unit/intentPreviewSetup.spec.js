import { afterEach, describe, expect, it } from 'vitest';
import { mount } from '@vue/test-utils';
import { createI18n } from 'vue-i18n';
import en from '@/locales/en';
import IntentPreview from '@/components/molecules/IntentPreview/IntentPreview.vue';
import { intentTitle } from '@/components/molecules/IntentPreview/intentLines';
import { unappliedOf } from '@/views/Inbox/approvalQueue';

const i18n = () => createI18n({ legacy: false, locale: 'en', messages: { en }, missingWarn: false, fallbackWarn: false });
const t = (key, named) => i18n().global.t(key, named);

let wrapper;
const mountCard = (preview) => {
    wrapper = mount(IntentPreview, { attachTo: document.body, props: { preview }, global: { plugins: [i18n()], stubs: { ShellIcon: true } } });
    return wrapper;
};
const rows = () => wrapper.findAll('[data-test="intent-line"]').map((el) => [el.attributes('data-kind'), el.find('dt').text(), el.find('dd').text()]);

afterEach(() => { wrapper?.unmount(); wrapper = null; });

describe('the preview card for fields an agent wants to add', () => {
    const fields = {
        kind: 'fields',
        title: 'Budget, Region, Owner',
        lines: [
            { kind: 'place', project: 'Website', list: '' },
            { kind: 'field', name: 'Budget', type: 'money', options: [] },
            { kind: 'field', name: 'Region', type: 'dropdown', options: ['North', 'South'] },
            { kind: 'field', name: 'Owner', type: 'people', options: [] },
        ],
    };

    it('says they are new fields and lists each one with its type on a line of its own', () => {
        mountCard(fields);
        expect(wrapper.find('[data-test="intent-kind"]').text()).toBe('New fields');
        expect(wrapper.find('[data-test="intent-title"]').text()).toBe('Budget, Region, Owner');
        expect(rows()).toEqual([
            ['place', 'Where', 'Website'],
            ['field', 'Field', 'Budget: Money'],
            ['field', 'Field', 'Region: Dropdown (North, South)'],
            ['field', 'Field', 'Owner: People'],
        ]);
        expect(intentTitle(t, fields)).toBe('add the fields “Budget, Region, Owner”');
    });

    it('lists each first value under the fields, and counts the ones on tasks the person cannot open', () => {
        mountCard({
            kind: 'fields',
            title: 'Budget',
            lines: [
                { kind: 'fieldValue', field: 'Budget', task: 'Write release note', value: '120', others: 0 },
                { kind: 'fieldValue', field: 'Owner', task: 'Write release note', value: 'Mia Member', others: 1 },
                { kind: 'fieldValue', field: 'Owner', task: 'Write release note', value: '', others: 2 },
                { kind: 'fieldValue', field: 'Signed', task: '<b>Ship</b>', checked: true },
                { kind: 'fieldValue', field: 'Signed', task: 'Ship', checked: false },
                { kind: 'fieldValue', field: 'Region', task: 'Ship', value: '', others: 0 },
                { kind: 'fieldValue', field: '', task: 'Ship', value: 'x' },
                { kind: 'fieldValue', field: 'Region', task: '', value: 'x' },
                { kind: 'fieldValuesHidden', count: 2 },
                { kind: 'fieldValuesHidden', count: 0 },
            ],
        });
        expect(rows()).toEqual([
            ['fieldValue', 'Value', 'Budget on “Write release note”: 120'],
            ['fieldValue', 'Value', 'Owner on “Write release note”: Mia Member and 1 more'],
            ['fieldValue', 'Value', 'Owner on “Write release note”: 2 people not shown'],
            ['fieldValue', 'Value', 'Signed on “<b>Ship</b>”: Yes'],
            ['fieldValue', 'Value', 'Signed on “Ship”: No'],
            ['fieldValue', 'Value', 'Region on “Ship”: Empty'],
            ['fieldValuesHidden', 'Value', '2 values on tasks you cannot open'],
        ]);
        expect(wrapper.find('b').exists()).toBe(false);
    });

    it('shows a field of a type it does not know by its name alone, and draws a name as text', () => {
        mountCard({ kind: 'fields', title: 'x', lines: [{ kind: 'field', name: '<b>Stage</b>', type: 'hologram', options: [] }, { kind: 'field', name: '', type: 'text' }] });
        expect(rows()).toEqual([['field', 'Field', '<b>Stage</b>']]);
        expect(wrapper.find('b').exists()).toBe(false);
    });
});

describe('the preview card for a view an agent wants to add', () => {
    const view = {
        kind: 'view',
        title: 'My open work',
        lines: [
            { kind: 'place', project: 'Website', list: '' },
            { kind: 'layout', value: 'board' },
            { kind: 'group', by: '', field: 'Region' },
            { kind: 'sort', by: 'due', field: '', descending: true },
            { kind: 'mine' },
            { kind: 'statuses', names: ['In Progress', 'Review'] },
            { kind: 'priorities', values: ['HIGH', 'URGENT'] },
            { kind: 'search', text: 'invoice' },
            { kind: 'columns', names: ['Region'], others: 2 },
        ],
    };

    it('says it is a new view, its name, and what it shows', () => {
        mountCard(view);
        expect(wrapper.find('[data-test="intent-kind"]').text()).toBe('New view');
        expect(rows()).toEqual([
            ['place', 'Where', 'Website'],
            ['layout', 'Layout', 'Board'],
            ['group', 'Grouped by', 'Region'],
            ['sort', 'Sorted by', 'Due date, descending'],
            ['mine', 'Shows', 'Only the tasks of the person looking'],
            ['statuses', 'Status', 'In Progress, Review'],
            ['priorities', 'Priority', 'High, Urgent'],
            ['search', 'Search', 'invoice'],
            ['columns', 'Columns', 'Region and 2 more'],
        ]);
        expect(intentTitle(t, view)).toBe('add the view “My open work”');
    });

    it('names a built-in group and sort in words, and leaves out a line it cannot word', () => {
        mountCard({ kind: 'view', title: 'Plain', lines: [{ kind: 'layout', value: 'hologram' }, { kind: 'group', by: 'due_date', field: '' }, { kind: 'sort', by: 'name', field: '', descending: false }, { kind: 'columns', names: [], others: 1 }] });
        expect(rows()).toEqual([
            ['group', 'Grouped by', 'Due date'],
            ['sort', 'Sorted by', 'Name, ascending'],
            ['columns', 'Columns', '1 field not shown'],
        ]);
    });

    it('says which due dates the view keeps, in words or as a range of days', () => {
        mountCard({ kind: 'view', title: 'Due', lines: [{ kind: 'dueFilter', when: 'this_week' }, { kind: 'dueFilter', when: 'overdue' }, { kind: 'dueFilter', from: '2026-10-05', to: '2026-10-09' }, { kind: 'dueFilter', when: 'someday' }, { kind: 'dueFilter', from: '2026-10-05' }] });
        expect(rows()).toEqual([
            ['dueFilter', 'Due', 'This week'],
            ['dueFilter', 'Due', 'Before today'],
            ['dueFilter', 'Due', 'Oct 5, 2026 to Oct 9, 2026'],
        ]);
    });
});

describe('the preview card for a whole project setup an agent wants to make', () => {
    const plan = {
        kind: 'setup',
        title: 'Website',
        lines: [
            { kind: 'place', project: 'Website', list: '' },
            { kind: 'newStatuses', names: ['In Review', 'Client check'] },
            { kind: 'newLists', names: ['Backlog', 'This week'] },
            { kind: 'field', name: 'Budget', type: 'money', options: [] },
            { kind: 'planView', name: 'Review board', layout: 'board' },
            { kind: 'group', by: 'status', field: '' },
            { kind: 'columns', names: ['Budget'], others: 0 },
            { kind: 'planView', name: '<i>Plain</i>', layout: 'hologram' },
        ],
    };

    it('says it is a project setup and lists every part on a line of its own, each view followed by what it shows', () => {
        mountCard(plan);
        expect(wrapper.find('[data-test="intent-kind"]').text()).toBe('Project setup');
        expect(wrapper.find('[data-test="intent-title"]').text()).toBe('Website');
        expect(rows()).toEqual([
            ['place', 'Where', 'Website'],
            ['newStatuses', 'New statuses', 'In Review, Client check'],
            ['newLists', 'New lists', 'Backlog, This week'],
            ['field', 'Field', 'Budget: Money'],
            ['planView', 'New view', 'Review board: Board'],
            ['group', 'Grouped by', 'Status'],
            ['columns', 'Columns', 'Budget'],
            ['planView', 'New view', '<i>Plain</i>'],
        ]);
        expect(wrapper.find('i').exists()).toBe(false);
        expect(intentTitle(t, plan)).toBe('set up the project “Website”');
    });

    it('leaves out a part that names nothing', () => {
        mountCard({ kind: 'setup', title: 'Website', lines: [{ kind: 'newStatuses', names: [] }, { kind: 'newLists', names: ['', 7] }, { kind: 'planView', name: '', layout: 'board' }] });
        expect(rows()).toEqual([]);
    });
});

describe('what an approved setup could not make', () => {
    it('counts each part that was not made beside a change that failed whole', () => {
        const applied = [
            { action: 'project.setup', ok: true, result: { made: 3, notMade: [{ part: 'fields', name: 'Budget', error: 'disk full' }, { part: 'views', name: '', error: 'no board view' }, { part: 'lists' }] } },
            { action: 'task.add', ok: false, error: 'not allowed' },
            { action: 'fields.create', ok: true, result: { made: 1 } },
        ];
        expect(unappliedOf({ applied })).toEqual([{ ok: false, error: 'Budget: disk full' }, { ok: false, error: 'no board view' }, applied[1]]);
        expect(unappliedOf({})).toEqual([]);
    });
});
