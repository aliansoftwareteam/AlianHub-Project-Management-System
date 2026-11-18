process.env.STORAGE_TYPE = process.env.STORAGE_TYPE || 'server';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'password-full-length-test-secret';

jest.mock('../Config/loggerConfig', () => ({ error: jest.fn(), info: jest.fn(), warn: jest.fn() }));
jest.mock('../utils/mongo-handler/mongoQueries', () => ({ MongoDbCrudOpration: jest.fn() }));
jest.mock('../Modules/service.js', () => ({ SendEmail: jest.fn((subject, html, to, isHtml, cb) => cb({ status: true })) }));
jest.mock('../Modules/Users/controller', () => ({ updateUserFun: jest.fn(async () => ({})), getUserByQueyFun: jest.fn() }));

const bcrypt = require('bcrypt');
const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const mongoose = require('mongoose');
const { MongoDbCrudOpration } = require('../utils/mongo-handler/mongoQueries');
const { dbCollections } = require('../Config/collections');
const { schema } = require('../utils/mongo-handler/schema.js');
const { insertAuthFun, verifyAuth } = require('../Modules/Auth/controller/authHelpers');
const { changePassword, resetPassword } = require('../Modules/Auth/controller/password');

const ID = '6f0000000000000000000a01';
const EMAIL = 'long@example.test';
const OLD_PASSWORD = 'Old-Passw0rd!';
const WRONG = 'Wrong-Passw0rd!';
const SHARED_START = `Aa1!${'x'.repeat(56)}`;
const CHOSEN = `${SHARED_START}-the-chosen-tail`;
const SAME_START = `${SHARED_START}-another-tail`;

/* Written out rather than imported, so a change to the stored format fails here instead of locking accounts out. */
const preHashed = (input) => crypto.createHash('sha256').update(input, 'utf8').digest('base64');

let rows;
const matchesFilter = (row, filter) => Object.entries(filter).every(([key, value]) => String(row[key]) === String(value));
const WRITE_METHODS = ['save', 'updateOne', 'findOneAndUpdate'];
const writes = () => MongoDbCrudOpration.mock.calls
    .filter(([, query, method]) => query.type === dbCollections.USER_AUTH && WRITE_METHODS.includes(method))
    .map(([, { data }, method]) => (method === 'save' ? data : (data[1].$set || data[1])));
const onlyRow = () => {
    expect(rows).toHaveLength(1);
    return rows[0];
};

beforeEach(() => {
    rows = [];
    MongoDbCrudOpration.mockReset();
    MongoDbCrudOpration.mockImplementation(async (db, { type, data }, method) => {
        if (type !== dbCollections.USER_AUTH) return {};
        if (method === 'save') {
            const row = { _id: ID, ...data };
            rows.push(row);
            return { ...row };
        }
        const row = rows.find((candidate) => matchesFilter(candidate, data[0]));
        if (row && (method === 'updateOne' || method === 'findOneAndUpdate')) Object.assign(row, data[1].$set || data[1]);
        return row ? { ...row } : null;
    });
});

const signIn = (password) => new Promise((resolve) => verifyAuth({ email: EMAIL, password, isLoginType: 'frontend' }, resolve));
const waitFor = async (check) => {
    for (let i = 0; i < 300 && !check(); i += 1) await new Promise((resolve) => setTimeout(resolve, 10));
};

const response = () => {
    const res = { statusCode: 200, body: undefined };
    res.status = jest.fn((code) => { res.statusCode = code; return res; });
    res.json = jest.fn((body) => { res.body = body; return res; });
    return res;
};
const answered = (res, next = jest.fn()) => waitFor(() => res.json.mock.calls.length || next.mock.calls.length);

const signUpWith = (password) => new Promise((resolve) => insertAuthFun({ email: EMAIL, password }, resolve));

const resetTo = async (password) => {
    const token = jwt.sign({ purpose: 'reset' }, process.env.JWT_SECRET, { expiresIn: 600 });
    rows.push({ _id: ID, email: EMAIL, token });
    const res = response();
    const next = jest.fn();
    await resetPassword({ body: { id: ID, token, password } }, res, next);
    await answered(res, next);
    expect(res.statusCode).toBe(200);
};

