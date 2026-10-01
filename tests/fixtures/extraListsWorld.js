/* One workspace for the extra-list tests: people in every role, two private projects that share
 * one member, and a list of every kind a task could be pointed at. Each company gets a database
 * of its own, as in the app, so an id from another company is simply not there. */
const { EventEmitter } = require('events');
const fakeMongo = require('./fakeMongo');
const { SCHEMA_TYPE } = require('../../Config/schemaType');

const id = (kind, n) => `6f${'0'.repeat(19)}${kind}${n.toString(16).padStart(2, '0')}`;

const COMPANY = id('c', 1);
const OTHER_COMPANY = id('c', 2);
const GLOBAL = SCHEMA_TYPE.GOLBAL;

const LISTER_ROLE = 5;
const PEOPLE = {
    OWNER: { id: id('1', 1), role: 1, name: 'Olive Owner' },
    ADMIN: { id: id('1', 2), role: 2, name: 'Adam Admin' },
    ON_BOTH: { id: id('1', 3), role: 3, name: 'Bo Both' },
    HOME_ONLY: { id: id('1', 4), role: 3, name: 'Hana Home' },
    LIST_ONLY: { id: id('1', 5), role: 3, name: 'Lior List' },
    GUEST: { id: id('1', 6), role: 0, name: 'Gus Guest' },
    OUTSIDER: { id: id('1', 7), role: 3, name: 'Otto Outside' },
    LISTER: { id: id('1', 8), role: LISTER_ROLE, name: 'Lia Lister' },
};
const NO_SEAT = id('1', 9);
const uidOf = Object.fromEntries(Object.entries(PEOPLE).map(([key, person]) => [key, person.id]));

const P = {
    HOME: id('a', 1), ELSEWHERE: id('a', 2), OWN_RULES: id('a', 3), CLOSED: id('a', 4), GONE: id('a', 5),
    PERSONAL_MINE: id('a', 6), PERSONAL_THEIRS: id('a', 7), CHAT_SPACE: id('a', 8), OPEN: id('a', 9),
};
const L = {
    HOME: id('e', 1), HOME_SECOND: id('e', 2), HOME_PRIVATE: id('e', 3),
    THERE: id('e', 4), THERE_PRIVATE: id('e', 5), SCRUM: id('e', 6), BACKLOG: id('e', 7), ARCHIVED: id('e', 8), DELETED: id('e', 9),
    OWN_RULES: id('e', 10), CLOSED: id('e', 11), GONE: id('e', 12), PERSONAL_MINE: id('e', 13), PERSONAL_THEIRS: id('e', 14),
    CHANNEL: id('e', 15), OPEN: id('e', 16), MISSING: id('e', 255),
};
const T = {
    TASK: id('b', 1), SUBTASK: id('b', 2), IN_PRIVATE_SPRINT: id('b', 3), IN_MY_PERSONAL: id('b', 4), IN_THEIR_PERSONAL: id('b', 5),
    CHAT_ROW: id('b', 6), ARCHIVED: id('b', 7), DELETED: id('b', 8), IN_CLOSED: id('b', 9), SECOND: id('b', 10), MISSING: id('b', 255),
};
const FOREIGN = { LIST: id('d', 1), TASK: id('d', 2), PROJECT: id('d', 3) };

const taskRow = (_id, projectId, sprintId, extra = {}) => ({
    _id, TaskName: `Task ${_id.slice(-2)}`, TaskKey: `K-${_id.slice(-2)}`, TaskType: 'task', TaskTypeKey: 1, ProjectID: projectId, CompanyId: COMPANY,
    status: { key: 1, text: 'To Do', type: 'default_active' }, statusType: 'default_active', statusKey: 1, isParentTask: true, ParentTaskId: '',
    Task_Leader: uidOf.OWNER, Task_Priority: 'MEDIUM', deletedStatusKey: 0, sprintId, sprintArray: { id: sprintId, name: 'List' },
    AssigneeUserId: [], watchers: [], updatedAt: new Date('2026-10-01T00:00:00.000Z'), ...extra,
});

