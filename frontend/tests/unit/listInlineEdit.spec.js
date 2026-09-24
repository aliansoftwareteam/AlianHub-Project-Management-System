/* Task 038 — List rows edit status, assignee, due date and priority in place, gated by the
   same rights as the task panel, and every change offers Undo. */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { config, flushPromises, mount } from '@vue/test-utils';
import { createI18n } from 'vue-i18n';
import { createStore } from 'vuex';
import { defineComponent, h, ref } from 'vue';
import en from '@/locales/en';

const { ops } = vi.hoisted(() => ({
    ops: {
        updateStatus: vi.fn(() => Promise.resolve()),
        updateAssignee: vi.fn(() => Promise.resolve()),
        updatePriority: vi.fn(() => Promise.resolve()),
        updateDueDate: vi.fn(() => Promise.resolve()),
        updateTaskName: vi.fn(() => Promise.resolve())
    }
}));
vi.mock('@/utils/TaskOperations', () => ({ default: ops }));

import {
    rowEditRights, priorityAppOn, statusOptions, nextAssignees, assigneeInverse, dueChange, dueSnapshot, dueRestore
} from '@/views/Projects/ListView/listRowEdit';
import ListStatusCircle from '@/views/Projects/ListView/ListStatusCircle.vue';
import ListAssigneeCell from '@/views/Projects/ListView/ListAssigneeCell.vue';
import ListDueCell from '@/views/Projects/ListView/ListDueCell.vue';
import ListPriorityCell from '@/views/Projects/ListView/ListPriorityCell.vue';
import ListRow from '@/views/Projects/ListView/ListRow.vue';
import { useListInlineEdit } from '@/views/Projects/ListView/useListInlineEdit';
import { undoToast, runUndo, dismissUndoToast } from '@/composable/useUndoToast';

const i18n = createI18n({ legacy: false, locale: 'en', messages: { en }, missingWarn: false, fallbackWarn: false });
config.global.plugins = [i18n];

const OPEN = { key: 1, name: 'Open', type: 'default_active', value: 'open', bgColor: '#eee', textColor: '#777' };
const PROGRESS = { key: 3, name: 'In Progress', type: 'active', value: 'in_progress', bgColor: '#6473e835', textColor: '#6473e8' };
const REVIEW = { key: 4, name: 'In Review', type: 'active', value: 'in_review', bgColor: '#9759c035', textColor: '#9759c0' };
const DONE = { key: 2, name: 'Complete', type: 'close', value: 'complete', bgColor: '#e2f7e2', textColor: '#2a2' };
const STATUSES = [OPEN, PROGRESS, REVIEW, DONE];

const PRIORITIES = [
    { name: 'High', value: 'HIGH', statusImage: 'taskPriorities/high.png' },
    { name: 'Medium', value: 'MEDIUM', statusImage: 'taskPriorities/medium.png' },
    { name: 'Low', value: 'LOW', statusImage: 'taskPriorities/low.png' }
];

const USERS = [
    { _id: 'u1', Employee_Name: 'Olivia Owner', Employee_profileImageURL: '' },
    { _id: 'u2', Employee_Name: 'Max Member', Employee_profileImageURL: '' }
];

const task = (over = {}) => ({
    _id: 't1', TaskName: 'Ship the list edits', TaskKey: 'AH-7', ProjectID: 'p1', sprintId: 's1', isParentTask: true,
    statusKey: 3, statusType: 'active', AssigneeUserId: [], Task_Priority: '', DueDate: '', dueDateDeadLine: [],
    ...over
});

const baseStore = () => createStore({
    getters: {
        'settings/companyPriority': () => PRIORITIES,
        'settings/companyMembers': () => [],
        'settings/companyUsers': () => USERS.map((u) => ({ userId: u._id, isDelete: false })),
        'users/users': () => USERS,
        'settings/teams': () => [],
        'settings/companyOwnerDetail': () => ({ userId: 'u1' }),
        'projectData/currentProjectDetails': () => ({ taskStatusData: STATUSES }),
        'projectData/searchedTasks': () => [],
        'projectData/tasks': () => ({})
    },
    mutations: {
        'projectData/mutateUpdateFirebaseTasks': () => {},
        'projectData/mutateSearchTask': () => {}
    }
});