const changeTo = async (password) => {
    rows.push({ _id: ID, email: EMAIL, passwordHash: await bcrypt.hash(ID + OLD_PASSWORD, 4) });
    const res = response();
    await changePassword({ params: { id: ID }, uid: ID, body: { oldPassword: OLD_PASSWORD, newPassword: password } }, res);
    await answered(res);
    expect(res.statusCode).toBe(200);
};

const STORING_PATHS = [['sign-up', signUpWith], ['a reset', resetTo], ['a password change', changeTo]];

describe.each(STORING_PATHS)('a password stored by %s', (_label, store) => {
    it('signs in only with every character of it', async () => {
        await store(CHOSEN);

        const wrong = await signIn(WRONG);
        expect(wrong.status).toBe(false);
        expect(await signIn(SAME_START)).toEqual(wrong);
        expect((await signIn(CHOSEN)).status).toBe(true);
    });

    it('is stored with its format version', async () => {
        await store(CHOSEN);

        const row = onlyRow();
        expect(row.passwordHashVersion).toBe(2);
        expect(await bcrypt.compare(preHashed(ID + CHOSEN), row.passwordHash)).toBe(true);
        writes().filter((fields) => 'passwordHash' in fields).forEach((fields) => expect(fields.passwordHashVersion).toBe(2));
    });
});

describe('a password stored before the format version', () => {
    const storeLegacy = async (password) => {
        rows.push({ _id: ID, email: EMAIL, passwordHash: await bcrypt.hash(ID + password, 4) });
    };

    it('still signs in, and is stored in the current format after that sign-in', async () => {
        await storeLegacy(CHOSEN);
        const legacyHash = onlyRow().passwordHash;

        expect((await signIn(CHOSEN)).status).toBe(true);
        await waitFor(() => onlyRow().passwordHashVersion === 2);

        const row = onlyRow();
        expect(row.passwordHashVersion).toBe(2);
        expect(row.passwordHash).not.toBe(legacyHash);
        expect(await bcrypt.compare(preHashed(ID + CHOSEN), row.passwordHash)).toBe(true);
        expect(await signIn(SAME_START)).toEqual(await signIn(WRONG));
        expect((await signIn(CHOSEN)).status).toBe(true);
    });

    it('writes nothing for a wrong password', async () => {
        await storeLegacy(OLD_PASSWORD);

        expect((await signIn(WRONG)).status).toBe(false);
        expect((await signIn(OLD_PASSWORD)).status).toBe(true);
        await waitFor(() => writes().length > 0);
        await new Promise((resolve) => setTimeout(resolve, 100));

        expect(writes()).toHaveLength(1);
        expect(await bcrypt.compare(preHashed(ID + OLD_PASSWORD), onlyRow().passwordHash)).toBe(true);
    });
});

// The unit store keeps any field; the real userAuth schema is strict and drops undeclared ones on write.
describe('every field a password is stored with survives the strict userAuth schema', () => {
    const userAuthSchema = new mongoose.Schema(schema.userAuth, { strict: true });
    const undeclared = (fields) => Object.keys(fields).filter((key) => fields[key] !== undefined && !userAuthSchema.path(key));

    it('declares the format version as a number', () => {
        expect(userAuthSchema.path('passwordHashVersion') && userAuthSchema.path('passwordHashVersion').instance).toBe('Number');
    });

    it.each([
        ...STORING_PATHS,
        ['a sign-in that upgrades an older hash', async () => {
            rows.push({ _id: ID, email: EMAIL, passwordHash: await bcrypt.hash(ID + OLD_PASSWORD, 4) });
            await signIn(OLD_PASSWORD);
            await waitFor(() => writes().length > 0);
        }],
    ])('%s', async (_label, store) => {
        await store(CHOSEN);

        expect(writes().length).toBeGreaterThan(0);
        writes().forEach((fields) => expect(undeclared(fields)).toEqual([]));
    });
});
