const { createApiClient } = require('../../e2e/support/api');
const { loginAs, readState } = require('../../e2e/support/fixtures');
const { dbCollections } = require('../../Config/collections');

const state = readState();
const anonymous = createApiClient({ baseURL: state.baseURL });
const anonymousWithCompany = createApiClient({ baseURL: state.baseURL, companyId: state.companyId });
const OTHER_COMPANY = '6f00000000000000000000c2';
const GATEWAY = '/api/v1/mongoOpration';

const loggedTime = (taskId, overrides = {}) => ({
    dbName: state.companyId,
    collection: dbCollections.TIMESHEET,
    methodName: 'aggregate',
    dataObj: [[{ $match: { TicketID: String(taskId) } }, { $group: { _id: null, total: { $sum: '$LogTimeDuration' } } }]],
    ...overrides,
});

describe('POST /api/v1/mongoOpration (ACC-01)', () => {
    it('refuses the anonymous userAuth count from the finding with 401', async () => {
        const res = await anonymous.post(GATEWAY, { dbName: 'global', collection: dbCollections.USER_AUTH, methodName: 'countDocuments', dataObj: [{}] });
        expect(res.status).toBe(401);
        expect(res.body.status).toBe(false);
    });

    it('refuses the anonymous user email listing from the finding with 401', async () => {
        const res = await anonymous.post(GATEWAY, { dbName: 'global', collection: dbCollections.USERS, methodName: 'find', dataObj: [{}, { Employee_Email: 1 }] });
        expect(res.status).toBe(401);
        expect(JSON.stringify(res.body)).not.toContain(state.users.owner.email);
    });

    it('refuses an anonymous caller that sends a company id with 401', async () => {
        const res = await anonymousWithCompany.post(GATEWAY, loggedTime(state.tasks[0]._id));
        expect(res.status).toBe(401);
    });

    it('refuses a member aiming the session at a company they do not belong to', async () => {
        const member = await loginAs('member');
        const res = await member.api.withCompany(OTHER_COMPANY).post(GATEWAY, loggedTime(state.tasks[0]._id, { dbName: OTHER_COMPANY }));
        expect([401, 403]).toContain(res.status);
        expect(res.body.status).toBe(false);
    });

    it('refuses a member naming another company database with 403', async () => {
        const member = await loginAs('member');
        const res = await member.api.post(GATEWAY, loggedTime(state.tasks[0]._id, { dbName: OTHER_COMPANY }));
        expect(res.status).toBe(403);
    });

    it('refuses the owner reading credential collections with 403', async () => {
        const owner = await loginAs('owner');
        for (const [dbName, collection] of [['global', dbCollections.USER_AUTH], ['global', dbCollections.SESSIONS], [state.companyId, dbCollections.API_TOKENS]]) {
            const res = await owner.api.post(GATEWAY, { dbName, collection, methodName: 'countDocuments', dataObj: [{}] });
            expect(res.status).toBe(403);
        }
    });

    it('refuses the owner listing global users with 403', async () => {
        const owner = await loginAs('owner');
        const res = await owner.api.post(GATEWAY, { dbName: 'global', collection: dbCollections.USERS, methodName: 'find', dataObj: [{}, { Employee_Email: 1 }] });
        expect(res.status).toBe(403);
        expect(JSON.stringify(res.body)).not.toContain(state.users.member.email);
    });

    it('refuses a destructive method with 403 and leaves the data in place', async () => {
        const owner = await loginAs('owner');
        const res = await owner.api.post(GATEWAY, { dbName: state.companyId, collection: dbCollections.TASKS, methodName: 'deleteMany', dataObj: [{}] });
        expect(res.status).toBe(403);
        const task = await owner.api.get(`/api/v1/task/${state.tasks[0]._id}`);
        expect(task.status).toBe(200);
    });

    it('refuses $where with 403', async () => {
        const owner = await loginAs('owner');
        const res = await owner.api.post(GATEWAY, loggedTime(state.tasks[0]._id, { dataObj: [[{ $match: { $where: 'sleep(2000) || true' } }]] }));
        expect(res.status).toBe(403);
        expect(res.body.message).toContain('$where');
    });

    it('still answers the task panel logged-time query for a member', async () => {
        const member = await loginAs('member');
        const res = await member.api.post(GATEWAY, loggedTime(state.tasks[0]._id));
        expect(res.status).toBe(200);
        expect(res.body.status).toBe(true);
        expect(Array.isArray(res.body.data)).toBe(true);
    });
});