const provide = {
    $defaultUserAvatar: ref(''),
    $defaultGhostCustomUserImg: ref(''),
    $defaultTaskStatusImg: ref(''),
    $userId: ref('u1'),
    $dateFormat: ref('DD/MM/YYYY')
};

const SidebarStub = defineComponent({
    name: 'SidebarStub',
    props: { visible: Boolean, options: Array, grouped: Boolean, title: String },
    emits: ['selected', 'update:visible'],
    setup(props, { emit }) {
        return () => (props.visible
            ? h('div', { class: 'picker-stub', role: 'dialog', 'aria-label': props.title }, (props.options || []).flatMap((group) => [
                h('div', { class: 'picker-group' }, group.label),
                ...group.options.map((option) => h('button', { class: 'picker-option', onClick: () => { emit('selected', option); emit('update:visible', false); } }, option.label))
            ]))
            : null);
    }
});

const pickerStub = (name) => defineComponent({
    name,
    emits: ['selected', 'removed', 'select', 'update:modelValue'],
    setup(_, { slots, emit, expose }) {
        const open = vi.fn();
        expose({ open, emit });
        return () => h('div', { class: `stub-${name}` }, slots.trigger ? slots.trigger({ open, value: '' }) : []);
    }
});

afterEach(() => dismissUndoToast());

describe('who may edit from a row', () => {
    const rightsFor = (values, opts) => rowEditRights((path) => values[path.replace('task.', '')] ?? null, opts);
    const ALL = { task_list: true, task_status: true, task_assignee: true, task_due_date: true, task_priority: true, task_name_edit: true, sub_task_create: true };

    it('an owner or admin (every rule true) gets every picker and action', () => {
        expect(rightsFor(ALL)).toEqual({ status: true, assignee: true, due: true, priority: true, rename: true, subtask: true });
    });

    it('read access (false) shows values but opens nothing, the same as the task panel', () => {
        const read = Object.fromEntries(Object.keys(ALL).map((key) => [key, false]));
        expect(Object.values(rightsFor(read)).some(Boolean)).toBe(false);
    });

    it('each property follows its own rule', () => {
        expect(rightsFor({ ...ALL, task_status: false })).toMatchObject({ status: false, assignee: true, due: true });
        expect(rightsFor({ ...ALL, task_due_date: null })).toMatchObject({ due: false, status: true });
    });

    it('without task list access nothing is editable', () => {
        expect(Object.values(rightsFor({ ...ALL, task_list: false })).some(Boolean)).toBe(false);
    });

    it('archived rows are read only', () => {
        expect(Object.values(rightsFor(ALL, { archived: true })).some(Boolean)).toBe(false);
    });

    it('priority only exists when the project has the app and the plan includes it', () => {
        expect(priorityAppOn({ apps: [{ key: 'Priority' }] }, { projectProjectApp: true })).toBe(true);
        expect(priorityAppOn({ apps: ['Priority'] }, { projectProjectApp: true })).toBe(true);
        expect(priorityAppOn({ apps: [{ key: 'tags' }] }, { projectProjectApp: true })).toBe(false);
        expect(priorityAppOn({ apps: [{ key: 'Priority' }] }, {})).toBe(false);
        expect(priorityAppOn({}, { projectProjectApp: true })).toBe(false);
    });
});

describe('the status picker is grouped by kind', () => {
    it('lists To do, Active and Done in that order, each status once, keyed by its status key', () => {
        const groups = statusOptions(STATUSES, (id) => id);
        expect(groups.map((g) => g.label)).toEqual(['todo', 'active', 'done']);
        expect(groups[1].options.map((o) => o.label)).toEqual(['In Progress', 'In Review']);
        expect(groups[0].options[0]).toMatchObject({ value: 1, label: 'Open', key: 1 });
    });

    it('drops a kind the project does not use', () => {
        expect(statusOptions([OPEN, DONE], (id) => id).map((g) => g.label)).toEqual(['todo', 'done']);
    });
});

