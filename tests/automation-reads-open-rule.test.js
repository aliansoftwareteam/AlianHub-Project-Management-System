jest.setTimeout(30000);
const mockDb = require('./fixtures/fakeMongo').create();

jest.mock('../utils/mongo-handler/mongoQueries', () => ({
    MongoDbCrudOpration: (companyId, q, method) => mockDb.crud(companyId, q, method),
    validateObjectId: (id) => /^[a-f0-9]{24}$/i.test(String(id)),
}));
jest.mock('../Config/config', () => ({ myCache: { get: () => undefined, set: () => {}, del: () => {}, keys: () => [], getTtl: () => 0, flushAll: () => {} } }));
jest.mock('../Config/loggerConfig', () => ({ info: jest.fn(), error: jest.fn(), warn: jest.fn(), debug: jest.fn() }));
jest.mock('../event/socketEventEmitter', () => ({ emit: jest.fn(), on: jest.fn() }));
jest.mock('../utils/commonFunctions', () => ({ removeCache: jest.fn() }));
jest.mock('../Modules/Automations/engine/matcher', () => ({ invalidate: jest.fn(), contextFor: jest.fn(() => ({ task: {} })), inScope: jest.fn(() => true) }));
jest.mock('../Modules/Automations/engine/tools', () => ({ updateTask: jest.fn() }));
jest.mock('../Modules/Tasks/helpers/task_class_Mongo', () => ({ taskMongo: { create: jest.fn(), updateChecklists: jest.fn() } }));
jest.mock('../Modules/Tasks/helpers/mongo_helper', () => ({ HandleHistory: jest.fn(() => Promise.resolve()) }));
jest.mock('../Modules/LogTime/controllerV2/helpers', () => ({ updateRemainingTime: jest.fn(() => Promise.resolve()) }));

const { SCHEMA_TYPE } = require('../Config/schemaType');
const world = require('./fixtures/accessWorld');
const automations = require('../Modules/Automations/controller');
const templates = require('../Modules/TaskTemplates/controller');

const { CID, OWNER, ADMIN, INSIDER, OUTSIDER, GUEST, P_OPEN, P_PERSONAL, L_OPEN, L_SECRET, L_PERSONAL, T_OPEN, T_SECRET, T_PRIVATE, T_PERSONAL, OPENS, settle } = world;
const { seed, rows, task } = world.create(mockDb);

const EVERYONE = [['the owner', OWNER], ['an admin', ADMIN], ['a member on the private list', INSIDER], ['a member', OUTSIDER], ['a guest', GUEST]];
const NAMES = { [T_OPEN]: 'Open task', [T_SECRET]: 'Secret task', [T_PRIVATE]: 'Private task', [T_PERSONAL]: 'Personal task' };
const RULE = '6f0000000000000000000e01';
const namesOpenTo = (uid) => OPENS[uid].map((id) => NAMES[id]).sort();

const answered = (handler, req) => new Promise((resolve) => {
    const res = { statusCode: 200 };
    res.status = (code) => { res.statusCode = code; return res; };
    res.json = (answer) => { resolve({ code: res.statusCode, body: answer }); return res; };
    res.send = res.json;
    handler({ headers: { companyid: CID }, query: {}, params: {}, body: {}, ...req }, res);
}).then(async (answer) => { await settle(); return answer; });

