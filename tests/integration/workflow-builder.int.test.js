const crypto = require('node:crypto');
const { MongoClient } = require('mongodb');
const { resolveMongoUrl } = require('../../e2e/support/env');

// The builder's half of the workflow API against a real MongoDB.
//
// What only a real database answers: that a workflow really is stored turned
// off whatever the request asked for, that turning it on is a second write, and
// that a dry run against a real task leaves no run, no step row and no audit row
// behind — the whole promise of the control is that it changes nothing.

process.env.MONGODB_URL = resolveMongoUrl();
process.env.WORKFLOW_ENGINE = 'on';

const { SCHEMA_TYPE } = require('../../Config/schemaType');
const { dbCollections } = require('../../Config/collections');
const { MongoDbCrudOpration } = require('../../utils/mongo-handler/mongoQueries');
const { closeConnection } = require('../../middlewares/mongoConnector/helper');
const { ROLE_OWNER, ROLE_MEMBER } = require('../../Config/roleTypes');
const { SEAT_ACTIVE } = require('../../Config/seatStatus');
const controller = require('../../Modules/Workflows/controller');

const id = () => crypto.randomBytes(12).toString('hex');
const COMPANY = id();
const OWNER = id();
const MEMBER = id();
const PROJECT = id();
const AGENT = id();
const SPRINT = id();

let client;
let task;

const req = ({ uid = OWNER, params = {}, body = {}, query = {} } = {}) => ({
    headers: { companyid: COMPANY }, uid, params, query, body, ip: '127.0.0.1',
});

const res = () => {
    const r = { statusCode: 200, body: null };
    r.status = (code) => { r.statusCode = code; return r; };
    r.send = (body) => { r.body = body; return r; };
    return r;
};

const call = async (handler, options) => {
    const answer = res();
    await handler(req(options), answer);
    return answer;
};

const rows = (type, filter = {}) => MongoDbCrudOpration(COMPANY, { type, data: [filter] }, 'find');

const stepsFor = (taskId) => [
    { id: 'sOne', type: 'agent_run', config: { agentId: AGENT, taskId, budgetUsd: 1 } },
    { id: 'sTwo', type: 'human_approval', dependsOn: ['sOne'], config: { prompt: 'Ship $sOne.findings?', ownerUserId: OWNER } },
];

beforeAll(async () => {
    client = new MongoClient(resolveMongoUrl(), { serverSelectionTimeoutMS: 5000 });
    await client.connect();
    for (const type of [SCHEMA_TYPE.WORKFLOW_DEFINITIONS, SCHEMA_TYPE.WORKFLOW_RUNS, SCHEMA_TYPE.WORKFLOW_STEP_RUNS]) {
        // eslint-disable-next-line no-await-in-loop
        await MongoDbCrudOpration(COMPANY, { type, data: [] }, 'syncIndexes');
    }
    for (const [userId, roleType] of [[OWNER, ROLE_OWNER], [MEMBER, ROLE_MEMBER]]) {
        // eslint-disable-next-line no-await-in-loop
        await MongoDbCrudOpration(COMPANY, {
            type: SCHEMA_TYPE.COMPANY_USERS,
            data: { companyId: COMPANY, userId, userEmail: `${userId}@workflow.test`, roleType, designation: 0, status: SEAT_ACTIVE, isDelete: false },
        }, 'save');
    }
    await MongoDbCrudOpration(COMPANY, {
        type: SCHEMA_TYPE.PROJECTS,
        data: {
            _id: PROJECT, CompanyId: COMPANY, ProjectName: '[workflow-builder] project', ProjectCode: 'WFB', ProjectCurrency: { code: 'USD' },
            ProjectRequiredDefaultComponent: 'task', ProjectType: 'Blank', projectCreatedBy: OWNER, projectIcon: {}, status: 'active', statusType: 'active',
            isPrivateSpace: false, isPersonal: true, personalOwner: OWNER, deletedStatusKey: 0,
        },
    }, 'save');
    task = await MongoDbCrudOpration(COMPANY, {
        type: SCHEMA_TYPE.TASKS,
        data: {
            TaskName: '[workflow-builder] task', TaskKey: `WFB-${crypto.randomBytes(3).toString('hex')}`, TaskType: 'Task', TaskTypeKey: 1,
            ProjectID: PROJECT, CompanyId: COMPANY, status: { text: 'To Do' }, statusType: 'todo', statusKey: 1, isParentTask: false,
            Task_Leader: OWNER, sprintArray: [], sprintId: SPRINT, Task_Priority: 'Medium', deletedStatusKey: 0,
        },
    }, 'save');
});

