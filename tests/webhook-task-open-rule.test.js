const { EventEmitter } = require('events');

jest.setTimeout(30000);
const mockDb = require('./fixtures/fakeMongo').create();
const mockEmitter = new EventEmitter();

jest.mock('../utils/mongo-handler/mongoQueries', () => ({
    MongoDbCrudOpration: (companyId, q, method) => mockDb.crud(companyId, q, method),
    validateObjectId: (id) => /^[a-f0-9]{24}$/i.test(String(id)),
}));
jest.mock('../Config/config', () => ({ myCache: { get: () => undefined, set: () => {}, del: () => {}, keys: () => [], getTtl: () => 0, flushAll: () => {} } }));
jest.mock('../Config/loggerConfig', () => ({ info: jest.fn(), error: jest.fn(), warn: jest.fn(), debug: jest.fn() }));
jest.mock('../event/socketEventEmitter', () => mockEmitter);
jest.mock('../Modules/Agents/engine/safeFetch', () => ({ safeFetch: jest.fn(async () => ({ status: 200, data: 'ok' })) }));

const { SCHEMA_TYPE } = require('../Config/schemaType');
const world = require('./fixtures/accessWorld');
const { safeFetch } = require('../Modules/Agents/engine/safeFetch');
const dispatcher = require('../Modules/Webhooks/dispatcher');

const { CID, OWNER, ADMIN, INSIDER, OUTSIDER, GUEST, P_OPEN, L_OPEN, T_OPEN, T_SECRET, T_PRIVATE, T_PERSONAL, OPENS } = world;
const { seed, task } = world.create(mockDb);

const PEOPLE = { owner: OWNER, admin: ADMIN, insider: INSIDER, outsider: OUTSIDER, guest: GUEST };
const CONVERSATION = '6f0000000000000000000cd2';
const NOBODY = 'kept-by-nobody';

/* Each person keeps a webhook for every task event; one more was made before a webhook had a keeper, and is the owners' and admins'. */
const seedRows = () => {
    seed();
    Object.entries(PEOPLE).forEach(([name, createdBy]) => mockDb.seed(SCHEMA_TYPE.WEBHOOKS, { name, url: `https://hooks.example.test/${name}`, events: ['*'], secret: 's'.repeat(40), format: 'json', active: true, createdBy }));
    mockDb.seed(SCHEMA_TYPE.WEBHOOKS, { name: NOBODY, url: `https://hooks.example.test/${NOBODY}`, events: ['*'], secret: 's'.repeat(40), format: 'json', active: true });
    mockDb.seed(SCHEMA_TYPE.TASKS, { _id: CONVERSATION, TaskName: 'Adam and Ian', TaskKey: '--', CompanyId: CID, mainChat: true, ProjectID: P_OPEN, sprintId: L_OPEN, AssigneeUserId: [ADMIN, INSIDER], deletedStatusKey: 0 });
};

const toldOf = async (taskId) => {
    safeFetch.mockClear();
    dispatcher.invalidateCompanyCache(CID);
    mockEmitter.emit('task:update', { data: { ...task(taskId) }, updatedFields: { Task_Priority: 'HIGH' } });
    await jest.advanceTimersByTimeAsync(2500);
    return safeFetch.mock.calls.map(([url]) => String(url).split('/').pop()).sort();
};

beforeEach(() => { jest.clearAllMocks(); seedRows(); jest.useFakeTimers(); dispatcher.start(); });
afterEach(async () => { await jest.advanceTimersByTimeAsync(10000); jest.useRealTimers(); });

describe('a webhook is told of a task', () => {
    it.each([['an open task', T_OPEN], ['a task of a private list', T_SECRET], ['a task of a private project', T_PRIVATE], ['a task of a personal list', T_PERSONAL]])('%s: when the person who keeps it can open that task', async (name, taskId) => {
        const keepers = Object.entries(PEOPLE).filter(([, uid]) => OPENS[uid].includes(taskId)).map(([who]) => who);
        expect(await toldOf(taskId)).toEqual([...keepers, ...(taskId === T_PERSONAL ? [] : [NOBODY])].sort());
    });

    it('and never of a conversation', async () => {
        expect(await toldOf(CONVERSATION)).toEqual([]);
    });
});
