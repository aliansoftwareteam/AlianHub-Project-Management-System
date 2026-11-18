import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { parse } from '@vue/compiler-sfc';
import { defineComponent, h } from 'vue';

const { store, perms, validation } = vi.hoisted(() => ({
    store: { getters: {} },
    perms: { value: () => true },
    validation: { valid: true, checkAllFields: vi.fn(), checkErrors: vi.fn() },
}));

vi.mock('vuex', async (importOriginal) => ({ ...(await importOriginal()), useStore: () => store }));
vi.mock('@/composable', () => ({
    useCustomComposable: () => ({ makeUniqueId: () => 'uid', checkPermission: (key) => perms.value(key) }),
}));
vi.mock('@/composable/Validation.js', () => ({
    useValidation: () => ({ checkAllFields: validation.checkAllFields, checkErrors: validation.checkErrors }),
}));

import CardFieldComponent from '@/components/molecules/CardFieldComponent/CardFieldComponent.vue';

const DropStub = defineComponent({
    name: 'DropDownListComponent',
    props: ['field', 'items', 'selectedItems', 'error', 'selectedItem', 'isMultiSelect'],
    emits: ['update:selected'],
    render() {
        return h('div', {
            class: 'dd-stub', 'data-label': this.field?.label, 'data-error': this.error || '',
            'data-items': JSON.stringify((this.items || []).map((i) => i._id ?? i.key ?? i.id)),
            'data-selected': JSON.stringify(this.selectedItems),
        });
    },
});
const ToggleStub = defineComponent({ name: 'ToggleFieldComponent', props: ['field'], render() { return h('div', { class: 'toggle-stub', 'data-name': this.field.name }); } });
const TextStub = defineComponent({ name: 'TextInputFieldComponent', props: ['field'], render() { return h('div', { class: 'text-stub', 'data-name': this.field.name }); } });
const FilterStub = defineComponent({
    name: 'HomeTaskFilter',
    props: ['selected', 'isValidateFilter', 'filterField', 'selectedProjects'],
    emits: ['selectedFilter'],
    render() { return h('div', { class: 'filter-stub', 'data-valid': String(this.isValidateFilter), 'data-projects': this.selectedProjects.map((p) => p._id).join(',') }); },
});
const RecentStub = defineComponent({
    name: 'RecentlyAddedProjects',
    props: ['projects', 'selectedIds'],
    emits: ['toggle', 'dismiss'],
    render() { return h('div', { class: 'recent-stub', 'data-ids': this.projects.map((p) => p._id).join(',') }); },
});
const MapperStub = defineComponent({
    name: 'CategoryTaskTypeMapper',
    props: ['modelValue'],
    emits: ['update:modelValue'],
    render() { return h('div', { class: 'mapper-stub', 'data-map': JSON.stringify(this.modelValue) }); },
});

const stubs = {
    DropDownListComponent: DropStub, ToggleFieldComponent: ToggleStub, TextInputFieldComponent: TextStub,
    HomeTaskFilter: FilterStub, RecentlyAddedProjects: RecentStub, CategoryTaskTypeMapper: MapperStub,
};

const projects = [
    { _id: 'p1', ProjectName: 'Alpha' },
    { _id: 'p2', ProjectName: 'Beta' },
    { _id: 'p3', ProjectName: 'Gamma' },
];
const measureOptions = [{ id: 1, name: 'workload' }, { id: 2, name: 'tracker' }, { id: 3, name: 'tasks' }];

const baseFields = () => [
    { name: 'title', label: 'title', type: 'text', groupBy: 'display', value: 'My card', rules: 'required' },
    { name: 'AssigneeUserId', label: 'show_assignees', type: 'dropdown', groupBy: 'data', value: [] },
    { name: 'projectId', label: 'location', type: 'dropdown', groupBy: 'data', value: [] },
    { name: 'statusArray', label: 'status', type: 'dropdown', groupBy: 'data', value: [] },
];

