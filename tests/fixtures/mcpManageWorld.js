const { SCHEMA_TYPE } = require('../../Config/schemaType');
const guardFixture = require('./taskWriteGuard');

/* One workspace for the MCP task and doc management tests: an owner, an admin, two members and an outsider;
 * an open project with a private list, a private project, a second open project, another member's personal
 * list and a conversation space. */

const { CID, OWNER, MEMBER, LOCKED_PROJECT, LOCKED_TASK } = guardFixture;
const ADMIN = '6f0000000000000000000002';
const OTHER = '6f0000000000000000000004';
const OUTSIDER = '6f0000000000000000000009';
const TOKEN = '6f0000000000000000000101';
const P_OPEN = '6f0000000000000000000d01';
const P_PRIVATE = '6f0000000000000000000d02';
const P_DEST = '6f0000000000000000000d03';
const PL_OTHER = '6f0000000000000000000d04';
const CHAT = '6f0000000000000000000d09';
const S_OPEN = '6f0000000000000000000e01';
const S_NEXT = '6f0000000000000000000e02';
const S_SECRET = '6f0000000000000000000e03';
const S_DEST = '6f0000000000000000000e04';
const S_PRIVATE = '6f0000000000000000000e05';
const F = { rating: '6f0000000000000000000f01', bugOnly: '6f0000000000000000000f02', elsewhere: '6f0000000000000000000f03', number: '6f0000000000000000000f04', choice: '6f0000000000000000000f05', off: '6f0000000000000000000f06' };
const TASKS_GRANT = 'tasks:manage';
const DOCS_GRANT = 'docs:manage';
const ISSUER = 'https://hub.manage.test';
const CLIENT = 'https://agent.manage.test/oauth/client.json';
const GRANT_ID = '0123456789abcdef0123456789abcdef';
const PLAIN_SCOPES = ['tasks:read', 'tasks:write', 'projects:read', 'docs:read'];

const BEFORE = ['tasks.next', 'tasks.search', 'task.get', 'task.comment', 'task.status.set', 'task.link', 'task.create', 'subtask.create', 'timelog.start', 'timelog.stop', 'docs.read'];

const STATUSES = [
    { key: 1, name: 'To Do', type: 'default_active', bgColor: '#fff' },
    { key: 2, name: 'In Progress', type: 'active', bgColor: '#fff' },
    { key: 3, name: 'Done', type: 'close', bgColor: '#fff' },
];
const TYPES = [{ key: 1, name: 'Task', value: 'task' }, { key: 2, name: 'Bug', value: 'bug' }];

const settle = async () => { for (let i = 0; i < 30; i += 1) await new Promise((resolve) => setImmediate(resolve)); };

const ctx = (uid, over = {}) => ({
    companyId: CID, userId: uid, ip: '1.1.1.1', projectIds: [], canWrite: true,
    actor: { kind: 'agent', userId: uid, agentName: 'Claude', viaAccount: 'personal', tokenId: TOKEN },
    token: { _id: TOKEN, userId: uid, scopes: ['read', 'write'], grants: [TASKS_GRANT], active: true },
    ...over,
});
const withGrants = (uid, grants) => ctx(uid, { token: { _id: TOKEN, userId: uid, scopes: ['read', 'write'], grants, active: true } });
const olderToken = (uid) => ctx(uid, { token: { _id: TOKEN, userId: uid, scopes: ['read', 'write'], active: true } });
const readOnly = (uid) => ctx(uid, { canWrite: false, token: { _id: TOKEN, userId: uid, scopes: ['read'], grants: [TASKS_GRANT, DOCS_GRANT], active: true } });
const oauth = (uid) => ctx(uid, { token: { oauth: true, scopes: [...PLAIN_SCOPES] }, oauth: { clientId: 'c1', grantId: 'g1' } });

/* An outside client's call as the server builds it from a verified grant: `scopes` is what the person consented
 * to that the workspace's approval still allows. */
const outside = (uid, scopes) => ctx(uid, {
    canWrite: scopes.some((scope) => scope.endsWith(':write')),
    actor: { kind: 'agent', userId: uid, agentName: 'Outside agent', viaAccount: 'external', tokenId: null, clientId: CLIENT, grantId: GRANT_ID, delegatedBy: uid },
    token: { oauth: true, scopes: [...scopes] },
    oauth: { clientId: CLIENT, grantId: GRANT_ID, scopes: [...scopes] },
    taint: { tainted: true, taintSources: [{ kind: 'client', ref: CLIENT, at: new Date() }] },
});