describe('assignee changes and their inverse', () => {
    it('add, remove and replace give the list the server will hold', () => {
        expect(nextAssignees(['u1'], 'add', 'u2')).toEqual(['u1', 'u2']);
        expect(nextAssignees(['u1', 'u2'], 'remove', 'u1')).toEqual(['u2']);
        expect(nextAssignees(['u1'], 'replace', 'u2')).toEqual(['u2']);
        expect(nextAssignees(['u1'], 'add', 'u1')).toEqual(['u1']);
    });

    it('undo of add removes, undo of remove adds back', () => {
        expect(assigneeInverse('add', 'u2', ['u1'])).toEqual({ type: 'remove', uid: 'u2' });
        expect(assigneeInverse('remove', 'u1', ['u1'])).toEqual({ type: 'add', uid: 'u1' });
    });

    it('undo of replace puts the previous person back, or clears when there was nobody', () => {
        expect(assigneeInverse('replace', 'u2', ['u1'])).toEqual({ type: 'replace', uid: 'u1' });
        expect(assigneeInverse('replace', 'u2', [])).toEqual({ type: 'remove', uid: 'u2' });
    });
});

describe('due date changes keep the deadline history and undo restores it exactly', () => {
    const PREV = '2026-09-15T00:00:00.000Z';
    const NEXT = new Date('2026-10-01T00:00:00.000Z');

    it('a new date is appended to the deadline list', () => {
        const change = dueChange(task({ DueDate: PREV, dueDateDeadLine: [{ date: PREV }] }), NEXT);
        expect(change.DueDate).toEqual(NEXT);
        expect(change.dueDateDeadLine.map((d) => d.date.toISOString())).toEqual([PREV, NEXT.toISOString()]);
    });

    it('undo puts back the old date and list, including no date at all', () => {
        const withDate = dueRestore(dueSnapshot(task({ DueDate: PREV, dueDateDeadLine: [{ date: PREV }] })));
        expect(withDate.DueDate.toISOString()).toBe(PREV);
        expect(withDate.dueDateDeadLine.map((d) => d.date.toISOString())).toEqual([PREV]);
        expect(dueRestore(dueSnapshot(task()))).toEqual({ DueDate: null, dueDateDeadLine: [] });
    });
});

describe('the status circle', () => {
    const mountCircle = (props) => mount(ListStatusCircle, {
        props: { task: task(), statuses: STATUSES, editable: true, ...props },
        global: { plugins: [baseStore()], provide, stubs: { Sidebar: SidebarStub } }
    });

    it('is a button named for its value and its action', () => {
        const button = mountCircle().find('button.lv2__status');
        expect(button.exists()).toBe(true);
        expect(button.attributes('aria-label')).toBe('Status: In Progress, change');
        expect(button.attributes('aria-haspopup')).toBe('dialog');
    });

    it('takes two clicks: open the grouped picker, pick a status', async () => {
        const wrapper = mountCircle();
        await wrapper.find('button.lv2__status').trigger('click');
        expect(wrapper.findAll('.picker-group').map((g) => g.text())).toEqual(['To do', 'Active', 'Done']);
        const review = wrapper.findAll('.picker-option').find((b) => b.text() === 'In Review');
        await review.trigger('click');
        expect(wrapper.emitted('change')[0][0]).toMatchObject({ key: 4, name: 'In Review' });
        expect(wrapper.find('.picker-stub').exists()).toBe(false);
    });

    it('picking the current status changes nothing', async () => {
        const wrapper = mountCircle();
        await wrapper.find('button.lv2__status').trigger('click');
        await wrapper.findAll('.picker-option').find((b) => b.text() === 'In Progress').trigger('click');
        expect(wrapper.emitted('change')).toBeUndefined();
    });

    it('a click on the circle never reaches the row, which would open the task', async () => {
        const onRow = vi.fn();
        const Host = defineComponent({ setup: () => () => h('div', { onClick: onRow }, [h(ListStatusCircle, { task: task(), statuses: STATUSES, editable: true })]) });
        const wrapper = mount(Host, { global: { plugins: [baseStore()], provide, stubs: { Sidebar: SidebarStub } } });
        await wrapper.find('button.lv2__status').trigger('click');
        expect(onRow).not.toHaveBeenCalled();
    });

    it('without the right it shows the status and offers no picker', () => {
        const wrapper = mountCircle({ editable: false });
        expect(wrapper.find('button').exists()).toBe(false);
        expect(wrapper.find('.lv2__status').attributes('aria-label')).toBe('Status: In Progress');
        expect(wrapper.findComponent(SidebarStub).exists()).toBe(false);
    });

    it('a closed task reads as done', () => {
        expect(mountCircle({ task: task({ statusKey: 2, statusType: 'close' }) }).find('.lv2__status').classes()).toContain('is-done');
    });
});