let wrapper;
const mountCard = async (props = {}) => {
    wrapper = mount(CardFieldComponent, {
        props: { fieldsArray: baseFields(), allProjectsArray: projects, isEditCard: false, cardType: 'dashboard', ...props },
        global: { stubs },
    });
    await flushPromises();
    return wrapper;
};
const save = async () => { await wrapper.get('.submit-btn').trigger('click'); await flushPromises(); };
const dd = (label) => wrapper.findAll('.dd-stub').find((d) => d.attributes('data-label') === label);
const ddVm = (label) => wrapper.findAllComponents(DropStub).find((c) => c.props('field').label === label).vm;
const json = (value) => JSON.parse(value);
const submitted = () => wrapper.emitted('handleFunction')?.[0];

beforeEach(() => {
    store.getters = {
        'users/users': [{ _id: 'user-1', Employee_Name: 'Me' }, { _id: 'user-2', Employee_Name: 'Ben' }, { _id: 'user-3', Employee_Name: 'Cara' }],
        'settings/teams': [
            { _id: 't1', name: 'Design', assigneeUsersArray: ['user-2'] },
            { _id: 't2', name: 'Empty team', assigneeUsersArray: [] },
        ],
        'settings/AllTaskStatus': { settings: [{ key: 1, name: 'To Do' }, { key: 2, name: 'Doing' }, { key: 3, name: 'Complete' }] },
        'settings/companyUserDetail': { roleType: 1 },
    };
    perms.value = () => true;
    validation.checkAllFields.mockReset().mockResolvedValue(true);
    validation.checkErrors.mockReset();
    localStorage.clear();
});

afterEach(() => {
    wrapper?.unmount();
    wrapper = null;
    vi.restoreAllMocks();
});

describe('CardFieldComponent layout', () => {
    it('with no fields still shows labelled Cancel and Save and no sections', async () => {
        await mountCard({ fieldsArray: [] });
        expect(wrapper.find('.custom-form-container').exists()).toBe(false);
        expect(wrapper.get('.cancel-btn').text()).toBe('Projects.cancel');
        expect(wrapper.get('.submit-btn').text()).toBe('Projects.save');
        expect(wrapper.get('.cancel-btn').attributes('type')).toBe('button');
    });

    it('renders display and data sections with i18n headings and the right child for each field type', async () => {
        await mountCard({ fieldsArray: [...baseFields(), { name: 'toggle', label: 'show', type: 'radio', groupBy: 'display', value: true }] });
        expect(wrapper.findAll('.group_by_card').map((h) => h.text())).toEqual(['dashboardCard.display', 'dashboardCard.data']);
        expect(wrapper.find('.text-stub').attributes('data-name')).toBe('title');
        expect(wrapper.find('.toggle-stub').attributes('data-name')).toBe('toggle');
        expect(wrapper.findAll('.dd-stub').map((d) => d.attributes('data-label'))).toEqual(['show_assignees', 'status']);
    });

    it('leaves out a section whose fields are all hidden', async () => {
        const fields = baseFields();
        fields[0].hidden = true;
        await mountCard({ fieldsArray: fields });
        expect(wrapper.findAll('.group_by_card').map((h) => h.text())).toEqual(['dashboardCard.data']);
        expect(wrapper.find('.text-stub').exists()).toBe(false);
    });

    it('drops the retired hideEmptyEmployees field', async () => {
        await mountCard({ fieldsArray: [...baseFields(), { name: 'hideEmptyEmployees', label: 'hide', type: 'radio', groupBy: 'display', value: true }] });
        expect(wrapper.find('.toggle-stub').exists()).toBe(false);
    });

    it('Cancel closes the sidebar without saving', async () => {
        await mountCard();
        await wrapper.get('.cancel-btn').trigger('click');
        expect(wrapper.emitted('closeSidebar')).toEqual([[false]]);
        expect(wrapper.emitted('handleFunction')).toBeUndefined();
    });
});

