/* Task 040 phase 2: projectId on project rules, call notes, dashboards, agent findings, runs, proposals
   and delegated sessions is stored as an ObjectId, whichever form the writer passed. Every stored form
   is read from what Mongoose hands the driver under the real schema; the handlers' own database calls
   are only recorded and replayed. */
const mongoose = require('mongoose');
const verified = require('./fixtures/verifiedRequest');

process.env.STORAGE_TYPE = process.env.STORAGE_TYPE || 'server';

const mockCrud = jest.fn();
jest.mock('../utils/mongo-handler/mongoQueries', () => ({ MongoDbCrudOpration: (...a) => mockCrud(...a) }));
jest.mock('../Config/loggerConfig', () => ({ info: jest.fn(), error: jest.fn(), warn: jest.fn() }));
jest.mock('../Config/config', () => ({ myCache: { get: jest.fn(), set: jest.fn(), del: jest.fn(), getTtl: jest.fn() } }));
jest.mock('../utils/commonFunctions', () => ({ removeCache: jest.fn() }));
jest.mock('../event/socketEventEmitter', () => ({ emit: jest.fn() }));
jest.mock('../Modules/Sprints/controller', () => ({ addSprintFun: jest.fn() }));
jest.mock('../Modules/MainChats/controller', () => ({ updateMainChat: jest.fn() }));
jest.mock('../Modules/AI/meetingNotes', () => ({ generateMeetingNotes: jest.fn(async () => ({ status: false, reason: '' })) }));
jest.mock('../Modules/Agents/revisions', () => ({ pinFor: jest.fn(async () => ({ agentRevision: 0, skillRevision: null })) }));

const {
    projectRulesSchema, callsSchema, userDashboard, agentFindingsSchema, agentRunsSchema, agentProposalsSchema, agentSessionsSchema,
} = require('../utils/mongo-handler/createSchema');
const { realModelStore, isObjectId } = require('./fixtures/realModelStore');
const { SCHEMA_TYPE } = require('../Config/schemaType');
const importData = require('../utils/data');
const notes = require('../Modules/Calls/notes');
const dashboard = require('../Modules/UserDashboard/controller');
const findingMemory = require('../Modules/Agents/engine/findingMemory');
const runs = require('../Modules/Agents/runs');
const proposals = require('../Modules/Agents/proposals');
const sessionStore = require('../Modules/AgentSessions/store');

const C = '6f0000000000000000000c01';
const ME = '6f0000000000000000000001';
const PROJECT = '6f0000000000000000000b01';
const TASK = '6f0000000000000000000d01';
const ROW = '6f0000000000000000000e01';
const oid = (id) => new mongoose.Types.ObjectId(id);

const COLLECTIONS = [
    { type: SCHEMA_TYPE.PROJECT_RULES, schema: projectRulesSchema, doc: { name: 'Create', key: 'task_create', isParent: false, roles: [] } },
    { type: SCHEMA_TYPE.CALLS, schema: callsSchema, doc: { callId: 'call-1', participants: [ME] } },
    { type: SCHEMA_TYPE.USERDASHBOARD, schema: userDashboard, doc: { userId: ME, cards: [], title: 'Team', isDeleted: false, visibility: 'project', createdAt: new Date(), updatedAt: new Date() } },
    { type: SCHEMA_TYPE.AGENT_FINDINGS, schema: agentFindingsSchema, doc: { taskId: TASK, factId: 'meta-length' } },
    { type: SCHEMA_TYPE.AGENT_RUNS, schema: agentRunsSchema, doc: { agentId: 'a1', status: 'running' } },
    { type: SCHEMA_TYPE.AGENT_PROPOSALS, schema: agentProposalsSchema, doc: { agentId: 'a1', what: 'Comment', status: 'pending' } },
    { type: SCHEMA_TYPE.AGENT_SESSIONS, schema: agentSessionsSchema, doc: { taskId: TASK, clientId: 'cl', grantId: 'g', delegatedBy: ME, state: 'offered', createdAt: new Date() } },
];
const STORES = Object.fromEntries(COLLECTIONS.map(({ type, schema }) => [type, realModelStore(type, schema)]));

/* The written parts of a driver call only: a filter is sent as written and is checked on its own. */
const writtenParts = ({ op, args }) => {
    if (op === 'insertOne') return [args[0]];
    if (op === 'insertMany') return args[0];
    if (op === 'bulkWrite') return args[0].map((item) => (item.insertOne ? item.insertOne.document : (item.updateOne || item.updateMany).update));
    return [args[1]];
};
const projectIdOf = (part) => {
    if (part.$set && 'projectId' in part.$set) return part.$set.projectId;
    if (part.$setOnInsert && 'projectId' in part.$setOnInsert) return part.$setOnInsert.projectId;
    return part.projectId;
};
const storedProjectIds = async (type, method, data) => {
    const { writes, error } = await STORES[type].driverWrites(method, data);
    expect(error).toBeNull();
    return writes.flatMap(writtenParts).map(projectIdOf).filter((value) => value !== undefined);
};
const expectObjectIds = (stored) => {
    expect(stored.length).toBeGreaterThan(0);
    stored.forEach((value) => {
        expect(isObjectId(value)).toBe(true);
        expect(String(value)).toBe(PROJECT);
    });
};

