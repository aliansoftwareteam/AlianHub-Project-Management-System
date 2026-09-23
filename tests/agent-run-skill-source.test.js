const mockDb = require('./fixtures/fakeMongo').create();

jest.mock('../utils/mongo-handler/mongoQueries', () => ({ MongoDbCrudOpration: (...a) => mockDb.crud(...a) }));
jest.mock('../event/socketEventEmitter', () => ({ emit: jest.fn() }));
jest.mock('../Config/loggerConfig', () => ({ info: jest.fn(), error: jest.fn(), warn: jest.fn(), debug: jest.fn() }));

const { SCHEMA_TYPE } = require('../Config/schemaType');
const { agentRunsSchema } = require('../utils/mongo-handler/createSchema');
const runs = require('../Modules/Agents/runs');
const proposals = require('../Modules/Agents/proposals');

const C = '6f0000000000000000000c01';
const AGENT_ID = '6f0000000000000000000a01';
const FLAGS = ['SKILL_EXTERNAL_READS', 'PR_SUMMARY_AS_DATA'];

const agent = () => ({ _id: AGENT_ID, name: 'Reviewer', ownerId: 'owner1', autonomy: 1, allowedActions: ['task.comment'], projectIds: [], skills: [{ key: 'pr.summary', enabled: true }], account: 'workspace', paused: false });
const start = async (skill = 'pr.summary') => (await runs.start(C, { agent: agent(), skill, trigger: 'manual', startedBy: 'u1' })).run;
const companyCopy = (key, version) => ({ key, name: 'Our reviewer', version, enabled: true, inputs: [], gather: [], prompt: { partials: [], instructions: 'Review.', template: 'Review {{ task.name }}', output: {} }, emit: [], emits: [] });

const saved = {};
beforeAll(() => FLAGS.forEach((k) => { saved[k] = process.env[k]; }));
afterEach(() => FLAGS.forEach((k) => { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; }));
beforeEach(() => {
    Object.keys(mockDb.store).forEach((k) => { mockDb.store[k].length = 0; });
    mockDb.seed(SCHEMA_TYPE.AGENTS, agent());
});

describe('the skill source a run records at start', () => {
    it('is the built-in data seed when both flags are on', async () => {
        FLAGS.forEach((k) => { process.env[k] = 'on'; });
        expect((await start()).skillSource).toEqual({ kind: 'seed' });
    });

    it('is the built-in code skill when the flags are off', async () => {
        FLAGS.forEach((k) => { delete process.env[k]; });
        expect((await start()).skillSource).toEqual({ kind: 'code' });
    });

    it('is the code skill when only PR_SUMMARY_AS_DATA is on', async () => {
        delete process.env.SKILL_EXTERNAL_READS;
        process.env.PR_SUMMARY_AS_DATA = 'on';
        expect((await start()).skillSource).toEqual({ kind: 'code' });
    });

    it('is a seed for a skill that only ships as data', async () => {
        expect((await start('risk.today')).skillSource).toEqual({ kind: 'seed' });
    });

    it('is the workspace copy with its version when the company stored one', async () => {
        mockDb.seed(SCHEMA_TYPE.AGENT_SKILLS, companyCopy('pr.summary', 3));
        expect((await start()).skillSource).toEqual({ kind: 'workspace', version: 3 });
    });

    it('stays what it was at start after the company edits its copy', async () => {
        mockDb.seed(SCHEMA_TYPE.AGENT_SKILLS, companyCopy('pr.summary', 3));
        const run = await start();
        mockDb.store[SCHEMA_TYPE.AGENT_SKILLS][0].version = 4;
        expect((await runs.get(C, run._id)).skillSource).toEqual({ kind: 'workspace', version: 3 });
    });

    it('is declared on the strict run schema, so Mongoose keeps it', () => {
        expect(agentRunsSchema.path('skillSource')).toBeTruthy();
    });
});

describe('the proposal list', () => {
    it('carries the source of the run that filed each proposal', async () => {
        mockDb.seed(SCHEMA_TYPE.AGENT_SKILLS, companyCopy('pr.summary', 3));
        const run = await start();
        mockDb.seed(SCHEMA_TYPE.AGENT_PROPOSALS, { agentId: AGENT_ID, runId: String(run._id), what: 'Comment', status: 'pending', changes: [], createdAt: new Date() });
        mockDb.seed(SCHEMA_TYPE.AGENT_PROPOSALS, { agentId: AGENT_ID, what: 'By hand', status: 'pending', changes: [], createdAt: new Date() });
        const out = await proposals.list(C, { status: 'pending' });
        const byWhat = Object.fromEntries(out.proposals.map((p) => [p.what, p]));
        expect(byWhat.Comment.skillSource).toEqual({ kind: 'workspace', version: 3 });
        expect(byWhat['By hand'].skillSource).toBeUndefined();
    });
});