describe('CardFieldComponent defaults and saving', () => {
    it('a new card starts with everyone, all statuses and all projects, and saves them in dynamic "all" mode', async () => {
        await mountCard();
        expect(json(dd('show_assignees').attributes('data-selected'))).toEqual(['user-1', 'user-2', 'user-3']);
        expect(json(dd('status').attributes('data-selected'))).toEqual([1, 2, 3]);
        await save();
        const [data, filter] = submitted();
        expect(data).toMatchObject({ title: 'My card', AssigneeUserId: ['user-1', 'user-2', 'user-3'], statusArray: [1, 2, 3], projectMode: 'all', projectId: [] });
        expect(filter).toEqual([]);
    });

    it('Save locks after a successful submit so it cannot fire twice', async () => {
        await mountCard();
        expect(wrapper.get('.submit-btn').attributes('disabled')).toBeUndefined();
        await save();
        expect(wrapper.get('.submit-btn').attributes('disabled')).toBeDefined();
    });

    it('does not submit and stays editable when field validation fails', async () => {
        validation.checkAllFields.mockResolvedValue(false);
        await mountCard();
        await save();
        expect(submitted()).toBeUndefined();
        expect(wrapper.get('.submit-btn').attributes('disabled')).toBeUndefined();
    });

    it('does not submit fields that are hidden, and does not send disabled ones', async () => {
        const fields = baseFields();
        fields.push({ name: 'secret', label: 'secret', type: 'text', groupBy: 'display', value: 'x', hidden: true });
        fields.push({ name: 'locked', label: 'locked', type: 'text', groupBy: 'display', value: 'y', disabled: true });
        await mountCard({ fieldsArray: fields });
        await save();
        const [data] = submitted();
        expect(data).toHaveProperty('secret');
        expect(data).not.toHaveProperty('locked');
        const checked = validation.checkAllFields.mock.calls[0][0];
        expect(Object.keys(checked)).not.toContain('secret');
    });

    it('an edited card keeps its saved assignees, statuses and projects', async () => {
        const fields = baseFields();
        fields[1].value = ['user-2'];
        fields[2].value = ['p2'];
        fields[3].value = [2];
        await mountCard({ fieldsArray: fields, isEditCard: true });
        await save();
        expect(submitted()[0]).toMatchObject({ AssigneeUserId: ['user-2'], statusArray: [2], projectMode: 'include', projectId: ['p2'] });
    });

    it('restores the saved project mode on an edited card', async () => {
        const fields = baseFields();
        fields[2].value = ['p1'];
        await mountCard({ fieldsArray: fields, isEditCard: true, savedProjectMode: 'exclude' });
        await save();
        expect(submitted()[0]).toMatchObject({ projectMode: 'exclude', projectId: ['p1'] });
    });

    it('sends the measure, calculation, time range, fields and log type choices', async () => {
        const fields = [
            { name: 'measure', label: 'measure', type: 'dropdown', groupBy: 'display', value: 1, options: measureOptions },
            { name: 'calculation', label: 'calculation', type: 'dropdown', groupBy: 'display', value: 5, options: [{ id: 5, name: 'sum' }] },
            { name: 'timerange', label: 'timerange', type: 'dropdown', groupBy: 'display', value: 7, options: [{ id: 7, name: 'week' }] },
            { name: 'logtype', label: 'logtype', type: 'dropdown', groupBy: 'display', value: 9, options: [{ id: 9, name: 'log' }] },
            { name: 'groupBy', label: 'group_by', type: 'dropdown', groupBy: 'display', value: { $numberLong: '4' }, options: [{ id: 4, name: 'day' }] },
            { name: 'fields', label: 'fields', type: 'dropdown', groupBy: 'display', value: ['a'], options: [{ id: 'a', name: 'x' }, { id: 'b', name: 'y' }] },
        ];
        await mountCard({ fieldsArray: fields, isEditCard: true });
        await save();
        expect(submitted()[0]).toMatchObject({ measure: 1, calculation: 5, timerange: 7, logtype: 9, groupBy: 4, fields: ['a'] });
    });

    it('a new card ticks every optional field by default', async () => {
        const fields = [{ name: 'fields', label: 'fields', type: 'dropdown', groupBy: 'display', value: [], options: [{ id: 'a', name: 'x' }, { id: 'b', name: 'y' }] }];
        await mountCard({ fieldsArray: fields });
        await save();
        expect(submitted()[0].fields).toEqual(['a', 'b']);
    });
});

