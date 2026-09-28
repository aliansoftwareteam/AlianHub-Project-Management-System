/* Task 042 slice 5 — List and Table get a column chooser, custom field columns, story points
   with a total per group, and a Table whose cells edit in place from the keyboard. */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { config, flushPromises, mount } from '@vue/test-utils';
import { createI18n } from 'vue-i18n';
import { createStore } from 'vuex';
import { computed, defineComponent, h, nextTick, ref } from 'vue';
import en from '@/locales/en';

const { ops, idle } = vi.hoisted(() => ({
    ops: {
        updateTaskCustomField: vi.fn(() => Promise.resolve({ status: true })),
        updatePoints: vi.fn(() => Promise.resolve()),
        updateTotalEstimatedTime: vi.fn(() => Promise.resolve()),
        updateStatus: vi.fn(() => Promise.resolve())
    },
    idle: () => ({ get: () => ({ state: 'idle' }), ensure: () => {}, generate: () => {}, pin: () => {}, unpin: () => {} })
}));
vi.mock('@/utils/TaskOperations', () => ({ default: ops }));
vi.mock('@/services', () => ({ apiRequest: vi.fn(() => Promise.resolve({ data: {} })) }));
vi.mock('@/store/index', () => ({ default: { commit: () => {}, dispatch: () => Promise.resolve(), getters: {}, state: {} } }));
vi.mock('@/views/Projects/TableView/useTaskSummaries.js', () => ({ useTaskSummaries: idle }));
vi.mock('@/views/Projects/TableView/useTaskCategories.js', () => ({ useTaskCategories: idle }));

import {
    columnCatalogue, defaultColumns, gridTracks, listColumnsAt, resolveColumns, useViewColumns, withMove, withVisibility, columnStorageKey
} from '@/views/Projects/composables/viewColumns';
import { provideViewSettings } from '@/views/Projects/composables/viewSettingsContext';
import { customFieldPayload, customFieldText, projectFieldDefs } from '@/views/Projects/composables/projectCustomFields';
import { parseEstimate, pointsTotal } from '@/views/Projects/composables/taskPoints';
import { fieldEditRights } from '@/views/Projects/ListView/listRowEdit';
import { useListInlineEdit } from '@/views/Projects/ListView/useListInlineEdit';
import { handleGridKey } from '@/views/Projects/TableView/gridKeyboard';
import ViewColumnChooser from '@/views/Projects/components/columns/ViewColumnChooser.vue';
import CustomFieldCell from '@/views/Projects/components/columns/CustomFieldCell.vue';
import TableRow from '@/views/Projects/TableView/TableRow.vue';
import { dismissUndoToast, runUndo, undoToast } from '@/composable/useUndoToast';

const i18n = createI18n({ legacy: false, locale: 'en', messages: { en }, missingWarn: false, fallbackWarn: false });
config.global.plugins = [i18n];

const FIELDS = {
    text: { _id: 'f-text', fieldType: 'text', fieldTitle: 'Customer', isDelete: true, type: 'task', projectId: ['p1'] },
    textarea: { _id: 'f-long', fieldType: 'textarea', fieldTitle: 'Notes', isDelete: true, global: true },
    number: { _id: 'f-num', fieldType: 'number', fieldTitle: 'Seats', isDelete: true, projectId: ['p1'] },
    money: { _id: 'f-money', fieldType: 'money', fieldTitle: 'Budget', fieldMoneySymbol: '$', isDelete: true, projectId: ['p1'] },
    date: { _id: 'f-date', fieldType: 'date', fieldTitle: 'Go live', isDelete: true, projectId: ['p1'] },
    dropdown: {
        _id: 'f-drop', fieldType: 'dropdown', fieldTitle: 'Tier', isDelete: true, projectId: ['p1'],
        fieldOptions: [{ id: 1, label: 'Gold', color: '#c90' }, { id: 2, label: 'Silver', color: '#999' }]
    },
    checkbox: { _id: 'f-check', fieldType: 'checkbox', fieldTitle: 'Signed', isDelete: true, projectId: ['p1'] },
    email: { _id: 'f-mail', fieldType: 'email', fieldTitle: 'Contact', isDelete: true, projectId: ['p1'] },
    phone: { _id: 'f-phone', fieldType: 'phone', fieldTitle: 'Phone', isDelete: true, projectId: ['p1'], fieldCountryCode: '+44' },
    formula: { _id: 'f-formula', fieldType: 'formula', fieldTitle: 'Margin', isDelete: true, projectId: ['p1'] },
    rollup: { _id: 'f-rollup', fieldType: 'rollup', fieldTitle: 'Seats total', isDelete: true, projectId: ['p1'], rollupSourceFieldId: 'f-num', rollupFunction: 'sum' }
};