const seedRows = () => {
    seed();
    rows(SCHEMA_TYPE.TASKS).forEach((row) => { row.updatedAt = new Date(); });
    const parent = rows(SCHEMA_TYPE.RULES).find((rule) => rule.isParent);
    mockDb.seed(SCHEMA_TYPE.RULES, { key: 'task_create', name: 'task_create', isParent: false, parentId: String(parent._id), roles: [{ key: 3, permission: true }, { key: 0, permission: true }] });
    mockDb.seed(SCHEMA_TYPE.AUTOMATION_RULES, { _id: RULE, name: 'Escalate', version: 2, enabled: true, trigger: { event: 'task.updated' }, scope: { allProjects: true }, conditions: null, steps: [], deletedStatusKey: 0 });
    [[T_OPEN, P_OPEN, L_OPEN], [T_SECRET, P_OPEN, L_SECRET], [T_PERSONAL, P_PERSONAL, L_PERSONAL]].forEach(([id, projectId, sprintId], at) => mockDb.seed(SCHEMA_TYPE.AUTOMATION_RUNS, {
        ruleId: RULE, eventType: 'task.updated', status: 'success', steps: [], entity: { kind: 'task', id, key: `K-${at}` },
        envelope: { scope: { projectId, sprintId }, data: { _id: id, TaskName: NAMES[id] } }, startedAt: new Date(Date.UTC(2026, 8, 20, 10, at)),
    }));
};

beforeEach(() => { jest.clearAllMocks(); seedRows(); });

describe('the tasks an automation screen names', () => {
    it.each(EVERYONE)('in the preview of a rule are, for %s, the ones they can open', async (who, uid) => {
        const { body } = await answered(automations.preview, { uid, body: { conditions: {} } });
        expect(body.data.sample.map((row) => row.name).sort()).toEqual(namesOpenTo(uid));
        expect(body.data.count).toBe(OPENS[uid].length);
    });

    it.each(EVERYONE)('in the look back over the last days are, for %s, the ones they can open', async (who, uid) => {
        const { body } = await answered(automations.backtest, { uid, body: { rule: { trigger: { event: 'task.updated' }, scope: { allProjects: true } } } });
        expect(body.data.sample.map((row) => row.name).sort()).toEqual(namesOpenTo(uid));
        expect(body.data.matched).toBe(OPENS[uid].length);
    });

    it.each(EVERYONE)('in the past runs of a rule are, for %s, the ones they can open', async (who, uid) => {
        const { body } = await answered(automations.listRuns, { uid, params: { id: RULE } });
        const inRuns = [T_OPEN, T_SECRET, T_PERSONAL].filter((id) => OPENS[uid].includes(id)).map((id) => NAMES[id]).sort();
        expect(body.data.map((run) => run.envelope.data.TaskName).sort()).toEqual(inRuns);
    });

    it.each([['the owner', OWNER], ['an admin', ADMIN]])('in a trial run is, for %s, one they can open', async (who, uid) => {
        for (const taskId of [T_OPEN, T_SECRET, T_PRIVATE, T_PERSONAL]) {
            const { code, body } = await answered(automations.dryRun, { uid, params: { id: RULE }, body: { taskId } });
            expect([taskId, code === 404 ? 'not found' : body.data.task.id]).toEqual([taskId, OPENS[uid].includes(taskId) ? taskId : 'not found']);
        }
    });
});

describe('a task template', () => {
    it.each(EVERYONE)('is saved by %s from a task they can open, and a task they cannot open is not found', async (who, uid) => {
        for (const taskId of [T_OPEN, T_SECRET, T_PRIVATE, T_PERSONAL]) {
            const { code } = await answered(templates.saveTemplate, { uid, body: { name: 'Checklist', taskId, scope: 'project' } });
            expect([taskId, code]).toEqual([taskId, OPENS[uid].includes(taskId) ? 200 : 404]);
        }
    });

    it.each(EVERYONE)('is applied by %s to a task they can open, and a task they cannot open is not found', async (who, uid) => {
        const template = mockDb.seed(SCHEMA_TYPE.TASK_TEMPLATES, { name: 'Checklist', scope: 'workspace', deletedStatusKey: 0, fields: {}, checklist: [], subtasks: [] });
        for (const taskId of [T_OPEN, T_SECRET, T_PRIVATE, T_PERSONAL]) {
            const { code } = await answered(templates.applyTemplate, { uid, params: { id: String(template._id) }, body: { taskId, preview: true } });
            expect([taskId, code]).toEqual([taskId, OPENS[uid].includes(taskId) ? 200 : 404]);
        }
        expect(task(T_SECRET).TaskName).toBe('Secret task');
    });
});
