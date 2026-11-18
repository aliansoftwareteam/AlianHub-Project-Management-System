jest.mock('../utils/mongo-handler/mongoQueries', () => ({ MongoDbCrudOpration: jest.fn() }));
jest.mock('../Config/loggerConfig', () => ({ info: jest.fn(), error: jest.fn(), warn: jest.fn(), debug: jest.fn() }));

const fs = require('fs');
const path = require('path');
const mongoose = require('mongoose');
const { MongoDbCrudOpration } = require('../utils/mongo-handler/mongoQueries');
const { schema } = require('../utils/mongo-handler/schema.js');
const { SCHEMA_TYPE } = require('../Config/schemaType');
const { toSelfView } = require('../Modules/Users/helpers/userAccessRules');
const { NAV_ITEM_IDS, MAX_PINNED, sanitizeNavPreferences } = require('../Modules/Users/helpers/navPreferencesRules');
const { updateOwnNavPreferences } = require('../Modules/Users/navPreferences');

const UID = '64b000000000000000000001';
const OTHER_UID = '64b000000000000000000002';
const ROUTE = '/api/v2/users/nav-preferences';

const resOf = () => {
    const res = { status: jest.fn(() => res), json: jest.fn() };
    return res;
};

describe('the pinned nav items survive the strict user schema', () => {
    const Users = mongoose.models.NavPrefsUser || mongoose.model('NavPrefsUser', new mongoose.Schema(schema.users, { strict: true, timestamps: true }));

    it('keeps navPreferences.pinned as a list of names', () => {
        const doc = new Users({ navPreferences: { pinned: ['chat', 'time'] } });
        expect(doc.toObject().navPreferences.pinned).toEqual(['chat', 'time']);
    });

    it('leaves a user who never pinned anything without a value', () => {
        const doc = new Users({});
        expect(doc.toObject().navPreferences?.pinned).toBeUndefined();
    });
});

describe('every Shell nav item can be pinned', () => {
    const source = fs.readFileSync(path.join(__dirname, '..', 'frontend', 'src', 'components', 'organisms', 'Shell', 'navItems.js'), 'utf8');
    const keys = [...source.matchAll(/key:\s*"([^"]+)"/g)].map((m) => m[1]);

    it('finds the nav items (the scan works)', () => { expect(keys.length).toBeGreaterThan(10); });
    it.each(keys)('%s is a known id', (key) => { expect(NAV_ITEM_IDS).toContain(key); });
});

describe('sanitizeNavPreferences', () => {
    it('turns a list of known ids into a $set on the caller\'s record', () => {
        expect(sanitizeNavPreferences({ pinned: ['chat', 'docs'] })).toEqual({ ok: true, update: { $set: { 'navPreferences.pinned': ['chat', 'docs'] } } });
    });

    it('accepts clearing every pin', () => {
        expect(sanitizeNavPreferences({ pinned: [] })).toEqual({ ok: true, update: { $set: { 'navPreferences.pinned': [] } } });
    });

    it.each([
        ['an empty body', {}],
        ['a body that is not an object', 'chat'],
        ['a list', ['chat']],
        ['pinned that is not a list', { pinned: 'chat' }],
        ['a pin that is not a string', { pinned: [{ key: 'chat' }] }],
        ['an unknown nav item', { pinned: ['chat', 'billing-admin'] }],
        ['a very long name', { pinned: ['x'.repeat(500)] }],
        ['the same item twice', { pinned: ['chat', 'chat'] }],
        ['more pins than nav items', { pinned: [...NAV_ITEM_IDS, 'home'] }],
        ['an unknown field', { pinned: ['chat'], theme: 'dark' }],
        ['someone else\'s id', { userId: OTHER_UID, pinned: ['chat'] }],
        ['an operator', { $set: { 'navPreferences.pinned': ['chat'] } }]
    ])('refuses %s', (_name, body) => {
        expect(sanitizeNavPreferences(body).ok).toBe(false);
    });

    it('caps the list at the number of nav items', () => {
        expect(MAX_PINNED).toBe(NAV_ITEM_IDS.length);
        expect(sanitizeNavPreferences({ pinned: [...NAV_ITEM_IDS] }).ok).toBe(true);
    });
});

describe(`PUT ${ROUTE}`, () => {
    beforeEach(() => {
        MongoDbCrudOpration.mockReset();
        MongoDbCrudOpration.mockResolvedValue({ _id: UID, navPreferences: { pinned: ['chat'] } });
    });

    it('is registered and needs a signed-in session', () => {
        const routes = fs.readFileSync(path.join(__dirname, '..', 'Modules', 'Users', 'routes.js'), 'utf8');
        const middleware = fs.readFileSync(path.join(__dirname, '..', 'Config', 'setMiddleware.js'), 'utf8');
        expect(routes).toContain(`app.put('${ROUTE}', navPreferences.updateOwnNavPreferences)`);
        expect(middleware).toContain(`"${ROUTE}"`);
    });

    it('refuses a caller without a session', async () => {
        const res = resOf();
        await updateOwnNavPreferences({ body: { pinned: ['chat'] } }, res);
        expect(res.status).toHaveBeenCalledWith(401);
        expect(MongoDbCrudOpration).not.toHaveBeenCalled();
    });

    it('writes only to the signed-in user and returns what was stored', async () => {
        const res = resOf();
        await updateOwnNavPreferences({ uid: UID, body: { pinned: ['chat'] } }, res);
        const [scope, query, method] = MongoDbCrudOpration.mock.calls[0];
        expect(scope).toBe(SCHEMA_TYPE.GOLBAL);
        expect(query.type).toBe(SCHEMA_TYPE.USERS);
        expect(method).toBe('findOneAndUpdate');
        expect(String(query.data[0]._id)).toBe(UID);
        expect(Object.keys(query.data[0])).toEqual(['_id']);
        expect(query.data[1]).toEqual({ $set: { 'navPreferences.pinned': ['chat'] } });
        expect(res.status).toHaveBeenCalledWith(200);
        expect(res.json.mock.calls[0][0]).toEqual({ status: true, statusText: 'Navigation saved', data: { pinned: ['chat'] } });
    });

    it('answers 400 and writes nothing when the body names another user', async () => {
        const res = resOf();
        await updateOwnNavPreferences({ uid: UID, body: { userId: OTHER_UID, pinned: ['chat'] } }, res);
        expect(res.status).toHaveBeenCalledWith(400);
        expect(MongoDbCrudOpration).not.toHaveBeenCalled();
    });

    it('answers 400 and writes nothing for an invalid shape', async () => {
        const res = resOf();
        await updateOwnNavPreferences({ uid: UID, body: { pinned: ['nope'] } }, res);
        expect(res.status).toHaveBeenCalledWith(400);
        expect(MongoDbCrudOpration).not.toHaveBeenCalled();
    });

    it('answers 404 when the caller\'s record is gone', async () => {
        MongoDbCrudOpration.mockResolvedValue(null);
        const res = resOf();
        await updateOwnNavPreferences({ uid: UID, body: { pinned: ['chat'] } }, res);
        expect(res.status).toHaveBeenCalledWith(404);
    });
});

describe('the caller reads the stored pins back on their own record', () => {
    it('includes navPreferences in the self view', () => {
        expect(toSelfView({ _id: UID, navPreferences: { pinned: ['docs'] } }).navPreferences).toEqual({ pinned: ['docs'] });
    });
});
