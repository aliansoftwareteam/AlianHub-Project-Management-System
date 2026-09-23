const { MongoClient, ObjectId } = require('mongodb');
const { resolveMongoUrl } = require('../../e2e/support/env');
const { loginAs, readState, uniqueSuffix } = require('../../e2e/support/fixtures');

const state = readState();
const PROJECT = state.projects.shared;
const OTHER_COMPANY = new ObjectId().toHexString();

let client;
let owner;
let member;

const db = () => client.db(state.companyId);
const historyOf = (name) => db().collection('history').find({ ProjectId: String(PROJECT._id), Message: { $regex: name } }).toArray();

const addBody = (session, overrides = {}) => {
    const milestoneName = `Milestone ${uniqueSuffix()}`;
    return {
        companyId: session.companyId,
        projectId: PROJECT._id,
        ProjectName: PROJECT.name,
        userDetail: { id: member.userId, Employee_Name: 'Forged Name', companyOwnerId: member.userId },
        fixOrHourlyMilCheck: false,
        cuurencyValue: '$',
        milestoneObject: { milestoneName, amount: 10, startDate: '2026-01-01', endDate: '2026-02-01', statusArray: [], order: 1 },
        ...overrides,
    };
};

const waitFor = async (probe, timeoutMs = 5000) => {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
        const value = await probe();
        if (value || Date.now() > deadline) return value;
        await new Promise((resolve) => setTimeout(resolve, 100));
    }
};

beforeAll(async () => {
    client = new MongoClient(resolveMongoUrl(), { serverSelectionTimeoutMS: 5000 });
    await client.connect();
    owner = await loginAs('owner');
    member = await loginAs('member');
});

afterAll(async () => {
    if (client) await client.close();
});

describe('milestone writes take the company and user from the verified request', () => {
    it('records the history under the signed-in user, not the body userDetail', async () => {
        const body = addBody(owner);
        const res = await owner.api.post('/api/v1/addmilestone', body);

        expect(res.body).toMatchObject({ status: true });
        const name = body.milestoneObject.milestoneName;
        const history = await waitFor(async () => { const rows = await historyOf(name); return rows.length ? rows : null; });
        expect(history).not.toBeNull();
        history.forEach((row) => {
            expect(String(row.UserId)).toBe(String(owner.userId));
            expect(row.Message).not.toContain('Forged Name');
        });
    });

    it('adds a milestone when the body carries no userDetail', async () => {
        const body = addBody(owner);
        delete body.userDetail;
        const res = await owner.api.post('/api/v1/addmilestone', body);

        expect(res.body).toMatchObject({ status: true });
        expect(await db().collection('milestone').countDocuments({ milestoneName: body.milestoneObject.milestoneName })).toBe(1);
    });

    it('refuses a body that names another company and writes nothing', async () => {
        const body = addBody(owner, { companyId: OTHER_COMPANY });
        const res = await owner.api.post('/api/v1/addmilestone', body);

        expect(res.status).toBe(403);
        expect(await db().collection('milestone').countDocuments({ milestoneName: body.milestoneObject.milestoneName })).toBe(0);
    });
});
