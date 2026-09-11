const mockDb = require('./fixtures/fakeMongo').create();

jest.mock('../utils/mongo-handler/mongoQueries', () => ({ MongoDbCrudOpration: (...a) => mockDb.crud(...a) }));
jest.mock('../utils/commonFunctions', () => ({ removeCache: jest.fn() }));
jest.mock('../Config/loggerConfig', () => ({ error: jest.fn(), info: jest.fn() }));
jest.mock('../Modules/Agents/scope', () => ({ visibleProjectIds: jest.fn() }));
jest.mock('../Modules/Automations/engine/matcher', () => ({ invalidate: jest.fn() }));
jest.mock('../Modules/Automations/engine/tools', () => ({ updateTask: jest.fn() }));
jest.mock('../Config/permissionGuard', () => ({
    getRoleType: jest.fn(),
    isPrivileged: (roleType) => roleType === 1 || roleType === 2,
    evaluatePermission: jest.fn(async () => true),
    isWritable: (value) => value === true || value === 1 || value === 2,
}));

const { SCHEMA_TYPE } = require('../Config/schemaType');
const scope = require('../Modules/Agents/scope');
const guard = require('../Config/permissionGuard');
const tools = require('../Modules/Automations/engine/tools');
const matcher = require('../Modules/Automations/engine/matcher');
const ctrl = require('../Modules/Automations/controller');

const C = '6f0000000000000000000c01';
const OPEN = '6f0000000000000000000a01';
const PRIVATE = '6f0000000000000000000a02';
const OWNER = '6f0000000000000000000001';
const ADMIN = '6f0000000000000000000002';
const MEMBER = '6f0000000000000000000003';
const GUEST = '6f0000000000000000000004';
const MISSING = '6f00000000000000000000ff';
const ROLES = { [OWNER]: 1, [ADMIN]: 2, [MEMBER]: 3, [GUEST]: 0 };

const call = async (handler, { uid, params = {}, body = {} }) => {
    const res = {
        statusCode: 200,
        body: null,
        status(code) { this.statusCode = code; return this; },
        send(payload) { this.body = payload; return this; },
    };
    await handler({ uid, params, body, headers: { companyid: C } }, res);
    return res;
};

const v2Rule = (over = {}) => ({
    name: 'Escalate',
    trigger: { type: 'event', event: 'task.priority_changed' },
    scope: { allProjects: false, projectIds: [OPEN] },
    conditions: {},
    steps: [{ id: 's1', type: 'action', action: 'add_comment', config: { body: 'hi' } }],
    ...over,
});

const seedRule = (over = {}) => mockDb.seed(SCHEMA_TYPE.AUTOMATION_RULES, { ...v2Rule(), version: 2, enabled: false, deletedStatusKey: 0, createdBy: OWNER, ...over });
const seedTask = (over = {}) => mockDb.seed(SCHEMA_TYPE.TASKS, {
    TaskName: 'Task', TaskKey: 'T-1', ProjectID: OPEN, isParentTask: true, deletedStatusKey: 0, Task_Priority: 'MEDIUM', updatedAt: new Date(), ...over,
});
const rules = () => mockDb.store[SCHEMA_TYPE.AUTOMATION_RULES] || [];

beforeEach(() => {
    Object.keys(mockDb.store).forEach((k) => { mockDb.store[k].length = 0; });
    jest.clearAllMocks();
    guard.getRoleType.mockImplementation(async (companyId, uid) => (uid in ROLES ? ROLES[uid] : null));
    guard.evaluatePermission.mockResolvedValue(true);
    scope.visibleProjectIds.mockImplementation(async (companyId, uid) => ([OWNER, ADMIN].includes(uid) ? [OPEN, PRIVATE] : [OPEN]));
    tools.updateTask.mockImplementation(async (companyId, taskId, set) => {
        const updated = await mockDb.crud(companyId, { type: SCHEMA_TYPE.TASKS, data: [{ _id: String(taskId) }, { $set: set }] }, 'findOneAndUpdate');
        return { changed: true, task: updated };
    });
});

