process.env.STORAGE_TYPE = process.env.STORAGE_TYPE || 'server';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'new-password-rule-test-secret';

jest.mock('../Config/loggerConfig', () => ({ error: jest.fn(), info: jest.fn(), warn: jest.fn() }));
jest.mock('../utils/mongo-handler/mongoQueries', () => ({ MongoDbCrudOpration: jest.fn() }));
jest.mock('../utils/data', () => ({ importUserNotifications: jest.fn(async () => undefined) }));
jest.mock('../Modules/Users/controller', () => ({ updateUserFun: jest.fn(async () => ({})), getUserByQueyFun: jest.fn() }));
jest.mock('../Modules/Auth/controller', () => ({ addAndRemoveUserInMongodbNotificationCount: jest.fn(), insertAuthFun: jest.fn() }));
jest.mock('../Modules/Auth/controller/sendVerificationMail', () => ({ sendVerificationEmailPromise: jest.fn(async () => undefined) }));
jest.mock('../Modules/storage/server/helpers/bucket.helper.js', () => ({}));

const bcrypt = require('bcrypt');
const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const { MongoDbCrudOpration } = require('../utils/mongo-handler/mongoQueries');
const { insertAuthFun } = require('../Modules/Auth/controller');
const createUser = require('../Modules/Auth/controller/createUser');
const { changePassword, resetPassword } = require('../Modules/Auth/controller/password');
const passwords = require('./fixtures/passwordSamples.json');

const USER = '6f0000000000000000000001';
const RULE = /8 to 256 characters.*uppercase letter.*lowercase letter.*number.*symbol/;
const LONGEST = `Aa1!${'x'.repeat(252)}`;
const TOO_LONG = `${LONGEST}x`;
const preHashed = (input) => crypto.createHash('sha256').update(input, 'utf8').digest('base64');

const response = () => {
    const res = { statusCode: 200, body: undefined };
    res.status = jest.fn((code) => { res.statusCode = code; return res; });
    res.json = jest.fn((body) => { res.body = body; return res; });
    res.send = jest.fn((body) => { res.body = body; return res; });
    return res;
};
const settle = () => new Promise((resolve) => setImmediate(resolve));
const answered = (res, next = () => {}) => new Promise((resolve) => {
    const check = () => (res.json.mock.calls.length || (next.mock && next.mock.calls.length) ? resolve() : setTimeout(check, 5));
    check();
});
const writes = () => MongoDbCrudOpration.mock.calls.filter(([, , method]) => method === 'findOneAndUpdate' || method === 'save');

beforeEach(() => {
    jest.clearAllMocks();
    insertAuthFun.mockImplementation((data, cb) => cb({ status: true, data: { ...data, _id: USER } }));
    MongoDbCrudOpration.mockImplementation(async (db, query, method) => (method === 'save' ? { ...query.data, _id: USER } : null));
});

describe('POST /api/v2/createUser checks the password a person chooses', () => {
    const signup = async (password) => {
        const res = response();
        createUser.createUserV2({ body: { firstName: 'Ada', lastName: 'Lovelace', email: 'ada@example.test', password } }, res);
        await settle();
        return res;
    };

    it.each(passwords.weak)('refuses %j and creates no account', async (password) => {
        const res = await signup(password);
        expect(res.send).toHaveBeenCalledTimes(1);
        expect(res.body).toEqual({ status: false, statusText: expect.stringMatching(RULE) });
        expect(insertAuthFun).not.toHaveBeenCalled();
    });

    it.each(passwords.strong)('accepts %j', async (password) => {
        const res = await signup(password);
        expect(res.body.status).toBe(true);
        expect(insertAuthFun.mock.calls[0][0]).toEqual({ email: 'ada@example.test', password });
    });

    it('refuses a 257-character password and accepts a 256-character one', async () => {
        expect((await signup(TOO_LONG)).body).toEqual({ status: false, statusText: expect.stringMatching(RULE) });
        expect(insertAuthFun).not.toHaveBeenCalled();
        expect((await signup(LONGEST)).body.status).toBe(true);
        expect(insertAuthFun.mock.calls[0][0].password).toBe(LONGEST);
    });
});

describe('POST /api/v2/auth/reset-password checks the new password', () => {
    const token = jwt.sign({ purpose: 'reset' }, process.env.JWT_SECRET, { expiresIn: 600 });
    const reset = async (password) => {
        MongoDbCrudOpration.mockImplementation(async (db, query, method) => (method === 'findOne' ? { _id: USER, token } : {}));
        const req = { body: { id: USER, token, password } };
        const res = response();
        const next = jest.fn();
        await resetPassword(req, res, next);
        await answered(res, next);
        return { req, res, next };
    };

    it.each(passwords.weak)('refuses %j, keeps the old hash and leaves the link usable', async (password) => {
        const { req, res, next } = await reset(password);
        expect(next).toHaveBeenCalledTimes(1);
        expect(req.errorMessageObject).toEqual({ message: expect.stringMatching(RULE) });
        expect(res.json).not.toHaveBeenCalled();
        expect(writes()).toEqual([]);
    });

    it.each(passwords.strong)('stores %j', async (password) => {
        const { res, next } = await reset(password);
        expect(next).not.toHaveBeenCalled();
        expect(res.statusCode).toBe(200);
        const [[, update]] = writes();
        expect(update.data[1].passwordHashVersion).toBe(2);
        expect(await bcrypt.compare(preHashed(USER + password), update.data[1].passwordHash)).toBe(true);
    });

    it('refuses a 257-character password and stores a 256-character one', async () => {
        const refused = await reset(TOO_LONG);
        expect(refused.req.errorMessageObject).toEqual({ message: expect.stringMatching(RULE) });
        expect(writes()).toEqual([]);
        const stored = await reset(LONGEST);
        expect(stored.res.statusCode).toBe(200);
        expect(writes()).toHaveLength(1);
    });
});

describe('PATCH /api/v2/auth/:id/change-password checks only the new password', () => {
    const OLD_WEAK_PASSWORD = 'abcdefgh';
    const change = async (newPassword) => {
        const passwordHash = await bcrypt.hash(USER + OLD_WEAK_PASSWORD, 4);
        MongoDbCrudOpration.mockImplementation(async (db, query, method) => (method === 'findOne' ? { _id: USER, passwordHash } : {}));
        const res = response();
        await changePassword({ params: { id: USER }, uid: USER, body: { oldPassword: OLD_WEAK_PASSWORD, newPassword } }, res);
        await answered(res);
        return res;
    };

    it.each(passwords.weak)('refuses %j', async (newPassword) => {
        const res = await change(newPassword);
        expect(res.statusCode).toBe(400);
        expect(res.body).toEqual({ message: expect.stringMatching(RULE) });
        expect(writes()).toEqual([]);
    });

    it.each(passwords.strong)('replaces an old password that predates the rule with %j', async (newPassword) => {
        const res = await change(newPassword);
        expect(res.statusCode).toBe(200);
        expect(writes()).toHaveLength(1);
    });

    it('refuses a 257-character password and stores a 256-character one', async () => {
        const refused = await change(TOO_LONG);
        expect(refused.statusCode).toBe(400);
        expect(refused.body).toEqual({ message: expect.stringMatching(RULE) });
        expect(writes()).toEqual([]);
        expect((await change(LONGEST)).statusCode).toBe(200);
        expect(writes()).toHaveLength(1);
    });
});
