jest.mock('../Config/loggerConfig', () => ({ error: jest.fn(), info: jest.fn(), warn: jest.fn(), debug: jest.fn() }));
jest.mock('../utils/mongo-handler/mongoQueries', () => ({ MongoDbCrudOpration: jest.fn(async () => null) }));

const fs = require('fs');
const path = require('path');
const mongoose = require('mongoose');
const { MongoDbCrudOpration } = require('../utils/mongo-handler/mongoQueries');
const { myCache } = require('../Config/config');
const { setMiddlewareV2 } = require('../Config/setMiddleware');
const { schema } = require('../utils/mongo-handler/schema.js');
const { signSession, startApp } = require('./fixtures/sessionApp');
const { toSelfView, MEMBER_FIELDS } = require('../Modules/Users/helpers/userAccessRules');
const ctrl = require('../Modules/Users/controller');

const COMPANY = '6f0000000000000000000c01';
const ADMIN = '6f00000000000000000000a1';
const MEMBER = '6f00000000000000000000a2';

const source = fs.readFileSync(path.join(__dirname, '..', 'frontend', 'src', 'views', 'Settings', 'Language', 'localePrefs.js'), 'utf8');
const defaultsBlock = (source.match(/const DEFAULTS = \{([\s\S]*?)\};/) || [])[1] || '';
const DEFAULTS = Object.fromEntries([...defaultsBlock.matchAll(/(\w+):\s*"([^"]*)"/g)].map((m) => [m[1], m[2]]));

const SAVED = { ...DEFAULTS, language: 'ar', numerals: 'arab', dateFormat: 'YYYY-MM-DD', numberFormat: '1.250.000,50', weekStart: 'saturday', currency: 'AED' };

describe('the language and region preferences survive the strict user schema', () => {
    const Users = mongoose.models.LocalePrefsUser || mongoose.model('LocalePrefsUser', new mongoose.Schema(schema.users, { strict: true, timestamps: true }));

    it('reads every field the Language page saves (the scan works)', () => {
        expect(Object.keys(DEFAULTS).sort()).toEqual(['currency', 'dateFormat', 'language', 'numberFormat', 'numerals', 'weekStart']);
        expect(Object.keys(SAVED).sort()).toEqual(Object.keys(DEFAULTS).sort());
    });

    it('keeps every field the Language page saves', () => {
        expect(new Users({ localePreferences: SAVED }).toObject().localePreferences).toEqual(SAVED);
    });

    it('keeps them when they arrive as the page\'s $set', () => {
        const doc = new Users({});
        doc.set({ languageCode: 'ar', localePreferences: SAVED });
        expect(doc.toObject().localePreferences).toEqual(SAVED);
    });

    it('drops a field the page never sends', () => {
        expect(new Users({ localePreferences: { ...SAVED, theme: 'dark' } }).toObject().localePreferences).toEqual(SAVED);
    });

    it('leaves a user who never saved them without a value', () => {
        expect(new Users({}).toObject().localePreferences?.currency).toBeUndefined();
    });

    it('comes back in the self view and stays out of what other members see', () => {
        expect(toSelfView({ _id: MEMBER, localePreferences: SAVED }).localePreferences).toEqual(SAVED);
        expect(MEMBER_FIELDS).not.toContain('localePreferences');
    });
});

describe('PUT /api/v1/user with localePreferences', () => {
    let app;
    const updates = () => MongoDbCrudOpration.mock.calls.filter((call) => call[2] === 'findOneAndUpdate');
    const put = (uid, body) => app.call('PUT', '/api/v1/user', { token: signSession(uid, [COMPANY]), body });

    beforeAll(async () => {
        app = await startApp((server) => {
            setMiddlewareV2(server);
            server.put('/api/v1/user', ctrl.updateUserStatus);
        });
    });
    afterAll(() => app.close());

    beforeEach(() => {
        myCache.flushAll();
        MongoDbCrudOpration.mockReset();
        MongoDbCrudOpration.mockImplementation(async (db, obj, method) => {
            const filter = (obj.data && obj.data[0]) || {};
            if (method === 'findOneAndUpdate') return { _id: String(filter._id), AssignCompany: [COMPANY], ...((obj.data[1] && obj.data[1].$set) || {}) };
            return null;
        });
    });

    it('lets the user save their own', async () => {
        const res = await put(MEMBER, { userId: MEMBER, updateObject: { $set: { languageCode: 'ar', localePreferences: SAVED } }, newObj: { returnDocument: 'after' } });
        expect(res.status).toBe(200);
        expect(updates()[0][1].data[1]).toEqual({ $set: { languageCode: 'ar', localePreferences: SAVED } });
        expect(res.body.data.localePreferences).toEqual(SAVED);
    });

    it('refuses anyone else writing them, an admin included', async () => {
        const res = await put(ADMIN, { userId: MEMBER, updateObject: { $set: { localePreferences: SAVED } } });
        expect(res.status).toBe(403);
        expect(updates()).toHaveLength(0);
    });
});

describe('GET /api/v1/user/:id hands the saved preferences back to their owner', () => {
    let app;
    const get = (uid, id) => app.call('GET', `/api/v1/user/${id}`, { token: signSession(uid, [COMPANY]) });

    beforeAll(async () => {
        app = await startApp((server) => {
            setMiddlewareV2(server);
            server.get('/api/v1/user/:id', ctrl.getUserById);
        });
    });
    afterAll(() => app.close());

    beforeEach(() => {
        myCache.flushAll();
        MongoDbCrudOpration.mockReset();
        MongoDbCrudOpration.mockImplementation(async (db, obj, method) => {
            if (method !== 'findOne') return null;
            const id = String(((obj.data && obj.data[0]) || {})._id);
            if (id === MEMBER) return { _id: MEMBER, AssignCompany: [COMPANY], languageCode: 'ar', localePreferences: SAVED };
            if (id === ADMIN) return { _id: ADMIN, AssignCompany: [COMPANY] };
            return null;
        });
    });

    it('returns them when a user loads their own profile, as a new device does at sign-in', async () => {
        const res = await get(MEMBER, MEMBER);
        expect(res.status).toBe(200);
        expect(res.body.localePreferences).toEqual(SAVED);
        expect(res.body.languageCode).toBe('ar');
    });

    it('keeps them out of a teammate\'s view of that profile', async () => {
        const res = await get(ADMIN, MEMBER);
        expect(res.status).toBe(200);
        expect(res.body.localePreferences).toBeUndefined();
    });
});
