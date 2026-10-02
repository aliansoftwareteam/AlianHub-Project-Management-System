/* Work that waits on a timer after a write belongs to no request: when it runs, it runs under no token's project
   list, no agent's mark and no request, whichever request started the wait. */
const mockReads = [];
const mockFound = {};
const mockContext = () => {
    const { narrowingFor } = require('../Config/tokenNarrowing');
    const { agentOf } = require('../Config/agentRequest');
    return {
        narrowedTo: narrowingFor('6f00000000000000000d0011'),
        agent: agentOf('6f00000000000000000d0011'),
        mark: require('../Modules/Agents/actingAgent').current(),
        request: require('../Config/requestContext').get(),
    };
};

jest.mock('../utils/mongo-handler/mongoQueries', () => ({
    MongoDbCrudOpration: async (companyId, query, method) => {
        mockReads.push({ type: query.type, ...mockContext() });
        return method === 'find' ? [] : (mockFound[query.type] || null);
    },
    validateObjectId: (id) => /^[a-f0-9]{24}$/i.test(String(id)),
}));
jest.mock('../Config/loggerConfig', () => ({ error: jest.fn(), info: jest.fn(), warn: jest.fn(), debug: jest.fn() }));

const { myCache } = require('../Config/config');
const { SCHEMA_TYPE } = require('../Config/schemaType');
const { MongoDbCrudOpration } = require('../utils/mongo-handler/mongoQueries');
const socketEmitter = require('../event/socketEventEmitter');
const { runNarrowed } = require('../Config/tokenNarrowing');
const { runForAgentOf } = require('../Config/agentRequest');
const actingAgent = require('../Modules/Agents/actingAgent');
const requestContext = require('../Config/requestContext');
const autoRefill = require('../Modules/CustomField/aiFields/autoRefill');
const goalEvents = require('../Modules/Goals/goalEvents');
const dispatcher = require('../Modules/Webhooks/dispatcher');
const pageSettle = require('../Modules/Pages/helpers/pageSettle');

const C = '6f00000000000000000d0c01';
const PERSON = '6f00000000000000000d0011';
const PROJECT = '6f00000000000000000d0a01';
const LIST = '6f00000000000000000d0b01';
const TASK = '6f00000000000000000d0701';
const PAGE = '6f00000000000000000d0901';
const WAIT_MS = 20;

const AGENT = { userId: PERSON, agentId: 'agent-1', agentName: 'Helper', depth: 0 };
const REQUEST = { id: 'req-1', uid: PERSON };
const NO_REQUEST = { narrowedTo: null, agent: null, mark: null, request: null };

/* What a request made with an agent's token, narrowed to one project, runs its handler inside. */
const insideARequest = (work) => requestContext.run(REQUEST, () => runNarrowed({ userId: PERSON, projectIds: [PROJECT] },
    () => runForAgentOf(PERSON, { chat: false }, () => actingAgent.runAs(AGENT, work))));

const realSetTimeout = global.setTimeout;
const settle = (ms) => new Promise((resolve) => { realSetTimeout(resolve, ms); });
const readsOf = (type) => mockReads.filter((read) => read.type === type).map(({ type: _type, ...context }) => context);

const taskChange = () => socketEmitter.emit('task:update', {
    data: { _id: TASK, CompanyId: C, TaskName: 'Renamed', Task_Priority: 'HIGH', ProjectID: PROJECT, sprintId: LIST, deletedStatusKey: 0 },
    updatedFields: { TaskName: 'Renamed', Task_Priority: 'HIGH' },
});

beforeAll(() => {
    jest.spyOn(global, 'setTimeout').mockImplementation((run, ms, ...args) => realSetTimeout(run, Math.min(Number(ms) || 0, WAIT_MS), ...args));
    dispatcher.start();
});

afterAll(() => {
    global.setTimeout.mockRestore();
});

beforeEach(() => {
    myCache.flushAll();
    dispatcher.invalidateCompanyCache(C);
    mockReads.length = 0;
    Object.keys(mockFound).forEach((type) => delete mockFound[type]);
});

afterEach(async () => {
    autoRefill.stop();
    pageSettle.forgetAll();
    await goalEvents.flushAll();
});

describe('the wait a request starts', () => {
    it('is started inside what the request runs in', async () => {
        await insideARequest(() => MongoDbCrudOpration(C, { type: SCHEMA_TYPE.TASKS, data: [{}] }, 'findOne'));
        expect(readsOf(SCHEMA_TYPE.TASKS)).toEqual([{ narrowedTo: [PROJECT], agent: { uid: PERSON, chat: false }, mark: AGENT, request: REQUEST }]);
    });
});

describe('work that runs after the wait', () => {
    const afterTheWait = async (start) => {
        insideARequest(start);
        expect(mockReads).toEqual([]);
        await settle(WAIT_MS * 5);
    };

    it('an AI field filled again after an edit', async () => {
        autoRefill.start({ debounceMs: WAIT_MS });
        await afterTheWait(taskChange);
        expect(readsOf(SCHEMA_TYPE.CUSTOM_FIELDS)).toEqual([NO_REQUEST]);
    });

    it('a goal\'s count marked for a recount', async () => {
        await afterTheWait(() => goalEvents.onEnvelope({ companyId: C, type: 'task.created', entity: { kind: 'task', id: TASK }, scope: { sprintId: LIST }, changedFields: [] }));
        expect(readsOf(SCHEMA_TYPE.GOALS)).toEqual([NO_REQUEST]);
    });

    it('a task change sent to the workspace\'s webhooks', async () => {
        await afterTheWait(taskChange);
        expect(readsOf(SCHEMA_TYPE.WEBHOOKS)).toEqual([NO_REQUEST]);
    });

    it('a doc settled after its last autosave', async () => {
        await afterTheWait(() => pageSettle.settleLater(C, PAGE));
        expect(readsOf(SCHEMA_TYPE.PAGES)).toEqual([NO_REQUEST, NO_REQUEST]);
    });

    it('a settled doc is announced as a doc always is, naming no writer, whoever saved it', async () => {
        mockFound[SCHEMA_TYPE.PAGES] = { _id: PAGE, title: 'Notes', mentionsTold: [], editedBy: PERSON };
        const announced = [];
        const hear = (payload) => announced.push(Object.keys(payload).sort());
        socketEmitter.on('pages:update', hear);
        await afterTheWait(() => pageSettle.settleLater(C, PAGE));
        mockReads.length = 0;
        pageSettle.settleLater(C, PAGE);
        await settle(WAIT_MS * 5);
        socketEmitter.off('pages:update', hear);

        expect(announced).toEqual([['companyId', 'data', 'module', 'type'], ['companyId', 'data', 'module', 'type']]);
    });
});
