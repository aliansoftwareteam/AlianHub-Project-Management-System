/* Task 047, AI-6: the project manager switch, the daily look that files what the rules find, and who reads a finding. */
process.env.STORAGE_TYPE = 'server';
const mockDb = require('./fixtures/fakeMongo').create();

jest.mock('../utils/mongo-handler/mongoQueries', () => ({
    MongoDbCrudOpration: (companyId, q, method) => mockDb.crud(companyId, q, method),
    validateObjectId: (id) => /^[a-f0-9]{24}$/i.test(String(id)),
}));
jest.mock('../Config/config', () => ({ myCache: { get: () => undefined, set: () => {}, del: () => {}, keys: () => [], getTtl: () => 0, flushAll: () => {} } }));
jest.mock('../Config/loggerConfig', () => ({ info: jest.fn(), error: jest.fn(), warn: jest.fn(), debug: jest.fn() }));
const mockStub = () => new Proxy({}, {
    get: (target, name) => {
        if (name === 'then' || name === '__esModule') return undefined;
        target[name] = target[name] || jest.fn(() => Promise.resolve({}));
        return target[name];
    },
});
jest.mock('../Modules/Sprints/controller', () => mockStub());
jest.mock('../Modules/Tasks/helpers/handleNotification', () => mockStub());
jest.mock('../Modules/notification/prepare-notification-data/controllerV2', () => mockStub());
jest.mock('../Modules/Company/eventController', () => mockStub());
jest.mock('../Modules/Company/controller/updateCompany', () => ({ getCompanyDataFun: jest.fn(async () => [mockDb.store.companies[0]]) }));
jest.mock('../Modules/notification-count/controller', () => mockStub());
jest.mock('../Modules/MainChats/controller', () => mockStub());
jest.mock('../Modules/LogTime/controllerV2.js', () => mockStub());
jest.mock('../Modules/CustomField/controller', () => mockStub());
jest.mock('../utils/planHelper', () => mockStub());
jest.mock('../utils/commonFunctions.js', () => mockStub());
jest.mock('../common-storage/common-server.js', () => mockStub());
jest.mock('../event/socketEventEmitter', () => ({ emit: jest.fn(), on: jest.fn() }));
jest.mock('../Modules/Knowledge/ingest/events', () => ({ publishCommentChanged: jest.fn(), publish: jest.fn() }));
jest.mock('../Modules/Agents/triggers', () => ({ fromComment: jest.fn(async () => null) }));
jest.mock('../Config/jwt', () => ({ verifyCompanyMembership: jest.fn(async () => true) }));
jest.mock('../Modules/ApiTokens/controller', () => ({ verifyToken: jest.fn(), logTokenActivity: jest.fn() }));

const fs = require('fs');
const path = require('path');
const { SCHEMA_TYPE } = require('../Config/schemaType');
const world = require('./fixtures/mcpManageWorld');
const socketEmitter = require('../event/socketEventEmitter');
const proposals = require('../Modules/Agents/proposals');
const approvalQueue = require('../Modules/Inbox/helpers/approvalQueue');
const { RULE } = require('../Modules/Agents/manager/rules');
const settings = require('../Modules/Agents/manager/settings');
const findings = require('../Modules/Agents/manager/findings');
const dailyLook = require('../Modules/Agents/manager/dailyLook');
const controller = require('../Modules/Agents/manager/controller');
const { projectFindingsSchema } = require('../utils/mongo-handler/createSchema');

const { CID, OWNER, ADMIN, MEMBER, OTHER, OUTSIDER, TOKEN, P_OPEN, P_DEST, S_OPEN, S_SECRET, settle } = world;
const { seed, rows, rules: permissionRules } = world.create(mockDb);
const GUEST = OUTSIDER;

const WEDNESDAY = new Date('2026-10-07T09:00:00Z');
const THURSDAY = new Date('2026-10-08T09:00:00Z');
const FRIDAY = new Date('2026-10-09T09:00:00Z');
const SATURDAY = new Date('2026-10-10T09:00:00Z');
const day = (ymd) => new Date(`${ymd}T00:00:00Z`);