describe('the assignee cell', () => {
    const Assignee = pickerStub('Assignee');
    const mountCell = (props) => mount(ListAssigneeCell, {
        props: { task: task(), editable: true, options: ['u1', 'u2'], multiple: false, ...props },
        global: { plugins: [baseStore()], provide, stubs: { Assignee } }
    });

    it('with nobody assigned, the button says so and offers to set one', () => {
        const button = mountCell().find('button.lv2__cell-btn');
        expect(button.attributes('aria-label')).toBe('Assignee: none, set');
        expect(button.find('.lv2__cell-empty').exists()).toBe(true);
    });

    it('with someone assigned, it names them', async () => {
        const wrapper = mount(ListAssigneeCell, {
            props: { task: task({ AssigneeUserId: ['u2'] }), editable: true, options: ['u1', 'u2'] },
            global: { plugins: [baseStore()], provide, stubs: { Assignee }, mocks: {} }
        });
        expect(wrapper.find('button.lv2__cell-btn').attributes('aria-label')).toMatch(/^Assignee: .+, change$/);
    });

    it('a pick in single-assignee mode replaces, a pick in multi mode adds, a selected person is removed', async () => {
        const single = mountCell();
        single.findComponent(Assignee).vm.$emit('selected', { id: 'u2' });
        expect(single.emitted('change')[0][0]).toEqual({ type: 'replace', uid: 'u2' });

        const multi = mountCell({ multiple: true });
        multi.findComponent(Assignee).vm.$emit('selected', { id: 'u2' });
        multi.findComponent(Assignee).vm.$emit('removed', { id: 'u1' });
        expect(multi.emitted('change')).toEqual([[{ type: 'add', uid: 'u2' }], [{ type: 'remove', uid: 'u1' }]]);
    });

    it('without the right there is no button and no picker', () => {
        const wrapper = mountCell({ editable: false });
        expect(wrapper.find('button').exists()).toBe(false);
        expect(wrapper.findComponent(Assignee).exists()).toBe(false);
        expect(wrapper.find('.lv2__c-assignee-value, [aria-label="Assignee: none"]').exists()).toBe(true);
    });
});

describe('the due date cell', () => {
    const CalenderCompo = pickerStub('CalenderCompo');
    const mountCell = (props) => mount(ListDueCell, {
        props: { task: task(), editable: true, ...props },
        global: { plugins: [baseStore()], provide, stubs: { CalenderCompo } }
    });

    it('empty: a button named "Due date: none, set" with the empty icon', () => {
        const button = mountCell().find('button.lv2__cell-btn');
        expect(button.attributes('aria-label')).toBe('Due date: none, set');
        expect(button.find('.lv2__cell-empty').exists()).toBe(true);
    });

    it('set: the button shows the date and says it can be changed', () => {
        const due = new Date(Date.now() + 10 * 86400000);
        const button = mountCell({ task: task({ DueDate: due.toISOString() }) }).find('button.lv2__cell-btn');
        expect(button.attributes('aria-label')).toMatch(/^Due date: .+, change$/);
        expect(button.text().length).toBeGreaterThan(0);
    });

    it('a picked date is passed up', () => {
        const wrapper = mountCell();
        const picked = new Date('2026-10-02T00:00:00.000Z');
        wrapper.findComponent(CalenderCompo).vm.$emit('update:modelValue', picked);
        expect(wrapper.emitted('change')[0][0]).toEqual(picked);
    });

    it('without the right the date is text only', () => {
        const wrapper = mountCell({ editable: false, task: task({ DueDate: new Date().toISOString() }) });
        expect(wrapper.find('button').exists()).toBe(false);
        expect(wrapper.findComponent(CalenderCompo).exists()).toBe(false);
    });
});

