const crypto = require('node:crypto');
const { MongoClient } = require('mongodb');
const { resolveMongoUrl } = require('../../e2e/support/env');

// The approval half of the workflow API, against a real MongoDB.
//
// What only a real database can answer: that the unique index on
// { runId, stepId } really makes one request out of a re-ticked step, that the
// decision is a compare-and-set so the second answer is refused rather than
// overwriting the first, that a reassignment is written down with who moved it
// and to whom, and that a member who owns nothing sees nothing to act on.

process.env.MONGODB_URL = resolveMongoUrl();
process.env.WORKFLOW_ENGINE = 'on';
process.env.WORKFLOW_BACKOFF_MS = '100,100,100';
process.env.WORKFLOW_LEASE_MS = '10000';

const { SCHEMA_TYPE } = require('../../Config/schemaType');
const { dbCollections } = require('../../Config/collections');
const { MongoDbCrudOpration } = require('../../utils/mongo-handler/mongoQueries');
const { closeConnection } = require('../../middlewares/mongoConnector/helper');
const { ROLE_OWNER, ROLE_MEMBER } = require('../../Config/roleTypes');
const { SEAT_ACTIVE } = require('../../Config/seatStatus');
const controller = require('../../Modules/Workflows/controller');
const approvals = require('../../Modules/Workflows/approvals');

const id = () => crypto.randomBytes(12).toString('hex');
const COMPANY = id();
const OWNER = id();
const MEMBER = id();
const STANDIN = id();
const OUTSIDER = id();

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

let client;