const project = (id) => rows(SCHEMA_TYPE.PROJECTS).find((row) => String(row._id) === String(id));
const stored = () => rows(SCHEMA_TYPE.PROJECT_FINDINGS);
const open = () => stored().filter((row) => row.status === findings.STATUS.OPEN);
const filed = () => rows(SCHEMA_TYPE.AGENT_PROPOSALS);
const ofRule = (list, rule) => list.filter((row) => row.rule === rule);
const switchOn = (id = P_OPEN) => { project(id).agentManager = { on: true }; };

/* Every seeded task of the open project gets an owner, an estimate and a recent change, so only the cases a test adds are found. */
const calm = () => rows(SCHEMA_TYPE.TASKS).filter((row) => String(row.ProjectID) === P_OPEN)
    .forEach((row) => Object.assign(row, { AssigneeUserId: [OTHER], totalEstimatedTime: 60, updatedAt: day('2026-10-06'), DueDate: day('2026-11-20') }));

let n = 0;
const task = (over = {}) => {
    n += 1;
    return mockDb.seed(SCHEMA_TYPE.TASKS, {
        TaskKey: `CASE-${n}`, TaskName: `Case ${n}`, CompanyId: CID, ProjectID: P_OPEN, sprintId: S_OPEN, sprintArray: { id: S_OPEN, name: 'Sprint 1' },
        AssigneeUserId: [OTHER], watchers: [], isParentTask: true, deletedStatusKey: 0, status: { key: 2, text: 'In Progress', type: 'active' }, statusType: 'active', statusKey: 2,
        totalEstimatedTime: 60, updatedAt: day('2026-10-06'), createdAt: day('2026-09-01'), relations: [], ...over,
    });
};
const waitsOn = (blocker) => [{ taskId: blocker._id, type: 'blocked_by' }];

const oneOfEach = () => {
    const quietBlocker = task({ updatedAt: day('2026-10-01'), statusType: 'default_active', status: { key: 1, text: 'To Do', type: 'default_active' } });
    const cases = {
        late: task({ DueDate: day('2026-10-04') }),
        quietBlocker,
        waiting: task({ relations: waitsOn(quietBlocker) }),
        orphan: task({ AssigneeUserId: [] }),
        bare: task({ totalEstimatedTime: 0 }),
        quiet: task({ updatedAt: day('2026-09-30') }),
        mail: task({ origin: { kind: 'email', ref: 'm1' }, AssigneeUserId: [], totalEstimatedTime: 0 }),
        loaded: task({ AssigneeUserId: [MEMBER] }),
    };
    mockDb.seed(SCHEMA_TYPE.ESTIMATES_TIME, { ProjectId: P_OPEN, TaskId: String(cases.loaded._id), UserId: MEMBER, userId: MEMBER, Date: day('2026-10-06'), EstimatedTime: 42 * 60 });
    return cases;
};

beforeAll(() => mockDb.uniqueFromSchema(SCHEMA_TYPE.PROJECT_FINDINGS, projectFindingsSchema));

beforeEach(() => {
    jest.clearAllMocks();
    n = 0;
    seed();
    calm();
    mockDb.seed(SCHEMA_TYPE.COMPANY_USERS, { userId: GUEST, roleType: 0, status: 2, isDelete: false });
});
afterEach(settle);

describe('the switch', () => {
    it('is off until someone turns it on, and the level is Suggest', async () => {
        expect(await settings.read(CID, P_OPEN)).toEqual({ on: false, level: 'suggest' });
        switchOn();
        expect(await settings.read(CID, P_OPEN)).toEqual({ on: true, level: 'suggest' });
        expect(await settings.read(CID, P_DEST)).toEqual({ on: false, level: 'suggest' });
    });

    it('a project with the switch off is not looked at', async () => {
        oneOfEach();
        expect(await dailyLook.runForCompany(CID, WEDNESDAY)).toMatchObject({ looked: 0, filed: 0 });
        expect(stored()).toEqual([]);
        expect(filed()).toEqual([]);
    });
});

