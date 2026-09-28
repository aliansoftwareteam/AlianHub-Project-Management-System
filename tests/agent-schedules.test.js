process.env.STORAGE_TYPE = 'server';

const mockStores = { a: require('./fixtures/fakeMongo').create(), b: require('./fixtures/fakeMongo').create() };
const mockState = { companyB: '', roles: {}, visible: {}, aiOff: false, sent: [] };

jest.mock('../utils/mongo-handler/mongoQueries', () => ({
    MongoDbCrudOpration: (companyId, ...rest) => (String(companyId) === mockState.companyB ? mockStores.b : mockStores.a).crud(companyId, ...rest),
}));
jest.mock('../event/socketEventEmitter', () => ({ emit: jest.fn() }));
jest.mock('../Config/loggerConfig', () => ({ info: jest.fn(), error: jest.fn(), warn: jest.fn(), debug: jest.fn() }));
jest.mock('../Config/permissionGuard', () => ({
    getRoleType: jest.fn(async (companyId, uid) => (uid in mockState.roles ? mockState.roles[uid] : null)),
    isPrivileged: (r) => r === 1 || r === 2,
    evaluatePermission: jest.fn(async () => 1),
    isWritable: () => true,
    isReadable: () => true,
    ROLE_OWNER: 1,
    ROLE_ADMIN: 2,
}));
jest.mock('../Modules/Agents/scope', () => ({
    visibleProjectIds: jest.fn(async (companyId, uid) => mockState.visible[uid] || []),
    visibleProjects: jest.fn(async (companyId, uid) => (mockState.visible[uid] || []).map((_id) => ({ _id }))),
}));
jest.mock('../Modules/Sprints/helpers/sprintVisibility', () => ({
    hiddenSprintIds: jest.fn(async () => []),
    hiddenSprintFilter: jest.fn(async () => ({})),
    canSeeSprintById: jest.fn(async () => true),
}));
jest.mock('../Modules/Agents/actor', () => ({
    ...jest.requireActual('../Modules/Agents/actor'),
    resolveActor: jest.fn(async (req) => ({ kind: 'human', userId: String(req.uid || '') })),
}));
jest.mock('../Modules/AICore/aiSwitch', () => {
    const offError = () => Object.assign(new Error('AI is turned off for this workspace.'), { code: 'ai_off' });
    return {
        AI_OFF: 'ai_off',
        allowed: jest.fn(async () => !mockState.aiOff),
        assertAllowed: jest.fn(async () => { if (mockState.aiOff) throw offError(); }),
        isAiOff: (e) => Boolean(e && e.code === 'ai_off'),
    };
});
jest.mock('../Modules/AICore/usage', () => ({
    ...jest.requireActual('../Modules/AICore/usage'),
    checkConfiguredModelPriced: () => ({ ok: true, reason: '' }),
    summarize: jest.fn(() => ({ costUsd: 0.002, totalTokens: 15, model: 'm', priced: true })),
}));
jest.mock('../Modules/AICore/modelCall', () => ({
    askModel: jest.fn(async () => ({ raw: { summary: 'Two things need you today.' }, model: 'm', usage: { inputTokens: 10, outputTokens: 5 }, degraded: null, refused: null })),
    parseModelJson: jest.fn(),
}));
jest.mock('../Modules/Agents/actions', () => ({
    ...jest.requireActual('../Modules/Agents/actions'),
    perform: jest.fn(async () => ({ result: { commentId: 'c1' }, auditId: 'audit1', undo: null })),
}));
jest.mock('../Modules/notification-count/controller', () => ({ updateUnReadCommentsCountFun: jest.fn(async () => ({})) }));
jest.mock('../Modules/service', () => ({ SendEmail: jest.fn((subject, body, to, isHtml, cb) => { mockState.sent.push({ subject, body, to, isHtml }); cb({ status: true }); }) }));
jest.mock('../Modules/Audit/recorder', () => ({ recordAudit: jest.fn(async () => null) }));