const create = () => {
    const dbs = new Map();
    const dbFor = (companyId) => {
        const key = String(companyId);
        if (!dbs.has(key)) dbs.set(key, fakeMongo.create());
        return dbs.get(key);
    };
    const crud = (companyId, query, method) => dbFor(companyId).crud(companyId, query, method);
    const db = () => dbFor(COMPANY);

    const seedRules = (type, permissions, extra = {}) => {
        const sections = {};
        Object.entries(permissions).forEach(([path, roles]) => {
            const [section, key] = path.split('.');
            sections[section] = sections[section] || db().seed(type, { key: section, name: section, isParent: true, roles: [], ...extra });
            db().seed(type, { key, name: key, isParent: false, parentId: String(sections[section]._id), roles: Object.entries(roles).map(([role, permission]) => ({ key: Number(role), permission })), ...extra });
        });
    };

    const project = (_id, extra = {}) => db().seed(SCHEMA_TYPE.PROJECTS, { _id, ProjectName: `Project ${_id.slice(-2)}`, isPrivateSpace: false, AssigneeUserId: [], deletedStatusKey: 0, statusType: 'active', isGlobalPermission: true, ...extra });
    const list = (_id, projectId, extra = {}) => db().seed(SCHEMA_TYPE.SPRINTS, { _id, projectId, name: `List ${_id.slice(-2)}`, private: false, AssigneeUserId: [], deletedStatusKey: 0, tasks: 0, ...extra });
    const task = (_id, projectId, sprintId, extra = {}) => db().seed(SCHEMA_TYPE.TASKS, taskRow(_id, projectId, sprintId, extra));

    const reset = () => {
        dbs.clear();
        delete process.env.PERMISSION_ENFORCEMENT_MODE;
        delete process.env.DISABLE_PERMISSION_ENFORCEMENT;
        dbFor(GLOBAL).seed('companies', { _id: COMPANY });
        Object.values(PEOPLE).forEach((person) => {
            dbFor(GLOBAL).seed(SCHEMA_TYPE.USERS, { _id: person.id, Employee_Name: person.name });
            db().seed(SCHEMA_TYPE.COMPANY_USERS, { userId: person.id, roleType: person.role, status: 2, isDelete: false });
        });
        seedRules(SCHEMA_TYPE.RULES, {
            'task.task_move': { 3: true, 0: null, [LISTER_ROLE]: true },
            'task.task_list': { 3: true, 0: true, [LISTER_ROLE]: true },
            'task.task_status': { 3: true, 0: true, [LISTER_ROLE]: true },
            'task.task_priority': { 3: true, 0: true, [LISTER_ROLE]: true },
            'project.private_projects': { 3: null, 0: null, [LISTER_ROLE]: 2 },
        });
        seedRules(SCHEMA_TYPE.PROJECT_RULES, { 'task.task_move': { 3: null, 0: null }, 'task.task_list': { 3: true, 0: true } }, { projectId: P.OWN_RULES });

        project(P.HOME, { isPrivateSpace: true, AssigneeUserId: [uidOf.ON_BOTH, uidOf.HOME_ONLY, uidOf.GUEST] });
        project(P.ELSEWHERE, { isPrivateSpace: true, AssigneeUserId: [uidOf.ON_BOTH, uidOf.LIST_ONLY, uidOf.GUEST] });
        project(P.OWN_RULES, { isGlobalPermission: false });
        project(P.CLOSED, { statusType: 'close' });
        project(P.GONE, { deletedStatusKey: 1 });
        project(P.PERSONAL_MINE, { isPrivateSpace: true, isPersonal: true, personalOwner: uidOf.ON_BOTH, AssigneeUserId: [uidOf.ON_BOTH] });
        project(P.PERSONAL_THEIRS, { isPrivateSpace: true, isPersonal: true, personalOwner: uidOf.HOME_ONLY, AssigneeUserId: [uidOf.HOME_ONLY] });
        project(P.OPEN);
        db().seed(SCHEMA_TYPE.MAIN_CHATS, { _id: P.CHAT_SPACE, default: false });

        list(L.HOME, P.HOME, { name: 'Sprint board', tasks: 3 });
        list(L.HOME_SECOND, P.HOME, { name: 'Design queue' });
        list(L.HOME_PRIVATE, P.HOME, { name: 'Salary review', private: true, AssigneeUserId: [uidOf.HOME_ONLY] });
        list(L.THERE, P.ELSEWHERE, { name: 'Launch plan' });
        list(L.THERE_PRIVATE, P.ELSEWHERE, { name: 'Board papers', private: true, AssigneeUserId: [uidOf.LIST_ONLY] });
        list(L.SCRUM, P.ELSEWHERE, { isScrum: true });
        list(L.BACKLOG, P.ELSEWHERE, { isBacklog: true });
        list(L.ARCHIVED, P.ELSEWHERE, { deletedStatusKey: 2 });
        list(L.DELETED, P.ELSEWHERE, { deletedStatusKey: 1 });
        list(L.OWN_RULES, P.OWN_RULES);
        list(L.CLOSED, P.CLOSED);
        list(L.GONE, P.GONE);
        list(L.PERSONAL_MINE, P.PERSONAL_MINE);
        list(L.PERSONAL_THEIRS, P.PERSONAL_THEIRS);
        list(L.CHANNEL, P.CHAT_SPACE);
        list(L.OPEN, P.OPEN, { name: 'Open list' });

        task(T.TASK, P.HOME, L.HOME, { TaskName: 'Write the brief' });
        task(T.SECOND, P.HOME, L.HOME, { TaskName: 'Review the brief' });
        task(T.SUBTASK, P.HOME, L.HOME, { isParentTask: false, ParentTaskId: T.TASK, ancestors: [T.TASK] });
        task(T.IN_PRIVATE_SPRINT, P.HOME, L.HOME_PRIVATE);
        task(T.IN_MY_PERSONAL, P.PERSONAL_MINE, L.PERSONAL_MINE);
        task(T.IN_THEIR_PERSONAL, P.PERSONAL_THEIRS, L.PERSONAL_THEIRS);
        task(T.CHAT_ROW, P.CHAT_SPACE, L.CHANNEL, { mainChat: true, AssigneeUserId: [uidOf.ON_BOTH, uidOf.HOME_ONLY] });
        task(T.ARCHIVED, P.HOME, L.HOME, { deletedStatusKey: 2 });
        task(T.DELETED, P.HOME, L.HOME, { deletedStatusKey: 1 });
        task(T.IN_CLOSED, P.CLOSED, L.CLOSED);

        const other = dbFor(OTHER_COMPANY);
        other.seed(SCHEMA_TYPE.PROJECTS, { _id: FOREIGN.PROJECT, ProjectName: 'Theirs', isPrivateSpace: false, deletedStatusKey: 0 });
        other.seed(SCHEMA_TYPE.SPRINTS, { _id: FOREIGN.LIST, projectId: FOREIGN.PROJECT, name: 'Their list', deletedStatusKey: 0 });
        other.seed(SCHEMA_TYPE.TASKS, taskRow(FOREIGN.TASK, FOREIGN.PROJECT, FOREIGN.LIST, { CompanyId: OTHER_COMPANY }));
    };

    const rows = (type) => db().store[type] || [];
    const stored = (taskId) => rows(SCHEMA_TYPE.TASKS).find((row) => String(row._id) === taskId);
    const listsOf = (taskId) => (stored(taskId).extraLists || []).map((entry) => String(entry.sprintId));
    /* Puts a task in lists as a stored row holds them, without going through the routes. */
    const place = (taskId, entries) => {
        stored(taskId).extraLists = entries.map(([projectId, sprintId]) => ({ projectId, sprintId, addedBy: uidOf.OWNER, addedAt: new Date('2026-09-30T00:00:00.000Z') }));
    };
    const setRule = (key, role, permission, projectId = null) => {
        const type = projectId ? SCHEMA_TYPE.PROJECT_RULES : SCHEMA_TYPE.RULES;
        const rule = rows(type).find((row) => row.key === key && (!projectId || row.projectId === projectId));
        rule.roles = [...rule.roles.filter((entry) => entry.key !== role), { key: role, permission }];
    };

    return { dbFor, crud, db, reset, rows, stored, listsOf, place, setRule, project, list, task };
};

