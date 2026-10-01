/* Task 047, AI-4b: a change an agent makes is stored on the history row as the agent's, with the agent's name
   and the person it acted for, and reads the same on both agent paths. */
process.env.STORAGE_TYPE = 'server';
const mockDb = require('./fixtures/fakeMongo').create();

jest.mock('../utils/mongo-handler/mongoQueries', () => ({
    MongoDbCrudOpration: (companyId, q, method) => mockDb.crud(companyId, q, method),
    validateObjectId: (id) => /^[a-f0-9]{24}$/i.test(String(id)),
}));
jest.mock('../Config/config', () => ({ myCache: { get: () => undefined, set: () => {}, del: () => {}, keys: () => [], getTtl: () => 0, flushAll: () => {} } }));
jest.mock('../Config/loggerConfig', () => ({ info: jest.fn(), error: jest.fn(), warn: jest.fn(), debug: jest.fn() }));
const mockStub = () => new Proxy({}, {
    get: (target, name) => {
        if (name === 'then' || name === '__esModule') return undefined;
        target[name] = target[name] || jest.fn(() => Promise.resolve({}));
        return target[name];
    },
});
jest.mock('../Modules/Sprints/controller', () => mockStub());
jest.mock('../Modules/Tasks/helpers/handleNotification', () => mockStub());
jest.mock('../Modules/notification/prepare-notification-data/controllerV2', () => mockStub());
jest.mock('../Modules/Company/eventController', () => mockStub());
jest.mock('../Modules/Company/controller/updateCompany', () => mockStub());
jest.mock('../Modules/notification-count/controller', () => mockStub());
jest.mock('../Modules/MainChats/controller', () => mockStub());
jest.mock('../Modules/LogTime/controllerV2.js', () => mockStub());
jest.mock('../Modules/CustomField/controller', () => mockStub());
jest.mock('../utils/planHelper', () => mockStub());
jest.mock('../utils/commonFunctions.js', () => mockStub());
jest.mock('../common-storage/common-server.js', () => mockStub());
jest.mock('../event/socketEventEmitter', () => ({ emit: jest.fn(), on: jest.fn() }));
jest.mock('../Modules/Knowledge/ingest/events', () => ({ publishCommentChanged: jest.fn(), publish: jest.fn() }));
jest.mock('../Modules/Agents/triggers', () => ({ fromComment: jest.fn(async () => null) }));

const { SCHEMA_TYPE } = require('../Config/schemaType');
const { schema } = require('../utils/mongo-handler/schema');
const world = require('./fixtures/mcpManageWorld');
const mongoHelper = require('../Modules/Tasks/helpers/mongo_helper');
const notifications = require('../Modules/Tasks/helpers/handleNotification');
const { attribution } = require('../Modules/Agents/actor');
const { shownAs } = require('../Modules/Agents/actingAgent');
const actions = require('../Modules/Agents/actions');
const taskRequests = require('../Modules/Agents/taskRequests');
const workRequests = require('../Modules/Agents/workRequests');

mongoHelper.getTotalSprintCount = async () => true;

const { CID, OWNER, P_OPEN, S_OPEN, CLIENT, GRANT_ID, TOKEN, settle } = world;
const { seed, rows } = world.create(mockDb);

const token = { kind: 'agent', userId: OWNER, agentName: 'Claude', viaAccount: 'personal', personName: 'Olivia Owner', tokenId: TOKEN };
const connectedApp = { kind: 'agent', userId: OWNER, agentName: 'Claude', viaAccount: 'external', personName: 'Olivia Owner', tokenId: null, clientId: CLIENT, grantId: GRANT_ID, delegatedBy: OWNER };
const person = { kind: 'human', userId: OWNER };
const AGENT_FIELDS = ['actorType', 'agentName', 'actedFor'];

let fx;
const history = (taskId, type = 'task') => rows(SCHEMA_TYPE.HISTORY).filter((entry) => String(entry.TaskId) === String(taskId) && entry.Type === type);
const run = async (table, action, actor, params) => {
    const out = await table[action]({ companyId: CID, actor, params, depth: 0 });
    await settle();
    return out;
};
const close = (actor) => run(taskRequests.executors, 'task.status.change', actor, { taskId: fx.top._id, status: { name: 'Done' } });

beforeEach(() => {
    jest.clearAllMocks();
    fx = seed();
    rows(SCHEMA_TYPE.PROJECTS).find((project) => String(project._id) === P_OPEN).tagsArray = [{ uid: 'tag-1', tagName: 'Urgent' }];
});
afterEach(settle);