const config = require('../Config/config');
const { SCHEMA_TYPE } = require('../Config/schemaType');
const { dbCollections } = require('../Config/collections');
const runs = require('../Modules/Agents/runs');
const actions = require('../Modules/Agents/actions');
const { askModel } = require('../Modules/AICore/modelCall');
const slots = require('../Modules/Agents/schedules/slots');
const scheduler = require('../Modules/Agents/schedules/scheduler');
const ctrl = require('../Modules/Agents/schedulesController');
const agentsCtrl = require('../Modules/Agents/controller');

const A = '6f0000000000000000000c01';
const B = '6f0000000000000000000c02';
const ADMIN = '6f0000000000000000000d01';
const MEMBER = '6f0000000000000000000d02';
const OUTSIDER = '6f0000000000000000000d03';
const OPEN_PROJECT = '6f00000000000000000000a1';
const HIDDEN_PROJECT = '6f00000000000000000000a2';
const AGENT = '6f0000000000000000000a01';
const T_OPEN = '6f0000000000000000000701';
const T_HIDDEN = '6f0000000000000000000702';

// Monday 28 September 2026, 09:10 UTC — 14:40 in Kolkata.
const NOW = new Date('2026-09-28T09:10:00.000Z');
const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;

const store = () => mockStores.a;
const rows = (type, db = store()) => db.store[type] || [];
const reportRuns = (db = store()) => rows(SCHEMA_TYPE.AGENT_RUNS, db).filter((r) => r.kind === 'report');

const seedAgent = (over = {}, db = store()) => db.seed(SCHEMA_TYPE.AGENTS, {
    _id: AGENT, name: 'Briefer', autonomy: 3, allowedActions: [], account: 'workspace', spendCapUsd: 10, paused: false, deletedStatusKey: 0, projectIds: [], ownerId: MEMBER, skills: [], ...over,
});

// 09:00 UTC daily unless overridden: 10 minutes before NOW.
const seedSchedule = (over = {}, db = store()) => db.seed(SCHEMA_TYPE.AGENT_SCHEDULES, {
    agentId: AGENT, ownerId: MEMBER, createdBy: ADMIN, report: 'daily_briefing', every: 'daily', at: '09:00', timezone: 'UTC',
    options: {}, deliver: { email: false }, enabled: true, since: new Date(NOW.getTime() - 3 * 24 * HOUR), nextRunAt: new Date(NOW.getTime() - 10 * MINUTE), deletedStatusKey: 0, ...over,
});

const seedTask = (id, projectId, over = {}, db = store()) => db.seed(SCHEMA_TYPE.TASKS, {
    _id: id, ProjectID: projectId, TaskName: `Task ${id.slice(-3)}`, TaskKey: `T-${id.slice(-3)}`, AssigneeUserId: [MEMBER],
    statusType: 'active', status: { text: 'In progress' }, DueDate: new Date('2026-09-28T12:00:00.000Z'), deletedStatusKey: 0, createdAt: new Date('2026-09-27T10:00:00.000Z'), ...over,
});

const res = () => {
    const r = { code: 200, body: null };
    r.status = (c) => { r.code = c; return r; };
    r.send = (b) => { r.body = b; return r; };
    r.json = (b) => { r.body = b; return r; };
    return r;
};
const call = async (handler, { uid = ADMIN, companyId = A, params = {}, body = {}, query = {} } = {}) => {
    const r = res();
    await handler({ headers: { companyid: companyId }, uid, params, body, query }, r);
    return r;
};

const reportText = (run) => JSON.stringify(run.report || {});

beforeAll(() => require('../Modules/AICore/persistence').useInMemory());

beforeEach(() => {
    Object.values(mockStores).forEach((db) => Object.keys(db.store).forEach((k) => { db.store[k].length = 0; }));
    jest.clearAllMocks();
    mockState.companyB = B;
    mockState.roles = { [ADMIN]: 1, [MEMBER]: 3 };
    mockState.visible = { [MEMBER]: [OPEN_PROJECT] };
    mockState.aiOff = false;
    mockState.sent = [];
});

