const crypto = require('node:crypto');
const { MongoClient } = require('mongodb');
const { resolveMongoUrl } = require('../../e2e/support/env');
const { loginAs, readState, uniqueSuffix } = require('../../e2e/support/fixtures');

const state = readState();
const COMPANY_B = crypto.randomBytes(12).toString('hex');
const PROJECT = state.projects.shared;

let client;

const milestoneBody = (session, overrides = {}) => ({
    companyId: COMPANY_B,
    projectId: PROJECT._id,
    ProjectName: PROJECT.name,
    fixOrHourlyMilCheck: false,
    milestoneObject: {
        milestoneName: `Tenant pin ${uniqueSuffix()}`,
        amount: 100,
        order: 1,
        startDate: '2026-03-02',
        endDate: '2026-03-09',
        dueDate: '2026-03-09',
    },
    userDetail: { id: session.userId, Employee_Name: 'Tenant pin probe' },
    ...overrides,
});

const foreignRows = async () => {
    const db = client.db(COMPANY_B);
    const names = (await db.listCollections().toArray()).map((c) => c.name);
    const counts = await Promise.all(names.map((name) => db.collection(name).countDocuments({})));
    return counts.reduce((sum, n) => sum + n, 0);
};

const foreignDatabaseExists = async () => {
    const { databases } = await client.db('admin').admin().listDatabases({ nameOnly: true });
    return databases.some((db) => db.name === COMPANY_B);
};

beforeAll(async () => {
    client = new MongoClient(resolveMongoUrl(), { serverSelectionTimeoutMS: 5000 });
    await client.connect();
});

afterAll(async () => {
    if (!client) return;
    await client.db(COMPANY_B).dropDatabase();
    await client.close();
});

describe('the milestone write routes take the company from the companyid header', () => {
    it.each([
        ['/api/v1/addmilestone', (session) => milestoneBody(session)],
        ['/api/v1/updatemilestone', (session) => milestoneBody(session, { prevMilestoneName: 'Tenant pin', statusObj: {} })],
        ['/api/v1/deletemilestone', (session) => milestoneBody(session, { milestoneObjForDelete: { _id: crypto.randomBytes(12).toString('hex'), amount: 100 } })],
        ['/api/v1/clearmilestonestatus', (session) => milestoneBody(session)],
        ['/api/v1/cancelmilestonestatus', (session) => milestoneBody(session)],
        ['/api/v1/refundamount', (session) => milestoneBody(session)],
        ['/api/v1/draggablemilestone', (session) => milestoneBody(session)],
    ])('refuses POST %s aimed at another company, and writes nothing there', async (route, body) => {
        for (const role of ['owner', 'member']) {
            const session = await loginAs(role);
            const res = await session.api.post(route, body(session));

            expect({ route, role, status: res.status, answered: res.body && res.body.status }).toEqual({ route, role, status: 403, answered: false });
        }
        expect(await foreignRows()).toBe(0);
        expect(await foreignDatabaseExists()).toBe(false);
    });

    it('refuses an owner session aimed at company B through the header', async () => {
        const owner = await loginAs('owner');
        const res = await owner.api.withCompany(COMPANY_B).post('/api/v1/addmilestone', milestoneBody(owner));

        expect(res.status).toBeGreaterThanOrEqual(401);
        expect(res.body.status).toBe(false);
        expect(await foreignDatabaseExists()).toBe(false);
    });

    it('adds to the header company when the body repeats it', async () => {
        const owner = await loginAs('owner');
        const res = await owner.api.post('/api/v1/addmilestone', milestoneBody(owner, { companyId: owner.companyId }));

        expect(res.status).toBe(200);
        expect(res.body).toMatchObject({ status: true });
        expect(await client.db(state.companyId).collection('milestone').countDocuments({ projectId: PROJECT._id })).toBeGreaterThan(0);
        expect(await foreignDatabaseExists()).toBe(false);
    });
});