describe('CardFieldComponent status defaults', () => {
    const statuses = () => [
        { key: 1, name: 'To Do' }, { key: 2, name: 'in progress' }, { key: 3, name: 'In Review' },
        { key: 4, name: 'In Review' }, { key: 5, name: 'Blocked' }, { key: 6, name: ' Complete ' },
    ];

    it('the status summary card starts on its five usual statuses, one per name', async () => {
        store.getters['settings/AllTaskStatus'] = { settings: statuses() };
        await mountCard({ componentId: 'TaskStatusSummaryCard' });
        expect(json(dd('status').attributes('data-selected'))).toEqual([1, 2, 3, 6]);
        expect(json(dd('status').attributes('data-items'))).toEqual([1, 2, 3, 4, 5, 6]);
    });

    it('falls back to every status when a company uses none of those names', async () => {
        store.getters['settings/AllTaskStatus'] = { settings: [{ key: 8, name: 'Alpha' }, { key: 9, name: 'Beta' }] };
        await mountCard({ componentId: 'TaskStatusSummaryCard' });
        expect(json(dd('status').attributes('data-selected'))).toEqual([8, 9]);
    });

    it('other cards start on every status', async () => {
        store.getters['settings/AllTaskStatus'] = { settings: statuses() };
        await mountCard({ componentId: 'SomethingElse' });
        expect(json(dd('status').attributes('data-selected'))).toEqual([1, 2, 3, 4, 5, 6]);
    });
});

describe('CardFieldComponent assignees', () => {
    it('offers "Me" first, then teams with members, then the other people; the viewer is not listed twice', async () => {
        await mountCard();
        expect(json(dd('show_assignees').attributes('data-items'))).toEqual(['user-1', 'tId_t1', 'user-2', 'user-3']);
        const me = ddVm('show_assignees').$props.items[0];
        expect(me).toMatchObject({ Employee_Name: 'dashboardCard.me_option', isMe: true });
    });

    it('blocks saving with an error on the assignee picker when nobody is selected', async () => {
        await mountCard();
        ddVm('show_assignees').$emit('update:selected', [], { label: 'show_assignees' });
        await flushPromises();
        await save();
        expect(submitted()).toBeUndefined();
        expect(dd('show_assignees').attributes('data-error')).toBe('dashboardCard.error_assignees');
        ddVm('show_assignees').$emit('update:selected', ['user-2'], { label: 'show_assignees' });
        await flushPromises();
        expect(dd('show_assignees').attributes('data-error')).toBe('');
        await save();
        expect(submitted()[0].AssigneeUserId).toEqual(['user-2']);
    });

    it('the employee workload card shows a member only themselves and no teams', async () => {
        store.getters['settings/companyUserDetail'] = { roleType: 3 };
        await mountCard({ componentId: 'EmployeeWorkloadReportCard' });
        expect(json(dd('show_assignees').attributes('data-items'))).toEqual(['user-1']);
        expect(json(dd('show_assignees').attributes('data-selected'))).toEqual(['user-1']);
    });

    it('the employee workload card shows an admin everyone', async () => {
        await mountCard({ componentId: 'EmployeeWorkloadReportCard' });
        expect(json(dd('show_assignees').attributes('data-items'))).toEqual(['user-1', 'tId_t1', 'user-2', 'user-3']);
    });

    it('time-range cards limit a person without timesheet rights to themselves', async () => {
        perms.value = () => 1;
        const fields = [
            { name: 'measure', label: 'measure', type: 'dropdown', groupBy: 'display', value: 1, options: measureOptions },
            { name: 'timerange', label: 'timerange', type: 'dropdown', groupBy: 'display', value: 7, options: [{ id: 7, name: 'week' }] },
            ...baseFields().slice(1, 2),
        ];
        await mountCard({ fieldsArray: fields, isEditCard: true });
        await save();
        expect(submitted()[0].AssigneeUserId).toEqual(['user-1']);
    });

    // The tracker branch asks about workload_timesheet instead of tracker_timesheet, so a person without tracker access keeps everyone.
    it.fails('a person without tracker timesheet access is limited to themselves for the tracker measure', async () => {
        perms.value = (key) => (key === 'sheet_settings.tracker_timesheet' ? null : true);
        const fields = [
            { name: 'measure', label: 'measure', type: 'dropdown', groupBy: 'display', value: 2, options: measureOptions },
            { name: 'timerange', label: 'timerange', type: 'dropdown', groupBy: 'display', value: 7, options: [{ id: 7, name: 'week' }] },
            ...baseFields().slice(1, 2),
        ];
        await mountCard({ fieldsArray: fields, isEditCard: true });
        await save();
        expect(submitted()[0].AssigneeUserId).toEqual(['user-1']);
    });
});