describe('schedule slots', () => {
    it('finds the latest daily slot in the schedule\'s own time zone', () => {
        const s = { every: 'daily', at: '14:30', timezone: 'Asia/Kolkata' };
        expect(slots.latestSlot(s, NOW).toISOString()).toBe('2026-09-28T09:00:00.000Z');
        expect(slots.nextSlot(s, NOW).toISOString()).toBe('2026-09-29T09:00:00.000Z');
    });

    it('skips the weekend for a weekdays schedule', () => {
        const s = { every: 'weekdays', at: '08:00', timezone: 'UTC' };
        expect(slots.latestSlot(s, new Date('2026-09-27T12:00:00.000Z')).toISOString()).toBe('2026-09-25T08:00:00.000Z');
        expect(slots.nextSlot(s, new Date('2026-09-26T12:00:00.000Z')).toISOString()).toBe('2026-09-28T08:00:00.000Z');
    });

    it('fires a weekly schedule on its weekday only', () => {
        const s = { every: 'weekly', weekday: 5, at: '16:00', timezone: 'UTC' };
        expect(slots.latestSlot(s, NOW).toISOString()).toBe('2026-09-25T16:00:00.000Z');
        expect(slots.nextSlot(s, NOW).toISOString()).toBe('2026-10-02T16:00:00.000Z');
    });

    it('refuses a time zone it cannot read', () => {
        expect(slots.isValidZone('Mars/Olympus')).toBe(false);
        expect(slots.isValidZone('Europe/Berlin')).toBe(true);
    });
});

describe('a due schedule', () => {
    it('fires once per slot, however often the scheduler ticks', async () => {
        seedAgent();
        seedSchedule();
        seedTask(T_OPEN, OPEN_PROJECT);
        await scheduler.tickCompany(A, { now: NOW });
        await scheduler.tickCompany(A, { now: new Date(NOW.getTime() + MINUTE) });
        await scheduler.tickCompany(A, { now: new Date(NOW.getTime() + 20 * MINUTE) });
        const made = reportRuns();
        expect(made).toHaveLength(1);
        expect(made[0]).toMatchObject({ trigger: 'schedule', kind: 'report', startedBy: MEMBER, taskId: null, status: 'done' });
        const schedule = rows(SCHEMA_TYPE.AGENT_SCHEDULES)[0];
        expect(new Date(schedule.lastSlotAt).toISOString()).toBe('2026-09-28T09:00:00.000Z');
        expect(schedule.lastResult).toMatchObject({ status: 'done', runId: String(made[0]._id) });
        expect(new Date(schedule.nextRunAt).toISOString()).toBe('2026-09-29T09:00:00.000Z');
    });

    it('fires again at the next slot', async () => {
        seedAgent();
        seedSchedule();
        await scheduler.tickCompany(A, { now: NOW });
        await scheduler.tickCompany(A, { now: new Date('2026-09-29T09:01:00.000Z') });
        expect(reportRuns()).toHaveLength(2);
    });

    it('does not fire before its slot or for a slot from before it was saved', async () => {
        seedAgent();
        seedSchedule({ since: new Date(NOW.getTime() - 5 * MINUTE) });
        await scheduler.tickCompany(A, { now: NOW });
        expect(reportRuns()).toHaveLength(0);
    });

    it('skips a slot missed by more than an hour instead of catching up', async () => {
        seedAgent();
        seedSchedule({ at: '07:00' });
        await scheduler.tickCompany(A, { now: NOW });
        expect(reportRuns()).toHaveLength(0);
        const schedule = rows(SCHEMA_TYPE.AGENT_SCHEDULES)[0];
        expect(schedule.lastResult).toMatchObject({ status: 'missed' });
        expect(new Date(schedule.nextRunAt).toISOString()).toBe('2026-09-29T07:00:00.000Z');
    });

    it('catches up a slot missed by less than an hour', async () => {
        seedAgent();
        seedSchedule({ at: '08:20' });
        await scheduler.tickCompany(A, { now: NOW });
        expect(reportRuns()).toHaveLength(1);
    });

    it('ignores a disabled or deleted schedule', async () => {
        seedAgent();
        seedSchedule({ enabled: false });
        seedSchedule({ deletedStatusKey: 1 });
        await scheduler.tickCompany(A, { now: NOW });
        expect(reportRuns()).toHaveLength(0);
    });
});