describe('the history row of a change an agent makes through the task route', () => {
    it.each([['a personal token', token], ['a connected app', connectedApp]])('names the agent and the person it acted for: %s', async (_kind, actor) => {
        await close(actor);
        expect(history(fx.top._id)).toHaveLength(1);
        expect(history(fx.top._id)[0]).toMatchObject({
            Key: 'Task_Status', UserId: OWNER, actorType: 'agent', agentName: 'Claude', actedFor: OWNER,
            Message: '<b>Claude, for Olivia Owner</b> has changed <b> Status</b> as <b>Done</b>.',
        });
    });

    it('marks the task\'s row and the project\'s row of a create alike', async () => {
        const made = await run(taskRequests.executors, 'task.add', token, { projectId: P_OPEN, sprintId: S_OPEN, title: 'Ship the importer' });
        const created = rows(SCHEMA_TYPE.HISTORY).filter((entry) => /Ship the importer/.test(entry.Message));
        expect(created.map((entry) => entry.Type).sort()).toEqual(['project', 'task']);
        created.forEach((entry) => {
            expect(entry).toMatchObject({ actorType: 'agent', agentName: 'Claude', actedFor: OWNER });
            expect(entry.Message).toMatch(/^<b>Claude, for Olivia Owner<\/b> has created new <b>Ship the importer<\/b>/);
        });
        expect(made.result.taskId).toBeTruthy();
    });

    it('marks a tag change made through the work tools', async () => {
        await run(workRequests.executors, 'task.tags.add', token, { taskId: fx.top._id, tag: 'Urgent' });
        expect(history(fx.top._id)).toHaveLength(1);
        expect(history(fx.top._id)[0]).toMatchObject({ UserId: OWNER, actorType: 'agent', agentName: 'Claude', actedFor: OWNER });
        expect(history(fx.top._id)[0].Message).toMatch(/^<b>Claude, for Olivia Owner<\/b>/);
    });

    it('builds the line from the stored person and escapes the agent\'s name', async () => {
        await close({ ...token, agentName: '<img src=x onerror=alert(1)>', personName: 'Someone Else' });
        const [entry] = history(fx.top._id);
        expect(entry.Message).not.toMatch(/<img/);
        expect(entry.Message).toMatch(/, for Olivia Owner<\/b> has changed/);
        expect(entry.Message).not.toMatch(/Someone Else/);
        expect(entry.agentName).toBe('<img src=x onerror=alert(1)>');
    });

    it('tells the people it notifies the same name', async () => {
        await close(token);
        expect(notifications.HandleBothNotification).toHaveBeenCalledWith(expect.objectContaining({ userData: expect.objectContaining({ id: OWNER, Employee_Name: 'Claude, for Olivia Owner' }) }));
    });
});

describe('the history row of a person\'s own change', () => {
    it('is stored and worded as before, with no agent fields', async () => {
        await close(person);
        const [entry] = history(fx.top._id);
        expect(entry).toMatchObject({ Key: 'Task_Status', UserId: OWNER, Message: '<b>Olivia Owner</b> has changed <b> Status</b> as <b>Done</b>.' });
        AGENT_FIELDS.forEach((field) => expect(entry).not.toHaveProperty(field));
    });

    it('is not marked by an agent\'s change that ran before it', async () => {
        await close(token);
        await run(taskRequests.executors, 'task.status.change', person, { taskId: fx.top._id, status: { name: 'In Progress' } });
        const mine = history(fx.top._id).find((entry) => /In Progress/.test(entry.Message));
        expect(mine.Message).toMatch(/^<b>Olivia Owner<\/b>/);
        AGENT_FIELDS.forEach((field) => expect(mine).not.toHaveProperty(field));
    });
});

describe('one wording on both agent paths', () => {
    it.each([
        ['a personal token', token, 'Olivia Owner via Claude'],
        ['a connected app', connectedApp, 'Claude for Olivia Owner'],
    ])('%s is shown to people as "Agent, for Person", and the audit log keeps its own label', (_kind, actor, label) => {
        expect(shownAs(actor)).toBe('Claude, for Olivia Owner');
        expect(attribution(actor)).toMatchObject({ actorType: 'agent', label });
    });

    it('takes the tool\'s name from the rule the audit log uses', () => {
        const linked = { ...token, agentName: 'Laptop token', provider: 'claude-code' };
        expect(shownAs(linked)).toBe('claude-code, for Olivia Owner');
        expect(attribution(linked).label).toBe('Olivia Owner via claude-code');
        expect(shownAs({ ...connectedApp, personName: '' })).toBe('Claude, for Member');
    });

    it('names a workspace agent by its own name', () => {
        const reviewer = { kind: 'agent', userId: OWNER, agentId: '6f0000000000000000000a01', agentName: 'Reviewer', viaAccount: 'workspace' };
        expect(shownAs(reviewer)).toBe('Reviewer');
        expect(attribution(reviewer).label).toBe('Reviewer');
    });

    it('leaves a person as a person', () => {
        expect(attribution({ kind: 'human', userId: OWNER, personName: 'Olivia Owner' })).toEqual({ actorId: OWNER, actorType: 'human', label: 'Olivia Owner' });
    });

    it('marks a comment made on the older path with the name the history uses', async () => {
        await actions.perform({ companyId: CID, actor: token, action: 'task.comment', params: { taskId: fx.top._id, body: 'Reviewed.' }, reason: 'review' });
        await settle();
        const [comment] = rows(SCHEMA_TYPE.COMMENTS).filter((row) => row.message === 'Reviewed.');
        expect(comment).toMatchObject({ isAgent: true, actorType: 'agent', agentName: 'Claude, for Olivia Owner', userId: OWNER });
    });
});

describe('the fields are declared', () => {
    it.each(AGENT_FIELDS)('history.%s is in the schema, so a strict save keeps it', (field) => {
        expect(schema.history[field]).toMatchObject({ type: String, required: false });
    });
});