const task = (over = {}) => ({
    _id: 't1', TaskName: 'Onboard Acme', TaskKey: 'AH-9', ProjectID: 'p1', sprintId: 's1', isParentTask: true, statusKey: 1,
    AssigneeUserId: [], customField: {}, ...over
});

afterEach(() => dismissUndoToast());

describe('the column chooser', () => {
    const catalogue = columnCatalogue('table', { fields: [FIELDS.text, FIELDS.dropdown] });

    it('offers every built-in column and the project\'s fields, with the Table defaults ticked', () => {
        const ids = resolveColumns('table', catalogue, null).map((c) => [c.id, c.visible]);
        expect(ids).toEqual([
            ['status', true], ['assignee', true], ['due', true], ['start', false], ['priority', true], ['estimate', true],
            ['points', true], ['tags', true], ['created', false], ['updated', false], ['summary', true], ['risk', true],
            ['area', true], ['doneBy', true], ['cf:f-text', true], ['cf:f-drop', true]
        ]);
    });

    it('drops a column the rules take away and keeps its saved place for when it returns', () => {
        const noTags = columnCatalogue('list', { tagsOn: false, priorityOn: false });
        expect(noTags.map((c) => c.id)).not.toContain('tags');
        expect(noTags.map((c) => c.id)).not.toContain('priority');
        const state = withMove(null, columnCatalogue('list').map((c) => c.id), 'tags', 2);
        expect(resolveColumns('list', noTags, state).map((c) => c.id)[0]).toBe('assignee');
        expect(resolveColumns('list', columnCatalogue('list'), state).map((c) => c.id).slice(0, 3)).toEqual(['assignee', 'due', 'tags']);
    });

    it('shows, hides and reorders from the panel into the open view\'s state, without the browser', async () => {
        const storage = window.localStorage;
        storage.clear();
        let api;
        const settings = { sort: ref(null), columns: ref({ order: [], shown: [], hidden: [] }) };
        settings.setSort = (value) => { settings.sort.value = value; };
        settings.setColumns = (value) => { settings.columns.value = value; };
        const Chooser = defineComponent({
            setup() {
                api = useViewColumns(ref('p1'), 'table', computed(() => catalogue));
                return () => h(ViewColumnChooser, {
                    columns: api.columns.value,
                    onToggle: api.setVisible,
                    onMove: api.move,
                    onReset: api.reset
                });
            }
        });
        const Host = defineComponent({ setup() { provideViewSettings(settings); return () => h(Chooser); } });
        const wrapper = mount(Host, { attachTo: document.body });

        await wrapper.get('.vcc__trigger').trigger('click');
        expect(wrapper.get('[role="dialog"]').attributes('aria-label')).toBe('ViewColumns.title');

        const item = (id) => wrapper.findAll('.vcc__item').find((node) => node.attributes('data-column') === id);
        await item('tags').get('input').setValue(false);
        expect(api.visibleColumns.value.map((c) => c.id)).not.toContain('tags');

        await item('due').findAll('.vcc__move')[0].trigger('click');
        expect(api.columns.value.map((c) => c.id).slice(0, 3)).toEqual(['status', 'due', 'assignee']);
        await item('start').get('input').setValue(true);

        expect(settings.columns.value.hidden).toEqual(['tags']);
        expect(settings.columns.value.shown).toEqual(['start']);
        expect(settings.columns.value.order.slice(0, 3)).toEqual(['status', 'due', 'assignee']);
        expect(storage.getItem(columnStorageKey({ companyId: 'company-1', userId: 'user-1', projectId: 'p1' }, 'table'))).toBe(null);
        expect(api.visibleColumns.value.map((c) => c.id).slice(0, 4)).toEqual(['status', 'due', 'assignee', 'start']);

        api.reset();
        expect(api.isVisible('tags')).toBe(true);
        expect(settings.columns.value).toEqual({ order: [], shown: [], hidden: [] });
        wrapper.unmount();
    });

    it('Esc closes the panel and gives focus back to its button', async () => {
        const wrapper = mount(ViewColumnChooser, { props: { columns: resolveColumns('list', columnCatalogue('list'), null) }, attachTo: document.body });
        await wrapper.get('.vcc__trigger').trigger('click');
        await wrapper.get('[role="dialog"]').trigger('keydown', { key: 'Escape' });
        await nextTick();
        expect(wrapper.find('[role="dialog"]').exists()).toBe(false);
        expect(document.activeElement).toBe(wrapper.get('.vcc__trigger').element);
        wrapper.unmount();
    });

    it('lays out one grid track per shown column, and the List keeps its narrower tracks', () => {
        const list = defaultColumns('list');
        expect(gridTracks('list', list)).toBe('28px minmax(0, 1fr) minmax(0, .45fr) 56px 64px 72px 48px 80px 88px');
        expect(listColumnsAt(list, 1050).map((c) => c.id)).not.toContain('doneBy');
        const withPoints = resolveColumns('list', columnCatalogue('list'), withVisibility(null, 'points', true)).filter((c) => c.visible);
        expect(listColumnsAt(withPoints, 900).map((c) => c.id)).toEqual(['tags', 'assignee', 'due', 'priority']);
    });
});

