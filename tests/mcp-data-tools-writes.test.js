process.env.MCP_TOOLS_DATA = 'on';
const mockDb = require('./fixtures/fakeMongo').create();

jest.mock('../utils/mongo-handler/mongoQueries', () => ({ MongoDbCrudOpration: (...a) => mockDb.crud(...a) }));
jest.mock('../Modules/Audit/recorder', () => ({ recordAudit: jest.fn() }));
jest.mock('../event/socketEventEmitter', () => ({ emit: jest.fn() }));
jest.mock('../Config/loggerConfig', () => ({ error: jest.fn(), info: jest.fn(), warn: jest.fn(), debug: jest.fn() }));
jest.mock('../Modules/Knowledge/ingest/events', () => ({ publishCommentChanged: jest.fn(), publish: jest.fn() }));
jest.mock('../Modules/Agents/permissions', () => ({ holderMay: jest.fn(async () => ({ allowed: true, reason: '' })) }));
jest.mock('../Modules/Tasks/helpers/completionStore', () => ({ recordWork: jest.fn(async () => null), forStatusChange: jest.fn(async () => null) }));
jest.mock('../Modules/Agents/agentAudit', () => ({
    openAction: jest.fn(async () => 'audit-1'),
    applyAction: jest.fn(async () => null),
    failAction: jest.fn(async () => null),
    recordRefusal: jest.fn(async () => 'ref-1'),
}));

const { SCHEMA_TYPE } = require('../Config/schemaType');
const actions = require('../Modules/Agents/actions');
const { inverses } = require('../Modules/Agents/undo');

const C = '6f0000000000000000000c01';
const ME = '6f0000000000000000000001';
const SOMEONE = '6f0000000000000000000002';
const P_A = '6f0000000000000000000a01';

const actor = { kind: 'agent', userId: ME, agentId: null, viaAccount: 'personal', personName: 'Mia' };
const rows = (type) => mockDb.store[type] || [];

let task;

beforeEach(() => {
    Object.keys(mockDb.store).forEach((k) => { mockDb.store[k].length = 0; });
    jest.clearAllMocks();
    process.env.MCP_TOOLS_DATA = 'on';
    task = mockDb.seed(SCHEMA_TYPE.TASKS, { TaskKey: 'A-1', TaskName: 'Ship it', CompanyId: C, ProjectID: P_A, sprintId: '6f00000000000000000000b1', deletedStatusKey: 0 });
});

const perform = (action, params) => actions.perform({ companyId: C, actor, action, params, reason: `${action} via MCP` });

describe('comment.create stores text through the web path\'s escaping', () => {
    it('escapes markup the way the comments route does', async () => {
        const out = await perform('comment.create', { taskId: task._id, body: '<img src=x onerror=alert(1)> & "quotes"' });
        const [saved] = rows(SCHEMA_TYPE.COMMENTS);
        expect(saved.message).toBe('&lt;img src=x onerror=alert(1)&gt; &amp; &quot;quotes&quot;');
        expect(saved).toMatchObject({ userId: ME, project: false, isDeleted: false });
        expect([String(saved.taskId), String(saved.projectId)]).toEqual([task._id, P_A]);
        expect(out).toMatchObject({ auditId: 'audit-1', result: { commentId: String(saved._id) }, undo: { kind: 'comment', commentId: String(saved._id), taskId: task._id } });
    });

    it('leaves plain text exactly as written, as the web app sends it', async () => {
        await perform('comment.create', { taskId: task._id, body: 'Tom & Jerry said "hi"' });
        expect(rows(SCHEMA_TYPE.COMMENTS)[0].message).toBe('Tom & Jerry said "hi"');
    });

    it('refuses an empty comment', async () => {
        await expect(perform('comment.create', { taskId: task._id, body: '   ' })).rejects.toMatchObject({ deterministic: true });
        expect(rows(SCHEMA_TYPE.COMMENTS)).toHaveLength(0);
    });
});

describe('timelog.create writes one entry for the person behind the agent', () => {
    it('logs the minutes on the task\'s project, attributed to the agent, and undo removes it', async () => {
        const out = await perform('timelog.create', { taskId: task._id, minutes: 90, date: '2026-09-01', startTime: '10:30', description: 'Review', billable: false });
        const [entry] = rows(SCHEMA_TYPE.TIMESHEET);
        expect(entry).toMatchObject({
            Loggeduser: ME, TicketID: task._id, ProjectId: P_A, LogTimeDuration: 90, LogDescription: 'Review', logAddType: 0, billable: false,
            LogStartTime: Date.parse('2026-09-01T10:30:00Z') / 1000, LogEndTime: Date.parse('2026-09-01T12:00:00Z') / 1000, actorType: 'agent',
        });
        expect(out.undo).toEqual({ kind: 'timelog.create', timesheetId: String(entry._id), taskId: task._id });
        await inverses[out.undo.kind](C, out.undo);
        expect(rows(SCHEMA_TYPE.TIMESHEET)).toHaveLength(0);
    });

    it('defaults to today at 09:00 UTC with a description naming the task', async () => {
        await perform('timelog.create', { taskId: task._id, minutes: 15 });
        const [entry] = rows(SCHEMA_TYPE.TIMESHEET);
        const today = new Date().toISOString().slice(0, 10);
        expect(entry.LogStartTime).toBe(Date.parse(`${today}T09:00:00Z`) / 1000);
        expect(entry.LogDescription).toMatch(/A-1/);
        expect(entry.billable).toBe(true);
    });

    it.each([
        [{ minutes: 0 }], [{ minutes: 1441 }], [{ minutes: 'lots' }], [{ minutes: 10, date: '2026-13-01' }],
        [{ minutes: 10, date: '2999-01-01' }], [{ minutes: 10, startTime: '25:00' }],
    ])('refuses %o without writing', async (bad) => {
        await expect(perform('timelog.create', { taskId: task._id, ...bad })).rejects.toMatchObject({ deterministic: true });
        expect(rows(SCHEMA_TYPE.TIMESHEET)).toHaveLength(0);
    });

    it('refuses a day inside an approved, locked timesheet period', async () => {
        mockDb.seed(SCHEMA_TYPE.TIMESHEET_APPROVAL, {
            userId: ME, status: 'approved', deletedStatusKey: 0, periodStart: new Date(2026, 7, 31), periodEnd: new Date(2026, 8, 6),
        });
        await expect(perform('timelog.create', { taskId: task._id, minutes: 10, date: '2026-09-02' })).rejects.toMatchObject({ deterministic: true, message: expect.stringMatching(/approved/) });
        expect(rows(SCHEMA_TYPE.TIMESHEET)).toHaveLength(0);
    });

    it('needs a person to log against', async () => {
        await expect(actions.perform({ companyId: C, actor: { kind: 'agent', agentId: 'a1' }, action: 'timelog.create', params: { taskId: task._id, minutes: 5 } }))
            .rejects.toBeTruthy();
        expect(rows(SCHEMA_TYPE.TIMESHEET).filter((e) => e.Loggeduser === SOMEONE)).toHaveLength(0);
        expect(rows(SCHEMA_TYPE.TIMESHEET)).toHaveLength(0);
    });
});