const req = ({ companyId = COMPANY, uid = OWNER, params = {}, body = {}, query = {} } = {}) => ({
    headers: { companyid: companyId }, uid, params, query, body, ip: '127.0.0.1',
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

const seat = (userId, roleType) => MongoDbCrudOpration(COMPANY, {
    type: SCHEMA_TYPE.COMPANY_USERS,
    data: { companyId: COMPANY, userId, userEmail: `${userId}@workflow.test`, roleType, designation: 0, status: SEAT_ACTIVE, isDelete: false },
}, 'save');

const STEP = 'sAsk';

/* A run whose one step asks a person. Starting it dispatches inline, so by the
 * time this resolves the step has opened its request and gone back to waiting. */
const startApproval = async (config = {}) => {
    const started = await call(controller.startRun, {
        body: {
            workflowId: 'approval-probe',
            name: 'Ship the release',
            steps: [{
                id: STEP,
                type: 'human_approval',
                config: {
                    title: 'Ship the release',
                    prompt: 'The notes are ready. Ship it?',
                    ownerUserId: MEMBER,
                    escalateToUserId: STANDIN,
                    escalateAfterMs: 60 * 60 * 1000,
                    deadlineMs: 2 * 60 * 60 * 1000,
                    ...config,
                },
            }],
        },
    });
    expect(started.body.status).toBe(true);
    return String(started.body.data.run._id);
};

beforeAll(async () => {
    client = new MongoClient(resolveMongoUrl(), { serverSelectionTimeoutMS: 5000 });
    await client.connect();
    for (const type of [SCHEMA_TYPE.WORKFLOW_RUNS, SCHEMA_TYPE.WORKFLOW_STEP_RUNS, SCHEMA_TYPE.WORKFLOW_APPROVALS, SCHEMA_TYPE.AUDIT_LOGS]) {
        // eslint-disable-next-line no-await-in-loop
        await MongoDbCrudOpration(COMPANY, { type, data: [] }, 'syncIndexes');
    }
    await seat(OWNER, ROLE_OWNER);
    await seat(MEMBER, ROLE_MEMBER);
    await seat(STANDIN, ROLE_MEMBER);
    await seat(OUTSIDER, ROLE_MEMBER);
});

afterAll(async () => {
    if (client) {
        await client.db(COMPANY).dropDatabase().catch(() => {});
        await client.close();
    }
    closeConnection(COMPANY);
    closeConnection(dbCollections.GLOBAL);
    await sleep(50);
});

describe('reading the approvals a person is being asked to decide', () => {
    it('opens one request per step and shows it with its owner, deadline and escalation path', async () => {
        const runId = await startApproval();

        const listed = await call(controller.listApprovals, {});
        const mine = listed.body.data.find((row) => row.runId === runId);
        expect(mine).toBeTruthy();
        expect(mine.ownerUserId).toBe(MEMBER);
        expect(mine.escalateToUserId).toBe(STANDIN);
        expect(new Date(mine.deadlineAt).getTime()).toBeGreaterThan(Date.now());
        expect(mine.status).toBe('pending');
        expect(mine.step.type).toBe('human_approval');
        expect(mine.run.name).toBe('Ship the release');
        expect(mine.canDecide).toBe(true);

        const owned = await call(controller.listApprovals, { uid: MEMBER });
        const theirs = owned.body.data.find((row) => row.runId === runId);
        expect(theirs.canDecide).toBe(true);
    });

    it('hides an approval from a member who neither owns it nor can open its run', async () => {
        const runId = await startApproval();
        const listed = await call(controller.listApprovals, { uid: OUTSIDER });
        expect(listed.body.data.find((row) => row.runId === runId)).toBeUndefined();
    });
});

describe('deciding an approval', () => {
    it('records the decision once and lets the run carry on', async () => {
        const runId = await startApproval();

        const decided = await call(controller.decideApproval, {
            uid: MEMBER, params: { id: runId, stepId: STEP }, body: { decision: 'approved', comment: 'Looks right' },
        });
        expect(decided.body.status).toBe(true);
        expect(decided.body.data.approval.status).toBe('approved');
        expect(decided.body.data.approval.decidedBy).toBe(MEMBER);
        expect(decided.body.data.approval.comment).toBe('Looks right');

        const again = await call(controller.decideApproval, {
            uid: OWNER, params: { id: runId, stepId: STEP }, body: { decision: 'rejected' },
        });
        expect(again.statusCode).toBe(409);

        const stored = await approvals.get(COMPANY, runId, STEP);
        expect(stored.status).toBe('approved');
    });

    it('refuses a member who is not the owner of the step', async () => {
        const runId = await startApproval();
        const refused = await call(controller.decideApproval, {
            uid: OUTSIDER, params: { id: runId, stepId: STEP }, body: { decision: 'approved' },
        });
        expect(refused.statusCode).toBe(403);
        expect((await approvals.get(COMPANY, runId, STEP)).status).toBe('pending');
    });

    it('refuses a decision that is not one', async () => {
        const runId = await startApproval();
        const refused = await call(controller.decideApproval, {
            uid: OWNER, params: { id: runId, stepId: STEP }, body: { decision: 'maybe' },
        });
        expect(refused.statusCode).toBe(400);
    });
});

describe('reassigning an approval', () => {
    it('writes down who moved it, from whom and to whom', async () => {
        const runId = await startApproval();

        const moved = await call(controller.reassignApproval, {
            uid: OWNER, params: { id: runId, stepId: STEP }, body: { toUserId: STANDIN, reason: 'Dana is away' },
        });
        expect(moved.body.status).toBe(true);
        expect(moved.body.data.approval.ownerUserId).toBe(STANDIN);

        const stored = await approvals.get(COMPANY, runId, STEP);
        expect(stored.reassignedBy).toBe(OWNER);
        expect(stored.owners.map(String)).toEqual([MEMBER, STANDIN]);
        expect(stored.reassignments).toHaveLength(1);
        expect(stored.reassignments[0]).toMatchObject({ from: MEMBER, to: STANDIN, by: OWNER, reason: 'Dana is away' });
    });

    it('moves the decision with the request: the new owner may answer and the old one may not', async () => {
        const runId = await startApproval();
        await call(controller.reassignApproval, { uid: MEMBER, params: { id: runId, stepId: STEP }, body: { toUserId: STANDIN } });

        const oldOwner = await call(controller.decideApproval, {
            uid: MEMBER, params: { id: runId, stepId: STEP }, body: { decision: 'approved' },
        });
        expect(oldOwner.statusCode).toBe(403);

        const newOwner = await call(controller.decideApproval, {
            uid: STANDIN, params: { id: runId, stepId: STEP }, body: { decision: 'approved' },
        });
        expect(newOwner.body.status).toBe(true);
    });

    it('refuses a stranger to the company, and refuses handing it to its own owner', async () => {
        const runId = await startApproval();

        const stranger = await call(controller.reassignApproval, {
            uid: OWNER, params: { id: runId, stepId: STEP }, body: { toUserId: id() },
        });
        expect(stranger.statusCode).toBe(400);

        const same = await call(controller.reassignApproval, {
            uid: OWNER, params: { id: runId, stepId: STEP }, body: { toUserId: MEMBER },
        });
        expect(same.statusCode).toBe(409);
    });

    it('refuses to move an approval that has already been decided', async () => {
        const runId = await startApproval();
        await call(controller.decideApproval, { uid: OWNER, params: { id: runId, stepId: STEP }, body: { decision: 'rejected' } });

        const late = await call(controller.reassignApproval, {
            uid: OWNER, params: { id: runId, stepId: STEP }, body: { toUserId: STANDIN },
        });
        expect(late.statusCode).toBe(409);
    });
});
