const { MongoClient } = require('mongodb');
const { resolveMongoUrl } = require('../../e2e/support/env');
const { loginAs, readState } = require('../../e2e/support/fixtures');
const { newId, tag } = require('./notificationSeed');

const state = readState();
const PROJECT = state.projects.shared;
const COMPANY_B = newId();

let client;
let member;
let admin;

const history = (companyId, Message) => client.db(companyId).collection('history').findOne({ Message });

beforeAll(async () => {
    client = new MongoClient(resolveMongoUrl(), { serverSelectionTimeoutMS: 5000 });
    await client.connect();
    member = await loginAs('member');
    admin = await loginAs('admin');
});

afterAll(async () => {
    if (!client) return;
    await client.db(COMPANY_B).dropDatabase();
    await client.close();
});

describe('POST /api/v1/handleHistory records the signed-in user in the verified company', () => {
    it('refuses a body that names another company and writes nothing there', async () => {
        const message = `steer ${tag()}`;
        const res = await member.api.post('/api/v1/handleHistory', {
            type: 'project', companyId: COMPANY_B, projectId: PROJECT._id, taskId: null,
            object: { key: 'Project_Name', message }, userData: { id: member.userId },
        });

        expect([res.status, res.body && res.body.status]).toEqual([403, false]);
        expect(await history(COMPANY_B, message)).toBeNull();
    });

    it('records the caller as the actor when userData names someone else', async () => {
        const message = `actor ${tag()}`;
        const res = await member.api.post('/api/v1/handleHistory', {
            type: 'project', companyId: member.companyId, projectId: PROJECT._id, taskId: null,
            object: { key: 'Project_Name', message }, userData: { id: admin.userId },
        });

        expect(res.body).toMatchObject({ status: true });
        const row = await history(state.companyId, message);
        expect({ UserId: row && row.UserId, ProjectId: row && row.ProjectId }).toEqual({ UserId: member.userId, ProjectId: PROJECT._id });
    });

    it('reads the fields by name, whatever order the body lists them in', async () => {
        const message = `order ${tag()}`;
        const res = await member.api.post('/api/v1/handleHistory', {
            userData: { id: member.userId }, object: { key: 'Project_Name', message },
            projectId: PROJECT._id, type: 'project', companyId: member.companyId,
        });

        expect(res.body).toMatchObject({ status: true });
        const row = await history(state.companyId, message);
        expect({ UserId: row && row.UserId, ProjectId: row && row.ProjectId, Type: row && row.Type }).toEqual({ UserId: member.userId, ProjectId: PROJECT._id, Type: 'project' });
    });
});