const create = (mockDb) => {
    const rules = guardFixture.create(mockDb);
    const rows = (type) => mockDb.store[type] || [];
    const stored = (id) => rows(SCHEMA_TYPE.TASKS).find((task) => String(task._id) === String(id));
    const audits = (action, state = null) => rows(SCHEMA_TYPE.AUDIT_LOGS).filter((row) => row.meta && row.meta.action === action && (!state || row.meta.state === state));
    const snapshot = () => JSON.stringify([rows(SCHEMA_TYPE.TASKS), rows(SCHEMA_TYPE.PAGES), rows(SCHEMA_TYPE.COMMENTS)]);

    /* A tool call the way a client makes it: one JSON-RPC message through the server's own dispatch. */
    const rpcThrough = (server) => async (caller, name, args) => {
        const reply = await server.handleRpc(caller, { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } });
        await settle();
        if (reply.error) return { rpcError: reply.error };
        return { ...JSON.parse(reply.result.content[0].text), ...(reply.result.isError ? { isError: true } : {}) };
    };
    const listedThrough = (server) => async (caller) => (await server.handleRpc(caller, { jsonrpc: '2.0', id: 1, method: 'tools/list' })).result.tools.map((tool) => tool.name);

    /* The shared rules cover the task write keys; the reads and the doc tools here need two more. */
    const grantToMembers = (section, key) => {
        const parents = rows(SCHEMA_TYPE.RULES);
        const parent = parents.find((rule) => rule.isParent && rule.key === section) || mockDb.seed(SCHEMA_TYPE.RULES, { key: section, name: section, isParent: true, roles: [] });
        mockDb.seed(SCHEMA_TYPE.RULES, { key, name: key, isParent: false, parentId: String(parent._id), roles: [{ key: 3, permission: true }] });
    };

    const seed = () => {
        rules.reset();
        grantToMembers('task', 'task_activity_log');
        grantToMembers('project', 'project_details');
        delete process.env.MCP_TOOLS_V2;
        process.env.MCP_TOOLS_MANAGE = 'on';
        [[ADMIN, 2], [OTHER, 3]].forEach(([userId, roleType]) => mockDb.seed(SCHEMA_TYPE.COMPANY_USERS, { userId, roleType, status: 2, isDelete: false, userEmail: `${userId}@example.com` }));
        [[OWNER, 'Olivia Owner'], [ADMIN, 'Adam Admin'], [MEMBER, 'Mia Member'], [OTHER, 'Priya Other'], [OUTSIDER, 'Otto Outsider']]
            .forEach(([_id, Employee_Name]) => mockDb.seed(SCHEMA_TYPE.USERS, { _id, Employee_Name, Employee_Email: `${_id}@example.com`, Time_Zone: 'UTC' }));

        const project = (_id, ProjectName, extra = {}) => mockDb.seed(SCHEMA_TYPE.PROJECTS, {
            _id, ProjectName, ProjectCode: ProjectName.slice(0, 3).toUpperCase(), CompanyId: CID, isPrivateSpace: false, AssigneeUserId: [],
            taskStatusData: STATUSES.map((status) => ({ ...status })), taskTypeCounts: TYPES.map((type) => ({ ...type })), deletedStatusKey: 0, lastTaskId: 10, ...extra,
        });
        project(P_OPEN, 'Open');
        project(P_PRIVATE, 'Private', { isPrivateSpace: true, AssigneeUserId: [OTHER] });
        project(P_DEST, 'Destination', { taskStatusData: [{ key: 7, name: 'Backlog', type: 'default_active' }, { key: 8, name: 'in progress', type: 'active' }], taskTypeCounts: [{ key: 5, name: 'Task', value: 'task' }] });
        project(PL_OTHER, 'Personal', { isPrivateSpace: true, isPersonal: true, personalOwner: OTHER, AssigneeUserId: [OTHER] });
        mockDb.seed(SCHEMA_TYPE.MAIN_CHATS, { _id: CHAT, default: true });

        const sprint = (_id, projectId, name, extra = {}) => mockDb.seed(SCHEMA_TYPE.SPRINTS, { _id, projectId, name, AssigneeUserId: [], tasks: 0, deletedStatusKey: 0, ...extra });
        sprint(S_SECRET, P_OPEN, 'Secret', { private: true, AssigneeUserId: [OTHER], createdAt: new Date('2026-01-01T00:00:00Z') });
        sprint(S_OPEN, P_OPEN, 'Sprint 1', { createdAt: new Date('2026-02-01T00:00:00Z') });
        sprint(S_NEXT, P_OPEN, 'Sprint 2', { createdAt: new Date('2026-03-01T00:00:00Z') });
        sprint(S_DEST, P_DEST, 'Inbox');
        sprint(S_PRIVATE, P_PRIVATE, 'Private list');

        const task = (TaskKey, ProjectID, sprintId, extra = {}) => mockDb.seed(SCHEMA_TYPE.TASKS, {
            TaskKey, TaskName: `Task ${TaskKey}`, CompanyId: CID, ProjectID, sprintId, sprintArray: { id: sprintId, name: 'Sprint 1' }, AssigneeUserId: [], watchers: [],
            isParentTask: true, ParentTaskId: '', ancestors: [], subTasks: 0, deletedStatusKey: 0, TaskType: 'task', TaskTypeKey: 1,
            status: { key: 2, text: 'In Progress', type: 'active' }, statusType: 'active', statusKey: 2, Task_Priority: 'MEDIUM', rawDescription: 'before', ...extra,
        });
        const top = task('OPN-1', P_OPEN, S_OPEN, { subTasks: 1, AssigneeUserId: [MEMBER], DueDate: new Date('2026-10-10T00:00:00Z'), createdAt: new Date('2026-09-01T00:00:00Z') });
        const child = task('OPN-2', P_OPEN, S_OPEN, { isParentTask: false, ParentTaskId: top._id, ancestors: [top._id], subTasks: 1, createdAt: new Date('2026-09-02T00:00:00Z') });
        const grandchild = task('OPN-3', P_OPEN, S_OPEN, { isParentTask: false, ParentTaskId: child._id, ancestors: [top._id, child._id], createdAt: new Date('2026-09-03T00:00:00Z') });
        const fx = {
            top, child, grandchild,
            bug: task('OPN-4', P_OPEN, S_OPEN, { TaskType: 'bug', TaskTypeKey: 2, AssigneeUserId: [OTHER], DueDate: new Date('2026-11-20T00:00:00Z') }),
            secret: task('OPN-9', P_OPEN, S_SECRET),
            private: task('PRV-1', P_PRIVATE, S_PRIVATE, { AssigneeUserId: [OTHER] }),
            personal: task('PER-1', PL_OTHER, undefined, { AssigneeUserId: [OTHER] }),
            chat: task('CHAT-1', CHAT, undefined, { mainChat: true, AssigneeUserId: [OTHER, OUTSIDER] }),
        };

        const field = (_id, fieldType, extra = {}) => mockDb.seed(SCHEMA_TYPE.CUSTOM_FIELDS, { _id, fieldTitle: fieldType, fieldType, type: 'task', global: true, isDelete: true, ...extra });
        field(F.rating, 'rating', { fieldTitle: 'Confidence', fieldRatingMax: 5 });
        field(F.bugOnly, 'text', { fieldTitle: 'Steps', fieldTaskTypes: [2] });
        field(F.elsewhere, 'text', { fieldTitle: 'Elsewhere', global: false, projectId: [P_DEST] });
        field(F.number, 'number', { fieldTitle: 'Budget' });
        field(F.choice, 'dropdown', { fieldTitle: 'Area', fieldOptions: [{ id: 'a1', label: 'Web' }, { id: 'a2', label: 'API' }] });
        field(F.off, 'text', { fieldTitle: 'Retired', isDelete: false });
        return fx;
    };

    /* The grant and the workspace approval behind an outside client's call, as consent and an owner's approval leave them. */
    const seedGrant = (userId, scopes, over = {}) => {
        mockDb.seed(SCHEMA_TYPE.OAUTH_CLIENT_APPROVALS, {
            companyId: CID, clientId: CLIENT, clientName: 'Outside agent', clientKind: 'metadata_document', status: 'approved', scopes: [...scopes], privateSprints: false,
        });
        return mockDb.seed(SCHEMA_TYPE.OAUTH_GRANTS, {
            grantId: GRANT_ID, clientId: CLIENT, companyId: CID, userId, scopes: [...scopes], resource: `${ISSUER}/mcp`,
            createdAt: new Date(), expiresAt: new Date(Date.now() + 86400000), revokedAt: null, ...over,
        });
    };

    return { rules, seed, stored, rows, audits, snapshot, rpcThrough, listedThrough, seedGrant };
};

module.exports = {
    CID, OWNER, ADMIN, MEMBER, OTHER, OUTSIDER, TOKEN, LOCKED_PROJECT, LOCKED_TASK,
    P_OPEN, P_PRIVATE, P_DEST, PL_OTHER, CHAT, S_OPEN, S_NEXT, S_SECRET, S_DEST, S_PRIVATE, F, TASKS_GRANT, DOCS_GRANT,
    ISSUER, CLIENT, GRANT_ID, PLAIN_SCOPES,
    BEFORE, STATUSES, TYPES, settle, ctx, withGrants, olderToken, readOnly, oauth, outside, create,
};
