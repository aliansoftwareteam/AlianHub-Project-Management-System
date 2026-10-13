const crypto = require('node:crypto');
const { MongoClient, ObjectId } = require('mongodb');
const { resolveMongoUrl } = require('../../e2e/support/env');
const { loginAs, readState } = require('../../e2e/support/fixtures');

const state = readState();
const COMPANY_B = crypto.randomBytes(12).toString('hex');
const [TASK] = state.tasks;
const PROJECT = state.projects.shared;
const OWNER_ID = state.users.owner.userId;

let client;

const logBody = (session, overrides = {}) => ({
    logTimeDate: '2026-03-02',
    description: 'Tenant pin probe',
    startLogTime: '09:00',
    endLogTime: '10:00',
    timeDuration: '1:00',
    ticketId: TASK._id,
    projectId: PROJECT._id,
    companyId: COMPANY_B,
    userId: session.userId,
    isEdit: false,
    userName: 'Tenant pin probe',
    dateFormat: 'DD/MM/YYYY',
    taskName: 'E2E Task One',
    projectName: PROJECT.name,
    sprintId: TASK.sprintId,
    companyOwnerId: OWNER_ID,
    timeZone: 'UTC',
    ...overrides,
});

const deleteBody = (session, timeSheetId, overrides = {}) => ({
    ...logBody(session),
    timeSheetId,
    timeDuration: 60,
    ...overrides,
});

const trackerStartBody = (session, overrides = {}) => ({
    description: 'Tenant pin probe',
    userId: session.userId,
    projectId: PROJECT._id,
    taskId: TASK._id,
    companyId: COMPANY_B,
    ...overrides,
});

const foreignRows = async () => {
    const db = client.db(COMPANY_B);
    const names = (await db.listCollections().toArray()).map((c) => c.name);
    const counts = await Promise.all(names.map((name) => db.collection(name).countDocuments({})));
    return counts.reduce((sum, n) => sum + n, 0);
};

/* The exploit brought company B's database into existence, so its absence is the assertion
 * that matters — an empty-but-created database would mean the write reached Mongo. */
const foreignDatabaseExists = async () => {
    const { databases } = await client.db('admin').admin().listDatabases({ nameOnly: true });
    return databases.some((db) => db.name === COMPANY_B);
};

const ownTimesheets = () => client.db(state.companyId).collection('timesheets');

beforeAll(async () => {
    client = new MongoClient(resolveMongoUrl(), { serverSelectionTimeoutMS: 5000 });
    await client.connect();
});

afterAll(async () => {
    if (!client) return;
    await client.db(COMPANY_B).dropDatabase();
    await client.close();
});

describe('the LogTime v2 routes take the company from the companyid header', () => {
    it.each([
        ['POST /api/v2/manualLogtime', (session) => session.api.post('/api/v2/manualLogtime', logBody(session))],
        ['POST /api/v2/deleteManualLogtime', (session) => session.api.post('/api/v2/deleteManualLogtime', deleteBody(session, String(new ObjectId())))],
        ['POST /api/v2/timeTracker/start', (session) => session.api.post('/api/v2/timeTracker/start', trackerStartBody(session))],
        ['POST /api/v3/timeTracker/start', (session) => session.api.post('/api/v3/timeTracker/start', trackerStartBody(session))],
        ['POST /api/v2/timetracker/end', (session) => session.api.post('/api/v2/timetracker/end', logBody(session, { timeSheetId: String(new ObjectId()), taskId: TASK._id, strokes: '[]' }))],
        ['POST /api/v2/timetracker/timelog', (session) => session.api.post('/api/v2/timetracker/timelog', { companyId: COMPANY_B, userId: session.userId })],
    ])('refuses a member whose body aims %s at another company, and writes nothing there', async (_route, call) => {
        const member = await loginAs('member');
        const res = await call(member);

        expect({
            status: res.status,
            answered: res.body && res.body.status,
            rows: await foreignRows(),
            database: await foreignDatabaseExists(),
        }).toEqual({ status: 403, answered: false, rows: 0, database: false });
    });

    it.each(['owner', 'admin', 'guest'])('refuses a %s the same way', async (role) => {
        const session = await loginAs(role);
        const res = await session.api.post('/api/v2/manualLogtime', logBody(session));

        expect(res.status).toBe(403);
        expect(res.body.status).toBe(false);
        expect(await foreignRows()).toBe(0);
        expect(await foreignDatabaseExists()).toBe(false);
    });

    it('refuses a member session aimed at company B through the header', async () => {
        const member = await loginAs('member');
        const res = await member.api.withCompany(COMPANY_B).post('/api/v2/manualLogtime', logBody(member));

        expect(res.status).toBeGreaterThanOrEqual(401);
        expect(res.body.status).toBe(false);
        expect(await foreignDatabaseExists()).toBe(false);
    });

    it('logs into the header company when the body repeats it', async () => {
        const member = await loginAs('member');
        const res = await member.api.post('/api/v2/manualLogtime', logBody(member, { companyId: member.companyId, description: 'Tenant pin same-company' }));

        expect(res.status).toBe(200);
        expect(res.body).toMatchObject({ status: true });
        const stored = await ownTimesheets().findOne({ _id: new ObjectId(String(res.body.data._id)) });
        expect(stored).toMatchObject({ LogDescription: 'Tenant pin same-company', Loggeduser: member.userId });
        expect(await foreignDatabaseExists()).toBe(false);
    });

    it('logs into the header company when the body leaves it out', async () => {
        const member = await loginAs('member');
        const body = logBody(member, { description: 'Tenant pin no-company' });
        delete body.companyId;
        const res = await member.api.post('/api/v2/manualLogtime', body);

        expect(res.status).toBe(200);
        expect(res.body).toMatchObject({ status: true });
        const stored = await ownTimesheets().findOne({ _id: new ObjectId(String(res.body.data._id)) });
        expect(stored).not.toBeNull();
    });

    it('leaves an entry of the header company alone when the body aims the delete elsewhere', async () => {
        const member = await loginAs('member');
        const created = await member.api.post('/api/v2/manualLogtime', logBody(member, { companyId: member.companyId, description: 'Tenant pin delete probe' }));
        const timeSheetId = String(created.body.data._id);

        const res = await member.api.post('/api/v2/deleteManualLogtime', deleteBody(member, timeSheetId));

        expect(res.status).toBe(403);
        expect(await ownTimesheets().findOne({ _id: new ObjectId(timeSheetId) })).not.toBeNull();
        expect(await foreignDatabaseExists()).toBe(false);
    });
});
