const mockDb = require('./fixtures/fakeMongo').create();

jest.mock('../utils/mongo-handler/mongoQueries', () => ({ MongoDbCrudOpration: (...a) => mockDb.crud(...a) }));
jest.mock('../Config/loggerConfig', () => ({ error: jest.fn(), info: jest.fn(), warn: jest.fn() }));

/* Sprint 8 slice 11: the sessions list marks the caller's own session, since
 * the client can no longer compare cookie tails itself. */
const { dbCollections } = require('../Config/collections');
const { listOwnSessions } = require('../Modules/Users/sessions');

const UID = '6f0000000000000000000001';
const MINE = '6f00000000000000000000e1';
const THEIRS = '6f00000000000000000000e2';

const res = () => {
    const out = { code: 200 };
    out.status = (c) => { out.code = c; return out; };
    out.json = (b) => { out.body = b; return out; };
    return out;
};

beforeEach(() => {
    Object.keys(mockDb.store).forEach((k) => { mockDb.store[k].length = 0; });
    mockDb.seed(dbCollections.SESSIONS, { _id: MINE, userId: UID, tokenTail: 'aaaaaa', ip: '10.0.0.1' });
    mockDb.seed(dbCollections.SESSIONS, { _id: THEIRS, userId: UID, tokenTail: 'bbbbbb', ip: '10.0.0.2' });
});

describe('listOwnSessions', () => {
    it('marks the request session current and nothing else', async () => {
        const out = res();
        await listOwnSessions({ uid: UID, sessionId: MINE }, out);
        expect(out.code).toBe(200);
        expect(out.body.data).toHaveLength(2);
        expect(out.body.data.find((s) => String(s._id) === MINE)).toMatchObject({ current: true });
        expect(out.body.data.find((s) => String(s._id) === THEIRS)).toMatchObject({ current: false });
    });

    it('marks nothing current without a session id', async () => {
        const out = res();
        await listOwnSessions({ uid: UID }, out);
        expect(out.body.data.every((s) => s.current === false)).toBe(true);
    });

    it('still refuses without a user', async () => {
        const out = res();
        await listOwnSessions({}, out);
        expect(out.code).toBe(401);
    });
});
