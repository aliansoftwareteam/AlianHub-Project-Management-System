const { SCHEMA_TYPE } = require('../../Config/schemaType');

/* One workspace: an owner, an admin, a member on everything private, a member outside it and a guest;
 * an open project with an open list and a private list, a private project, and the insider's personal list. */

const CID = '6f00000000000000000000c1';
const OWNER = '6f0000000000000000000001';
const ADMIN = '6f0000000000000000000002';
const INSIDER = '6f0000000000000000000003';
const OUTSIDER = '6f0000000000000000000004';
const GUEST = '6f0000000000000000000005';
const P_OPEN = '6f0000000000000000000a01';
const P_PRIVATE = '6f0000000000000000000a02';
const P_PERSONAL = '6f0000000000000000000a03';
const L_OPEN = '6f0000000000000000000b01';
const L_SECRET = '6f0000000000000000000b02';
const L_PRIVATE = '6f0000000000000000000b03';
const L_PERSONAL = '6f0000000000000000000b04';
const T_OPEN = '6f0000000000000000000d01';
const T_SECRET = '6f0000000000000000000d02';
const T_PRIVATE = '6f0000000000000000000d03';
const T_PERSONAL = '6f0000000000000000000d04';

const PEOPLE = [[OWNER, 1, 'Olive Owner'], [ADMIN, 2, 'Adam Admin'], [INSIDER, 3, 'Ian Insider'], [OUTSIDER, 3, 'Mia Member'], [GUEST, 0, 'Gus Guest']];
const STATUSES = [
    { key: 1, name: 'To Do', type: 'default_active' },
    { key: 2, name: 'In Progress', type: 'active' },
    { key: 3, name: 'Done', type: 'close' },
];
const TASK_KEYS = ['task_list', 'task_status', 'task_priority', 'task_assignee', 'task_due_date', 'task_start_date', 'task_name_edit', 'task_custom_field', 'task_delete', 'task_archive', 'task_move', 'task_tag', 'task_comment'];

/* What each person can open, by the rule the task routes read by. */
const OPENS = {
    [OWNER]: [T_OPEN, T_SECRET, T_PRIVATE],
    [ADMIN]: [T_OPEN, T_SECRET, T_PRIVATE],
    [INSIDER]: [T_OPEN, T_SECRET, T_PRIVATE, T_PERSONAL],
    [OUTSIDER]: [T_OPEN],
    [GUEST]: [T_OPEN],
};

const settle = async () => { for (let i = 0; i < 30; i += 1) await new Promise((resolve) => setImmediate(resolve)); };

const create = (mockDb) => {
    const rows = (type) => mockDb.store[type] || [];
    const task = (id) => rows(SCHEMA_TYPE.TASKS).find((row) => String(row._id) === String(id));

    /* Sets what members and guests hold on a task key in the company rules. */
    const setRule = (key, permission) => {
        rows(SCHEMA_TYPE.RULES).filter((rule) => rule.key === key).forEach((rule) => { rule.roles = [{ key: 3, permission }, { key: 0, permission }]; });
    };

    const seed = () => {
        Object.keys(mockDb.store).forEach((type) => { mockDb.store[type].length = 0; });
        mockDb.store.companies = [{ _id: CID }];
        PEOPLE.forEach(([userId, roleType, Employee_Name]) => {
            mockDb.seed(SCHEMA_TYPE.COMPANY_USERS, { userId, roleType, status: 2, isDelete: false });
            mockDb.seed(SCHEMA_TYPE.USERS, { _id: userId, Employee_Name });
        });
        const parent = mockDb.seed(SCHEMA_TYPE.RULES, { key: 'task', name: 'Task', isParent: true, roles: [] });
        TASK_KEYS.forEach((key) => mockDb.seed(SCHEMA_TYPE.RULES, { key, name: key, isParent: false, parentId: String(parent._id), roles: [{ key: 3, permission: true }, { key: 0, permission: true }] }));

        const project = (_id, ProjectName, extra = {}) => mockDb.seed(SCHEMA_TYPE.PROJECTS, {
            _id, ProjectName, ProjectCode: ProjectName.slice(0, 3).toUpperCase(), CompanyId: CID, isPrivateSpace: false, isGlobalPermission: true, AssigneeUserId: [], deletedStatusKey: 0,
            taskStatusData: STATUSES, taskTypeCounts: [{ key: 1, value: 'task', name: 'Task' }], ...extra,
        });
        project(P_OPEN, 'Open');
        project(P_PRIVATE, 'Private', { isPrivateSpace: true, AssigneeUserId: [INSIDER] });
        project(P_PERSONAL, 'Personal', { isPrivateSpace: true, isPersonal: true, personalOwner: INSIDER, AssigneeUserId: [INSIDER] });

        const list = (_id, name, projectId, extra = {}) => mockDb.seed(SCHEMA_TYPE.SPRINTS, { _id, name, projectId, deletedStatusKey: 0, ...extra });
        list(L_OPEN, 'Open list', P_OPEN);
        list(L_SECRET, 'Private list', P_OPEN, { private: true, AssigneeUserId: [INSIDER] });
        list(L_PRIVATE, 'List of the private project', P_PRIVATE);
        list(L_PERSONAL, 'Personal list', P_PERSONAL);

        const seedTask = (_id, TaskName, ProjectID, sprintId, extra = {}) => mockDb.seed(SCHEMA_TYPE.TASKS, {
            _id, TaskName, TaskKey: `${TaskName.slice(0, 3).toUpperCase()}-1`, ProjectID, sprintId, CompanyId: CID, statusKey: 1, statusType: 'default_active', status: { text: 'To Do', key: 1 },
            TaskType: 'task', TaskTypeKey: 1, isParentTask: true, AssigneeUserId: [INSIDER], watchers: [], deletedStatusKey: 0, customField: {}, ...extra,
        });
        seedTask(T_OPEN, 'Open task', P_OPEN, L_OPEN);
        seedTask(T_SECRET, 'Secret task', P_OPEN, L_SECRET);
        seedTask(T_PRIVATE, 'Private task', P_PRIVATE, L_PRIVATE);
        seedTask(T_PERSONAL, 'Personal task', P_PERSONAL, L_PERSONAL);
        return { seedTask, project, list };
    };

    return { seed, rows, task, setRule };
};

module.exports = {
    CID, OWNER, ADMIN, INSIDER, OUTSIDER, GUEST, P_OPEN, P_PRIVATE, P_PERSONAL, L_OPEN, L_SECRET, L_PRIVATE, L_PERSONAL,
    T_OPEN, T_SECRET, T_PRIVATE, T_PERSONAL, STATUSES, OPENS, settle, create,
};
