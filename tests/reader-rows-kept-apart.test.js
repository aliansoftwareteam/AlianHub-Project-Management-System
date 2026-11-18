jest.setTimeout(30000);
const mockDb = require('./fixtures/fakeMongo').create();
const mockKept = new Map();

jest.mock('../utils/mongo-handler/mongoQueries', () => ({
    MongoDbCrudOpration: (companyId, q, method) => mockDb.crud(companyId, q, method),
    validateObjectId: (id) => /^[a-f0-9]{24}$/i.test(String(id)),
}));
jest.mock('../Config/config', () => ({
    myCache: { get: (key) => mockKept.get(key), set: (key, value) => { mockKept.set(key, value); }, del: (key) => { mockKept.delete(key); }, keys: () => [...mockKept.keys()], getTtl: () => 0, flushAll: () => mockKept.clear() },
}));
jest.mock('../Config/loggerConfig', () => ({ info: jest.fn(), error: jest.fn(), warn: jest.fn(), debug: jest.fn() }));

const { SCHEMA_TYPE } = require('../Config/schemaType');
const world = require('./fixtures/accessWorld');
const { runNarrowed } = require('../Config/tokenNarrowing');
const { noticesKeptFromReader } = require('../Modules/Comments/helpers/readerRows');

const { CID, OWNER, INSIDER, P_OPEN, P_PRIVATE, L_OPEN, L_PRIVATE, T_OPEN, T_PRIVATE } = world;
const { seed } = world.create(mockDb);

const notice = (projectId, sprintId, taskId) => mockDb.seed(SCHEMA_TYPE.NOTIFICATIONS, {
    projectId, sprintId, taskId, key: 'task_edit', type: 'tasks', message: 'notice', userId: OWNER, receiverID: INSIDER, assigneeUsers: [INSIDER], notSeen: [INSIDER], companyId: CID,
});
const asPerson = () => noticesKeptFromReader(CID, INSIDER);
const asNarrowedToken = () => runNarrowed({ userId: INSIDER, projectIds: [P_PRIVATE] }, () => noticesKeptFromReader(CID, INSIDER));
const keeps = (clause, taskId) => JSON.stringify(clause).includes(taskId);

beforeEach(() => {
    mockKept.clear();
    seed();
    notice(P_OPEN, L_OPEN, T_OPEN);
    notice(P_PRIVATE, L_PRIVATE, T_PRIVATE);
});

describe('what is kept from a reader for a few seconds', () => {
    it('is kept for a token narrowed to some projects apart from the person, whoever asks first', async () => {
        const person = await asPerson();
        const token = await asNarrowedToken();

        expect(keeps(person, T_OPEN)).toBe(false);
        expect(keeps(token, T_OPEN)).toBe(true);
        expect(keeps(token, T_PRIVATE)).toBe(false);

        mockKept.clear();
        expect(await asNarrowedToken()).toEqual(token);
        expect(await asPerson()).toEqual(person);
    });

    it('is read once for the same asking', async () => {
        const placeReads = () => mockDb.calls.filter((call) => [SCHEMA_TYPE.PROJECTS, SCHEMA_TYPE.NOTIFICATIONS, SCHEMA_TYPE.MENTIONS].includes(call.type)).length;
        await asPerson();
        const reads = placeReads();
        await asPerson();

        expect(reads).toBeGreaterThan(0);
        expect(placeReads()).toBe(reads);
    });
});
