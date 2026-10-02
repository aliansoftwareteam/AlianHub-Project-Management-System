const verified = require('./fixtures/verifiedRequest');
const mockDb = require('./fixtures/fakeMongo').create();
const mockOpen = { tasks: new Set(), projects: new Set() };

jest.mock('../utils/mongo-handler/mongoQueries', () => ({ MongoDbCrudOpration: (...args) => mockDb.crud(...args) }));
jest.mock('../Config/config', () => ({ myCache: { get: () => undefined, set: () => {}, del: () => {}, keys: () => [], getTtl: () => 0 } }));
jest.mock('../Config/loggerConfig', () => ({ info: jest.fn(), error: jest.fn(), warn: jest.fn() }));
jest.mock('../Modules/Tasks/helpers/taskWritePlacement', () => ({
    readableTaskIds: jest.fn(async (companyId, uid, ids) => ids.map(String).filter((id) => mockOpen.tasks.has(id))),
}));
jest.mock('../Modules/Agents/scope', () => ({
    visibleProjects: jest.fn(async () => [...mockOpen.projects].map((id) => ({ _id: id, ProjectName: `Project ${id.slice(-2)}` }))),
}));

const { SCHEMA_TYPE } = require('../Config/schemaType');
const ctrl = require('../Modules/Audit/controller');
const { readableTaskIds } = require('../Modules/Tasks/helpers/taskWritePlacement');
const { EVENTS, ACTIONS } = require('../Modules/Audit/eventWords');
const registry = require('../Modules/Agents/registry');

const CID = '6f00000000000000000000c1';
const OWNER = '6f0000000000000000000001';
const MEMBER = '6f0000000000000000000002';
const SEAT = '6f0000000000000000000f02';
const TASK = '6f0000000000000000000a01';
const HIDDEN_TASK = '6f0000000000000000000a02';
const PROJECT = '6f0000000000000000000b01';
const HIDDEN_PROJECT = '6f0000000000000000000b02';
const LIST = '6f0000000000000000000d01';
const HIDDEN_LIST = '6f0000000000000000000d02';
const AGENT = '6f0000000000000000000e01';

let at = 0;
const row = (over = {}) => {
    at += 1;
    return { action: 'agent.action_refused', actorId: AGENT, actorName: 'Planner', entityType: 'task', entityId: TASK, createdAt: new Date(Date.UTC(2026, 9, 2, 10, 0, at)), meta: { actorType: 'agent', action: 'task.comment', reason: 'not_visible: the task is not one the person behind this agent can open' }, ...over };
};

const list = async (query = {}) => {
    const res = { code: 200 };
    res.status = (c) => { res.code = c; return res; };
    res.json = (b) => { res.body = b; return res; };
    res.send = (b) => { res.body = b; return res; };
    await ctrl.listAuditLogs(verified({ uid: OWNER, headers: { companyid: CID }, query, body: {} }), res);
    return res.body;
};

const exportCsv = async (query = {}) => {
    const chunks = [];
    const res = { code: 200, headers: {} };
    res.status = (c) => { res.code = c; return res; };
    res.json = (b) => { res.body = b; return res; };
    res.send = (b) => { chunks.push(String(b)); return res; };
    res.setHeader = (k, v) => { res.headers[k] = v; };
    res.write = (b) => { chunks.push(String(b)); return true; };
    res.end = (b) => { if (b) chunks.push(String(b)); };
    await ctrl.exportAuditCsv(verified({ uid: OWNER, headers: { companyid: CID }, query, body: {} }), res);
    return chunks.join('').split('\n').map((line) => line.split(','));
};

const byEntity = (rows) => Object.fromEntries(rows.map((r) => [`${r.entityType}:${r.entityId}`, r]));

beforeEach(() => {
    Object.keys(mockDb.store).forEach((k) => { mockDb.store[k].length = 0; });
    mockOpen.tasks = new Set([TASK]);
    mockOpen.projects = new Set([PROJECT]);
    readableTaskIds.mockClear();
    mockDb.seed(SCHEMA_TYPE.COMPANY_USERS, { userId: OWNER, roleType: 1, status: 2, isDelete: false });
    mockDb.seed(SCHEMA_TYPE.COMPANY_USERS, { _id: SEAT, userId: MEMBER, roleType: 3, status: 2, isDelete: false });
    mockDb.seed(SCHEMA_TYPE.USERS, { _id: OWNER, Employee_Name: 'Olivia Owner' });
    mockDb.seed(SCHEMA_TYPE.USERS, { _id: MEMBER, Employee_Name: 'Mina Member' });
    mockDb.seed(SCHEMA_TYPE.TASKS, { _id: TASK, TaskName: 'Fix login', ProjectID: PROJECT });
    mockDb.seed(SCHEMA_TYPE.TASKS, { _id: HIDDEN_TASK, TaskName: 'Board minutes', ProjectID: HIDDEN_PROJECT });
    mockDb.seed(SCHEMA_TYPE.SPRINTS, { _id: LIST, name: 'Backlog', projectId: PROJECT });
    mockDb.seed(SCHEMA_TYPE.SPRINTS, { _id: HIDDEN_LIST, name: 'Layoffs', projectId: HIDDEN_PROJECT });
    mockDb.seed(SCHEMA_TYPE.AGENTS, { _id: AGENT, name: 'Planner' });
});

