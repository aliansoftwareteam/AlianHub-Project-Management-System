const crypto = require('node:crypto');
const { MongoClient, ObjectId } = require('mongodb');
const { resolveMongoUrl } = require('../../e2e/support/env');

// An approval step names the people it asks. Starting a run or saving a workflow accepts only active members of
// the company as its owner or escalation; a user seated only in another company, or not seated at all, is refused.

process.env.MONGODB_URL = resolveMongoUrl();
process.env.WORKFLOW_ENGINE = 'on';
process.env.WORKFLOW_BACKOFF_MS = '100,100,100';
process.env.WORKFLOW_LEASE_MS = '10000';

const { SCHEMA_TYPE } = require('../../Config/schemaType');
const { dbCollections } = require('../../Config/collections');
const { MongoDbCrudOpration } = require('../../utils/mongo-handler/mongoQueries');
const { closeConnection } = require('../../middlewares/mongoConnector/helper');
const { ROLE_OWNER, ROLE_MEMBER } = require('../../Config/roleTypes');
const { SEAT_ACTIVE, SEAT_PENDING } = require('../../Config/seatStatus');
const controller = require('../../Modules/Workflows/controller');

const id = () => crypto.randomBytes(12).toString('hex');
const COMPANY = id();
const OTHER_COMPANY = id();
const OWNER = id();
const MEMBER = id();
const INVITEE = id();
const OUTSIDER = id();
const OUTSIDER_NAME = `Otto Outsider ${id().slice(0, 6)}`;

let client;

const req = ({ uid = OWNER, params = {}, body = {} } = {}) => ({
    headers: { companyid: COMPANY }, uid, params, query: {}, body, ip: '127.0.0.1',
});

const res = () => {
    const answer = { statusCode: 200, body: null };
    answer.status = (code) => { answer.statusCode = code; return answer; };
    answer.send = (body) => { answer.body = body; return answer; };
    return answer;
};

const call = async (handler, options) => {
    const answer = res();
    await handler(req(options), answer);
    return answer;
};

const seat = (companyId, userId, roleType, status = SEAT_ACTIVE) => MongoDbCrudOpration(companyId, {
    type: SCHEMA_TYPE.COMPANY_USERS,
    data: { companyId, userId, userEmail: `${userId}@workflow.test`, roleType, designation: 0, status, isDelete: false },
}, 'save');

const askStep = (config) => [{ id: 'sAsk', type: 'human_approval', config: { title: 'Ship it', prompt: 'Ship it?', deadlineMs: 60 * 60 * 1000, ...config } }];

const approvalsNaming = (userId) => client.db(COMPANY).collection('workflow_approvals').countDocuments({ $or: [{ ownerUserId: userId }, { escalateToUserId: userId }] });

beforeAll(async () => {
    client = new MongoClient(resolveMongoUrl(), { serverSelectionTimeoutMS: 5000 });
    await client.connect();
    for (const type of [SCHEMA_TYPE.WORKFLOW_RUNS, SCHEMA_TYPE.WORKFLOW_STEP_RUNS, SCHEMA_TYPE.WORKFLOW_APPROVALS]) {
        // eslint-disable-next-line no-await-in-loop
        await MongoDbCrudOpration(COMPANY, { type, data: [] }, 'syncIndexes');
    }
    await seat(COMPANY, OWNER, ROLE_OWNER);
    await seat(COMPANY, MEMBER, ROLE_MEMBER);
    await seat(COMPANY, INVITEE, ROLE_MEMBER, SEAT_PENDING);
    await seat(OTHER_COMPANY, OUTSIDER, ROLE_MEMBER);
    await client.db(dbCollections.GLOBAL).collection('users').insertOne({ _id: new ObjectId(OUTSIDER), Employee_Name: OUTSIDER_NAME });
});

afterAll(async () => {
    if (client) {
        await client.db(COMPANY).dropDatabase().catch(() => {});
        await client.db(OTHER_COMPANY).dropDatabase().catch(() => {});
        await client.db(dbCollections.GLOBAL).collection('users').deleteOne({ Employee_Name: OUTSIDER_NAME }).catch(() => {});
        await client.close();
    }
    closeConnection(COMPANY);
    closeConnection(OTHER_COMPANY);
    closeConnection(dbCollections.GLOBAL);
    await new Promise((resolve) => setTimeout(resolve, 50));
});

describe('starting a run', () => {
    it.each([
        ['an owner seated only in another company', { ownerUserId: OUTSIDER }, OUTSIDER],
        ['an escalation seated only in another company', { ownerUserId: MEMBER, escalateToUserId: OUTSIDER, escalateAfterMs: 60000 }, OUTSIDER],
        ['an owner whose invitation is still pending', { ownerUserId: INVITEE }, INVITEE],
    ])('refuses %s, and no approval names them', async (_, config, named) => {
        const started = await call(controller.startRun, { body: { workflowId: 'members-probe', steps: askStep(config) } });
        expect([started.statusCode, started.body.status]).toEqual([400, false]);
        expect(await approvalsNaming(named)).toBe(0);
        const listed = await call(controller.listApprovals, {});
        expect(JSON.stringify(listed.body)).not.toContain(OUTSIDER_NAME);
    });

    it('still opens an approval owned by a member of the company', async () => {
        const started = await call(controller.startRun, { body: { workflowId: 'members-probe', steps: askStep({ ownerUserId: MEMBER, escalateToUserId: OWNER, escalateAfterMs: 60000 }) } });
        expect(started.body.status).toBe(true);
        const runId = String(started.body.data.run._id);
        expect(await client.db(COMPANY).collection('workflow_approvals').countDocuments({ runId, ownerUserId: MEMBER })).toBe(1);
    });
});

describe('saving a workflow', () => {
    it('refuses an approval step owned by another company\'s user, on create and on update', async () => {
        const created = await call(controller.createDefinition, { body: { name: 'Ship', steps: askStep({ ownerUserId: OUTSIDER }) } });
        expect([created.statusCode, created.body.status]).toEqual([400, false]);

        const saved = await call(controller.createDefinition, { body: { name: 'Ship', steps: askStep({ ownerUserId: MEMBER }) } });
        expect(saved.body.status).toBe(true);
        const updated = await call(controller.updateDefinition, { params: { id: String(saved.body.data._id) }, body: { name: 'Ship', steps: askStep({ ownerUserId: MEMBER, escalateToUserId: OUTSIDER }) } });
        expect([updated.statusCode, updated.body.status]).toEqual([400, false]);

        const stored = await client.db(COMPANY).collection('workflow_definitions').find({}).toArray();
        expect(JSON.stringify(stored)).not.toContain(OUTSIDER);
    });
});
