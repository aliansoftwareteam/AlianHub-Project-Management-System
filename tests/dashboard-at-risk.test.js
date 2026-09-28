const mockDb = require('./fixtures/fakeMongo').create();

jest.mock('../utils/mongo-handler/mongoQueries', () => ({ MongoDbCrudOpration: (...a) => mockDb.crud(...a) }));
jest.mock('../Config/loggerConfig', () => ({ info: jest.fn(), error: jest.fn(), warn: jest.fn(), debug: jest.fn() }));
jest.mock('../Modules/Tasks/helpers/taskQueryGuard', () => ({
    ...jest.requireActual('../Modules/Tasks/helpers/taskQueryGuard'),
    visibilityStage: jest.fn(async () => null),
}));

const fs = require('fs');
const path = require('path');
const { SCHEMA_TYPE } = require('../Config/schemaType');
const { visibilityStage, toObjectIds } = require('../Modules/Tasks/helpers/taskQueryGuard');
const atRisk = require('../Modules/UserDashboard/atRisk');

const C = '6f0000000000000000000c01';
const OTHER_COMPANY = '6f0000000000000000000c02';
const MEMBER = '6f0000000000000000000a03';
const P = '6f0000000000000000000701';
const HIDDEN_P = '6f0000000000000000000702';
const NOW = new Date('2026-09-30T10:00:00.000Z').getTime();
const at = (iso) => new Date(iso);

describe('riskReasons', () => {
    const window = atRisk.riskWindow({ now: NOW });
    const task = (over) => ({ statusType: 'active', status: { text: 'In Progress', type: 'active' }, ...over });

    it('calls a task late once its due day has passed, with the days late', () => {
        expect(atRisk.riskReasons(task({ DueDate: at('2026-09-27T09:00:00.000Z') }), window)).toEqual({ reasons: ['overdue'], daysLate: 3 });
    });

    it('calls a task due within two days that has not started stalled', () => {
        const notStarted = task({ statusType: 'default_active', status: { text: 'To Do', type: 'default_active' }, DueDate: at('2026-10-01T09:00:00.000Z') });
        expect(atRisk.riskReasons(notStarted, window).reasons).toEqual(['stalled']);
    });

    it('leaves a task due soon that is already moving alone', () => {
        expect(atRisk.riskReasons(task({ DueDate: at('2026-10-01T09:00:00.000Z') }), window).reasons).toEqual([]);
    });

    it('reads blocked from the status name or a blocked-by link', () => {
        expect(atRisk.riskReasons(task({ status: { text: 'Blocked by vendor', type: 'active' } }), window).reasons).toEqual(['blocked']);
        expect(atRisk.riskReasons(task({ relations: [{ type: 'blocked_by', taskId: 'x' }] }), window).reasons).toEqual(['blocked']);
    });

    it('never flags closed work', () => {
        expect(atRisk.riskReasons(task({ statusType: 'close', DueDate: at('2026-09-01T09:00:00.000Z') }), window).reasons).toEqual([]);
    });
});

describe('POST /api/v1/dashboard/at-risk', () => {
    const resOf = () => { const r = { code: 200, body: null }; r.status = (c) => { r.code = c; return r; }; r.json = (b) => { r.body = b; return r; }; return r; };
    const call = async (over = {}) => { const r = resOf(); await atRisk.getAtRisk({ headers: { companyid: C }, body: {}, uid: MEMBER, ...over }, r); return r; };
    const seedTask = (over) => mockDb.seed(SCHEMA_TYPE.TASKS, { ProjectID: P, sprintId: 's1', statusType: 'active', status: { text: 'In Progress', type: 'active' }, deletedStatusKey: 0, ...over });

    beforeEach(() => {
        Object.keys(mockDb.store).forEach((k) => { mockDb.store[k].length = 0; });
        mockDb.calls.length = 0;
        jest.clearAllMocks();
        jest.spyOn(Date, 'now').mockReturnValue(NOW);
        visibilityStage.mockResolvedValue(null);
        mockDb.seed(SCHEMA_TYPE.PROJECTS, { _id: P, ProjectName: 'Website' });
        mockDb.seed(SCHEMA_TYPE.PROJECTS, { _id: HIDDEN_P, ProjectName: 'Board only' });
        seedTask({ _id: 'late', TaskName: 'Late one', DueDate: at('2026-09-25T09:00:00.000Z') });
        seedTask({ _id: 'stuck', TaskName: 'Stuck one', status: { text: 'Blocked', type: 'active' } });
        seedTask({ _id: 'idle', TaskName: 'Not started', statusType: 'default_active', status: { text: 'To Do', type: 'default_active' }, DueDate: at('2026-10-01T09:00:00.000Z') });
        seedTask({ _id: 'fine', TaskName: 'On track', DueDate: at('2026-10-20T09:00:00.000Z') });
        seedTask({ _id: 'done', TaskName: 'Finished late', statusType: 'close', DueDate: at('2026-09-01T09:00:00.000Z') });
        seedTask({ _id: 'trash', TaskName: 'Deleted late', DueDate: at('2026-09-01T09:00:00.000Z'), deletedStatusKey: 1 });
        seedTask({ _id: 'chat', TaskName: 'Chat thread', DueDate: at('2026-09-01T09:00:00.000Z'), mainChat: true });
        seedTask({ _id: 'secret', TaskName: 'Board secret', ProjectID: HIDDEN_P, DueDate: at('2026-09-02T09:00:00.000Z') });
    });
    afterEach(() => jest.restoreAllMocks());

    it('is registered with the other dashboard cards', () => {
        const routes = fs.readFileSync(path.join(__dirname, '..', 'Modules', 'UserDashboard', 'routes.js'), 'utf8');
        expect(routes).toContain("app.post('/api/v1/dashboard/at-risk', atRisk.getAtRisk)");
    });

    it('needs a company and a session', async () => {
        expect((await call({ headers: {} })).code).toBe(400);
        expect((await call({ uid: undefined })).code).toBe(401);
    });

    it('lists late, blocked and stalled work for an owner or admin across the company', async () => {
        const r = await call();
        expect(r.body.status).toBe(true);
        const ids = r.body.data.tasks.map((t) => t.taskId);
        expect(ids).toEqual(['secret', 'late', 'stuck', 'idle']);
        expect(r.body.data.counts).toEqual({ overdue: 2, blocked: 1, stalled: 1, total: 4 });
        expect(r.body.data.tasks[1]).toMatchObject({ taskName: 'Late one', projectName: 'Website', reasons: ['overdue'], daysLate: 5 });
    });

    it('shows a member only the projects they can open', async () => {
        visibilityStage.mockResolvedValue({ $match: { ProjectID: { $in: toObjectIds([P]) } } });
        const r = await call();
        expect(visibilityStage).toHaveBeenCalledWith(C, MEMBER);
        expect(JSON.stringify(r.body.data)).not.toContain('Board secret');
        expect(r.body.data.counts.total).toBe(3);
    });

    it('reads only the company in the header', async () => {
        await call();
        expect(mockDb.calls.every((c) => c.companyId === C)).toBe(true);
        expect(mockDb.calls.some((c) => c.companyId === OTHER_COMPANY)).toBe(false);
    });
});