describe('AUT-04 rule management is for owners and admins', () => {
    it('refuses a guest creating a rule and saves nothing', async () => {
        const res = await call(ctrl.createRuleV2, { uid: GUEST, body: v2Rule() });
        expect(res.statusCode).toBe(403);
        expect(res.body.status).toBe(false);
        expect(rules()).toHaveLength(0);
    });

    it('refuses a member editing a rule someone else created', async () => {
        const rule = seedRule();
        const res = await call(ctrl.updateRuleV2, { uid: MEMBER, params: { id: rule._id }, body: v2Rule({ name: 'Renamed by member' }) });
        expect(res.statusCode).toBe(403);
        expect(rules()[0].name).toBe('Escalate');
    });

    it('refuses a guest switching a rule on, and a member deleting one', async () => {
        const rule = seedRule();
        expect((await call(ctrl.setRuleEnabled, { uid: GUEST, params: { id: rule._id }, body: { enabled: true } })).statusCode).toBe(403);
        expect((await call(ctrl.deleteRule, { uid: MEMBER, params: { id: rule._id } })).statusCode).toBe(403);
        expect(rules()[0]).toMatchObject({ enabled: false, deletedStatusKey: 0 });
    });

    it('lets an admin create a rule switched off, edit it, switch it on and delete it', async () => {
        const created = await call(ctrl.createRuleV2, { uid: ADMIN, body: v2Rule() });
        expect(created.body).toMatchObject({ status: true, data: { enabled: false, createdBy: ADMIN } });
        const id = created.body.data._id;

        const renamed = await call(ctrl.updateRuleV2, { uid: OWNER, params: { id }, body: v2Rule({ name: 'Renamed' }) });
        expect(renamed.body.data.name).toBe('Renamed');
        expect((await call(ctrl.setRuleEnabled, { uid: ADMIN, params: { id }, body: { enabled: true } })).body.data.enabled).toBe(true);
        expect((await call(ctrl.deleteRule, { uid: ADMIN, params: { id } })).body.status).toBe(true);
        expect(rules()[0]).toMatchObject({ deletedStatusKey: 1, enabled: false });
        expect(matcher.invalidate).toHaveBeenCalledWith(C);
    });

    it('refuses an admin scoping a rule to a project they cannot open', async () => {
        scope.visibleProjectIds.mockResolvedValue([OPEN]);
        const res = await call(ctrl.createRuleV2, { uid: ADMIN, body: v2Rule({ scope: { allProjects: false, projectIds: [PRIVATE] } }) });
        expect(res.statusCode).toBe(403);
        expect(rules()).toHaveLength(0);
    });
});

describe('AUT-05 v1 rules', () => {
    const v1Rule = (over = {}) => ({ name: 'Bump', conditions: {}, actions: [{ type: 'set_priority', value: 'HIGH' }], ...over });

    it('saves a new v1 rule switched off', async () => {
        const res = await call(ctrl.createRule, { uid: OWNER, body: v1Rule() });
        expect(res.body).toMatchObject({ status: true, data: { enabled: false } });
    });

    it('refuses a guest saving or applying a v1 rule', async () => {
        expect((await call(ctrl.createRule, { uid: GUEST, body: v1Rule({ enabled: true }) })).statusCode).toBe(403);
        const rule = mockDb.seed(SCHEMA_TYPE.AUTOMATION_RULES, { ...v1Rule(), enabled: false, deletedStatusKey: 0 });
        const task = seedTask();
        expect((await call(ctrl.applyRule, { uid: GUEST, params: { id: rule._id } })).statusCode).toBe(403);
        expect(tools.updateTask).not.toHaveBeenCalled();
        expect(mockDb.store[SCHEMA_TYPE.TASKS].find((t) => t._id === task._id).Task_Priority).toBe('MEDIUM');
    });

    it('refuses the whole batch when one target sits in a project the caller cannot edit', async () => {
        const rule = mockDb.seed(SCHEMA_TYPE.AUTOMATION_RULES, { ...v1Rule(), enabled: false, deletedStatusKey: 0 });
        seedTask({ ProjectID: OPEN });
        seedTask({ ProjectID: PRIVATE, TaskKey: 'P-1' });
        scope.visibleProjectIds.mockResolvedValue([OPEN]);
        const res = await call(ctrl.applyRule, { uid: ADMIN, params: { id: rule._id } });
        expect(res.statusCode).toBe(403);
        expect(tools.updateTask).not.toHaveBeenCalled();
    });

    it('refuses when the task priority permission is not writable on a target project', async () => {
        const rule = mockDb.seed(SCHEMA_TYPE.AUTOMATION_RULES, { ...v1Rule(), enabled: false, deletedStatusKey: 0 });
        seedTask();
        guard.evaluatePermission.mockResolvedValue(false);
        expect((await call(ctrl.applyRule, { uid: ADMIN, params: { id: rule._id } })).statusCode).toBe(403);
        expect(guard.evaluatePermission).toHaveBeenCalledWith(C, ADMIN, 'task.task_priority', { projectId: OPEN });
    });

    it('applies through the task update helper for an owner who can edit every target', async () => {
        const rule = mockDb.seed(SCHEMA_TYPE.AUTOMATION_RULES, { ...v1Rule(), enabled: false, deletedStatusKey: 0 });
        const task = seedTask();
        seedTask({ Task_Priority: 'HIGH', TaskKey: 'T-2' });
        const res = await call(ctrl.applyRule, { uid: OWNER, params: { id: rule._id } });
        expect(res.body).toMatchObject({ status: true, data: { modified: 1 } });
        expect(tools.updateTask).toHaveBeenCalledTimes(1);
        expect(tools.updateTask).toHaveBeenCalledWith(C, task._id, { Task_Priority: 'HIGH' }, expect.objectContaining({ ruleId: rule._id }));
    });
});

