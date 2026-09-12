const crypto = require('node:crypto');
const { MongoClient } = require('mongodb');
const { resolveMongoUrl } = require('../../e2e/support/env');
const { loginAs, readState } = require('../../e2e/support/fixtures');

const state = readState();
const COMPANY_B = crypto.randomBytes(12).toString('hex');
const PROJECT = state.projects.shared;
const TASK = state.tasks[0];

let client;

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

const routes = [
    ['/api/v1/taskIndex', (session) => ({
        companyId: COMPANY_B,
        taskId: TASK._id,
        projectId: PROJECT._id,
        sprintId: TASK.sprintId,
        isFirst: true,
        isFirstWithRecord: false,
        updateData: { TaskName: 'Steered' },
        userId: session.userId,
    })],
    ['/api/v1/updateTaskIndexOnload', () => ({
        companyId: COMPANY_B,
        taskUpdate: { data: TASK._id },
    })],
    ['/api/v2/prepare-notification-data', (session) => ({
        companyId: COMPANY_B,
        key: 'TASK_ASSIGNEE',
        projectId: PROJECT._id,
        taskId: TASK._id,
        userId: session.userId,
    })],
    ['/api/v1/removeUserNotification', (session) => ({
        companyId: COMPANY_B,
        userId: session.userId,
        type: 'Add',
    })],
];

beforeAll(async () => {
    client = new MongoClient(resolveMongoUrl(), { serverSelectionTimeoutMS: 5000 });
    await client.connect();
});

afterAll(async () => {
    if (!client) return;
    await client.db(COMPANY_B).dropDatabase();
    await client.close();
});

describe('the routes PR #686 left open take the company from the companyid header', () => {
    it.each(routes)('refuses a member whose body aims %s at another company, and writes nothing there', async (route, body) => {
        const member = await loginAs('member');
        const res = await member.api.post(route, body(member));

        expect({
            route,
            status: res.status,
            answered: res.body && res.body.status,
            rows: await foreignRows(),
            database: await foreignDatabaseExists(),
        }).toEqual({ route, status: 403, answered: false, rows: 0, database: false });
    });

    it('still serves the header company when the body repeats it', async () => {
        const member = await loginAs('member');
        const res = await member.api.post('/api/v1/removeUserNotification', {
            companyId: member.companyId,
            userId: member.userId,
            type: 'Add',
        });

        expect(res.status).toBe(200);
        expect(res.body && res.body.status).not.toBe(false);
        expect(await foreignDatabaseExists()).toBe(false);
    });
});