describe('custom field values', () => {
    it('only the project\'s live task fields become columns', () => {
        const defs = projectFieldDefs([...Object.values(FIELDS), { _id: 'x', fieldType: 'text', isDelete: true, projectId: ['p2'] }, { _id: 'y', fieldType: 'text', isDelete: false, projectId: ['p1'] }], 'p1');
        expect(defs.map((d) => d._id)).toEqual(Object.values(FIELDS).map((d) => d._id));
    });

    const valued = task({
        customField: {
            'f-text': { _id: 'f-text', fieldValue: 'Acme Ltd' },
            'f-long': { _id: 'f-long', fieldValue: 'Two sites' },
            'f-num': { _id: 'f-num', fieldValue: '12' },
            'f-money': { _id: 'f-money', fieldValue: '4500' },
            'f-date': { _id: 'f-date', fieldValue: '2026-10-05T00:00:00.000Z' },
            'f-drop': { _id: 'f-drop', fieldValue: [2] },
            'f-check': { _id: 'f-check', fieldValue: true },
            'f-mail': { _id: 'f-mail', fieldValue: 'ops@acme.test' },
            'f-phone': { _id: 'f-phone', fieldValue: '2079460000', fieldCode: '+44' },
            'f-formula': { _id: 'f-formula', fieldValue: 0.35 }
        }
    });
    const kids = [
        { _id: 'k1', ParentTaskId: 't1', deletedStatusKey: 0, customField: { 'f-num': { fieldValue: '3' } } },
        { _id: 'k2', ParentTaskId: 't1', deletedStatusKey: 0, customField: { 'f-num': { fieldValue: '4' } } }
    ];

    const cell = (type, editable = false, data = valued) => mount(CustomFieldCell, {
        props: { def: FIELDS[type], task: data, editable, allTasks: [data, ...kids], defs: Object.values(FIELDS) },
        global: { provide: { $dateFormat: ref('DD/MM/YYYY') }, stubs: { ShellIcon: true } }
    });

    it.each([
        ['text', 'Acme Ltd'], ['textarea', 'Two sites'], ['number', '12'], ['money', '$4500'], ['date', '05/10/2026'],
        ['dropdown', 'Silver'], ['email', 'ops@acme.test'], ['phone', '+44 2079460000'], ['formula', '0.35'], ['rollup', '7']
    ])('%s shows its value', (type, text) => {
        expect(cell(type).text()).toBe(text);
    });

    it('checkbox shows a checked box, read-only without the right', () => {
        const box = cell('checkbox').get('input[type="checkbox"]');
        expect(box.element.checked).toBe(true);
        expect(box.element.disabled).toBe(true);
        expect(cell('checkbox', true).get('input').element.disabled).toBe(false);
    });

    it('formula and rollup never offer an editor, even with the right', () => {
        expect(cell('formula', true).find('button').exists()).toBe(false);
        expect(cell('rollup', true).find('input').exists()).toBe(false);
    });

    it('a value reads as a value to a screen reader, and an empty editable one as "set"', () => {
        expect(cell('text').get('.cfc__value').text()).toBe('Acme Ltd');
        expect(cell('text', true, task()).get('button').attributes('aria-label')).toBe('Customer: none, set');
    });

    it('Enter saves an edit, Esc drops it', async () => {
        const wrapper = cell('number', true);
        await wrapper.get('button').trigger('click');
        await wrapper.get('input').setValue('14');
        await wrapper.get('input').trigger('keydown', { key: 'Enter' });
        expect(wrapper.emitted('change')).toEqual([['14']]);

        await wrapper.get('button').trigger('click');
        await wrapper.get('input').setValue('99');
        await wrapper.get('input').trigger('keydown', { key: 'Escape' });
        expect(wrapper.emitted('change')).toHaveLength(1);
        expect(wrapper.find('input').exists()).toBe(false);
    });

    it('stores what the task panel stores for each type', () => {
        expect(customFieldPayload(FIELDS.dropdown, 1)).toEqual({ fieldValue: [1], _id: 'f-drop' });
        expect(customFieldPayload(FIELDS.number, '1,200')).toEqual({ fieldValue: '1200', _id: 'f-num' });
        expect(customFieldPayload(FIELDS.number, 'many')).toEqual({ invalid: true });
        expect(customFieldPayload(FIELDS.email, 'nope')).toEqual({ invalid: true });
        expect(customFieldPayload(FIELDS.checkbox, true)).toEqual({ fieldValue: true, _id: 'f-check' });
        expect(customFieldPayload(FIELDS.date, '2026-10-05').fieldValue).toBeInstanceOf(Date);
        expect(customFieldPayload(FIELDS.formula, '1')).toEqual({ invalid: true });
        expect(customFieldText(FIELDS.text, task())).toBe('');
    });
});