describe('the report reads only what the schedule owner can open', () => {
    it('leaves out a task in a project the owner cannot see', async () => {
        seedAgent();
        seedSchedule();
        seedTask(T_OPEN, OPEN_PROJECT, { TaskName: 'Visible launch checklist' });
        seedTask(T_HIDDEN, HIDDEN_PROJECT, { TaskName: 'Secret board merger' });
        await scheduler.tickCompany(A, { now: NOW });
        const [run] = reportRuns();
        expect(reportText(run)).toContain('Visible launch checklist');
        expect(reportText(run)).not.toContain('Secret board merger');
        const prompt = askModel.mock.calls[0][1].prompt;
        expect(prompt).toContain('Visible launch checklist');
        expect(prompt).not.toContain('Secret board merger');
    });

    it('reads every project for an owner who is an admin', async () => {
        seedAgent();
        seedSchedule({ ownerId: ADMIN, report: 'deadline_watch', options: { days: 3 } });
        seedTask(T_OPEN, OPEN_PROJECT, { TaskName: 'Visible launch checklist' });
        seedTask(T_HIDDEN, HIDDEN_PROJECT, { TaskName: 'Secret board merger' });
        await scheduler.tickCompany(A, { now: NOW });
        expect(reportText(reportRuns()[0])).toContain('Secret board merger');
    });

    it('keeps inside the agent\'s project scope as well', async () => {
        seedAgent({ projectIds: [HIDDEN_PROJECT] });
        seedSchedule({ ownerId: ADMIN, report: 'deadline_watch' });
        seedTask(T_OPEN, OPEN_PROJECT, { TaskName: 'Visible launch checklist' });
        seedTask(T_HIDDEN, HIDDEN_PROJECT, { TaskName: 'Secret board merger' });
        await scheduler.tickCompany(A, { now: NOW });
        expect(reportText(reportRuns()[0])).not.toContain('Visible launch checklist');
    });

    it('lists only unanswered mentions on tasks the owner can open', async () => {
        seedAgent();
        seedSchedule({ report: 'mentions_digest' });
        seedTask(T_OPEN, OPEN_PROJECT, { TaskName: 'Visible launch checklist' });
        seedTask(T_HIDDEN, HIDDEN_PROJECT, { TaskName: 'Secret board merger' });
        const T_REPLIED = '6f0000000000000000000703';
        seedTask(T_REPLIED, OPEN_PROJECT, { TaskName: 'Already answered' });
        const at = new Date('2026-09-27T10:00:00.000Z');
        [T_OPEN, T_HIDDEN, T_REPLIED].forEach((taskId) => store().seed(SCHEMA_TYPE.MENTIONS, { taskId, mentionIds: [MEMBER], userId: ADMIN, comment_message: `ping on ${taskId}`, createdAt: at }));
        store().seed(SCHEMA_TYPE.COMMENTS, { taskId: T_REPLIED, userId: MEMBER, createdAt: new Date(at.getTime() + HOUR) });
        await scheduler.tickCompany(A, { now: NOW });
        const [run] = reportRuns();
        const unanswered = run.report.sections.find((sec) => sec.key === 'unanswered');
        expect(unanswered.items.map((i) => i.taskName)).toEqual(['Visible launch checklist']);
    });

    it('sums the week per project the owner can open', async () => {
        seedAgent();
        seedSchedule({ report: 'weekly_status' });
        seedTask(T_OPEN, OPEN_PROJECT, { DueDate: new Date('2026-09-20T12:00:00.000Z'), updatedAt: new Date('2026-09-27T10:00:00.000Z') });
        seedTask('6f0000000000000000000704', OPEN_PROJECT, { statusType: 'close', updatedAt: new Date('2026-09-26T10:00:00.000Z') });
        seedTask(T_HIDDEN, HIDDEN_PROJECT, { statusType: 'close', updatedAt: new Date('2026-09-26T10:00:00.000Z') });
        await scheduler.tickCompany(A, { now: NOW });
        const projects = reportRuns()[0].report.sections;
        expect(projects).toHaveLength(1);
        expect(projects[0]).toMatchObject({ key: 'project', projectId: OPEN_PROJECT, counts: { done: 1, slipped: 1, blocked: 0 } });
    });

    it('does not run for an owner who is no longer allowed to own it', async () => {
        seedAgent({ ownerId: ADMIN });
        seedSchedule({ ownerId: MEMBER });
        await scheduler.tickCompany(A, { now: NOW });
        expect(reportRuns()).toHaveLength(0);
        expect(rows(SCHEMA_TYPE.AGENT_SCHEDULES)[0].lastResult).toMatchObject({ status: 'skipped' });
    });

    it('does not run for an owner who left the company', async () => {
        seedAgent({ ownerId: OUTSIDER });
        seedSchedule({ ownerId: OUTSIDER });
        await scheduler.tickCompany(A, { now: NOW });
        expect(reportRuns()).toHaveLength(0);
    });
});