describe('the priority cell', () => {
    const PriorityComp = pickerStub('PriorityComp');
    const mountCell = (props) => mount(ListPriorityCell, {
        props: { task: task({ Task_Priority: 'HIGH' }), editable: true, ...props },
        global: { plugins: [baseStore()], provide, stubs: { PriorityComp } }
    });

    it('shows the company word for the priority and names the action', () => {
        const button = mountCell().find('button.lv2__cell-btn');
        expect(button.attributes('aria-label')).toBe('Priority: High, change');
        expect(button.find('.ah-chip').text()).toBe('High');
    });

    it('empty: "Priority: none, set"', () => {
        expect(mountCell({ task: task() }).find('button.lv2__cell-btn').attributes('aria-label')).toBe('Priority: none, set');
    });

    it('a pick is passed up', () => {
        const wrapper = mountCell();
        wrapper.findComponent(PriorityComp).vm.$emit('select', PRIORITIES[2]);
        expect(wrapper.emitted('change')[0][0]).toMatchObject({ value: 'LOW' });
    });

    it('without the right the chip is shown and nothing opens', () => {
        const wrapper = mountCell({ editable: false });
        expect(wrapper.find('button').exists()).toBe(false);
        expect(wrapper.find('.ah-chip').text()).toBe('High');
    });
});

