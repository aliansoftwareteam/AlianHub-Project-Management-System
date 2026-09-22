const crypto = require('node:crypto');
const { MongoClient } = require('mongodb');
const { resolveMongoUrl } = require('../../e2e/support/env');

/* A grant revoked while an external_agent step waits, against a real MongoDB with AUDIT_CHAIN on: the session is
 * revoked, the refusal row names the outside client and the person who delegated, the step fails by name once it is
 * woken, and the company's audit chain still verifies over every row that was written. */

process.env.MONGODB_URL = resolveMongoUrl();
process.env.WORKFLOW_ENGINE = 'on';
process.env.EXTERNAL_AGENT_SESSIONS = 'on';
process.env.EXTERNAL_AGENT_STEPS = 'on';
process.env.AUDIT_CHAIN = 'true';
process.env.AUDIT_CHAIN_KEY = crypto.randomBytes(32).toString('hex');
process.env.JWT_SECRET = process.env.JWT_SECRET || crypto.randomBytes(32).toString('hex');

const { SCHEMA_TYPE } = require('../../Config/schemaType');
const { dbCollections } = require('../../Config/collections');
const { MongoDbCrudOpration } = require('../../utils/mongo-handler/mongoQueries');
const { closeConnection } = require('../../middlewares/mongoConnector/helper');
const chain = require('../../Modules/Audit/chain');
const tokenHash = require('../../Modules/OAuthServer/tokenHash');
require('../../Modules/Workflows/stepTypes');
const workflowStore = require('../../Modules/Workflows/store');
const externalSession = require('../../Modules/Workflows/externalSession');
const lifecycle = require('../../Modules/AgentSessions/lifecycle');

const id = () => crypto.randomBytes(12).toString('hex');
const COMPANY = id();
const PERSON = id();
const TASK = id();
const CLIENT = `ahc_${crypto.randomBytes(12).toString('hex')}`;
const GRANT = `grant-${id()}`;
const RAW = tokenHash.generate('access');
const STEP = 'sCode';

let client;
let runId;
let sessionId;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const audits = () => client.db(COMPANY).collection('audit_logs');

async function waitFor(check, timeoutMs = 15000) {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
        const value = await check();
        if (value || Date.now() > deadline) return value;
        await sleep(100);
    }
}

beforeAll(async () => {
    client = new MongoClient(resolveMongoUrl(), { serverSelectionTimeoutMS: 5000 });
    await client.connect();
    for (const type of [SCHEMA_TYPE.WORKFLOW_RUNS, SCHEMA_TYPE.WORKFLOW_STEP_RUNS, SCHEMA_TYPE.AGENT_SESSIONS, SCHEMA_TYPE.AUDIT_LOGS]) {
        // eslint-disable-next-line no-await-in-loop
        await MongoDbCrudOpration(COMPANY, { type, data: [] }, 'syncIndexes');
    }
    const now = new Date();
    await MongoDbCrudOpration(SCHEMA_TYPE.GOLBAL, { type: SCHEMA_TYPE.OAUTH_GRANTS, data: {
        grantId: GRANT, clientId: CLIENT, companyId: COMPANY, userId: PERSON, scopes: ['tasks:read', 'tasks:write'], resource: 'http://127.0.0.1/mcp',
        createdAt: now, expiresAt: new Date(now.getTime() + 86400000), purgeAt: new Date(now.getTime() + 86400000), revokedAt: now, revokedReason: 'revoked_by_user',
    } }, 'save');
    await MongoDbCrudOpration(SCHEMA_TYPE.GOLBAL, { type: SCHEMA_TYPE.OAUTH_TOKENS, data: {
        tokenHash: tokenHash.hashOf(RAW), kind: 'access', grantId: GRANT, clientId: CLIENT, companyId: COMPANY, userId: PERSON,
        scopes: ['tasks:read', 'tasks:write'], resource: 'http://127.0.0.1/mcp', createdAt: now, expiresAt: new Date(now.getTime() + 900000), purgeAt: new Date(now.getTime() + 900000), revokedAt: now,
    } }, 'save');

    const run = await workflowStore.createRun(COMPANY, {
        workflowId: 's10s8-audit', name: 'Hand the parser to the coder', source: 'api', startedBy: PERSON, taskId: TASK,
        steps: [{ id: STEP, type: 'external_agent', config: { clientId: CLIENT, taskId: TASK } }],
    });
    runId = String(run._id);
    await workflowStore.patchRun(COMPANY, runId, { status: 'running' });
    const session = await MongoDbCrudOpration(COMPANY, { type: SCHEMA_TYPE.AGENT_SESSIONS, data: {
        taskId: TASK, clientId: CLIENT, clientName: 'Coder', grantId: GRANT, delegatedBy: PERSON, state: 'active', tainted: true,
        createdAt: now, deliveredAt: now, firstActivityAt: now, activityCount: 1, activities: [{ type: 'action', text: 'Running the tests', at: now }],
        workflowRunId: runId, workflowStepId: STEP,
    } }, 'save');
    sessionId = String(session._id);
    await MongoDbCrudOpration(COMPANY, { type: SCHEMA_TYPE.WORKFLOW_STEP_RUNS, data: [
        { runId, stepId: STEP },
        { $set: { agentSessionId: sessionId, waitReason: 'waiting for Coder to finish', waitUntil: new Date(now.getTime() + 3600000), nextAttemptAt: new Date(now.getTime() + 3600000) } },
    ] }, 'updateOne');
});

