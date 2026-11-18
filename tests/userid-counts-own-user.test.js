const mockCrud = jest.fn();

jest.mock('../utils/mongo-handler/mongoQueries', () => ({ MongoDbCrudOpration: (...a) => mockCrud(...a) }));
jest.mock('../Config/loggerConfig', () => ({ info: jest.fn(), error: jest.fn(), warn: jest.fn() }));
jest.mock('../event/socketEventEmitter', () => ({ emit: jest.fn() }));

const { SCHEMA_TYPE } = require('../Config/schemaType');
const ctrl = require('../Modules/UserId/controller');

const C = '6f0000000000000000000c01';
const ME = '6f0000000000000000000001';
const TEAMMATE = '6f0000000000000000000002';

const call = async (handler, { body = {}, params = {} }, uid = ME) => {
    const r = { code: 200, body: null };
    r.status = (c) => { r.code = c; return r; };
    r.json = (b) => { r.body = b; return r; };
    r.send = r.json;
    await handler({ headers: { companyid: C }, body, params, query: {}, uid }, r);
    return r;
};

const writes = () => mockCrud.mock.calls.filter(([, { type }, method]) => type === SCHEMA_TYPE.USERID && method === 'findOneAndUpdate');
const reads = () => mockCrud.mock.calls.filter(([, { type }, method]) => type === SCHEMA_TYPE.USERID && method === 'findOne');

beforeEach(() => {
    jest.clearAllMocks();
    mockCrud.mockImplementation(async (companyId, { data }) => ({ _id: 'row', userId: data[0].userId }));
});

describe('PUT /api/v1/collection/userid', () => {
    it.each([['notifications', 'notification_counts'], ['mentions', 'mention_counts']])('clears the signed-in user\'s %s count', async (key, field) => {
        const r = await call(ctrl.updateCounts, { body: { userId: ME, key } });

        expect(r.code).toBe(200);
        expect(writes().map(([, { data }]) => [data[0], data[1]])).toEqual([[{ userId: ME }, { $set: { [field]: 0 } }]]);
    });

    it('clears the signed-in user\'s count when the body names no user', async () => {
        const r = await call(ctrl.updateCounts, { body: { key: 'notifications' } });

        expect(r.code).toBe(200);
        expect(writes()[0][1].data[0]).toEqual({ userId: ME });
    });

    it.each([['another member', TEAMMATE], ['an operator', { $ne: ME }], ['a list', [TEAMMATE]]])('refuses %s as the user and writes nothing', async (_label, userId) => {
        const r = await call(ctrl.updateCounts, { body: { userId, key: 'notifications' } });

        expect(r.code).toBe(403);
        expect(r.body.status).toBe(false);
        expect(writes()).toHaveLength(0);
    });
});

describe('GET /api/v1/collection/userid/:id', () => {
    it('returns the signed-in user\'s counts', async () => {
        const r = await call(ctrl.getCounts, { params: { id: ME } });

        expect(r.code).toBe(200);
        expect(reads()[0][1].data[0]).toEqual({ userId: ME });
    });

    it('refuses another member\'s counts and reads nothing', async () => {
        const r = await call(ctrl.getCounts, { params: { id: TEAMMATE } });

        expect(r.code).toBe(403);
        expect(reads()).toHaveLength(0);
    });
});
