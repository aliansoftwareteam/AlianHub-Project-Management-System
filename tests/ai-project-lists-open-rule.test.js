process.env.STORAGE_TYPE = 'server';
jest.setTimeout(30000);
const mockDb = require('./fixtures/fakeMongo').create();

jest.mock('../utils/mongo-handler/mongoQueries', () => ({
    MongoDbCrudOpration: (companyId, q, method) => mockDb.crud(companyId, q, method),
    validateObjectId: (id) => /^[a-f0-9]{24}$/i.test(String(id)),
}));
jest.mock('../Config/config', () => ({ myCache: { get: () => undefined, set: () => {}, del: () => {}, keys: () => [], getTtl: () => 0, flushAll: () => {} } }));
jest.mock('../Config/loggerConfig', () => ({ info: jest.fn(), error: jest.fn(), warn: jest.fn(), debug: jest.fn() }));
jest.mock('../event/socketEventEmitter', () => ({ emit: jest.fn(), on: jest.fn() }));
jest.mock('../utils/commonFunctions', () => ({ removeCache: jest.fn() }));

const world = require('./fixtures/accessWorld');
const { loadSprintNamesForProject, loadSprintForTasks } = require('../Modules/AIProjectGenerator/orchestrator');

const { CID, OWNER, ADMIN, INSIDER, OUTSIDER, GUEST, P_OPEN, L_OPEN, L_SECRET } = world;
const { seed } = world.create(mockDb);

const EVERYONE = [['the owner', OWNER], ['an admin', ADMIN], ['a member on the private list', INSIDER], ['a member', OUTSIDER], ['a guest', GUEST]];
const ON_IT = [OWNER, ADMIN, INSIDER];

beforeEach(() => { jest.clearAllMocks(); seed(); });

describe('the lists of a project the assistant plans tasks for', () => {
    it.each(EVERYONE)('are named in the plan of %s without a private list they are not on', async (who, uid) => {
        expect((await loadSprintNamesForProject(CID, P_OPEN, uid)).sort()).toEqual(ON_IT.includes(uid) ? ['Open list', 'Private list'] : ['Open list']);
    });

    it.each(EVERYONE)('take the planned tasks of %s only when they can open the list', async (who, uid) => {
        expect(String((await loadSprintForTasks(CID, L_OPEN, uid))._id)).toBe(L_OPEN);
        expect(Boolean(await loadSprintForTasks(CID, L_SECRET, uid))).toBe(ON_IT.includes(uid));
    });
});
