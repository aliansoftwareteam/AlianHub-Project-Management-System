const { EventEmitter } = require('events');
const { SCHEMA_TYPE } = require('../../Config/schemaType');

const CID = '6f00000000000000000000c1';
const OTHER_COMPANY = '6f00000000000000000000c2';
const OWNER = '6f0000000000000000000001';
const MEMBER = '6f0000000000000000000003';
const OPEN_PROJECT = '6f0000000000000000000a01';
const LOCKED_PROJECT = '6f0000000000000000000a02';
const PARITY_PROJECT = '6f0000000000000000000a03';
const OPEN_TASK = '6f0000000000000000000b01';
const OPEN_TASK_2 = '6f0000000000000000000b02';
const LOCKED_TASK = '6f0000000000000000000b03';
const LOCKED_TASK_2 = '6f0000000000000000000b04';
const PARITY_TASK = '6f0000000000000000000b05';
const PARITY_TASK_2 = '6f0000000000000000000b06';
const MISSING_TASK = '6f0000000000000000000bff';

const ENV_KEYS = ['PERMISSION_ENFORCEMENT_MODE', 'DISABLE_PERMISSION_ENFORCEMENT', 'PERMISSION_ENFORCEMENT_CACHE_TTL_SECONDS'];

const TASK_KEYS = ['task_create', 'task_status', 'task_priority', 'task_assignee', 'task_due_date', 'task_start_date', 'task_type', 'task_description',
    'task_estimated_hours', 'task_name_edit', 'task_tag', 'task_checklist', 'task_checklist_assign_remove', 'task_attachments', 'task_custom_field',
    'task_comment', 'queue_list', 'task_delete', 'task_archive', 'task_convert_to_subtask', 'sub_task_create', 'convert_to_task',
    'task_convert_to_list', 'task_move', 'task_merge', 'task_duplicate', 'task_list'];
const PROJECT_PATHS = [...TASK_KEYS.map((k) => `task.${k}`), 'project.project_sprint_create'];
// Project rules are seeded from the project and task sections only, so they never hold a chat key.
const COMPANY_PATHS = [...PROJECT_PATHS, 'chat.one_to_one_chat'];

const ids = {
    [OPEN_PROJECT]: { taskId: OPEN_TASK, otherTaskId: OPEN_TASK_2, projectId: OPEN_PROJECT },
    [LOCKED_PROJECT]: { taskId: LOCKED_TASK, otherTaskId: LOCKED_TASK_2, projectId: LOCKED_PROJECT },
    [PARITY_PROJECT]: { taskId: PARITY_TASK, otherTaskId: PARITY_TASK_2, projectId: PARITY_PROJECT },
};

const settle = async () => { for (let i = 0; i < 20; i += 1) await new Promise((resolve) => setImmediate(resolve)); };

const response = () => {
    const res = new EventEmitter();
    res.statusCode = 200;
    res.status = (code) => { res.statusCode = code; return res; };
    res.json = (body) => { res.body = body; res.emit('finish'); return res; };
    return res;
};

const run = async (middleware, req) => {
    const res = response();
    let passed = false;
    await middleware(req, res, () => { passed = true; });
    if (passed) res.emit('finish');
    await settle();
    return { passed, code: res.statusCode, body: res.body };
};

const session = (uid, body, route = '/api/v2/tasks', method = 'PATCH') => ({
    uid, method, baseUrl: '', route: { path: route }, originalUrl: route, url: route, query: {}, headers: { companyid: CID }, body,
});
const token = (uid, body, route, method) => ({ ...session(uid, body, route, method), apiToken: { _id: 't' } });

const setMode = (mode) => { process.env.PERMISSION_ENFORCEMENT_MODE = mode; };

/* Owner and member seats, three projects with two tasks each: the company rules grant everything, the locked project's own rules let the member only see tasks, the parity project's grant everything. */
const create = (mockDb) => {
    const seedRules = (type, paths, grant, extra = {}) => {
        const parents = {};
        [...new Set(paths.map((path) => path.split('.')[0]))].forEach((key) => { parents[key] = mockDb.seed(type, { key, name: key, isParent: true, roles: [], ...extra }); });
        paths.forEach((path) => {
            const [parent, key] = path.split('.');
            mockDb.seed(type, { key, name: key, isParent: false, parentId: String(parents[parent]._id), roles: [{ key: 3, permission: grant(path) }], ...extra });
        });
    };

    const reset = () => {
        Object.keys(mockDb.store).forEach((k) => { mockDb.store[k].length = 0; });
        mockDb.calls.length = 0;
        ENV_KEYS.forEach((k) => { delete process.env[k]; });
        mockDb.store.companies = [{ _id: CID }];
        mockDb.seed(SCHEMA_TYPE.COMPANY_USERS, { userId: OWNER, roleType: 1, status: 2, isDelete: false });
        mockDb.seed(SCHEMA_TYPE.COMPANY_USERS, { userId: MEMBER, roleType: 3, status: 2, isDelete: false });
        mockDb.seed(SCHEMA_TYPE.PROJECTS, { _id: OPEN_PROJECT, isGlobalPermission: true });
        mockDb.seed(SCHEMA_TYPE.PROJECTS, { _id: LOCKED_PROJECT, isGlobalPermission: false });
        mockDb.seed(SCHEMA_TYPE.PROJECTS, { _id: PARITY_PROJECT, isGlobalPermission: false });
        [[OPEN_TASK, OPEN_PROJECT], [OPEN_TASK_2, OPEN_PROJECT], [LOCKED_TASK, LOCKED_PROJECT], [LOCKED_TASK_2, LOCKED_PROJECT], [PARITY_TASK, PARITY_PROJECT], [PARITY_TASK_2, PARITY_PROJECT]]
            .forEach(([_id, ProjectID]) => mockDb.seed(SCHEMA_TYPE.TASKS, { _id, ProjectID }));
        seedRules(SCHEMA_TYPE.RULES, COMPANY_PATHS, () => true);
        seedRules(SCHEMA_TYPE.PROJECT_RULES, PROJECT_PATHS, (path) => (path === 'task.task_list' ? false : null), { projectId: LOCKED_PROJECT });
        seedRules(SCHEMA_TYPE.PROJECT_RULES, PROJECT_PATHS, () => true, { projectId: PARITY_PROJECT });
    };

    /* Sets the member's permission on `key` in a project's own rules, or in the company rules when projectId is null. */
    const setRule = (projectId, key, permission) => {
        const rows = projectId
            ? mockDb.store[SCHEMA_TYPE.PROJECT_RULES].filter((rule) => rule.projectId === projectId && rule.key === key)
            : mockDb.store[SCHEMA_TYPE.RULES].filter((rule) => rule.key === key);
        if (!rows.length) throw new Error(`no rule ${key} in ${projectId || 'company'}`);
        rows.forEach((rule) => { rule.roles = [{ key: 3, permission }]; });
    };

    return {
        reset,
        setRule,
        decisions: () => mockDb.store.permission_decisions || [],
        audits: () => (mockDb.store.audit_logs || []).filter((row) => row.action === 'permission.refused'),
        permissionReads: () => mockDb.calls.map((call) => call.type).filter((type) => type !== 'companies'),
    };
};

module.exports = {
    CID, OTHER_COMPANY, OWNER, MEMBER, OPEN_PROJECT, LOCKED_PROJECT, PARITY_PROJECT, OPEN_TASK, OPEN_TASK_2, LOCKED_TASK, LOCKED_TASK_2,
    PARITY_TASK, PARITY_TASK_2, MISSING_TASK, ENV_KEYS, ids, settle, response, run, session, token, setMode, create,
};
