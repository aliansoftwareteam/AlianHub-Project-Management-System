const mockDb = require('./fixtures/fakeMongo').create();

jest.mock('../utils/mongo-handler/mongoQueries', () => ({ MongoDbCrudOpration: (...a) => mockDb.crud(...a) }));
jest.mock('../utils/commonFunctions', () => ({ removeCache: jest.fn() }));
jest.mock('../Config/loggerConfig', () => ({ error: jest.fn(), info: jest.fn(), warn: jest.fn(), debug: jest.fn() }));
jest.mock('../event/socketEventEmitter', () => ({ emit: jest.fn() }));
jest.mock('../Modules/Agents/scope', () => ({ visibleProjectIds: jest.fn(async () => ['6f0000000000000000000a01']) }));
jest.mock('../Modules/Automations/engine/matcher', () => ({ invalidate: jest.fn() }));
jest.mock('../Modules/Audit/recorder', () => ({ recordAudit: jest.fn(), recordAuditFromReq: jest.fn() }));
jest.mock('../Config/permissionGuard', () => ({
    getRoleType: jest.fn(async () => 1),
    isPrivileged: (roleType) => roleType === 1 || roleType === 2,
    evaluatePermission: jest.fn(async () => true),
    isWritable: (value) => value === true || value === 1 || value === 2,
}));

const { SCHEMA_TYPE } = require('../Config/schemaType');
const { recordAudit } = require('../Modules/Audit/recorder');
const tools = require('../Modules/Automations/engine/tools');
const ctrl = require('../Modules/Automations/controller');

const C = '6f0000000000000000000c01';
const PROJECT = '6f0000000000000000000a01';
const OWNER = '6f0000000000000000000001';
const saved = process.env.STEP_CREDENTIALS;

const seedTask = () => mockDb.seed(SCHEMA_TYPE.TASKS, { TaskName: 'Task', TaskKey: 'T-1', ProjectID: PROJECT, CompanyId: C, isParentTask: true, deletedStatusKey: 0, Task_Priority: 'MEDIUM', updatedAt: new Date() });
const auditOf = (action) => recordAudit.mock.calls.map(([, entry]) => entry).filter((entry) => entry.action === action);

beforeEach(() => {
    Object.keys(mockDb.store).forEach((k) => { mockDb.store[k].length = 0; });
    recordAudit.mockClear();
    process.env.STEP_CREDENTIALS = 'on';
});
afterAll(() => { if (saved === undefined) delete process.env.STEP_CREDENTIALS; else process.env.STEP_CREDENTIALS = saved; });

describe('the worker service identity on automation rows', () => {
    it('signs a row the runner writes while it executes a run', async () => {
        const task = seedTask();
        await tools.updateTask(C, task._id, { Task_Priority: 'HIGH' }, { runId: 'run1', ruleId: 'rule1', ruleName: 'Escalate', depth: 0 });
        const [row] = auditOf('automation.task.update');
        expect(row).toMatchObject({ actorId: 'rule:rule1', meta: { runId: 'run1', actorType: 'service', service: 'worker', serviceId: 'service:worker' } });
    });

    it('leaves a row written for a person\'s apply request as it was: the person asked, not the worker', async () => {
        const rule = mockDb.seed(SCHEMA_TYPE.AUTOMATION_RULES, { name: 'Raise', conditions: {}, actions: [{ type: 'set_priority', value: 'HIGH' }], enabled: false, deletedStatusKey: 0, createdBy: OWNER });
        const task = seedTask();
        const res = { statusCode: 200, body: null, status(code) { this.statusCode = code; return this; }, send(payload) { this.body = payload; return this; } };
        await ctrl.applyRule({ uid: OWNER, params: { id: rule._id }, body: {}, headers: { companyid: C } }, res);
        expect(res.body).toMatchObject({ status: true, data: { modified: 1 } });
        expect(mockDb.store[SCHEMA_TYPE.TASKS].find((t) => t._id === task._id).Task_Priority).toBe('HIGH');
        const [row] = auditOf('automation.rule.apply');
        expect(row).toMatchObject({ actorId: `rule:${rule._id}`, meta: { runId: null, ruleId: String(rule._id), fields: ['Task_Priority'] } });
        expect(Object.keys(row.meta).sort()).toEqual(['fields', 'ruleId', 'runId']);
    });

    it('signs nothing while STEP_CREDENTIALS is off', async () => {
        delete process.env.STEP_CREDENTIALS;
        const task = seedTask();
        await tools.updateTask(C, task._id, { Task_Priority: 'HIGH' }, { runId: 'run1', ruleId: 'rule1', ruleName: 'Escalate', depth: 0 });
        const [row] = auditOf('automation.task.update');
        expect(Object.keys(row.meta).sort()).toEqual(['fields', 'ruleId', 'runId']);
    });
});
