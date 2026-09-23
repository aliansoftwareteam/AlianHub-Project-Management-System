const crypto = require('node:crypto');
const { MongoClient, ObjectId } = require('mongodb');
const { resolveMongoUrl } = require('../../e2e/support/env');

/* Automated steps that name people check them when they run, not only when they were saved: an approval step whose
 * owner or escalation has since left the company fails with a reason, and an agent's assignment accepts only
 * active members. Someone already on the task stays. */

process.env.MONGODB_URL = resolveMongoUrl();
process.env.WORKFLOW_ENGINE = 'on';

const { SCHEMA_TYPE } = require('../../Config/schemaType');
const { dbCollections } = require('../../Config/collections');
const { MongoDbCrudOpration } = require('../../utils/mongo-handler/mongoQueries');
const { closeConnection } = require('../../middlewares/mongoConnector/helper');
const { ROLE_OWNER, ROLE_MEMBER } = require('../../Config/roleTypes');
const { SEAT_ACTIVE, SEAT_PENDING } = require('../../Config/seatStatus');
const { NOT_A_MEMBER } = require('../../Config/companyMembers');
const approvalStep = require('../../Modules/Workflows/stepTypes/approval');
const { executors } = require('../../Modules/Agents/actions');

const id = () => crypto.randomBytes(12).toString('hex');
const COMPANY = id();
const OTHER_COMPANY = id();
const OWNER = id();
const MEMBER = id();
const LEAVER = id();
const INVITEE = id();
const OUTSIDER = id();
const NOBODY = id();

let client;

const seat = (companyId, userId, roleType, status = SEAT_ACTIVE) => MongoDbCrudOpration(companyId, {
    type: SCHEMA_TYPE.COMPANY_USERS,
    data: { companyId, userId, userEmail: `${userId}@automation.test`, roleType, designation: 0, status, isDelete: false },
}, 'save');

const leave = (userId) => client.db(COMPANY).collection('company_users').updateOne({ userId }, { $set: { isDelete: true } });

const approvals = () => client.db(COMPANY).collection('workflow_approvals');

const ask = (config) => ({
    companyId: COMPANY,
    run: { _id: new ObjectId(), workflowId: 'members-at-run-time', name: 'Ship' },
    step: { stepId: 'sAsk', config: { title: 'Ship it', prompt: 'Ship it?', deadlineMs: 60 * 60 * 1000, ...config } },
});

// A step that opened its approval answers by waiting on it.
const runStep = (request) => approvalStep.execute(request).catch((error) => {
    if (error && error.name === 'WorkflowWaiting') return 'waiting';
    throw error;
});

const taskWith = async (AssigneeUserId) => {
    const _id = new ObjectId();
    await client.db(COMPANY).collection('tasks').insertOne({ _id, TaskName: 'Automated', CompanyId: COMPANY, ProjectID: id(), AssigneeUserId, Task_Leader: OWNER });
    return String(_id);
};

const assign = (taskId, assigneeIds, replace = false) => executors['task.assign']({
    companyId: COMPANY,
    actor: { kind: 'agent', userId: OWNER, agentId: id(), agentName: 'Assigner' },
    params: { taskId, assigneeIds, replace },
    depth: 0,
});

const assigneesOf = async (taskId) => (await client.db(COMPANY).collection('tasks').findOne({ _id: new ObjectId(taskId) })).AssigneeUserId;

beforeAll(async () => {
    client = new MongoClient(resolveMongoUrl(), { serverSelectionTimeoutMS: 5000 });
    await client.connect();
    await MongoDbCrudOpration(COMPANY, { type: SCHEMA_TYPE.WORKFLOW_APPROVALS, data: [] }, 'syncIndexes');
    await seat(COMPANY, OWNER, ROLE_OWNER);
    await seat(COMPANY, MEMBER, ROLE_MEMBER);
    await seat(COMPANY, LEAVER, ROLE_MEMBER);
    await seat(COMPANY, INVITEE, ROLE_MEMBER, SEAT_PENDING);
    await seat(OTHER_COMPANY, OUTSIDER, ROLE_MEMBER);
});

afterAll(async () => {
    if (client) {
        await client.db(COMPANY).dropDatabase().catch(() => {});
        await client.db(OTHER_COMPANY).dropDatabase().catch(() => {});
        await client.close();
    }
    closeConnection(COMPANY);
    closeConnection(OTHER_COMPANY);
    closeConnection(dbCollections.GLOBAL);
    await new Promise((resolve) => setTimeout(resolve, 50));
});

describe('an approval step at run time', () => {
    it('fails with a reason when its owner has left the company since the workflow was saved', async () => {
        const leaver = id();
        await seat(COMPANY, leaver, ROLE_MEMBER);
        await leave(leaver);
        await expect(runStep(ask({ ownerUserId: leaver }))).rejects.toMatchObject({ deterministic: true, message: expect.stringContaining(NOT_A_MEMBER) });
        expect(await approvals().countDocuments({ ownerUserId: leaver })).toBe(0);
    });

    it.each([['another company\'s user', OUTSIDER], ['a pending invitee', INVITEE]])('fails when its escalation is %s', async (_, who) => {
        const request = ask({ ownerUserId: MEMBER, escalateToUserId: who, escalateAfterMs: 60000 });
        await expect(runStep(request)).rejects.toMatchObject({ deterministic: true, message: expect.stringContaining(NOT_A_MEMBER) });
        expect(await approvals().countDocuments({ escalateToUserId: who })).toBe(0);
    });

    it('does not hand an approval to an escalation who left while it waited', async () => {
        const request = ask({ ownerUserId: MEMBER, escalateToUserId: LEAVER, escalateAfterMs: 60000 });
        await runStep(request);
        await leave(LEAVER);
        await approvals().updateOne({ runId: String(request.run._id) }, { $set: { escalateAt: new Date(Date.now() - 1000) } });

        await expect(runStep(request)).rejects.toMatchObject({ deterministic: true, message: expect.stringContaining(NOT_A_MEMBER) });
        const stored = await approvals().findOne({ runId: String(request.run._id) });
        expect(stored.ownerUserId).toBe(MEMBER);
        expect(stored.owners || []).not.toContain(LEAVER);
    });

    it('still opens an approval for a member', async () => {
        const request = ask({ ownerUserId: MEMBER, escalateToUserId: OWNER, escalateAfterMs: 60000 });
        await runStep(request);
        expect(await approvals().countDocuments({ runId: String(request.run._id), ownerUserId: MEMBER })).toBe(1);
    });
});

describe('an agent assigning a task', () => {
    it.each([['another company\'s user', OUTSIDER], ['a pending invitee', INVITEE], ['an id nobody holds', NOBODY]])(
        'refuses %s and leaves the task as it was',
        async (_, who) => {
            const taskId = await taskWith([OWNER]);
            await expect(assign(taskId, [MEMBER, who])).rejects.toThrow(NOT_A_MEMBER);
            expect(await assigneesOf(taskId)).toEqual([OWNER]);
        },
    );

    it('still assigns a member and keeps someone already on the task', async () => {
        const taskId = await taskWith([OWNER, NOBODY]);
        await assign(taskId, [MEMBER]);
        expect(await assigneesOf(taskId)).toEqual([OWNER, NOBODY, MEMBER]);
        await assign(taskId, [NOBODY, MEMBER], true);
        expect(await assigneesOf(taskId)).toEqual([NOBODY, MEMBER]);
    });
});
