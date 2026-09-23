const crypto = require('node:crypto');
const { MongoClient } = require('mongodb');
const { resolveMongoUrl } = require('../../e2e/support/env');
const { loginAs, readState } = require('../../e2e/support/fixtures');

const state = readState();
const OTHER_COMPANY = crypto.randomBytes(12).toString('hex');
const PROJECT = state.projects.shared;

let client;
let owner;
let member;

const inboxesOf = (query) => client.db('global').collection('email_inboxes').find(query).toArray();

beforeAll(async () => {
    client = new MongoClient(resolveMongoUrl(), { serverSelectionTimeoutMS: 5000 });
    await client.connect();
    owner = await loginAs('owner');
    member = await loginAs('member');
});

afterAll(async () => {
    if (client) await client.close();
});

describe('email-in inboxes take the company and user from the verified request', () => {
    it('creates an inbox as the signed-in user', async () => {
        const res = await member.api.post('/api/v1/email-in/inboxes', { projectId: PROJECT._id, userData: { id: member.userId, Employee_Name: 'Member' } });

        expect(res.body).toMatchObject({ status: true });
        const [inbox] = await inboxesOf({ token: res.body.data.token });
        expect(inbox).toMatchObject({ companyId: state.companyId, createdBy: member.userId });
    });

    it('refuses an inbox that would create tasks as another user', async () => {
        const res = await member.api.post('/api/v1/email-in/inboxes', { projectId: PROJECT._id, name: 'Steered creator', userData: { id: owner.userId, Employee_Name: 'Owner' } });

        expect(res.status).toBe(403);
        expect(await inboxesOf({ name: 'Steered creator' })).toHaveLength(0);
    });

    it('refuses a body naming another company', async () => {
        const res = await member.api.post('/api/v1/email-in/inboxes', { companyId: OTHER_COMPANY, projectId: PROJECT._id, name: 'Steered company', userData: { id: member.userId } });

        expect(res.status).toBe(403);
        expect(await inboxesOf({ name: 'Steered company' })).toHaveLength(0);
    });
});

describe('integrations, cloud storage and audit logs take the company from the verified request', () => {
    it.each([
        ['/api/v1/integrations/connections', () => owner],
        ['/api/v1/cloud-storage/providers', () => member],
        ['/api/v1/audit-logs', () => owner],
    ])('%s answers a normal call and refuses a query naming another company', async (route, who) => {
        const normal = await who().api.get(route);
        expect(normal.status).toBe(200);
        expect(normal.body).toMatchObject({ status: true });

        const steered = await who().api.get(route, { query: { companyId: OTHER_COMPANY } });
        expect(steered.status).toBe(403);
    });
});