describe('the daily look', () => {
    it('files one finding for each case, each with the facts its reason is written from', async () => {
        const cases = oneOfEach();
        switchOn();
        expect(await dailyLook.runForCompany(CID, WEDNESDAY)).toMatchObject({ looked: 1, filed: 7 });
        expect(open().map((row) => row.rule).sort()).toEqual(Object.values(RULE).filter((rule) => rule !== RULE.TRIAGE).sort());
        const about = (rule) => ofRule(open(), rule)[0];
        expect(about(RULE.SLIPPING)).toMatchObject({ taskId: String(cases.late._id), facts: { taskKey: cases.late.TaskKey, daysLate: 3 } });
        expect(about(RULE.BLOCKED)).toMatchObject({ taskId: String(cases.waiting._id), facts: { blockerKey: cases.quietBlocker.TaskKey, quietDays: 4 } });
        expect(about(RULE.OVERLOADED)).toMatchObject({ userId: MEMBER, facts: { plannedHours: 42, capacityHours: 40 } });
        expect(about(RULE.NO_OWNER)).toMatchObject({ taskId: String(cases.orphan._id) });
        expect(about(RULE.NO_ESTIMATE)).toMatchObject({ taskId: String(cases.bare._id) });
        expect(about(RULE.STALE)).toMatchObject({ taskId: String(cases.quiet._id), facts: { quietDays: 5 } });
        expect(about(RULE.UNTRIAGED)).toMatchObject({ taskId: String(cases.mail._id), facts: { origin: 'email' } });
        expect(project(P_OPEN).agentManagerLookedOn).toBe('2026-10-07');
    });

    it('files a ready change as a proposal from the system for the project, and applies nothing', async () => {
        const cases = oneOfEach();
        switchOn();
        const before = JSON.stringify([rows(SCHEMA_TYPE.TASKS), rows(SCHEMA_TYPE.COMMENTS)]);
        await dailyLook.runForCompany(CID, WEDNESDAY);
        expect(JSON.stringify([rows(SCHEMA_TYPE.TASKS), rows(SCHEMA_TYPE.COMMENTS)])).toBe(before);
        expect(filed().map((row) => row.finding.rule).sort()).toEqual([RULE.BLOCKED, RULE.STALE]);
        const ask = filed().find((row) => row.finding.rule === RULE.STALE);
        expect(ask).toMatchObject({
            status: 'pending', source: proposals.SOURCE_SYSTEM, agentName: 'System for Open', projectId: P_OPEN, taskId: String(cases.quiet._id),
            changes: [{ action: 'task.comment', params: { taskId: String(cases.quiet._id) }, reversible: true }],
            finding: { rule: RULE.STALE, projectName: 'Open', facts: { quietDays: 5 } },
        });
        expect(ask.requestedBy).toBeUndefined();
        expect(String(ofRule(open(), RULE.STALE)[0].proposalId)).toBe(String(ask._id));
        expect(socketEmitter.emit.mock.calls.every(([, event]) => !event || event.companyId === CID)).toBe(true);
    });

    it('rests on a day the project does not work, and looks on a day only its own week works', async () => {
        oneOfEach();
        switchOn();
        expect(await dailyLook.runForCompany(CID, SATURDAY)).toMatchObject({ looked: 0 });
        expect(project(P_OPEN).agentManagerLookedOn).toBeUndefined();
        project(P_OPEN).workingDays = [6];
        expect(await dailyLook.runForCompany(CID, SATURDAY)).toMatchObject({ looked: 1 });
        expect(await dailyLook.runForCompany(CID, WEDNESDAY)).toMatchObject({ looked: 0 });
    });

    it('looks once a day, and does not file the same finding again while it is open', async () => {
        oneOfEach();
        switchOn();
        await dailyLook.runForCompany(CID, WEDNESDAY);
        expect(await dailyLook.runForCompany(CID, WEDNESDAY)).toMatchObject({ looked: 0, filed: 0 });
        expect(await dailyLook.runForCompany(CID, THURSDAY)).toMatchObject({ looked: 1, filed: 0 });
        expect(stored()).toHaveLength(7);
        expect(filed()).toHaveLength(2);
        expect(ofRule(open(), RULE.SLIPPING)[0].facts.daysLate).toBe(4);
    });

    it('two servers looking at the same moment file once', async () => {
        oneOfEach();
        switchOn();
        const runs = await Promise.all([dailyLook.runForAllCompanies(WEDNESDAY), dailyLook.runForAllCompanies(WEDNESDAY)]);
        expect(runs.map((run) => run.looked).sort()).toEqual([0, 1]);
        expect(stored()).toHaveLength(7);
        expect(filed()).toHaveLength(2);
    });

    it('closes a finding when its cause is gone, and takes its waiting proposal back', async () => {
        const cases = oneOfEach();
        switchOn();
        await dailyLook.runForCompany(CID, WEDNESDAY);
        cases.orphan.AssigneeUserId = [OTHER];
        cases.quiet.updatedAt = WEDNESDAY;
        await dailyLook.runForCompany(CID, THURSDAY);
        expect(open().map((row) => row.rule)).not.toEqual(expect.arrayContaining([RULE.NO_OWNER, RULE.STALE]));
        expect(ofRule(stored(), RULE.NO_OWNER)[0]).toMatchObject({ status: findings.STATUS.CLOSED, closedAt: THURSDAY });
        expect(filed().find((row) => row.finding.rule === RULE.STALE)).toMatchObject({ status: 'declined', decidedBy: 'system' });
        expect(filed().find((row) => row.finding.rule === RULE.BLOCKED)).toMatchObject({ status: 'pending' });
    });

    it('opens a closed finding again when the cause comes back', async () => {
        const cases = oneOfEach();
        switchOn();
        await dailyLook.runForCompany(CID, WEDNESDAY);
        cases.orphan.AssigneeUserId = [OTHER];
        await dailyLook.runForCompany(CID, THURSDAY);
        cases.orphan.AssigneeUserId = [];
        expect(await dailyLook.runForCompany(CID, FRIDAY)).toMatchObject({ filed: 1 });
        expect(ofRule(stored(), RULE.NO_OWNER)).toMatchObject([{ status: findings.STATUS.OPEN, openedAt: FRIDAY }]);
    });

    it('files no more than ten a day, the most urgent first, and the rest the day after', async () => {
        const late = task({ DueDate: day('2026-10-01') });
        Array.from({ length: 13 }, () => task({ AssigneeUserId: [] }));
        switchOn();
        expect(dailyLook.CAPS).toEqual({ TASKS_READ: 500, FILED_PER_DAY: 10 });
        expect(await dailyLook.runForCompany(CID, WEDNESDAY)).toMatchObject({ filed: 10 });
        expect(open()).toHaveLength(10);
        expect(ofRule(open(), RULE.SLIPPING)).toMatchObject([{ taskId: String(late._id) }]);
        expect(await dailyLook.runForCompany(CID, THURSDAY)).toMatchObject({ filed: 4 });
        expect(open()).toHaveLength(14);
    });

    it('does not offer a declined change again for the same task and cause', async () => {
        oneOfEach();
        switchOn();
        await dailyLook.runForCompany(CID, WEDNESDAY);
        const ask = filed().find((row) => row.finding.rule === RULE.STALE);
        expect(await proposals.decline(CID, ask._id, { decider: { kind: 'human', userId: OWNER }, ip: '', reason: 'not_now' })).toMatchObject({ proposal: { status: 'declined' } });
        await dailyLook.runForCompany(CID, THURSDAY);
        await dailyLook.runForCompany(CID, FRIDAY);
        expect(ofRule(stored(), RULE.STALE)).toMatchObject([{ status: findings.STATUS.DECLINED }]);
        expect(filed().filter((row) => row.finding.rule === RULE.STALE)).toHaveLength(1);
    });

    it('an approved change is applied as the system on the approver\'s rights, can be undone, and is not asked again while the cause lasts', async () => {
        const cases = oneOfEach();
        switchOn();
        await dailyLook.runForCompany(CID, WEDNESDAY);
        const ask = filed().find((row) => row.finding.rule === RULE.STALE);
        const out = await proposals.approve(CID, ask._id, { decider: { kind: 'human', userId: OWNER }, isPrivileged: true, ip: '' });
        await settle();
        expect(out).toMatchObject({ proposal: { status: 'approved' }, applied: [{ action: 'task.comment', ok: true }], undoToken: String(ask._id) });
        const written = rows(SCHEMA_TYPE.COMMENTS).filter((row) => String(row.taskId || row.TaskId || '') === String(cases.quiet._id) || String(row.message || '').includes('5 working days'));
        expect(written).toHaveLength(1);
        expect(written[0]).toMatchObject({ actorType: 'agent', userId: OWNER });
        cases.quiet.updatedAt = day('2026-09-30');
        await dailyLook.runForCompany(CID, THURSDAY);
        expect(ofRule(stored(), RULE.STALE)).toMatchObject([{ status: findings.STATUS.HANDLED }]);
        expect(filed().filter((row) => row.finding.rule === RULE.STALE)).toHaveLength(1);
    });

    it('a member approves a date move, it is applied, and undo puts the dates back', async () => {
        const blocker = task({ DueDate: day('2026-10-12') });
        const waiting = task({ startDate: day('2026-10-09'), DueDate: day('2026-10-14'), relations: waitsOn(blocker) });
        const now = () => rows(SCHEMA_TYPE.TASKS).find((row) => String(row._id) === String(waiting._id));
        switchOn();
        await dailyLook.runForCompany(CID, WEDNESDAY);
        const move = filed().find((row) => row.finding.rule === RULE.SLIPPING);
        const decider = { kind: 'human', userId: MEMBER };
        const out = await proposals.approve(CID, move._id, { decider, isPrivileged: false, ip: '' });
        await settle();
        expect(out.applied).toMatchObject([{ action: 'task.update', ok: true }]);
        expect(now()).toMatchObject({ startDate: day('2026-10-12'), DueDate: day('2026-10-17') });
        expect(await proposals.undoApproval(CID, move._id, { decider, isPrivileged: false, ip: '' })).toMatchObject({ proposal: { status: 'undone' } });
        await settle();
        expect(now()).toMatchObject({ startDate: day('2026-10-09'), DueDate: day('2026-10-14') });
        await dailyLook.runForCompany(CID, THURSDAY);
        expect(ofRule(stored(), RULE.SLIPPING)).toMatchObject([{ status: findings.STATUS.DECLINED }]);
    });

    it('asks no model, sends nothing outside and writes no email', () => {
        const dir = path.join(__dirname, '..', 'Modules', 'Agents', 'manager');
        const required = fs.readdirSync(dir).flatMap((file) => [...fs.readFileSync(path.join(dir, file), 'utf8').matchAll(/require\(['"]([^'"]+)['"]\)/g)].map((match) => match[1]));
        expect(required.length).toBeGreaterThan(5);
        expect(required.filter((name) => /AICore|\/AI\/|llm|langchain|openai|anthropic|axios|node-fetch|https?$|mail|smtp|slack|connectors/i.test(name))).toEqual([]);
    });
});