describe('delivery', () => {
    it('puts the report in the owner\'s inbox and books the model spend on the run', async () => {
        seedAgent();
        seedSchedule();
        seedTask(T_OPEN, OPEN_PROJECT);
        await scheduler.tickCompany(A, { now: NOW });
        const [run] = reportRuns();
        // The global copy lands in the same fake store; it is the one carrying notificationId.
        const notices = rows(SCHEMA_TYPE.NOTIFICATIONS).filter((n) => n.changeType === 'agent_report' && !('notificationId' in n));
        expect(notices).toHaveLength(1);
        expect(notices[0]).toMatchObject({ receiverID: MEMBER, notSeen: [MEMBER], type: 'agent' });
        expect(notices[0].changeData).toMatchObject({ runId: String(run._id), report: 'daily_briefing', agentName: 'Briefer' });
        expect(run.report.summary).toBe('Two things need you today.');
        expect(run.spend).toMatchObject({ tokens: 15, usd: 0.002 });
        expect(askModel.mock.calls[0][1].spend).toMatchObject({ runId: String(run._id), companyId: A });
    });

    it('still delivers the facts when no model answers', async () => {
        askModel.mockResolvedValueOnce({ raw: null, model: null, usage: { inputTokens: 0, outputTokens: 0 }, degraded: 'no LLM provider configured', refused: null });
        seedAgent();
        seedSchedule();
        seedTask(T_OPEN, OPEN_PROJECT, { TaskName: 'Visible launch checklist' });
        await scheduler.tickCompany(A, { now: NOW });
        const [run] = reportRuns();
        expect(run.status).toBe('done');
        expect(reportText(run)).toContain('Visible launch checklist');
    });

    it('emails the owner only when asked and mail is configured', async () => {
        const saved = { host: config.NODEMAILER_HOST, email: config.NODEMAILER_EMAIL };
        config.NODEMAILER_HOST = 'smtp.example.test';
        config.NODEMAILER_EMAIL = 'bot@example.test';
        try {
            store().seed(dbCollections.USERS, { _id: MEMBER, Employee_Email: 'member@example.test' });
            seedAgent();
            seedSchedule({ deliver: { email: true } });
            await scheduler.tickCompany(A, { now: NOW });
            expect(mockState.sent).toHaveLength(1);
            expect(mockState.sent[0]).toMatchObject({ to: 'member@example.test', isHtml: false });
        } finally {
            config.NODEMAILER_HOST = saved.host;
            config.NODEMAILER_EMAIL = saved.email;
        }
    });

    it('is read-only by default: no comment is posted when the agent may not write', async () => {
        seedAgent({ allowedActions: [] });
        seedSchedule({ deliver: { taskId: T_OPEN } });
        seedTask(T_OPEN, OPEN_PROJECT);
        await scheduler.tickCompany(A, { now: NOW });
        expect(actions.perform).not.toHaveBeenCalled();
        expect(reportRuns()[0].report.delivered).toMatchObject({ inbox: true, comment: false });
    });

    it('posts the comment through the action layer as the owner when writes are allowed', async () => {
        seedAgent({ allowedActions: ['task.comment'] });
        seedSchedule({ deliver: { taskId: T_OPEN } });
        seedTask(T_OPEN, OPEN_PROJECT);
        await scheduler.tickCompany(A, { now: NOW });
        const [run] = reportRuns();
        expect(actions.perform).toHaveBeenCalledTimes(1);
        const args = actions.perform.mock.calls[0][0];
        expect(args).toMatchObject({ companyId: A, action: 'task.comment', params: { taskId: T_OPEN }, allowedActions: ['task.comment'] });
        expect(args.actor).toMatchObject({ kind: 'agent', userId: MEMBER, agentId: AGENT, runId: String(run._id) });
        expect(run.report.delivered.comment).toBe(true);
    });

    it('never posts on a task the owner cannot open', async () => {
        seedAgent({ allowedActions: ['task.comment'] });
        seedSchedule({ deliver: { taskId: T_HIDDEN } });
        seedTask(T_HIDDEN, HIDDEN_PROJECT);
        await scheduler.tickCompany(A, { now: NOW });
        expect(actions.perform).not.toHaveBeenCalled();
    });
});