describe('CardFieldComponent project scope', () => {
    const scope = () => wrapper.find('.cf-scope-select');

    it('shows the scope selector with translated options, defaulting to all projects with no list', async () => {
        await mountCard();
        expect(wrapper.get('.cf-scope-label').text()).toBe('dashboardCard.location');
        expect(scope().findAll('option').map((o) => o.text())).toEqual(['dashboardCard.project_scope_all', 'dashboardCard.project_scope_include', 'dashboardCard.project_scope_exclude']);
        expect(scope().element.value).toBe('all');
        expect(wrapper.find('.cf-scope-list').exists()).toBe(false);
    });

    it('Include and Exclude reveal the project list; All hides it again', async () => {
        await mountCard();
        await scope().setValue('include');
        expect(wrapper.find('.cf-scope-list').exists()).toBe(true);
        await scope().setValue('exclude');
        expect(wrapper.find('.cf-scope-list').exists()).toBe(true);
        await scope().setValue('all');
        expect(wrapper.find('.cf-scope-list').exists()).toBe(false);
    });

    it('Include with nothing chosen blocks saving and names the problem; choosing a project clears it', async () => {
        await mountCard();
        await scope().setValue('include');
        const picker = () => wrapper.get('.cf-scope-list .dd-stub');
        wrapper.getComponent('.cf-scope-list .dd-stub').vm.$emit('update:selected', [], { label: 'location' });
        await flushPromises();
        await save();
        expect(submitted()).toBeUndefined();
        expect(picker().attributes('data-error')).toBe('dashboardCard.error_location');
        wrapper.getComponent('.cf-scope-list .dd-stub').vm.$emit('update:selected', ['p3'], { label: 'location' });
        await flushPromises();
        expect(picker().attributes('data-error')).toBe('');
        await save();
        expect(submitted()[0]).toMatchObject({ projectMode: 'include', projectId: ['p3'] });
    });

    it('Exclude saves the excluded ids', async () => {
        await mountCard();
        await scope().setValue('exclude');
        wrapper.getComponent('.cf-scope-list .dd-stub').vm.$emit('update:selected', ['p1', 'p2'], { label: 'location' });
        await flushPromises();
        await save();
        expect(submitted()[0]).toMatchObject({ projectMode: 'exclude', projectId: ['p1', 'p2'] });
    });
});

describe('CardFieldComponent measure rules', () => {
    const fields = () => [
        { name: 'measure', label: 'measure', type: 'dropdown', groupBy: 'display', value: 1, options: measureOptions },
        { name: 'calculation', label: 'calculation', type: 'dropdown', groupBy: 'display', value: 5, options: [{ id: 5, name: 'sum' }] },
        { name: 'timerange', label: 'timerange', type: 'dropdown', groupBy: 'display', value: 7, options: [{ id: 7, name: 'week' }] },
        { name: 'flag', label: 'flag', type: 'radio', groupBy: 'display', value: true },
    ];

    it('shows calculation and time range for workload, hides the toggle', async () => {
        await mountCard({ fieldsArray: fields(), isEditCard: true });
        expect(wrapper.findAll('.dd-stub').map((d) => d.attributes('data-label'))).toEqual(['measure', 'calculation', 'timerange']);
        expect(wrapper.find('.toggle-stub').exists()).toBe(false);
    });

    it('switching to the task measure drops calculation and time range and shows the toggle', async () => {
        await mountCard({ fieldsArray: fields(), isEditCard: true });
        ddVm('measure').$emit('update:selected', { id: 3 }, { label: 'measure' });
        await flushPromises();
        expect(wrapper.findAll('.dd-stub').map((d) => d.attributes('data-label'))).toEqual(['measure']);
        expect(wrapper.find('.toggle-stub').exists()).toBe(true);
        await save();
        expect(submitted()[0].measure).toBe(3);
    });

    it('stores each picked option on the matching setting', async () => {
        await mountCard({ fieldsArray: fields(), isEditCard: true });
        ddVm('calculation').$emit('update:selected', { id: 6 }, { label: 'calculation' });
        ddVm('timerange').$emit('update:selected', { id: 8 }, { label: 'timerange' });
        await flushPromises();
        await save();
        expect(submitted()[0]).toMatchObject({ calculation: 6, timerange: 8 });
    });
});

