/* The Table view asks the server to give a row its group index only when the row lacks one,
   and sends the three values that name the group, never the group's own query. */
import { describe, test, expect, vi, beforeEach } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';
import { createStore } from 'vuex';
import { ref } from 'vue';

const h = vi.hoisted(() => ({ apiRequest: vi.fn(), permissions: {} }));

vi.mock('@/composable', () => ({
    useCustomComposable: () => ({ checkPermission: (key) => (key in h.permissions ? h.permissions[key] : true), checkApps: () => true }),
    useGetterFunctions: () => ({ getUser: () => null })
}));
vi.mock('@/services', () => ({ apiRequest: h.apiRequest }));

import TableViewTable from '@/views/Projects/TableView/TableViewTable.vue';
import * as env from '@/config/env';

const PID = 'p1';
const SPRINT = 's1';
const MEMBER = '6f0000000000000000000003';

const GROUPS = {
    status: { key: '0_0_Doing', name: 'Doing', isExpanded: true, tasksArray: [], conditions: [{ statusKey: { $eq: 2 } }], searchKey: 'statusKey', indexName: 'groupByStatusIndex', searchCondition: ':=', searchValue: 2 },
    assignee: { key: '0_0_Assignee', name: 'Assignee', isExpanded: true, users: [], value: MEMBER, teamIds: [], tasksArray: [], conditions: [{ AssigneeUserId: { $in: [MEMBER] } }], searchKey: 'AssigneeUserId', indexName: 'groupByAssigneeIndex', searchCondition: ':', searchValue: [MEMBER] },
    unassigned: { key: '0_1_Unassigned', name: 'Unassigned', isExpanded: true, users: [], value: '', teamIds: [], tasksArray: [], conditions: [{ AssigneeUserId: { $in: [null, []] } }], searchKey: 'AssigneeUserId', indexName: 'groupByAssigneeIndex', searchCondition: ':', searchValue: '[]' },
    customField: { customFieldId: 'f1', customFieldType: 'dropdown', name: 'Blue', value: 'opt-1', isExpanded: true, tasksArray: [], conditions: [{ 'customField.f1.fieldValue': 'opt-1' }], searchKey: 'customField.f1.fieldValue', indexName: 'groupByStatusIndex', searchValue: 'opt-1' }
};

const task = (id, extra = {}) => ({
    _id: id, TaskKey: `PAR-${id}`, TaskName: id, sprintId: SPRINT, statusKey: 2, AssigneeUserId: [MEMBER],
    isParentTask: true, deletedStatusKey: 0, customField: { f1: { fieldValue: 'opt-1' } }, ...extra
});
const indexed = (id, extra = {}) => task(id, { groupByStatusIndex: 1, groupByAssigneeIndex: 1, ...extra });

const openTable = async (group, tasks) => {
    const store = createStore({
        state: { taskSelection: { selectedTaskIds: [], lastAnchorId: null, activeView: 'table' } },
        getters: {
            'projectData/tableTasks': () => ({ [PID]: { [SPRINT]: { tasks } } }),
            'projectData/searchedTasks': () => []
        },
        mutations: { 'taskSelection/setActiveView': () => {}, 'taskSelection/setActiveProject': () => {} },
        actions: { 'projectData/setTableTasksFromTypesense': () => Promise.resolve() }
    });
    const wrapper = mount(TableViewTable, {
        props: { data: group, sprintId: SPRINT },
        global: {
            plugins: [store],
            provide: { searchedTask: ref(false), showArchived: ref(false), selectedProject: ref({ _id: PID, isGlobalPermission: true }) },
            stubs: { TableRow: true, Skelaton: true }
        }
    });
    await flushPromises();
    return wrapper;
};

const repairs = () => h.apiRequest.mock.calls.filter(([, url]) => url === env.ONLOAD_UPDATE_TASK_INDEX).map(([, , body]) => body);

beforeEach(() => {
    h.apiRequest.mockReset();
    h.apiRequest.mockResolvedValue({ data: { status: true } });
    h.permissions = {};
});

describe('opening the Table view', () => {
    test('asks for nothing when every row holds its index', async () => {
        await openTable(GROUPS.status, [indexed('1'), indexed('2')]);

        expect(repairs()).toEqual([]);
    });

    test('asks once for each row without an index, naming the group in plain values', async () => {
        await openTable(GROUPS.status, [indexed('1'), task('2'), task('3', { groupByStatusIndex: null })]);

        expect(repairs()).toEqual([
            { taskUpdate: { data: '2', item: { indexName: 'groupByStatusIndex', searchKey: 'statusKey', searchValue: 2 }, taskKey: 'PAR-2' }, companyId: 'company-1' },
            { taskUpdate: { data: '3', item: { indexName: 'groupByStatusIndex', searchKey: 'statusKey', searchValue: 2 }, taskKey: 'PAR-3' }, companyId: 'company-1' }
        ]);
        expect(JSON.stringify(repairs())).not.toContain('$');
    });

    test('names a person\'s group by the person and the unassigned group as the route reads it', async () => {
        await openTable(GROUPS.assignee, [task('2')]);
        await openTable(GROUPS.unassigned, [task('3', { AssigneeUserId: [] })]);

        expect(repairs().map((body) => body.taskUpdate.item)).toEqual([
            { indexName: 'groupByAssigneeIndex', searchKey: 'AssigneeUserId', searchValue: MEMBER },
            { indexName: 'groupByAssigneeIndex', searchKey: 'AssigneeUserId', searchValue: '[]' }
        ]);
    });

    test('skips a row that is still being created', async () => {
        await openTable(GROUPS.status, [task('2', { TaskKey: '--' })]);

        expect(repairs()).toEqual([]);
    });

    test('asks for nothing under a custom field group, which the route has no index for', async () => {
        await openTable(GROUPS.customField, [task('2')]);

        expect(repairs()).toEqual([]);
    });

    test.each([[null], [undefined], [false], [0]])('asks for nothing when the viewer\'s task list permission is %s', async (permission) => {
        h.permissions = { 'task.task_list': permission };

        await openTable(GROUPS.status, [task('2')]);

        expect(repairs()).toEqual([]);
    });

    test('goes on to the next row when one is refused', async () => {
        const logged = vi.spyOn(console, 'error').mockImplementation(() => {});
        h.apiRequest.mockRejectedValueOnce(new Error('refused'));

        await openTable(GROUPS.status, [task('2'), task('3')]);

        expect(repairs().map((body) => body.taskUpdate.data)).toEqual(['2', '3']);
        logged.mockRestore();
    });
});
