/* Task 047, AI-4b: what the event bus is told about a change an agent makes, on the path that runs the web
   app's own task handlers and on the older path that writes through the automation tools. */
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
jest.mock('../Modules/Knowledge/ingest/events', () => ({ publishCommentChanged: jest.fn(), publish: jest.fn() }));
jest.mock('../Modules/Agents/triggers', () => ({ fromComment: jest.fn(async () => null) }));

const logger = require('../Config/loggerConfig');
const world = require('./fixtures/mcpManageWorld');
const mongoHelper = require('../Modules/Tasks/helpers/mongo_helper');
const domainEventBus = require('../event/domainEventBus');
const matcher = require('../Modules/Automations/engine/matcher');
const actions = require('../Modules/Agents/actions');
const taskRequests = require('../Modules/Agents/taskRequests');
const workRequests = require('../Modules/Agents/workRequests');
const { SCHEMA_TYPE } = require('../Config/schemaType');

mongoHelper.getTotalSprintCount = async () => true;

const { CID, OWNER, P_OPEN, settle } = world;
const { seed, rows } = world.create(mockDb);

const WINDOW_MS = 2500;
const agent = { kind: 'agent', userId: OWNER, agentName: 'Claude', viaAccount: 'personal', personName: 'Olivia Owner', tokenId: world.TOKEN };
const person = { kind: 'human', userId: OWNER };
const plainRule = { reactToAutomation: false };
const optedIn = { reactToAutomation: true };

let fx;
let published = [];
const onEnvelope = (envelope) => published.push(envelope);
const afterWindow = async () => { await settle(); await jest.advanceTimersByTimeAsync(WINDOW_MS); await settle(); };
const statusEvents = () => published.filter((envelope) => envelope.type === 'task.status_changed');
const close = (actor, depth) => taskRequests.executors['task.status.change']({ companyId: CID, actor, params: { taskId: fx.top._id, status: { name: 'Done' } }, depth });

beforeAll(() => {
    domainEventBus.start();
    domainEventBus.bus.on('domain.event', onEnvelope);
});
afterAll(() => domainEventBus.bus.off('domain.event', onEnvelope));

beforeEach(() => {
    jest.useFakeTimers({ doNotFake: ['setImmediate', 'nextTick', 'queueMicrotask'] });
    jest.clearAllMocks();
    published = [];
    fx = seed();
    rows(SCHEMA_TYPE.PROJECTS).find((project) => String(project._id) === P_OPEN).tagsArray = [{ uid: 'tag-1', tagName: 'Urgent' }];
});
afterEach(async () => {
    await afterWindow();
    jest.useRealTimers();
});

describe('a change an agent makes through the task route', () => {
    it('is published as the agent\'s, one hop deeper than the event it answered', async () => {
        await close(agent, 0);
        await afterWindow();
        expect(statusEvents()).toHaveLength(1);
        expect(statusEvents()[0]).toMatchObject({ companyId: CID, actor: { kind: 'system', userId: null }, depth: 0 });
    });

    it('wakes a rule only where the rule opted in to changes made by automations and agents', async () => {
        await close(agent, 0);
        await afterWindow();
        const [envelope] = statusEvents();
        expect(matcher.acceptsActor(plainRule, envelope)).toBe(true);
        expect(matcher.acceptsActor(optedIn, envelope)).toBe(true);
    });

    it('stops a chain at the depth limit', async () => {
        await close(agent, domainEventBus.MAX_DEPTH);
        await afterWindow();
        expect(statusEvents()).toHaveLength(1);
    });

    it('carries the mark through a tag change too', async () => {
        await workRequests.executors['task.tags.add']({ companyId: CID, actor: agent, params: { taskId: fx.top._id, tag: 'Urgent' }, depth: 1 });
        await afterWindow();
        const tagged = published.filter((envelope) => envelope.entity.id === String(fx.top._id));
        expect(tagged.length).toBeGreaterThan(0);
        tagged.forEach((envelope) => expect(envelope).toMatchObject({ actor: { kind: 'system' }, depth: 0 }));
    });
});

describe('a person\'s own change through the same route', () => {
    it('is published as it always was', async () => {
        await close(person, 0);
        await afterWindow();
        expect(statusEvents()).toHaveLength(1);
        expect(statusEvents()[0]).toMatchObject({ actor: { kind: 'system', userId: null }, depth: 0 });
        expect(matcher.acceptsActor(plainRule, statusEvents()[0])).toBe(true);
    });
});

describe('a change an agent makes on the older path', () => {
    it('is published as not a person\'s, one hop deeper, and no rule answers it unless it opted in', async () => {
        await actions.perform({ companyId: CID, actor: agent, action: 'task.update', params: { taskId: fx.top._id, fields: { Task_Priority: 'HIGH' } }, reason: 'triage', depth: 1 });
        await afterWindow();
        const [envelope] = published.filter((entry) => entry.type === 'task.priority_changed');
        expect(envelope).toMatchObject({ companyId: CID, depth: 2 });
        expect(['agent', 'automation']).toContain(envelope.actor.kind);
        expect(matcher.acceptsActor(plainRule, envelope)).toBe(false);
        expect(matcher.acceptsActor(optedIn, envelope)).toBe(true);
    });

    it('drops the event past the depth limit', async () => {
        await actions.perform({ companyId: CID, actor: agent, action: 'task.update', params: { taskId: fx.top._id, fields: { Task_Priority: 'HIGH' } }, reason: 'triage', depth: domainEventBus.MAX_DEPTH });
        await afterWindow();
        expect(published.filter((entry) => entry.type === 'task.priority_changed')).toHaveLength(0);
        expect(logger.error).toHaveBeenCalledWith(expect.stringMatching(/exceeds 3/));
    });
});