describe('who may edit a field from a cell', () => {
    const rightsFor = (values, opts) => fieldEditRights((path) => values[path.replace('task.', '')] ?? null, opts);

    it('follows the task panel: estimate and points on a writable task_estimated_hours, fields on task_custom_field', () => {
        expect(rightsFor({ task_list: true, task_estimated_hours: 1, task_custom_field: true }, { customFields: true }))
            .toEqual({ estimate: true, points: true, customField: true });
        expect(rightsFor({ task_list: true, task_estimated_hours: false, task_custom_field: false }, { customFields: true }))
            .toEqual({ estimate: false, points: false, customField: false });
    });

    it('nothing opens on an archived list, or when the project has no custom fields app', () => {
        const all = { task_list: true, task_estimated_hours: true, task_custom_field: true };
        expect(Object.values(rightsFor(all, { archived: true, customFields: true })).some(Boolean)).toBe(false);
        expect(rightsFor(all, { customFields: false }).customField).toBe(false);
    });
});

describe('edits from a cell go through the task API with Undo', () => {
    let api;
    const project = ref({ _id: 'p1', CompanyId: 'c1', ProjectName: 'Launch', ProjectCode: 'AH', isGlobalPermission: true });
    const tableCommits = [];
    const stored = task({ customField: { 'f-text': { _id: 'f-text', fieldValue: 'Acme' } }, points: 3 });

    beforeEach(() => {
        Object.values(ops).forEach((fn) => fn.mockClear());
        tableCommits.length = 0;
        const store = createStore({
            getters: {
                'settings/companyOwnerDetail': () => ({ userId: 'u1' }),
                'settings/companyUsers': () => [],
                'settings/finalCustomFields': () => [FIELDS.text],
                'projectData/searchedTasks': () => [],
                'projectData/tableTasks': () => ({ p1: { sprints: ['s1'], s1: { tasks: [stored] } } }),
                'users/users': () => []
            },
            mutations: {
                'projectData/mutateUpdateFirebaseTasks': () => {},
                'projectData/mutateTypesenseTableTasks': (_, payload) => tableCommits.push(payload)
            }
        });
        const Host = defineComponent({ setup() { api = useListInlineEdit(project); return () => null; } });
        mount(Host, { global: { plugins: [store], provide: { $userId: ref('u1'), $companyId: ref('c1'), searchedTask: ref(false) } } });
    });

    const lastArg = (fn) => fn.mock.calls[fn.mock.calls.length - 1][0];

    it('a custom field is saved for this company and task, shows at once in the Table, and Undo restores it', async () => {
        await api.setCustomField(stored, FIELDS.text, 'Acme Group');
        await flushPromises();
        expect(lastArg(ops.updateTaskCustomField)).toMatchObject({
            companyId: 'c1', taskId: 't1', customFieldId: 'f-text', updateDetail: { fieldValue: 'Acme Group', _id: 'f-text' }
        });
        expect(tableCommits[0].data.customField['f-text'].fieldValue).toBe('Acme Group');
        expect(undoToast.current.message).toBe(en.Toast.Custom_field_updated_successfully);
        await runUndo();
        await flushPromises();
        expect(lastArg(ops.updateTaskCustomField).updateDetail).toEqual({ _id: 'f-text', fieldValue: 'Acme' });
    });

    it('an invalid value never reaches the API', async () => {
        const saved = await api.setCustomField(stored, FIELDS.email, 'not-an-email');
        expect(saved).toBe(false);
        expect(ops.updateTaskCustomField).not.toHaveBeenCalled();
    });

    it('points and estimate use the panel\'s own calls', async () => {
        api.setPoints(stored, 5);
        await flushPromises();
        expect(lastArg(ops.updatePoints).firebaseObj).toEqual({ points: 5 });
        api.setEstimate(stored, 90, { reason: 'Scope grew' });
        await flushPromises();
        expect(lastArg(ops.updateTotalEstimatedTime)).toMatchObject({ firebaseObj: { totalEstimatedTime: 90 }, obj: { reason: 'Scope grew' } });
    });
});

