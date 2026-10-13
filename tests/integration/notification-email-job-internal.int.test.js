const { MongoClient } = require('mongodb');
const { resolveMongoUrl } = require('../../e2e/support/env');
const { createApiClient } = require('../../e2e/support/api');
const { loginAs, readState } = require('../../e2e/support/fixtures');
const { newId, tag } = require('./notificationSeed');

const state = readState();
const MARKER = `email-job-${tag()}`;

let client;

beforeAll(async () => {
    client = new MongoClient(resolveMongoUrl(), { serverSelectionTimeoutMS: 5000 });
    await client.connect();
    await client.db('global').collection('notifications').insertOne({
        companyId: state.companyId,
        receiverID: newId(),
        projectId: state.projects.shared._id,
        message: MARKER,
        Employee_Email: `${MARKER}@e2e.alianhub.test`,
        notificationType: 'email',
    });
});

afterAll(async () => {
    if (!client) return;
    await client.db('global').collection('notifications').deleteMany({ message: MARKER });
    await client.close();
});

describe('the notification email job is not an HTTP endpoint', () => {
    it.each(['member', 'guest', 'owner'])('answers a signed-in %s with no route and no notification data', async (role) => {
        const session = await loginAs(role);
        const res = await session.api.post('/api/v2/email-cron-handler', {});

        expect(res.status).toBe(404);
        expect(JSON.stringify(res.body || '')).not.toContain(MARKER);
    });

    it('answers a caller with no session the same way', async () => {
        const res = await createApiClient({ baseURL: state.baseURL, companyId: state.companyId }).post('/api/v2/email-cron-handler', {});

        expect(res.status).toBe(404);
        expect(JSON.stringify(res.body || '')).not.toContain(MARKER);
    });
});