afterAll(async () => {
    lifecycle.reset();
    await chain.flushMirrors();
    if (client) {
        await client.db(COMPANY).dropDatabase().catch(() => {});
        await client.db('global').collection('audit_chain_heads').deleteMany({ _id: COMPANY });
        await client.db('global').collection('oauth_tokens').deleteMany({ grantId: GRANT });
        await client.db('global').collection('oauth_grants').deleteMany({ grantId: GRANT });
        await client.close();
    }
    [COMPANY, dbCollections.GLOBAL].forEach((db) => closeConnection(db));
    await sleep(50);
});

describe('a grant revoked while an external_agent step waits', () => {
    it('revokes the session, attributes the refusal to the client and the person, fails the step by name and keeps the chain whole', async () => {
        const closed = await externalSession.refuseRevokedToken(RAW, { action: 'task.comment', ip: '203.0.113.9' });
        expect(closed).toEqual([sessionId]);

        const session = await client.db(COMPANY).collection('agent_sessions').findOne({});
        expect(session).toMatchObject({ state: 'revoked', reason: expect.stringMatching(/grant behind this session was revoked \(revoked_by_user\)/) });

        const refusal = await waitFor(() => audits().findOne({ action: 'agent.action_refused', entityId: sessionId }));
        expect(refusal).toMatchObject({
            actorId: CLIENT, entityType: 'agent_session',
            meta: { viaAccount: 'external', clientId: CLIENT, grantId: GRANT, delegatedBy: PERSON, action: 'task.comment', reason: expect.stringMatching(/grant_not_live/), tainted: true },
        });
        expect(typeof refusal.chain.seq).toBe('number');

        const step = await waitFor(async () => {
            const row = await workflowStore.getStep(COMPANY, runId, STEP);
            return row && row.status === 'failed' ? row : null;
        });
        expect(step).toMatchObject({ status: 'failed', error: expect.stringMatching(/revoked: the grant behind this session was revoked/) });
        expect((await workflowStore.getRun(COMPANY, runId)).status).toBe('failed');

        const system = await waitFor(() => audits().findOne({ action: 'agent_session.revoked', entityId: TASK }));
        expect(system).toBeTruthy();
        await sleep(500);
        await chain.flushMirrors();
        expect(await chain.verifyChain(COMPANY)).toMatchObject({ state: 'verified', brokenAt: null });
    }, 30000);
});
