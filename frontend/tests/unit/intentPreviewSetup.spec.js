import { afterEach, describe, expect, it } from 'vitest';
import { mount } from '@vue/test-utils';
import { createI18n } from 'vue-i18n';
import en from '@/locales/en';
import IntentPreview from '@/components/molecules/IntentPreview/IntentPreview.vue';
import { intentTitle } from '@/components/molecules/IntentPreview/intentLines';

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
});
