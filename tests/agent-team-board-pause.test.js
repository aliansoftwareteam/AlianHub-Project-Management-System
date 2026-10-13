const fakeMongo = require('./fixtures/fakeMongo');

const mockDb = fakeMongo.create();

jest.mock('../utils/mongo-handler/mongoQueries', () => ({ MongoDbCrudOpration: (...a) => mockDb.crud(...a) }));
jest.mock('../event/socketEventEmitter', () => ({ emit: jest.fn() }));
jest.mock('../Config/loggerConfig', () => ({ info: jest.fn(), error: jest.fn(), warn: jest.fn(), debug: jest.fn() }));
jest.mock('../utils/commonFunctions', () => ({ removeCache: jest.fn() }));
jest.mock('../Config/permissionGuard', () => ({
    getRoleType: jest.fn(async () => 1),
    isPrivileged: (r) => r === 1 || r === 2,
    evaluatePermission: jest.fn(async () => 1),
    isWritable: () => true,
    isReadable: () => true,
}));
jest.mock('../Modules/Agents/scope', () => ({
    visibleProjectIds: jest.fn(async () => []),
    visibleProjects: jest.fn(async () => []),
}));

const { dbCollections } = require('../Config/collections');

beforeAll(() => require('../Modules/AICore/persistence').useInMemory());
const team = require('../Modules/Agents/team');

const C = '6f0000000000000000000c01';
const OTHER_COMPANY = '6f0000000000000000000c02';
const OWNER = '6f0000000000000000000001';

const company = (_id, agentPolicy) => mockDb.seed(dbCollections.COMPANIES, { _id, ...(agentPolicy ? { agentPolicy } : {}) });

beforeEach(() => {
    Object.keys(mockDb.store).forEach((type) => { mockDb.store[type].length = 0; });
});

describe('the team board, which every screen that shows agents at work reads', () => {
    it('says the workspace\'s connected agents are paused while they are', async () => {
        company(C, { connectedPaused: true });
        expect((await team.board(C, { viewerId: OWNER })).connectedPaused).toBe(true);
    });

    it('says they are not while they are not, whatever another workspace holds', async () => {
        company(C);
        company(OTHER_COMPANY, { connectedPaused: true });
        expect((await team.board(C, { viewerId: OWNER })).connectedPaused).toBe(false);
    });

    it('says nothing of it when the pause cannot be read, and still answers the board', async () => {
        company(C, { connectedPaused: true });
        const real = mockDb.crud.getMockImplementation();
        mockDb.crud.mockImplementation(async (companyId, query, method) => {
            if (query.type === dbCollections.COMPANIES) throw new Error('read failed');
            return real(companyId, query, method);
        });
        const board = await team.board(C, { viewerId: OWNER });
        mockDb.crud.mockImplementation(real);
        expect(board).not.toHaveProperty('connectedPaused');
        expect(Array.isArray(board.agents)).toBe(true);
    });
});
