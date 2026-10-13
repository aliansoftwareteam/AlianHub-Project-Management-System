jest.setTimeout(30000);
const mockDb = require('./fixtures/fakeMongo').create();

jest.mock('../utils/mongo-handler/mongoQueries', () => ({
    MongoDbCrudOpration: (companyId, q, method) => mockDb.crud(companyId, q, method),
    validateObjectId: (id) => /^[a-f0-9]{24}$/i.test(String(id)),
}));
jest.mock('../Config/config', () => ({ myCache: { get: () => undefined, set: () => {}, del: () => {}, keys: () => [], getTtl: () => 0, flushAll: () => {} } }));
jest.mock('../Config/loggerConfig', () => ({ info: jest.fn(), error: jest.fn(), warn: jest.fn(), debug: jest.fn() }));

const mongoose = require('mongoose');
const world = require('./fixtures/accessWorld');
const { commentThreadAccess } = require('../Modules/Comments/helpers/threadAccess');

const { CID, OWNER, ADMIN, INSIDER, OUTSIDER, GUEST, P_OPEN, L_OPEN, T_OPEN } = world;
const { seed } = world.create(mockDb);

const EVERYONE = [['the owner', OWNER], ['an admin', ADMIN], ['a member on everything private', INSIDER], ['a member', OUTSIDER], ['a guest', GUEST]];
/* What a query string can carry in place of an id: `taskId[$ne]=x` arrives as an object. */
const NOT_AN_ID = [['a condition', { $ne: 'x' }], ['a list', [T_OPEN]], ['a number', 7]];

beforeEach(() => { jest.clearAllMocks(); seed(); });

describe('a comment thread is named by ids', () => {
    it.each(EVERYONE)('and %s opens the thread of a task they can open, named as text or as a stored id', async (who, uid) => {
        expect((await commentThreadAccess(CID, uid, { projectId: P_OPEN, sprintId: L_OPEN, taskId: T_OPEN })).allowed).toBe(true);
        expect((await commentThreadAccess(CID, uid, { projectId: new mongoose.Types.ObjectId(P_OPEN), sprintId: new mongoose.Types.ObjectId(L_OPEN), taskId: new mongoose.Types.ObjectId(T_OPEN) })).allowed).toBe(true);
        expect((await commentThreadAccess(CID, uid, { projectId: P_OPEN, sprintId: L_OPEN, taskId: 'default' })).allowed).toBe(true);
    });

    const cases = NOT_AN_ID.flatMap(([what, value]) => ['sprintId', 'taskId'].map((field) => [field, what, value]));
    it.each(cases)('and a request whose %s is %s names no thread', async (field, what, value) => {
        for (const [, uid] of EVERYONE) {
            expect(await commentThreadAccess(CID, uid, { projectId: P_OPEN, sprintId: L_OPEN, taskId: T_OPEN, [field]: value })).toEqual({ allowed: false, statusCode: 400 });
        }
    });
});
