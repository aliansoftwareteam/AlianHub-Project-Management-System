const mockDb = require('./fixtures/fakeMongo').create();

jest.mock('../utils/mongo-handler/mongoQueries', () => ({ MongoDbCrudOpration: (...a) => mockDb.crud(...a) }));
jest.mock('../utils/commonFunctions', () => ({ removeCache: jest.fn() }));
jest.mock('../Config/config', () => ({ myCache: new (require('node-cache'))() }));
jest.mock('../Modules/notification/defaults', () => ({
    ensureNotificationDefaults: jest.fn(async (companyId, userId) => mockDb.seed('notifications_settings', { userId: String(userId), tasks: { items: [] } })),
}));

const { SCHEMA_TYPE } = require('../Config/schemaType');
const { myCache } = require('../Config/config');
const { ensureNotificationDefaults } = require('../Modules/notification/defaults');
const ctrl = require('../Modules/settings/settingNotifications/controller');

const C = '6f0000000000000000000c01';
const ME = '6f00000000000000000000b1';
const OTHER = '6f00000000000000000000b2';

const read = async (uid, id) => {
    const r = { code: 200, body: null, headers: {} };
    r.status = (c) => { r.code = c; return r; };
    r.json = (b) => { r.body = b; return r; };
    r.set = (h) => { Object.assign(r.headers, h); return r; };
    await ctrl.getNotifications({ headers: { companyid: C }, uid, params: { id }, body: {}, query: {} }, r);
    return r;
};
const settingsDocs = () => mockDb.store[SCHEMA_TYPE.NOTIFICATIONS_SETTINGS];

beforeEach(() => {
    Object.keys(mockDb.store).forEach((k) => { mockDb.store[k].length = 0; });
    mockDb.calls.length = 0;
    myCache.flushAll();
    jest.clearAllMocks();
    mockDb.seed(SCHEMA_TYPE.NOTIFICATIONS_SETTINGS, { _id: '6f0000000000000000000d01', userId: ME, tasks: { items: [] } });
    mockDb.seed(SCHEMA_TYPE.NOTIFICATIONS_SETTINGS, { _id: '6f0000000000000000000d02', userId: OTHER, tasks: { items: [] } });
});

describe('GET /api/v1/notifications/:id', () => {
    it('answers the caller\'s own settings document', async () => {
        const r = await read(ME, ME);
        expect(r.code).toBe(200);
        expect(r.body).toMatchObject({ userId: ME });
    });

    it.each(['preferences', 'not-an-id', 'undefined'])('refuses the word %s with 400 and creates no document', async (word) => {
        const r = await read(ME, word);
        expect(r.code).toBe(400);
        expect(r.body.status).toBe(false);
        expect(ensureNotificationDefaults).not.toHaveBeenCalled();
        expect(settingsDocs().some((d) => d.userId === word)).toBe(false);
    });

    it('does not hand one user another user\'s settings', async () => {
        const r = await read(ME, OTHER);
        expect(r.code).toBe(403);
        expect(r.body.status).toBe(false);
        expect(r.body.userId).toBeUndefined();
    });

    it('does not create defaults for someone else', async () => {
        const stranger = '6f00000000000000000000b9';
        expect((await read(ME, stranger)).code).toBe(403);
        expect(ensureNotificationDefaults).not.toHaveBeenCalled();
    });

    it('does not serve another user\'s cached document either', async () => {
        await read(OTHER, OTHER);
        const r = await read(ME, OTHER);
        expect(r.code).toBe(403);
        expect(r.headers.FromCache).toBeUndefined();
    });
});