describe('Table cells', () => {
    const edit = (rights = {}) => ({
        rights: ref({ status: true, assignee: false, due: false, priority: false, estimate: false, points: false, customField: false, ...rights }),
        statuses: ref([{ key: 1, name: 'Open', type: 'default_active', textColor: '#777', bgColor: '#eee' }]),
        showPriority: ref(true),
        multipleAssignees: ref(false),
        assigneeOptions: () => [],
        fields: { allTasks: ref([]), defs: ref([FIELDS.text]) },
        setStatus: vi.fn(), setCustomField: vi.fn(() => Promise.resolve(true)), setPoints: vi.fn(), setEstimate: vi.fn()
    });
    const columns = ref(resolveColumns('table', columnCatalogue('table', { fields: [FIELDS.text] }), null).filter((c) => c.visible));
    const store = createStore({ getters: { 'settings/companyPriority': () => [], 'users/users': () => [], 'settings/companyMembers': () => [], 'settings/teams': () => [], 'projectData/currentProjectDetails': () => ({}) } });
    const mountRows = (ctx, rows = [task(), task({ _id: 't2', TaskName: 'Second' })]) => mount(defineComponent({
        setup() {
            const root = ref(null);
            return () => h('div', { ref: root, role: 'table', onKeydown: (event) => handleGridKey(event, root.value) }, rows.map((row) => h(TableRow, { key: row._id, data: row })));
        }
    }), {
        attachTo: document.body,
        global: {
            plugins: [store],
            provide: { listRowEdit: ctx, tableColumns: columns, selectedProject: ref({ _id: 'p1', isGlobalPermission: true }), $dateFormat: ref('DD/MM/YYYY') },
            stubs: { ShellIcon: true, ProvenanceBadge: true, TaskTagCell: true, Sidebar: true, Assignee: true, CalenderCompo: true, PriorityComp: true }
        }
    });

    afterEach(() => { document.body.innerHTML = ''; });

    it('render one cell per header, custom field included', () => {
        const wrapper = mountRows(edit());
        const cells = wrapper.findAll('[role="row"]')[0].findAll(':scope > [role="cell"]');
        expect(cells).toHaveLength(columns.value.length + 2);
        expect(cells.at(-1).attributes('data-col')).toBe('cf:f-text');
    });

    it('a custom field edit calls the update with the typed value', async () => {
        const ctx = edit({ customField: true });
        const wrapper = mountRows(ctx);
        const fieldCell = wrapper.find('[data-col="cf:f-text"]');
        await fieldCell.get('button').trigger('click');
        await fieldCell.get('input').setValue('Globex');
        await fieldCell.get('input').trigger('keydown', { key: 'Enter' });
        expect(ctx.setCustomField).toHaveBeenCalledWith(expect.objectContaining({ _id: 't1' }), FIELDS.text, 'Globex', expect.anything());
    });

    it('without the right the value is shown and nothing opens', () => {
        const wrapper = mountRows(edit({ customField: false, status: false }));
        expect(wrapper.find('[data-col="cf:f-text"] button').exists()).toBe(false);
        expect(wrapper.find('[data-col="status"] button').exists()).toBe(false);
        expect(wrapper.find('[data-col="points"] button').attributes('disabled')).toBeDefined();
    });

    it('arrows move between cells and rows, Enter opens the editor, Esc returns to the cell', async () => {
        const wrapper = mountRows(edit({ customField: true }));
        const [first, second] = wrapper.findAll('[role="row"]');
        const name = first.get('[data-col="name"]');
        name.element.focus();
        await name.trigger('keydown', { key: 'ArrowRight' });
        expect(document.activeElement.dataset.col).toBe('status');
        await first.get('[data-col="status"]').trigger('keydown', { key: 'ArrowDown' });
        expect(document.activeElement).toBe(second.get('[data-col="status"]').element);
        await second.get('[data-col="status"]').trigger('keydown', { key: 'ArrowUp' });
        expect(document.activeElement).toBe(first.get('[data-col="status"]').element);

        const field = first.get('[data-col="cf:f-text"]');
        field.element.focus();
        await field.trigger('keydown', { key: 'Enter' });
        await nextTick();
        const input = field.get('input');
        expect(document.activeElement).toBe(input.element);
        await input.trigger('keydown', { key: 'ArrowLeft' });
        expect(document.activeElement).toBe(input.element);
        await input.trigger('keydown', { key: 'Escape' });
        await flushPromises();
        expect(field.find('input').exists()).toBe(false);
        expect(field.element.contains(document.activeElement)).toBe(true);
    });
});

describe('story points', () => {
    it('total per group counts parent rows and ignores empty points', () => {
        expect(pointsTotal([{ points: 3 }, { points: '5' }, { points: null }, { points: 8, isParentTask: false }, {}])).toBe(8);
        expect(pointsTotal([])).toBe(0);
    });

    it('estimates read the way people type them', () => {
        expect(parseEstimate('1h 30m')).toBe(90);
        expect(parseEstimate('45m')).toBe(45);
        expect(parseEstimate('1.5')).toBe(90);
        expect(parseEstimate('')).toBe(0);
        expect(parseEstimate('soon')).toBe(null);
    });
});