describe('who reads a finding', () => {
    const keysFor = async (uid) => (await findings.visibleTo(CID, uid, P_OPEN)).map((row) => `${row.rule}:${row.facts.taskKey}`).sort();

    const seedHidden = async () => {
        const hidden = task({ TaskKey: 'HID-1', sprintId: S_SECRET, sprintArray: { id: S_SECRET, name: 'Secret' }, AssigneeUserId: [], updatedAt: day('2026-09-01') });
        const hiddenBlocker = task({ TaskKey: 'HID-2', sprintId: S_SECRET, sprintArray: { id: S_SECRET, name: 'Secret' }, DueDate: day('2026-10-20') });
        task({ TaskKey: 'OPN-WAIT', startDate: day('2026-10-09'), relations: waitsOn(hiddenBlocker) });
        task({ TaskKey: 'OPN-ORPHAN', AssigneeUserId: [] });
        switchOn();
        await dailyLook.runForCompany(CID, WEDNESDAY);
        return hidden;
    };

    it('an owner and a person on the private list read all of them', async () => {
        await seedHidden();
        const all = ['no_owner:HID-1', 'no_owner:OPN-ORPHAN', 'slipping:OPN-WAIT', 'stale:HID-1'];
        expect(await keysFor(OWNER)).toEqual(all);
        expect(await keysFor(OTHER)).toEqual(all);
    });

    it('a member outside the private list reads none that names a task in it, and no count gives them away', async () => {
        await seedHidden();
        expect(await keysFor(MEMBER)).toEqual(['no_owner:OPN-ORPHAN']);
        const res = { statusCode: 200, status(code) { this.statusCode = code; return this; }, json(sent) { this.body = sent; return this; } };
        await controller.getProjectManager({ uid: MEMBER, method: 'GET', headers: { companyid: CID }, params: { projectId: P_OPEN } }, res);
        expect(res.body.data.findings).toHaveLength(1);
        expect(JSON.stringify(res.body)).not.toMatch(/HID-|Secret/);
        expect(Object.keys(res.body.data).sort()).toEqual(['canEdit', 'findings', 'level', 'on']);
    });

    it('a guest reads none', async () => {
        await seedHidden();
        expect(await keysFor(GUEST)).toEqual([]);
    });

    it('a proposal about a task in the private list stays out of the queue of a member outside it', async () => {
        const hidden = await seedHidden();
        const ask = filed().find((row) => row.finding.rule === RULE.STALE);
        expect(ask.taskId).toBe(String(hidden._id));
        expect((await approvalQueue.readQueue(CID, MEMBER)).map((row) => row.proposalId)).not.toContain(String(ask._id));
        expect((await approvalQueue.readQueue(CID, OTHER)).map((row) => row.proposalId)).toContain(String(ask._id));
    });

    it('a ready change is offered for decision only to a person who could make it', async () => {
        task({ TaskKey: 'OPN-QUIET', updatedAt: day('2026-09-30') });
        switchOn();
        await dailyLook.runForCompany(CID, WEDNESDAY);
        const rowFor = async (uid) => (await approvalQueue.readQueue(CID, uid)).find((row) => row.finding && row.finding.rule === RULE.STALE);
        expect(await rowFor(MEMBER)).toMatchObject({ locked: false, editable: true, source: proposals.SOURCE_SYSTEM, finding: { rule: RULE.STALE, projectName: 'Open' } });
        expect((await findings.visibleTo(CID, MEMBER, P_OPEN))[0]).toMatchObject({ rule: RULE.STALE, canDecide: true, proposalId: expect.any(String) });
        permissionRules.setRule(null, 'task_comment', false);
        expect(await rowFor(MEMBER)).toMatchObject({ locked: true });
        expect(await rowFor(OWNER)).toMatchObject({ locked: false });
        const [seen] = await findings.visibleTo(CID, MEMBER, P_OPEN);
        expect(seen).toMatchObject({ rule: RULE.STALE, canDecide: false });
        expect(seen.proposalId).toBeUndefined();
    });
});