describe('the audit list names what a row is about', () => {
    it('gives a task, a project, a list, an agent and a member their names when the row holds only the id', async () => {
        [row(), row({ entityType: 'project', entityId: PROJECT }), row({ entityType: 'sprint', entityId: LIST }), row({ entityType: 'agent', entityId: AGENT }), row({ entityType: 'member', entityId: MEMBER }), row({ entityType: 'member', entityId: SEAT })]
            .forEach((r) => mockDb.seed(SCHEMA_TYPE.AUDIT_LOGS, r));
        const rows = byEntity((await list()).data);
        expect(rows[`task:${TASK}`].entityLabel).toBe('Fix login');
        expect(rows[`project:${PROJECT}`].entityLabel).toBe('Project 01');
        expect(rows[`sprint:${LIST}`].entityLabel).toBe('Backlog');
        expect(rows[`agent:${AGENT}`].entityLabel).toBe('Planner');
        expect(rows[`member:${MEMBER}`].entityLabel).toBe('Mina Member');
        expect(rows[`member:${SEAT}`].entityLabel).toBe('Mina Member');
    });

    it('asks the task read rule as the reader, and names nothing the reader cannot open', async () => {
        [row({ entityId: HIDDEN_TASK }), row({ entityType: 'project', entityId: HIDDEN_PROJECT }), row({ entityType: 'sprint', entityId: HIDDEN_LIST })]
            .forEach((r) => mockDb.seed(SCHEMA_TYPE.AUDIT_LOGS, r));
        const body = await list();
        expect(readableTaskIds).toHaveBeenCalledWith(CID, OWNER, [HIDDEN_TASK]);
        expect(body.data).toHaveLength(3);
        body.data.forEach((r) => expect(r.entityLabel).toBeUndefined());
        expect(JSON.stringify(body)).not.toMatch(/Board minutes|Layoffs/);
    });

    it('leaves the stored row as it is, and a row that already has a name alone', async () => {
        mockDb.seed(SCHEMA_TYPE.AUDIT_LOGS, row());
        mockDb.seed(SCHEMA_TYPE.AUDIT_LOGS, row({ entityId: HIDDEN_TASK, entityName: 'Named when written' }));
        const rows = byEntity((await list()).data);
        expect(rows[`task:${TASK}`].entityName || '').toBe('');
        expect(rows[`task:${HIDDEN_TASK}`].entityName).toBe('Named when written');
        expect(rows[`task:${HIDDEN_TASK}`].entityLabel).toBeUndefined();
        mockDb.store[SCHEMA_TYPE.AUDIT_LOGS].forEach((stored) => expect(stored.entityLabel).toBeUndefined());
    });

    it('still lists the rows when a name cannot be read', async () => {
        mockDb.seed(SCHEMA_TYPE.AUDIT_LOGS, row());
        readableTaskIds.mockRejectedValueOnce(new Error('down'));
        const body = await list();
        expect(body.status).toBe(true);
        expect(body.data[0].entityLabel).toBeUndefined();
    });
});

describe('the audit export says what each row is in words', () => {
    it('keeps the key and adds its label in the next column', async () => {
        mockDb.seed(SCHEMA_TYPE.AUDIT_LOGS, row({ action: 'agent.project_policy_changed', entityType: 'project', entityId: PROJECT, meta: {} }));
        mockDb.seed(SCHEMA_TYPE.AUDIT_LOGS, row());
        mockDb.seed(SCHEMA_TYPE.AUDIT_LOGS, row({ meta: { actorType: 'agent', action: 'sprint.start', reason: 'Agents cannot perform sprint.start' } }));
        const [header, ...lines] = await exportCsv();
        expect(header).toEqual(['time', 'actorType', 'actor', 'agent', 'run', 'event', 'event_label', 'entity', 'reason', 'cost_usd', 'undone_at']);
        const labels = Object.fromEntries(lines.map((cells) => [cells[5], cells[6]]));
        expect(labels['agent.project_policy_changed']).toBe(EVENTS['agent.project_policy_changed']);
        expect(labels['task.comment']).toBe(registry.get('task.comment').label);
        expect(labels['sprint.start']).toBe(ACTIONS['sprint.start']);
        expect(lines.map((cells) => cells[7])).toEqual(expect.arrayContaining([PROJECT, TASK]));
    });

    it('leaves the label empty for a key it has no words for', async () => {
        mockDb.seed(SCHEMA_TYPE.AUDIT_LOGS, row({ action: 'something.unheard_of', meta: {} }));
        const [, cells] = await exportCsv();
        expect(cells[5]).toBe('something.unheard_of');
        expect(cells[6]).toBe('');
    });
});