const settle = async () => { for (let i = 0; i < 30; i += 1) await new Promise((resolve) => setImmediate(resolve)); };

/* Runs a registered route as Express would, every guard in front of the handler included. */
const routeCaller = (routes) => (route, uid, { body, params = {}, company = COMPANY, apiToken } = {}) => new Promise((resolve) => {
    const [method, routePath] = route.split(' ');
    const timer = setTimeout(() => resolve({ code: 'no answer' }), 2000);
    const res = new EventEmitter();
    res.statusCode = 200;
    res.status = (code) => { res.statusCode = code; return res; };
    res.send = (answer) => { clearTimeout(timer); resolve({ code: res.statusCode, body: answer }); res.emit('finish'); return res; };
    res.json = res.send;
    const req = {
        uid, method, baseUrl: '', route: { path: routePath }, path: routePath, originalUrl: routePath, url: routePath, query: {}, params,
        headers: { companyid: company }, aud: COMPANY, body: body === undefined ? undefined : JSON.parse(JSON.stringify(body)), ...(apiToken ? { apiToken } : {}),
    };
    const handlers = routes[route];
    const run = (at) => (at < handlers.length ? handlers[at](req, res, () => run(at + 1)) : undefined);
    Promise.resolve(run(0)).catch((error) => { clearTimeout(timer); resolve({ code: 'threw', error }); });
}).then(async (result) => { await settle(); return result; });

const routesOf = (modulePath) => {
    const table = {};
    const register = (method) => (routePath, ...handlers) => { table[`${method} ${routePath}`] = handlers; };
    const app = { get: register('GET'), post: register('POST'), put: register('PUT'), patch: register('PATCH'), delete: register('DELETE'), use: register('USE') };
    require(modulePath).init(app);
    return table;
};

module.exports = { COMPANY, OTHER_COMPANY, GLOBAL, LISTER_ROLE, PEOPLE, NO_SEAT, uidOf, P, L, T, FOREIGN, taskRow, create, settle, routeCaller, routesOf };
