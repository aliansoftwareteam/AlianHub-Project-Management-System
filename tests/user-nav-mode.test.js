jest.mock('../utils/mongo-handler/mongoQueries', () => ({ MongoDbCrudOpration: jest.fn() }));
jest.mock('../Config/loggerConfig', () => ({ info: jest.fn(), error: jest.fn(), warn: jest.fn(), debug: jest.fn() }));
jest.mock('../Modules/Auth/controller/authHelpers', () => ({ addAndRemoveUserInMongodbNotificationCount: jest.fn(async () => undefined) }));

const fs = require('fs');
const path = require('path');
const mongoose = require('mongoose');
const { MongoDbCrudOpration } = require('../utils/mongo-handler/mongoQueries');
const { schema } = require('../utils/mongo-handler/schema.js');
const { sanitizeSelfUpdate, toSelfView, toMemberView } = require('../Modules/Users/helpers/userAccessRules');
const { NAV_MODES, sanitizeNavPreferences, newAccountNavPreferences } = require('../Modules/Users/helpers/navPreferencesRules');
const { updateOwnNavPreferences } = require('../Modules/Users/navPreferences');
const { jitProvisionUser } = require('../Modules/SSO/provisioning');

const ROOT = path.join(__dirname, '..');
const UID = '64b000000000000000000001';
const OTHER_UID = '64b000000000000000000002';
const COMPANY = '64b000000000000000000c01';

const resOf = () => {
    const res = { status: jest.fn(() => res), json: jest.fn() };
    return res;
};

describe('the stored choice survives the strict user schema', () => {
    const Users = mongoose.models.NavModeUser || mongoose.model('NavModeUser', new mongoose.Schema(schema.users, { strict: true, timestamps: true }));

    it.each(['simple', 'full'])('keeps navPreferences.mode = %s', (mode) => {
        expect(new Users({ navPreferences: { mode } }).toObject().navPreferences.mode).toBe(mode);
    });

    it('leaves an account that never chose without a value', () => {
        expect(new Users({}).toObject().navPreferences?.mode).toBeUndefined();
        expect(new Users({ navPreferences: { pinned: ['chat'] } }).toObject().navPreferences.mode).toBeUndefined();
    });
});

describe('sanitizeNavPreferences with a mode', () => {
    it('knows two modes', () => {
        expect(NAV_MODES).toEqual(['simple', 'full']);
    });

    it.each(NAV_MODES)('turns %s into a $set on the caller\'s record', (mode) => {
        expect(sanitizeNavPreferences({ mode })).toEqual({ ok: true, update: { $set: { 'navPreferences.mode': mode } } });
    });

    it('takes the mode and the kept places together', () => {
        expect(sanitizeNavPreferences({ mode: 'simple', pinned: ['planner'] })).toEqual({
            ok: true,
            update: { $set: { 'navPreferences.pinned': ['planner'], 'navPreferences.mode': 'simple' } },
        });
    });

    it.each([
        ['an unknown mode', { mode: 'expert' }],
        ['a mode in the wrong case', { mode: 'Simple' }],
        ['an empty mode', { mode: '' }],
        ['a mode that is not a string', { mode: true }],
        ['a mode that is an operator', { mode: { $ne: 'full' } }],
        ['a list of modes', { mode: ['simple'] }],
        ['a mode beside an unknown field', { mode: 'simple', roleType: 1 }],
        ['a mode for someone else', { mode: 'simple', userId: OTHER_UID }],
        ['a mode beside invalid kept places', { mode: 'simple', pinned: ['nope'] }],
    ])('refuses %s', (_name, body) => {
        expect(sanitizeNavPreferences(body).ok).toBe(false);
    });
});