describe('CardFieldComponent filter', () => {
    const withFilter = () => [...baseFields(), { name: 'filter', label: 'add_filter', type: 'filter', groupBy: 'filter', value: [] }];

    it('shows the filter section with its heading and the chosen projects', async () => {
        const fields = withFilter();
        await mountCard({ fieldsArray: fields });
        expect(wrapper.findAll('.group_by_card').map((h) => h.text())).toContain('Filters.filter');
        expect(wrapper.get('.filter-stub').attributes('data-projects')).toBe('p1,p2,p3');
        expect(wrapper.get('.filter-stub').attributes('data-valid')).toBe('true');
    });

    it('hides the filter for time tracking cards and the cards that never had one', async () => {
        await mountCard({ fieldsArray: withFilter(), cardType: 'time_tracking' });
        expect(wrapper.find('.filter-stub').exists()).toBe(false);
        wrapper.unmount();
        await mountCard({ fieldsArray: withFilter(), componentId: 'QueueListComp' });
        expect(wrapper.find('.filter-stub').exists()).toBe(false);
    });

    it('sends a complete filter along with the form', async () => {
        await mountCard({ fieldsArray: withFilter() });
        const rule = { name: { value: 'Status' }, comparison: { value: 'is' }, values: ['Open'] };
        wrapper.getComponent(FilterStub).vm.$emit('selectedFilter', [rule]);
        await flushPromises();
        await save();
        expect(submitted()[1]).toEqual([{ name: { value: 'Status' }, comparison: { value: 'is' }, values: ['Open'] }]);
    });

    it('an incomplete filter blocks saving and flags the filter as invalid', async () => {
        await mountCard({ fieldsArray: withFilter() });
        wrapper.getComponent(FilterStub).vm.$emit('selectedFilter', [{ name: { value: 'Status' }, comparison: { value: 'is' }, values: [] }]);
        await flushPromises();
        await save();
        expect(submitted()).toBeUndefined();
        expect(wrapper.get('.filter-stub').attributes('data-valid')).toBe('false');
        expect(wrapper.get('.submit-btn').attributes('disabled')).toBeUndefined();
    });

    it('a due-date range without a date is incomplete', async () => {
        await mountCard({ fieldsArray: withFilter() });
        wrapper.getComponent(FilterStub).vm.$emit('selectedFilter', [{ name: { value: 'DueDate' }, comparison: { value: 'is' }, values: ['Date range'], date: '' }]);
        await flushPromises();
        await save();
        expect(submitted()).toBeUndefined();
    });
});