describe('the row wires the cells to the shared edit context', () => {
    const edit = (over = {}) => ({
        rights: ref({ status: true, assignee: true, due: true, priority: true, rename: true, subtask: true }),
        showPriority: ref(true),
        statuses: ref(STATUSES),
        multipleAssignees: ref(false),
        assigneeOptions: () => ['u1', 'u2'],
        setStatus: vi.fn(), setAssignee: vi.fn(), setDue: vi.fn(), setPriority: vi.fn(), rename: vi.fn(),
        copyLink: vi.fn(), taskHref: () => 'http://x/#/t1',
        ...over
    });
    const stubs = { ShellIcon: true, ProvenanceBadge: true, Sidebar: SidebarStub, Assignee: pickerStub('Assignee'), CalenderCompo: pickerStub('CalenderCompo'), PriorityComp: pickerStub('PriorityComp') };
    const renderRow = (ctx, data = task({ Task_Priority: 'HIGH' }), props = {}) => mount(ListRow, {
        props: { data, canSelect: true, ...props },
        global: { plugins: [baseStore()], provide: { ...provide, listRowEdit: ctx }, stubs }
    });

    it('a parent row has a status circle, and the selection checkbox is still its own control', () => {
        const wrapper = renderRow(edit());
        expect(wrapper.find('.lv2__c-select input[type="checkbox"]').exists()).toBe(true);
        expect(wrapper.find('.lv2__c-title button.lv2__status').exists()).toBe(true);
        expect(wrapper.find('.lv2__c-select .lv2__status').exists()).toBe(false);
    });

    it('still announces eight cells', () => {
        expect(renderRow(edit()).findAll('[role="row"] > [role="cell"]')).toHaveLength(8);
    });

    it('a status pick goes through the shared update with the row task', async () => {
        const ctx = edit();
        const wrapper = renderRow(ctx);
        await wrapper.find('button.lv2__status').trigger('click');
        await wrapper.findAll('.picker-option').find((b) => b.text() === 'In Review').trigger('click');
        expect(ctx.setStatus).toHaveBeenCalledWith(expect.objectContaining({ _id: 't1' }), expect.objectContaining({ key: 4 }), expect.anything());
    });

    it('with no rights, the row has no pickers and no edit actions', () => {
        const ctx = edit({ rights: ref({ status: false, assignee: false, due: false, priority: false, rename: false, subtask: false }) });
        const wrapper = renderRow(ctx);
        expect(wrapper.find('button.lv2__status').exists()).toBe(false);
        expect(wrapper.findAll('button.lv2__cell-btn')).toHaveLength(0);
        expect(wrapper.find('[data-action="rename"]').exists()).toBe(false);
        expect(wrapper.find('[data-action="subtask"]').exists()).toBe(false);
        expect(wrapper.find('[data-action="copy-link"]').exists()).toBe(true);
    });

    it('with priority off the priority cell is empty, value or not', () => {
        const wrapper = renderRow(edit({ showPriority: ref(false) }));
        expect(wrapper.find('.lv2__c-prio').text()).toBe('');
        expect(wrapper.find('.lv2__c-prio button').exists()).toBe(false);
    });

    it('row actions: rename, add subtask, copy link, open in a new tab and the row menu', () => {
        const wrapper = renderRow(edit());
        const actions = wrapper.findAll('.lv2__actions [data-action]').map((b) => b.attributes('data-action'));
        expect(actions).toEqual(['rename', 'subtask', 'copy-link', 'new-tab', 'menu']);
        expect(wrapper.find('[data-action="new-tab"]').attributes('href')).toBe('http://x/#/t1');
        expect(wrapper.find('[data-action="new-tab"]').attributes('target')).toBe('_blank');
        wrapper.findAll('.lv2__actions [data-action]').forEach((b) => expect(b.attributes('aria-label')).toBeTruthy());
    });

    it('rename edits in place: Enter saves through the shared update, Escape cancels', async () => {
        const ctx = edit();
        const wrapper = renderRow(ctx);
        await wrapper.find('[data-action="rename"]').trigger('click');
        const input = wrapper.find('input.lv2__rename');
        expect(input.exists()).toBe(true);
        await input.setValue('Ship the inline edits');
        await input.trigger('keydown', { key: 'Enter' });
        expect(ctx.rename).toHaveBeenCalledWith(expect.objectContaining({ _id: 't1' }), 'Ship the inline edits', expect.anything());

        await wrapper.find('[data-action="rename"]').trigger('click');
        await wrapper.find('input.lv2__rename').trigger('keydown', { key: 'Escape' });
        expect(wrapper.find('input.lv2__rename').exists()).toBe(false);
        expect(ctx.rename).toHaveBeenCalledTimes(1);
    });

    it('add subtask asks the group for a subtask row under this task', async () => {
        const wrapper = renderRow(edit());
        await wrapper.find('[data-action="subtask"]').trigger('click');
        expect(wrapper.emitted('add-subtask')).toHaveLength(1);
    });

    it('the row menu offers the same actions as the hover buttons', async () => {
        const wrapper = renderRow(edit());
        await wrapper.find('[data-action="menu"]').trigger('click');
        const items = wrapper.findAll('[role="menu"] [role="menuitem"]').map((i) => i.attributes('data-item'));
        expect(items).toEqual(expect.arrayContaining(['rename', 'subtask', 'copy-link', 'new-tab']));
    });

    it('subtask rows keep their done checkbox and gain no pickers', () => {
        const wrapper = renderRow(edit(), task({ isParentTask: false, _id: 's1' }), { isSub: true, canSetStatus: true });
        expect(wrapper.find('button.lv2__status').exists()).toBe(false);
        expect(wrapper.findAll('button.lv2__cell-btn')).toHaveLength(0);
    });
});