describe('PUT /api/v2/users/nav-preferences with a mode', () => {
    beforeEach(() => {
        MongoDbCrudOpration.mockReset();
        MongoDbCrudOpration.mockResolvedValue({ _id: UID, navPreferences: { pinned: ['planner'], mode: 'simple' } });
    });

    it('writes only to the signed-in person and answers with what was stored', async () => {
        const res = resOf();
        await updateOwnNavPreferences({ uid: UID, body: { mode: 'simple' } }, res);
        const [, query, method] = MongoDbCrudOpration.mock.calls[0];
        expect(method).toBe('findOneAndUpdate');
        expect(String(query.data[0]._id)).toBe(UID);
        expect(Object.keys(query.data[0])).toEqual(['_id']);
        expect(query.data[1]).toEqual({ $set: { 'navPreferences.mode': 'simple' } });
        expect(res.status).toHaveBeenCalledWith(200);
        expect(res.json.mock.calls[0][0].data).toEqual({ pinned: ['planner'], mode: 'simple' });
    });

    it('answers 400 and writes nothing for an invalid mode', async () => {
        const res = resOf();
        await updateOwnNavPreferences({ uid: UID, body: { mode: 'expert' } }, res);
        expect(res.status).toHaveBeenCalledWith(400);
        expect(MongoDbCrudOpration).not.toHaveBeenCalled();
    });

    it('answers 400 and writes nothing when the body names another person', async () => {
        const res = resOf();
        await updateOwnNavPreferences({ uid: UID, body: { userId: OTHER_UID, mode: 'simple' } }, res);
        expect(res.status).toHaveBeenCalledWith(400);
        expect(MongoDbCrudOpration).not.toHaveBeenCalled();
    });

    it('refuses a caller without a session', async () => {
        const res = resOf();
        await updateOwnNavPreferences({ body: { mode: 'simple' } }, res);
        expect(res.status).toHaveBeenCalledWith(401);
        expect(MongoDbCrudOpration).not.toHaveBeenCalled();
    });
});

describe('no other write reaches the choice', () => {
    it.each([
        ['a plain field', { navPreferences: { mode: 'simple' } }],
        ['a dotted field', { 'navPreferences.mode': 'simple' }],
        ['a $set', { $set: { 'navPreferences.mode': 'simple' } }],
    ])('the profile update refuses %s', (_name, update) => {
        expect(sanitizeSelfUpdate(update).ok).toBe(false);
    });

    it('is read back by its owner and by nobody else', () => {
        const record = { _id: UID, AssignCompany: [COMPANY], navPreferences: { mode: 'simple' } };
        expect(toSelfView(record).navPreferences).toEqual({ mode: 'simple' });
        expect(toMemberView(record, [COMPANY]).navPreferences).toBeUndefined();
    });
});

describe('a new account starts in Simple; one that exists keeps Full', () => {
    beforeEach(() => {
        MongoDbCrudOpration.mockReset();
    });

    it('gives a new account the Simple choice and nothing else', () => {
        expect(newAccountNavPreferences()).toEqual({ mode: 'simple' });
        expect(newAccountNavPreferences()).not.toBe(newAccountNavPreferences());
    });

    it('stores it on an account made by single sign-on', async () => {
        MongoDbCrudOpration.mockImplementation(async (_db, query, method) => {
            if (method === 'save') return { ...query.data, _id: query.data._id || new mongoose.Types.ObjectId(UID) };
            return null;
        });
        await jitProvisionUser({ companyId: COMPANY, email: 'new@example.test', firstName: 'New' });
        const saved = MongoDbCrudOpration.mock.calls.filter(([, query, method]) => method === 'save' && query.type === 'users').map(([, query]) => query.data);
        expect(saved).toHaveLength(1);
        expect(saved[0].navPreferences).toEqual({ mode: 'simple' });
    });

    it('leaves an account that signs in again through single sign-on as it was', async () => {
        MongoDbCrudOpration.mockImplementation(async (_db, query, method) => {
            if (method === 'findOne' && query.type === 'userAuth') return { _id: new mongoose.Types.ObjectId(UID) };
            if (method === 'findOne') return { _id: 'seat-1' };
            return null;
        });
        await jitProvisionUser({ companyId: COMPANY, email: 'old@example.test', firstName: 'Old' });
        const writes = MongoDbCrudOpration.mock.calls.filter(([, , method]) => method !== 'findOne' && method !== 'find');
        expect(JSON.stringify(writes)).not.toContain('navPreferences');
    });

    it('needs no migration: the schema sets no default, so a missing value means Full', () => {
        const source = fs.readFileSync(path.join(ROOT, 'utils', 'mongo-handler', 'schema.js'), 'utf8');
        const block = source.slice(source.indexOf('navPreferences: {'), source.indexOf('accessibilityPreferences: {'));
        expect(block).toMatch(/mode:/);
        expect(block).not.toMatch(/default:\s*['"]/);
    });
});

describe('the choice is a view preference, never a right', () => {
    const files = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) return files(full);
        return entry.name.endsWith('.js') ? [full] : [];
    });

    it('is read by no middleware and no permission rule', () => {
        const guards = [
            ...files(path.join(ROOT, 'middlewares')),
            path.join(ROOT, 'Config', 'setMiddleware.js'),
            path.join(ROOT, 'Modules', 'Users', 'helpers', 'userAccessRules.js'),
        ];
        const readers = guards.filter((file) => /navPreferences\.mode|NAV_MODES|navMode/.test(fs.readFileSync(file, 'utf8')));
        expect(readers).toEqual([]);
    });
});
