const { MongoClient, ObjectId } = require('mongodb');
const { resolveMongoUrl } = require('../../e2e/support/env');
const { loginAs, readState } = require('../../e2e/support/fixtures');

const state = readState();
const PROJECT = state.projects.shared;
const OTHER_COMPANY = new ObjectId().toHexString();
const FIELD = `project_${PROJECT._id}_comments`;

let client;
let owner;
let member;

const counters = () => client.db(state.companyId).collection('userId');
const countOf = async (userId) => {
    const row = await counters().findOne({ userId: String(userId) });
    return (row && row[FIELD]) || 0;
};

beforeAll(async () => {
    client = new MongoClient(resolveMongoUrl(), { serverSelectionTimeoutMS: 5000 });
    await client.connect();
    owner = await loginAs('owner');
    member = await loginAs('member');
});

beforeEach(async () => {
    await counters().updateMany({}, { $unset: { [FIELD]: '' } });
});

afterAll(async () => {
    if (client) await client.close();
});

describe('updateunreadcommentscount takes the company and user from the verified request', () => {
    it('bumps a teammate\'s unread count, as sending a comment does', async () => {
        const res = await member.api.post('/api/v1/updateunreadcommentscount', { companyId: member.companyId, key: 1, projectId: PROJECT._id, userIds: [owner.userId] });

        expect(res.body).toMatchObject({ status: true });
        expect(await countOf(owner.userId)).toBe(1);
    });

    it('marks the signed-in user read', async () => {
        await member.api.post('/api/v1/updateunreadcommentscount', { companyId: member.companyId, key: 1, projectId: PROJECT._id, userIds: [owner.userId] });
        const res = await owner.api.post('/api/v1/updateunreadcommentscount', { companyId: owner.companyId, key: 1, projectId: PROJECT._id, userIds: [owner.userId], read: true });

        expect(res.body).toMatchObject({ status: true });
        expect(await countOf(owner.userId)).toBe(0);
    });

    it('refuses to mark someone else read and leaves their count alone', async () => {
        await member.api.post('/api/v1/updateunreadcommentscount', { companyId: member.companyId, key: 1, projectId: PROJECT._id, userIds: [owner.userId] });
        const res = await member.api.post('/api/v1/updateunreadcommentscount', { companyId: member.companyId, key: 1, projectId: PROJECT._id, userIds: [owner.userId], read: true });

        expect(res.status).toBe(403);
        expect(await countOf(owner.userId)).toBe(1);
    });

    it('refuses a body that names another company and writes nothing', async () => {
        const res = await member.api.post('/api/v1/updateunreadcommentscount', { companyId: OTHER_COMPANY, key: 1, projectId: PROJECT._id, userIds: [owner.userId] });

        expect(res.status).toBe(403);
        expect(await countOf(owner.userId)).toBe(0);
    });

    it('creates no counter for a recipient outside the company', async () => {
        const stranger = new ObjectId().toHexString();
        const res = await member.api.post('/api/v1/updateunreadcommentscount', { companyId: member.companyId, key: 1, projectId: PROJECT._id, userIds: [stranger] });

        expect(res.body).toMatchObject({ status: true });
        expect(await counters().countDocuments({ userId: stranger })).toBe(0);
    });
});