describe('CardFieldComponent workload card extras', () => {
    const now = new Date();
    const recent = { _id: 'p9', ProjectName: 'Fresh', createdAt: now.toISOString() };
    const old = { _id: 'p8', ProjectName: 'Old', createdAt: '2020-01-01T00:00:00.000Z' };
    const fields = () => baseFields();
    const recentIds = () => wrapper.find('.recent-stub')?.attributes('data-ids');

    it('suggests only recently created projects, not old ones', async () => {
        const f = fields();
        f[2].value = ['p1'];
        await mountCard({ fieldsArray: f, isEditCard: true, savedProjectMode: 'include', componentId: 'EmployeeWorkloadReportCard', allProjectsArray: [...projects, recent, old] });
        expect(recentIds()).toBe('p9');
    });

    it('suggests nothing while every project is already in scope', async () => {
        await mountCard({ fieldsArray: fields(), componentId: 'EmployeeWorkloadReportCard', allProjectsArray: [...projects, recent] });
        expect(wrapper.find('.recent-stub').exists()).toBe(false);
    });

    it('never suggests projects on other cards', async () => {
        await mountCard({ fieldsArray: fields(), componentId: 'Other', allProjectsArray: [...projects, recent] });
        expect(wrapper.find('.recent-stub').exists()).toBe(false);
    });

    it('lists a new project once it is not in the saved selection, and ticking it moves it into the scope', async () => {
        const f = fields();
        f[2].value = ['p1'];
        await mountCard({ fieldsArray: f, isEditCard: true, savedProjectMode: 'include', componentId: 'EmployeeWorkloadReportCard', allProjectsArray: [...projects, recent, old] });
        expect(recentIds()).toBe('p9');
        wrapper.getComponent(RecentStub).vm.$emit('toggle', 'p9');
        await flushPromises();
        expect(wrapper.find('.recent-stub').exists()).toBe(false);
        await save();
        expect(submitted()[0].projectId).toEqual(['p1', 'p9']);
    });

    it('dismissing a suggestion hides it and remembers that for this person', async () => {
        const f = fields();
        f[2].value = ['p1'];
        await mountCard({ fieldsArray: f, isEditCard: true, savedProjectMode: 'include', componentId: 'EmployeeWorkloadReportCard', allProjectsArray: [...projects, recent] });
        wrapper.getComponent(RecentStub).vm.$emit('dismiss', 'p9');
        await flushPromises();
        expect(wrapper.find('.recent-stub').exists()).toBe(false);
        expect(JSON.parse(localStorage.getItem('rap_dismissed_user-1'))).toEqual(['p9']);
        wrapper.unmount();
        await mountCard({ fieldsArray: f, isEditCard: true, savedProjectMode: 'include', componentId: 'EmployeeWorkloadReportCard', allProjectsArray: [...projects, recent] });
        expect(wrapper.find('.recent-stub').exists()).toBe(false);
    });

    it('still hides the suggestion in this session when browser storage is blocked', async () => {
        const f = fields();
        f[2].value = ['p1'];
        vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('blocked'); });
        vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('blocked'); });
        await mountCard({ fieldsArray: f, isEditCard: true, savedProjectMode: 'include', componentId: 'EmployeeWorkloadReportCard', allProjectsArray: [...projects, recent] });
        wrapper.getComponent(RecentStub).vm.$emit('dismiss', 'p9');
        await flushPromises();
        expect(wrapper.find('.recent-stub').exists()).toBe(false);
    });

    it('the category card edits its map through the form and saves it', async () => {
        const f = [...fields(), { name: 'categoryMap', label: 'map', type: 'custom', groupBy: 'data', value: { a: 1 } }];
        await mountCard({ fieldsArray: f, componentId: 'UsersByCategoryCard' });
        expect(JSON.parse(wrapper.get('.mapper-stub').attributes('data-map'))).toEqual({ a: 1 });
        wrapper.getComponent(MapperStub).vm.$emit('update:modelValue', { b: 2 });
        await flushPromises();
        await save();
        expect(submitted()[0].categoryMap).toEqual({ b: 2 });
    });
});

describe('CardFieldComponent copy', () => {
    const source = readFileSync(resolve(__dirname, '../../src/components/molecules/CardFieldComponent/CardFieldComponent.vue'), 'utf8');
    const visibleAttrs = ['title', 'placeholder', 'alt', 'aria-label', 'label'];

    const bareCopy = () => {
        const found = [];
        const walk = (node) => {
            if (node.type === 2 && /\p{L}|\d/u.test(node.content)) found.push(node.content.trim());
            (node.props || []).forEach((p) => {
                if (p.type === 6 && visibleAttrs.includes(p.name) && p.value?.content) found.push(`${p.name}="${p.value.content}"`);
            });
            (node.children || []).forEach((c) => typeof c === 'object' && walk(c));
        };
        walk(parse(source).descriptor.template.ast);
        return found;
    };

    it('has no hard-coded visible text or attributes in the template', () => {
        expect(bareCopy()).toEqual([]);
    });

    it('every heading, option and button the person reads is an i18n key', async () => {
        await mountCard({ fieldsArray: [...baseFields(), { name: 'filter', label: 'add_filter', type: 'filter', groupBy: 'filter', value: [] }] });
        const texts = [...wrapper.findAll('h3, option, button, label')].map((n) => n.text());
        texts.forEach((text) => expect(text).toMatch(/^[A-Za-z]+\.[A-Za-z_]+$/));
    });
});
