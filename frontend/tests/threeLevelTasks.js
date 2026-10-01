/* One sprint with a task, two subtasks and two sub-subtasks, plus a task with none: the rows
   the three-level specs of the Board, Table and Calendar put on the fake server. */
import { vi } from 'vitest';

export const PID = 'p1';
export const SPRINT = 's1';
export const PEOPLE = ['u1', 'u2', 'u3'];

const TODO = { key: 1, name: 'To Do', type: 'default_active', value: 'todo', textColor: '#777', bgColor: '#eee' };
const DONE = { key: 2, name: 'Done', type: 'close', value: 'done', textColor: '#2a2', bgColor: '#e2f7e2' };

export const PROJECT = {
    _id: PID, CompanyId: 'c1', ProjectName: 'QA Sandbox', ProjectCode: 'QA', isGlobalPermission: true, isPrivateSpace: false,
    lastTaskId: 9, AssigneeUserId: PEOPLE, taskStatusData: [TODO, DONE], apps: [{ key: 'tags' }], tagsArray: [], viewColumn: [],
    sprintsObj: { [SPRINT]: { id: SPRINT, name: 'List', private: false } }, sprintsfolders: {}
};

export const TODO_GROUP = {
    key: '0_0_To Do', name: 'To Do', isExpanded: true, sprintId: SPRINT, tasksArray: [], conditions: [{ statusKey: { $eq: 1 } }],
    searchKey: 'statusKey', indexName: 'groupByStatusIndex', searchCondition: ':=', searchValue: 1
};

export const row = (id, name, over = {}) => ({
    _id: id, TaskName: name, TaskKey: `QA-${id}`, ProjectID: PID, CompanyId: 'c1', sprintId: SPRINT, sprintArray: { id: SPRINT, name: 'List' },
    isParentTask: true, ParentTaskId: '', ancestors: [], statusKey: 1, statusType: 'default_active', groupByStatusIndex: 1,
    AssigneeUserId: [], tagsArray: [], deletedStatusKey: 0, subTasks: 0, ...over
});

export const under = (parentRow, id, name, over = {}) => row(id, name, {
    isParentTask: false, ParentTaskId: parentRow._id, ancestors: [...parentRow.ancestors, parentRow._id], ...over
});

export function threeLevels() {
    const parent = row('t1', 'Parent', { subTasks: 2 });
    const first = under(parent, 's1', 'Child one', { subTasks: 2, AssigneeUserId: ['u2'] });
    const second = under(parent, 's2', 'Child two', { groupByStatusIndex: 2 });
    return [
        parent, first, second,
        under(first, 'g1', 'Grandchild one'),
        under(first, 'g2', 'Grandchild two', { groupByStatusIndex: 2, statusKey: 2, statusType: 'close' }),
        row('t2', 'Loner', { groupByStatusIndex: 2 })
    ];
}

export function seedStore(Store) {
    Store.state.settings.companies = [{ _id: 'c1', planFeature: { listView: true, boardView: true, tagProjectApp: true } }];
    Store.state.settings.selectedCompanyId = 'c1';
    Store.state.settings.companyUserDetail = { userId: 'u1', roleType: 1 };
    Store.state.settings.rules = { task: {} };
    Store.state.settings.companyUsers = PEOPLE.map((userId) => ({ _id: `cu-${userId}`, userId, isDelete: false }));
    Store.state.settings.socketInstance = { id: 'sock', emit: vi.fn(), on: vi.fn(), off: vi.fn() };
    Store.state.users.users = PEOPLE.map((id) => ({ _id: id, Employee_Name: `Person ${id}` }));
    Store.state.projectData.tasks = {};
    Store.state.projectData.tableTasks = {};
    Store.state.projectData.searchedTasks = [];
    Store.state.projectData.getPaginatedTaskPayload = [];
    Store.state.projectData.getTableTaskPayload = [];
    Store.state.taskSelection.selectedTaskIds = [];
}

export const fromSocket = (Store, op, data, updatedFields = {}) => {
    Store.commit('projectData/mutateUpdateFirebaseTasks', { snap: {}, op, pid: PID, sprintId: SPRINT, data: { ...data }, updatedFields });
    Store.commit('projectData/mutateTypesenseTableTasks', { snap: {}, op, pid: PID, sprintId: SPRINT, data: { ...data } });
};

export const readGroup = (Store) => Store.dispatch('projectData/getPaginatedTasks', {
    pid: PID, sprintId: SPRINT, item: TODO_GROUP, fetchNew: true, firstPageOnly: true, userId: 'u1', showAllTasks: true
});

export const readTable = (Store) => Store.dispatch('projectData/setTableTasksFromTypesense', {
    pid: PID, sprintId: SPRINT, item: { ...TODO_GROUP }, fetchNew: true, resetTable: null, sortKey: '', isFirst: false, userId: 'u1', showAllTasks: true
});