describe('who may turn the project manager on', () => {
    const request = (uid, body, extra = {}) => ({
        uid, method: 'PUT', originalUrl: `/api/v2/agents/project-manager/${P_OPEN}`, url: `/api/v2/agents/project-manager/${P_OPEN}`,
        headers: { companyid: CID }, params: { projectId: P_OPEN }, body, ip: '1.1.1.1', ...extra,
    });
    const through = async (handlers, req) => {
        const res = { statusCode: 200, status(code) { this.statusCode = code; return this; }, json(sent) { this.body = sent; return this; }, send(sent) { this.body = sent; return this; }, on() {} };
        for (const handler of [].concat(handlers)) {
            let passed = false;
            // eslint-disable-next-line no-await-in-loop
            await handler(req, res, () => { passed = true; });
            if (!passed) break;
        }
        await settle();
        return { code: res.statusCode, body: res.body };
    };
    const put = (uid, body, extra) => through(controller.putProjectManager, request(uid, body, extra));
    const get = (uid, extra) => through(controller.getProjectManager, { ...request(uid, undefined, extra), method: 'GET' });
    const changes = () => rows(SCHEMA_TYPE.AUDIT_LOGS).filter((row) => row.action === 'agent.project_policy_changed');

    it.each([['an owner', OWNER], ['an admin', ADMIN]])('%s turns it on for one project, and the change is recorded and announced', async (_who, uid) => {
        const out = await put(uid, { on: true });
        expect(out).toMatchObject({ code: 200, body: { status: true, data: { on: true, level: 'suggest', canEdit: true } } });
        expect(project(P_OPEN).agentManager).toMatchObject({ on: true, updatedBy: uid });
        expect(project(P_DEST).agentManager).toBeUndefined();
        expect(changes()).toMatchObject([{ actorId: uid, entityType: 'project', entityId: P_OPEN, meta: { from: { manager: false }, to: { manager: true } } }]);
        expect(socketEmitter.emit).toHaveBeenCalledWith('update', expect.objectContaining({ module: 'project', companyId: CID, updatedFields: { agentManager: expect.objectContaining({ on: true }) } }));
        expect(await put(uid, { on: false })).toMatchObject({ code: 200, body: { data: { on: false } } });
        expect(project(P_OPEN).agentManager).toMatchObject({ on: false });
    });

    it.each([['a member', MEMBER], ['a guest', GUEST]])('%s is refused', async (_who, uid) => {
        expect(await put(uid, { on: true })).toMatchObject({ code: 403, body: { status: false } });
        expect(project(P_OPEN).agentManager).toBeUndefined();
        expect(changes()).toHaveLength(0);
    });

    it('a member reads it without being offered the switch', async () => {
        expect(await get(MEMBER)).toMatchObject({ code: 200, body: { data: { on: false, level: 'suggest', canEdit: false, findings: [] } } });
    });

    it('an API token is refused, whoever holds it', async () => {
        expect(await put(OWNER, { on: true }, { apiToken: { _id: TOKEN, userId: OWNER, name: 'Script' } })).toMatchObject({ code: 403, body: { status: false } });
        expect(project(P_OPEN).agentManager).toBeUndefined();
    });

    it('an agent\'s token is refused, whoever holds it, and the attempt is recorded', async () => {
        const out = await put(OWNER, { on: true }, { apiToken: { _id: TOKEN, kind: 'agent', userId: OWNER, name: 'CLI' } });
        expect(out).toMatchObject({ code: 403, body: { status: false } });
        expect(project(P_OPEN).agentManager).toBeUndefined();
        expect(rows(SCHEMA_TYPE.AUDIT_LOGS).filter((row) => row.action === 'agent.action_refused' && row.meta.action === 'project.agent_manager.edit')).toHaveLength(1);
    });

    it('refuses a value that is not on or off, a project of another kind and one the caller cannot open', async () => {
        expect(await put(OWNER, { on: 'yes' })).toMatchObject({ code: 400 });
        expect(await put(OWNER, {})).toMatchObject({ code: 400 });
        expect(await through(controller.putProjectManager, { ...request(OWNER, { on: true }), params: { projectId: 'nope' } })).toMatchObject({ code: 400 });
        expect(await through(controller.putProjectManager, { ...request(OWNER, { on: true }), params: { projectId: '6f0000000000000000000dff' } })).toMatchObject({ code: 404 });
        expect(await get(GUEST, { params: { projectId: world.P_PRIVATE } })).toMatchObject({ code: 404 });
        expect(project(P_OPEN).agentManager).toBeUndefined();
    });

    it('turning it on looks at the project at once on a working day', async () => {
        task({ AssigneeUserId: [] });
        jest.useFakeTimers({ now: WEDNESDAY, doNotFake: ['setImmediate', 'nextTick', 'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'queueMicrotask'] });
        try {
            const out = await put(OWNER, { on: true });
            expect(out.body.data.findings).toMatchObject([{ rule: RULE.NO_OWNER }]);
        } finally {
            jest.useRealTimers();
        }
    });
});