afterAll(async () => {
    if (client) {
        await client.db(COMPANY).dropDatabase().catch(() => {});
        await client.close();
    }
    closeConnection(COMPANY);
    closeConnection(dbCollections.GLOBAL);
});

describe('a saved workflow is stored turned off', () => {
    it('stores enabled false even when the request asked for true, and turning it on is a second write', async () => {
        const created = await call(controller.createDefinition, { body: { name: 'Ship it', enabled: true, steps: stepsFor(String(task._id)) } });
        expect(created.body.status).toBe(true);
        const workflowId = String(created.body.data._id);

        const [stored] = await rows(SCHEMA_TYPE.WORKFLOW_DEFINITIONS, { _id: workflowId });
        expect(stored.enabled).toBe(false);
        expect(stored.steps).toHaveLength(2);

        const refused = await call(controller.startRun, { body: { definitionId: workflowId } });
        expect(refused.statusCode).toBe(409);
        expect(await rows(SCHEMA_TYPE.WORKFLOW_RUNS)).toHaveLength(0);

        const enabled = await call(controller.setDefinitionEnabled, { params: { id: workflowId }, body: { enabled: true } });
        expect(enabled.body.data.enabled).toBe(true);
        const [after] = await rows(SCHEMA_TYPE.WORKFLOW_DEFINITIONS, { _id: workflowId });
        expect(after.enabled).toBe(true);
        expect(String(after.enabledBy)).toBe(OWNER);
    });

    it('refuses a member the list and every write', async () => {
        for (const handler of [controller.listDefinitions, controller.createDefinition, controller.dryRun]) {
            // eslint-disable-next-line no-await-in-loop
            const answer = await call(handler, { uid: MEMBER, body: { name: 'Nope', steps: stepsFor(String(task._id)) } });
            expect(answer.statusCode).toBe(403);
        }
    });
});

describe('a dry run against a real task', () => {
    it('reads the task, plans the order, and writes nothing at all', async () => {
        const before = await rows(SCHEMA_TYPE.WORKFLOW_RUNS);
        const answer = await call(controller.dryRun, { body: { steps: stepsFor(String(task._id)), taskId: String(task._id), budgetUsd: 4 } });

        expect(answer.body.data.valid).toBe(true);
        expect(answer.body.data.input).toMatchObject({ kind: 'task', found: true, name: '[workflow-builder] task' });
        expect(answer.body.data.waves).toEqual([['sOne'], ['sTwo']]);
        expect(answer.body.data.summary).toMatchObject({ stepCount: 2, waveCount: 2, writeCount: 1, approvalCount: 1 });

        expect(await rows(SCHEMA_TYPE.WORKFLOW_RUNS)).toHaveLength(before.length);
        expect(await rows(SCHEMA_TYPE.WORKFLOW_STEP_RUNS)).toHaveLength(0);
        expect(await rows(SCHEMA_TYPE.AUDIT_LOGS)).toHaveLength(0);
    });

    it('names the field rather than planning an invalid workflow', async () => {
        const answer = await call(controller.dryRun, { body: { steps: [{ id: 'sOne', type: 'tool_call', config: {} }] } });
        expect(answer.body.data.valid).toBe(false);
        expect(answer.body.data.errors[0]).toMatch(/config\.tool: required/);
    });
});