describe('AUT-03 backtest and preview only search projects the caller can open', () => {
    it('keeps a private project task out of a guest backtest that names the project', async () => {
        seedTask({ ProjectID: PRIVATE, TaskName: 'zebraquokka' });
        const guest = await call(ctrl.backtest, { uid: GUEST, body: { rule: v2Rule({ scope: { allProjects: false, projectIds: [PRIVATE] } }) } });
        expect(guest.body.data).toMatchObject({ matched: 0, sample: [] });
        const owner = await call(ctrl.backtest, { uid: OWNER, body: { rule: v2Rule({ scope: { allProjects: false, projectIds: [PRIVATE] } }) } });
        expect(owner.body.data.matched).toBe(1);
    });

    it('keeps a title probe with no scope inside the visible projects', async () => {
        seedTask({ ProjectID: PRIVATE, TaskName: 'zebraquokka secret' });
        seedTask({ ProjectID: OPEN, TaskName: 'zebraquokka public' });
        const rule = v2Rule({ scope: { allProjects: true, projectIds: [] }, conditions: { op: 'contains', field: 'task.TaskName', value: 'zebraquokka' } });
        const res = await call(ctrl.backtest, { uid: GUEST, body: { rule } });
        expect(res.body.data.sample.map((t) => t.name)).toEqual(['zebraquokka public']);
    });

    it('keeps a private project task out of a guest v1 preview', async () => {
        seedTask({ ProjectID: PRIVATE, TaskName: 'hidden' });
        seedTask({ ProjectID: OPEN, TaskName: 'shown' });
        const res = await call(ctrl.preview, { uid: GUEST, body: { conditions: {} } });
        expect(res.body.data.count).toBe(1);
        expect(res.body.data.sample.map((t) => t.name)).toEqual(['shown']);
    });
});

describe('AUT-09 a missing or deleted rule answers 404', () => {
    it('does not claim to update or switch on a rule that does not exist', async () => {
        const put = await call(ctrl.updateRuleV2, { uid: OWNER, params: { id: MISSING }, body: v2Rule() });
        const patch = await call(ctrl.setRuleEnabled, { uid: OWNER, params: { id: MISSING }, body: { enabled: true } });
        expect([put.statusCode, put.body.status]).toEqual([404, false]);
        expect([patch.statusCode, patch.body.status]).toEqual([404, false]);
    });

    it('treats a soft-deleted rule as missing', async () => {
        const rule = seedRule({ deletedStatusKey: 1 });
        const patch = await call(ctrl.setRuleEnabled, { uid: OWNER, params: { id: rule._id }, body: { enabled: true } });
        expect(patch.statusCode).toBe(404);
        expect(rules()[0].enabled).toBe(false);
    });
});