describe('limits', () => {
    const skippedWith = () => rows(SCHEMA_TYPE.AGENT_SCHEDULES)[0].lastResult;

    it('respects the daily run limit', async () => {
        seedAgent({ rateLimitPerDay: 2 });
        seedSchedule();
        store().seed(SCHEMA_TYPE.AGENT_RUNS, { agentId: AGENT, status: 'done', startedAt: new Date() });
        store().seed(SCHEMA_TYPE.AGENT_RUNS, { agentId: AGENT, status: 'done', startedAt: new Date() });
        await scheduler.tickCompany(A, { now: NOW });
        expect(reportRuns()).toHaveLength(0);
        expect(skippedWith()).toMatchObject({ status: 'skipped' });
        expect(skippedWith().reason).toMatch(/Daily run limit/);
    });

    it('respects the agent spend cap', async () => {
        seedAgent({ spendCapUsd: 5, spendMonth: { month: runs.monthKey(), usd: 5 } });
        seedSchedule();
        await scheduler.tickCompany(A, { now: NOW });
        expect(reportRuns()).toHaveLength(0);
        expect(skippedWith().reason).toMatch(/Spend cap/);
    });

    it('stops while the agent is paused', async () => {
        seedAgent({ paused: true, pausedReason: 'manual' });
        seedSchedule();
        await scheduler.tickCompany(A, { now: NOW });
        expect(reportRuns()).toHaveLength(0);
        expect(skippedWith().reason).toMatch(/paused/);
    });

    it('stops after Pause all agents', async () => {
        seedAgent();
        seedSchedule();
        await runs.pauseAll(A, 'pause all');
        await scheduler.tickCompany(A, { now: NOW });
        expect(reportRuns()).toHaveLength(0);
    });

    it('does not run for an agent below L3', async () => {
        seedAgent({ autonomy: 2 });
        seedSchedule();
        await scheduler.tickCompany(A, { now: NOW });
        expect(reportRuns()).toHaveLength(0);
        expect(skippedWith().reason).toMatch(/L3/);
    });

    it('skips while AI is off, without calling the model', async () => {
        mockState.aiOff = true;
        seedAgent();
        seedSchedule();
        await scheduler.tickCompany(A, { now: NOW });
        expect(reportRuns()).toHaveLength(0);
        expect(askModel).not.toHaveBeenCalled();
        expect(skippedWith()).toMatchObject({ status: 'skipped', code: 'ai_off' });
    });
});

describe('company scoping', () => {
    it('ticks one company without touching another', async () => {
        seedAgent({}, mockStores.b);
        seedSchedule({}, mockStores.b);
        await scheduler.tickCompany(A, { now: NOW });
        expect(reportRuns(mockStores.b)).toHaveLength(0);
        await scheduler.tickCompany(B, { now: NOW });
        expect(reportRuns(mockStores.b)).toHaveLength(1);
        expect(reportRuns(mockStores.a)).toHaveLength(0);
    });

    it('does not let one company edit another company\'s schedule', async () => {
        seedAgent({}, mockStores.b);
        const schedule = seedSchedule({}, mockStores.b);
        const r = await call(ctrl.updateSchedule, { companyId: A, params: { id: AGENT, scheduleId: String(schedule._id) }, body: { enabled: false } });
        expect(r.code).toBe(404);
        expect(rows(SCHEMA_TYPE.AGENT_SCHEDULES, mockStores.b)[0].enabled).toBe(true);
    });
});