describe.each(COLLECTIONS)('the $type schema stores the project id as an ObjectId', ({ type, doc }) => {
    const withProject = (projectId) => ({ ...doc, projectId });

    test.each([
        ['save', 'save', () => withProject(PROJECT)],
        ['insertMany', 'insertMany', () => [[withProject(PROJECT)]]],
        ['updateOne with $set', 'updateOne', () => [{ _id: ROW }, { $set: { projectId: PROJECT } }]],
        ['updateMany', 'updateMany', () => [{ projectId: PROJECT }, { $set: { projectId: PROJECT } }]],
        ['findOneAndUpdate with an upsert', 'findOneAndUpdate', () => [{ _id: ROW }, { $set: { projectId: PROJECT } }, { new: true, upsert: true }]],
        ['bulkWrite', 'bulkWrite', () => [[{ insertOne: { document: withProject(PROJECT) } }, { updateOne: { filter: { _id: ROW }, update: { $set: { projectId: PROJECT } } } }]]],
    ])('%s converts a text id', async (_, method, data) => {
        expectObjectIds(await storedProjectIds(type, method, data()));
    });

    test('an id that is already an ObjectId is stored as it is', async () => {
        expectObjectIds(await storedProjectIds(type, 'save', withProject(oid(PROJECT))));
    });

    test('a value that is not an id is stored as sent', async () => {
        expect(await storedProjectIds(type, 'save', withProject(''))).toEqual(['']);
    });

    test('a filter is sent as written, so a read still matches either form', async () => {
        const { writes, error } = await STORES[type].driverWrites('find', [{ projectId: { $in: [PROJECT, oid(PROJECT)] } }]);
        expect(error).toBeNull();
        const [text, id] = writes[0].args[0].projectId.$in;
        expect(text).toBe(PROJECT);
        expect(isObjectId(id)).toBe(true);
    });
});

describe('every writer of these project ids stores an ObjectId through the schema', () => {
    const call = (handler, { body = {}, params = {} } = {}) => new Promise((resolve, reject) => {
        const r = { code: 200, body: null };
        r.status = (c) => { r.code = c; return r; };
        r.send = (b) => { r.body = b; resolve(r); return r; };
        r.json = r.send;
        Promise.resolve(handler(verified({ headers: { companyid: C }, body, params, query: {}, uid: ME }), r)).catch(reject);
    });
    const replayed = async (type) => {
        const writes = mockCrud.mock.calls
            .filter(([, q, method]) => q.type === type && ['save', 'insertMany', 'updateOne', 'updateMany', 'findOneAndUpdate', 'bulkWrite'].includes(method))
            .map(([, { data }, method]) => ({ method, data }));
        expect(writes.length).toBeGreaterThan(0);
        return (await Promise.all(writes.map(({ method, data }) => storedProjectIds(type, method, data)))).flat();
    };
    const agent = { _id: oid('6f0000000000000000000a01'), name: 'Reviewer', account: 'workspace' };

    beforeEach(() => {
        jest.clearAllMocks();
        mockCrud.mockImplementation(async (companyId, { type, data }, method) => {
            if (type === SCHEMA_TYPE.USERDASHBOARD && method === 'findOne') return { _id: oid(ROW), ownerId: ME, userId: ME, title: 'Team', visibility: 'private', projectId: '' };
            if (type === SCHEMA_TYPE.COMPANY_USERS && method === 'findOne') return { userId: ME, roleType: 1 };
            if (type === SCHEMA_TYPE.PROJECTS && method === 'find') return [{ _id: oid(PROJECT) }];
            if (method === 'insertMany') return data[0].map((row, at) => ({ ...row, _id: `${row.key}-${at}` }));
            if (method === 'save') return { _id: oid(ROW), ...data };
            if (method === 'findOneAndUpdate') return { _id: oid(ROW) };
            return method === 'findOne' ? null : [];
        });
    });

    test('seeding a project\'s own rules (utils/data.js importCompanyRules)', async () => {
        await importData.importCompanyRules(C, 'project', PROJECT);
        expectObjectIds(await replayed(SCHEMA_TYPE.PROJECT_RULES));
    });

    test('saving call notes (Calls/notes.js createNotes)', async () => {
        await call(notes.createNotes, { body: { callId: 'call-1', projectId: PROJECT } });
        expectObjectIds(await replayed(SCHEMA_TYPE.CALLS));
    });

    test.each([
        ['creating a project dashboard (createSharedDashboard)', () => call(dashboard.createSharedDashboard, { body: { title: 'Team', visibility: 'project', projectId: PROJECT } })],
        ['moving a dashboard to a project (updateSharedDashboard)', () => call(dashboard.updateSharedDashboard, { params: { id: ROW }, body: { visibility: 'project', projectId: PROJECT } })],
    ])('%s', async (_, run) => {
        await run();
        expectObjectIds(await replayed(SCHEMA_TYPE.USERDASHBOARD));
    });

    test('remembering a QA finding (findingMemory.record)', async () => {
        await findingMemory.record(C, { projectId: oid(PROJECT), taskId: TASK, factId: 'meta-length', title: 'Meta', severity: 'low' });
        expectObjectIds(await replayed(SCHEMA_TYPE.AGENT_FINDINGS));
    });

    test('starting an agent run (runs.start)', async () => {
        await runs.start(C, { agent, taskId: TASK, projectId: PROJECT, trigger: 'manual', startedBy: ME });
        expectObjectIds(await replayed(SCHEMA_TYPE.AGENT_RUNS));
    });

    test('filing an agent proposal (proposals.create)', async () => {
        await proposals.create(C, { agent, taskId: TASK, projectId: PROJECT, what: 'Post the summary', changes: [{ action: 'task.comment', params: { taskId: TASK, body: 'Done' } }] });
        expectObjectIds(await replayed(SCHEMA_TYPE.AGENT_PROPOSALS));
    });

    test('delegating a task to an outside agent (AgentSessions store.create)', async () => {
        await sessionStore.create(C, { taskId: TASK, projectId: PROJECT, clientId: 'cl', grantId: 'g', delegatedBy: ME, state: 'offered', createdAt: new Date() });
        expectObjectIds(await replayed(SCHEMA_TYPE.AGENT_SESSIONS));
    });
});