describe('every inline change offers Undo through the same update path', () => {
    let api;
    const project = ref({ _id: 'p1', CompanyId: 'c1', ProjectName: 'Launch', ProjectCode: 'AH', lastTaskId: 7, taskStatusData: STATUSES, isGlobalPermission: true });

    beforeEach(() => {
        Object.values(ops).forEach((fn) => fn.mockClear());
        const Host = defineComponent({ setup() { api = useListInlineEdit(project); return () => null; } });
        mount(Host, { global: { plugins: [baseStore()], provide: { ...provide, searchedTask: ref(false) } } });
    });

    const lastArg = (fn) => fn.mock.calls[fn.mock.calls.length - 1][0];

    it('status: the change, then Undo sends the previous status back', async () => {
        api.setStatus(task(), REVIEW);
        await flushPromises();
        expect(lastArg(ops.updateStatus).newStatus.statusKey).toBe(4);
        expect(undoToast.current.message).toBe(en.Toast.Status_updated_successfully);
        await runUndo();
        await flushPromises();
        expect(ops.updateStatus).toHaveBeenCalledTimes(2);
        expect(lastArg(ops.updateStatus).newStatus).toMatchObject({ statusKey: 3, statusType: 'active' });
        expect(undoToast.current).toBe(null);
    });

    it('assignee: replace, then Undo replaces with the previous person', async () => {
        api.setAssignee(task({ AssigneeUserId: ['u1'] }), { type: 'replace', uid: 'u2' });
        await flushPromises();
        expect(lastArg(ops.updateAssignee)).toMatchObject({ type: 'replace', firebaseObj: { AssigneeUserId: 'u2' } });
        await runUndo();
        await flushPromises();
        expect(lastArg(ops.updateAssignee)).toMatchObject({ type: 'replace', firebaseObj: { AssigneeUserId: 'u1' } });
    });

    it('assignee: the row task is not mutated by the update', async () => {
        const row = task({ AssigneeUserId: ['u1'] });
        api.setAssignee(row, { type: 'add', uid: 'u2' });
        await flushPromises();
        expect(row.AssigneeUserId).toEqual(['u1']);
    });

    it('due date: Undo restores the date that was there before', async () => {
        const PREV = '2026-09-15T00:00:00.000Z';
        api.setDue(task({ DueDate: PREV, dueDateDeadLine: [{ date: PREV }] }), new Date('2026-10-01T00:00:00.000Z'));
        await flushPromises();
        await runUndo();
        await flushPromises();
        const restored = lastArg(ops.updateDueDate).firebaseObj;
        expect(restored.DueDate.toISOString()).toBe(PREV);
        expect(restored.dueDateDeadLine).toHaveLength(1);
    });

    it('priority: Undo restores the previous value, and an unset priority can be restored to unset', async () => {
        api.setPriority(task({ Task_Priority: 'HIGH' }), PRIORITIES[2]);
        await flushPromises();
        expect(lastArg(ops.updatePriority).firebaseObj).toEqual({ Task_Priority: 'LOW' });
        await runUndo();
        await flushPromises();
        expect(lastArg(ops.updatePriority).firebaseObj).toEqual({ Task_Priority: 'HIGH' });

        api.setPriority(task(), PRIORITIES[0]);
        await flushPromises();
        expect(undoToast.current).not.toBe(null);
        await runUndo();
        await flushPromises();
        expect(lastArg(ops.updatePriority).firebaseObj).toEqual({ Task_Priority: '' });
    });

    it('rename: Undo puts the old name back', async () => {
        api.rename(task(), 'Ship the inline edits');
        await flushPromises();
        expect(lastArg(ops.updateTaskName).firebaseObj).toEqual({ TaskName: 'Ship the inline edits' });
        await runUndo();
        await flushPromises();
        expect(lastArg(ops.updateTaskName).firebaseObj).toEqual({ TaskName: 'Ship the list edits' });
    });

    it('an undone change does not offer another Undo', async () => {
        api.setStatus(task(), REVIEW);
        await flushPromises();
        await runUndo();
        await flushPromises();
        expect(undoToast.current).toBe(null);
    });

    it('a failed update offers no Undo', async () => {
        ops.updateStatus.mockImplementationOnce(() => Promise.reject(new Error('nope')));
        api.setStatus(task(), REVIEW);
        await flushPromises();
        expect(undoToast.current).toBe(null);
    });
});