describe('the schedules API', () => {
    const valid = { report: 'daily_briefing', every: 'weekdays', at: '08:30', timezone: 'Europe/Berlin' };

    it('creates a schedule for an L3 agent with the caller as owner and the next run worked out', async () => {
        seedAgent();
        const r = await call(ctrl.createSchedule, { params: { id: AGENT }, body: valid });
        expect(r.code).toBe(200);
        expect(r.body.data).toMatchObject({ agentId: AGENT, ownerId: ADMIN, every: 'weekdays', at: '08:30', timezone: 'Europe/Berlin', enabled: true, deliver: { email: false } });
        expect(r.body.data.nextRunAt).toBeTruthy();
    });

    it('explains why an agent below L3 cannot have one', async () => {
        seedAgent({ autonomy: 2 });
        const r = await call(ctrl.createSchedule, { params: { id: AGENT }, body: valid });
        expect(r.code).toBe(409);
        expect(r.body.message).toMatch(/L3/);
    });

    it('rejects an unknown report, a bad time and an unreadable time zone', async () => {
        seedAgent();
        expect((await call(ctrl.createSchedule, { params: { id: AGENT }, body: { ...valid, report: 'shell' } })).code).toBe(400);
        expect((await call(ctrl.createSchedule, { params: { id: AGENT }, body: { ...valid, at: '25:00' } })).code).toBe(400);
        expect((await call(ctrl.createSchedule, { params: { id: AGENT }, body: { ...valid, timezone: 'Mars/Olympus' } })).code).toBe(400);
        expect((await call(ctrl.createSchedule, { params: { id: AGENT }, body: { ...valid, every: 'weekly' } })).code).toBe(400);
    });

    it('lets only an owner or admin, or the agent\'s owner, set the person the run reads as', async () => {
        seedAgent({ ownerId: ADMIN });
        const byMember = await call(ctrl.createSchedule, { uid: MEMBER, params: { id: AGENT }, body: valid });
        expect(byMember.code).toBe(403);
        const forMember = await call(ctrl.createSchedule, { params: { id: AGENT }, body: { ...valid, ownerId: MEMBER } });
        expect(forMember.code).toBe(400);
    });

    it('lets the agent\'s owner schedule it for themselves', async () => {
        seedAgent({ ownerId: MEMBER });
        const r = await call(ctrl.createSchedule, { uid: MEMBER, params: { id: AGENT }, body: valid });
        expect(r.code).toBe(200);
        expect(r.body.data.ownerId).toBe(MEMBER);
    });

    it('does not let the agent\'s owner make it run as an admin', async () => {
        seedAgent({ ownerId: MEMBER });
        const r = await call(ctrl.createSchedule, { uid: MEMBER, params: { id: AGENT }, body: { ...valid, ownerId: ADMIN } });
        expect(r.code).toBe(403);
        const own = seedSchedule({ ownerId: MEMBER });
        const moved = await call(ctrl.updateSchedule, { uid: MEMBER, params: { id: AGENT, scheduleId: String(own._id) }, body: { ownerId: ADMIN } });
        expect(moved.code).toBe(403);
    });

    it('lists a report only to the person it was delivered to', async () => {
        seedAgent();
        seedSchedule();
        seedTask(T_OPEN, OPEN_PROJECT);
        await scheduler.tickCompany(A, { now: NOW });
        const [run] = reportRuns();
        const mine = await call(ctrl.listReports, { uid: MEMBER });
        expect(mine.body.data.map((r) => String(r._id))).toEqual([String(run._id)]);
        const theirs = await call(ctrl.listReports, { uid: OUTSIDER });
        expect(theirs.body.data).toEqual([]);
        expect((await call(ctrl.getReport, { uid: OUTSIDER, params: { id: String(run._id) } })).code).toBe(404);
        expect((await call(ctrl.getReport, { uid: MEMBER, params: { id: String(run._id) } })).body.data.report.summary).toBe('Two things need you today.');
    });

    it('opens a report run in the run detail for its owner, and for nobody else below admin', async () => {
        mockState.roles[OUTSIDER] = 3;
        mockState.visible[OUTSIDER] = [OPEN_PROJECT];
        seedAgent();
        seedSchedule();
        await scheduler.tickCompany(A, { now: NOW });
        const [run] = reportRuns();
        expect((await call(agentsCtrl.getRun, { uid: MEMBER, params: { id: String(run._id) } })).code).toBe(200);
        expect((await call(agentsCtrl.getRun, { uid: OUTSIDER, params: { id: String(run._id) } })).code).toBe(404);
    });
});
