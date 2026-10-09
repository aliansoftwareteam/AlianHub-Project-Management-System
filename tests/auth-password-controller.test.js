process.env.JWT_SECRET = 'auth-password-controller-secret';
process.env.JWT_ALGORITHM = 'HS256';
process.env.JWT_EXP = '24h';
process.env.WEBURL = 'https://hub.example.test';

jest.mock('../Config/loggerConfig', () => ({ error: jest.fn(), info: jest.fn(), warn: jest.fn() }));
jest.mock('../utils/mongo-handler/mongoQueries', () => ({ MongoDbCrudOpration: jest.fn() }));
jest.mock('../Modules/service.js', () => ({ SendEmail: jest.fn((subject, html, to, isHtml, cb) => cb({ status: true })) }));
jest.mock('../Modules/Users/controller.js', () => ({ updateUserFun: jest.fn(async () => ({})) }));

const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const { MongoDbCrudOpration } = require('../utils/mongo-handler/mongoQueries');
const { dbCollections } = require('../Config/collections');
const sendMail = require('../Modules/service.js');
const { updateUserFun } = require('../Modules/Users/controller.js');
const logger = require('../Config/loggerConfig');
const { generateToken } = require('../Config/jwt');
const { verifyPassword } = require('../Modules/Auth/helpers/passwordHash');
const { ACCOUNT_MAIL_ANSWER } = require('../Modules/Auth/helpers/accountMail');
const { PASSWORD_RULE_MESSAGE } = require('../Modules/Auth/helpers/passwordRule');
const ctrl = require('../Modules/Auth/controller/password');

const USER = '6f0000000000000000000a01';
const OTHER = '6f0000000000000000000b02';
const EMAIL = 'ada@example.test';
const OLD = 'Old-Passw0rd!';
const NEW = 'New-Passw0rd!';

const response = () => {
    const res = { statusCode: 200, body: undefined };
    res.status = jest.fn((code) => { res.statusCode = code; return res; });
    res.json = jest.fn((body) => { res.body = body; return res; });
    return res;
};
const settle = () => new Promise((resolve) => setImmediate(resolve));
const answered = async (res, next) => {
    const deadline = Date.now() + 5000;
    while (Date.now() < deadline && !res.json.mock.calls.length && !(next && next.mock.calls.length)) {
        // eslint-disable-next-line no-await-in-loop
        await new Promise((resolve) => setTimeout(resolve, 5));
    }
};

let oldRow;
beforeAll(async () => {
    oldRow = { _id: USER, passwordHash: await bcrypt.hash(USER + OLD, 4) };
});

beforeEach(() => {
    jest.clearAllMocks();
    MongoDbCrudOpration.mockReset();
    updateUserFun.mockResolvedValue({});
    sendMail.SendEmail.mockImplementation((s, h, t, i, cb) => cb({ status: true }));
});

describe('changePassword', () => {
    const run = async (req) => {
        const res = response();
        await ctrl.changePassword(req, res);
        await answered(res);
        return res;
    };
    const own = (body, over = {}) => ({ uid: USER, params: { id: USER }, body, ...over });

    it('stores the new password for the caller, after checking the old one, and says so', async () => {
        MongoDbCrudOpration.mockImplementation(async (db, query, method) => (method === 'findOne' ? { ...oldRow } : {}));
        const res = await run(own({ oldPassword: OLD, newPassword: NEW }));
        expect(res.statusCode).toBe(200);
        expect(res.body).toEqual({ status: true, message: 'Your password has been successfully changed.' });
        const [read, write] = MongoDbCrudOpration.mock.calls;
        expect(read).toEqual([dbCollections.GLOBAL, { type: dbCollections.USER_AUTH, data: [{ _id: USER }] }, 'findOne']);
        expect(write[0]).toBe(dbCollections.GLOBAL);
        expect(write[2]).toBe('findOneAndUpdate');
        expect(write[1].type).toBe(dbCollections.USER_AUTH);
        expect(write[1].data[0]).toEqual({ _id: USER });
        expect(JSON.stringify(write[1].data[1])).not.toContain(NEW);
        expect(await verifyPassword(USER + NEW, write[1].data[1])).toBe(true);
        expect(await verifyPassword(USER + OLD, write[1].data[1])).toBe(false);
    });

    it('refuses a missing user id in the path', async () => {
        const res = await run({ uid: USER, params: {}, body: { oldPassword: OLD, newPassword: NEW } });
        expect(res.statusCode).toBe(400);
        expect(res.body).toEqual({ message: 'user id is require' });
        expect(MongoDbCrudOpration).not.toHaveBeenCalled();
    });

    it('refuses a signed-out caller changing a password and reads nothing', async () => {
        const res = await run({ params: { id: USER }, body: { oldPassword: OLD, newPassword: NEW } });
        expect(res.statusCode).toBe(403);
        expect(res.body).toEqual({ message: 'You can only change your own password.' });
        expect(MongoDbCrudOpration).not.toHaveBeenCalled();
    });

    it('refuses changing another user\'s password and reads and writes nothing', async () => {
        const res = await run(own({ oldPassword: OLD, newPassword: NEW }, { params: { id: OTHER } }));
        expect(res.statusCode).toBe(403);
        expect(MongoDbCrudOpration).not.toHaveBeenCalled();
    });

    it('asks for the old password', async () => {
        const res = await run(own({ newPassword: NEW }));
        expect(res.statusCode).toBe(400);
        expect(res.body).toEqual({ message: 'Old Password is require' });
        expect(MongoDbCrudOpration).not.toHaveBeenCalled();
    });

    it('asks for the new password', async () => {
        const res = await run(own({ oldPassword: OLD }));
        expect(res.statusCode).toBe(400);
        expect(res.body).toEqual({ message: 'New Password is require' });
    });

    it('refuses a missing body', async () => {
        const res = await run(own(undefined));
        expect(res.statusCode).toBe(400);
        expect(MongoDbCrudOpration).not.toHaveBeenCalled();
    });

    it.each([['short'], ['alllowercase1!'], ['ALLUPPERCASE1!'], ['NoNumbers!!'], ['NoSymbols123']])('refuses the weak new password %p before reading the account', async (newPassword) => {
        const res = await run(own({ oldPassword: OLD, newPassword }));
        expect(res.statusCode).toBe(400);
        expect(res.body.message).toBe(PASSWORD_RULE_MESSAGE);
        expect(MongoDbCrudOpration).not.toHaveBeenCalled();
    });

    it('answers user not found and writes nothing when the account is gone', async () => {
        MongoDbCrudOpration.mockResolvedValue(null);
        const res = await run(own({ oldPassword: OLD, newPassword: NEW }));
        expect(res.statusCode).toBe(400);
        expect(res.body).toEqual({ message: 'user not found' });
        expect(MongoDbCrudOpration).toHaveBeenCalledTimes(1);
    });

    it('refuses a wrong old password and writes nothing', async () => {
        MongoDbCrudOpration.mockResolvedValue({ ...oldRow });
        const res = await run(own({ oldPassword: 'Wrong-Passw0rd!', newPassword: NEW }));
        expect(res.statusCode).toBe(400);
        expect(res.body).toEqual({ message: 'Auth.previous_wasnot_valid' });
        expect(MongoDbCrudOpration).toHaveBeenCalledTimes(1);
    });

    it('answers a database failure on the read with a 400', async () => {
        MongoDbCrudOpration.mockRejectedValue(new Error('db down'));
        const res = await run(own({ oldPassword: OLD, newPassword: NEW }));
        expect(res.statusCode).toBe(400);
        expect(res.body.message).toBeTruthy();
    });

    it('answers a database failure on the write with a 400, not a success', async () => {
        MongoDbCrudOpration.mockImplementation(async (db, query, method) => {
            if (method === 'findOne') return { ...oldRow };
            throw new Error('write failed');
        });
        const res = await run(own({ oldPassword: OLD, newPassword: NEW }));
        expect(res.statusCode).toBe(400);
        expect(res.body.status).toBeUndefined();
    });
});

describe('forgotPassword', () => {
    it('asks for an email', () => {
        const res = response();
        ctrl.forgotPassword({ body: {} }, res);
        expect(res.statusCode).toBe(400);
        expect(res.body).toEqual({ message: 'email is required' });
        expect(MongoDbCrudOpration).not.toHaveBeenCalled();
    });

    it.each([[undefined], [null], [{ email: '' }]])('asks for an email for the body %p', (body) => {
        const res = response();
        ctrl.forgotPassword({ body }, res);
        expect(res.statusCode).toBe(400);
        expect(MongoDbCrudOpration).not.toHaveBeenCalled();
    });

    it('gives the same answer for a known and an unknown address', async () => {
        MongoDbCrudOpration.mockResolvedValueOnce({ _id: USER }).mockResolvedValueOnce(null);
        const known = response();
        ctrl.forgotPassword({ body: { email: EMAIL } }, known);
        const unknown = response();
        ctrl.forgotPassword({ body: { email: 'nobody@example.test' } }, unknown);
        await settle();
        expect(known.statusCode).toBe(200);
        expect(known.body).toEqual({ status: true, message: ACCOUNT_MAIL_ANSWER });
        expect(unknown.statusCode).toBe(known.statusCode);
        expect(unknown.body).toEqual(known.body);
    });

    it('stores a 10-minute token on the account by email in the global userAuth and mails the reset link', async () => {
        MongoDbCrudOpration.mockResolvedValue({ _id: USER });
        ctrl.forgotPassword({ body: { email: EMAIL } }, response());
        await settle();
        const [db, query, method] = MongoDbCrudOpration.mock.calls[0];
        expect(db).toBe(dbCollections.GLOBAL);
        expect(query.type).toBe(dbCollections.USER_AUTH);
        expect(query.data[0]).toEqual({ email: EMAIL });
        expect(method).toBe('findOneAndUpdate');
        const { token } = query.data[1];
        const { exp, iat } = jwt.decode(token);
        expect(exp - iat).toBe(600);
        const [, html, to] = sendMail.SendEmail.mock.calls[0];
        expect(to).toBe(EMAIL);
        expect(html).toContain(`https://hub.example.test/#/reset-password/${token}`);
    });

    it('links to the admin reset page when the key is admin', async () => {
        MongoDbCrudOpration.mockResolvedValue({ _id: USER });
        ctrl.forgotPassword({ body: { email: EMAIL, key: 'admin' } }, response());
        await settle();
        expect(sendMail.SendEmail.mock.calls[0][1]).toContain('https://hub.example.test/admin/#/reset-password/');
    });

    it('sends no mail for an unknown address', async () => {
        MongoDbCrudOpration.mockResolvedValue(null);
        ctrl.forgotPassword({ body: { email: 'nobody@example.test' } }, response());
        await settle();
        expect(sendMail.SendEmail).not.toHaveBeenCalled();
    });

    it('does not query with an email that is not a string, and still gives the same answer', async () => {
        const res = response();
        ctrl.forgotPassword({ body: { email: { $ne: null } } }, res);
        await settle();
        expect(res.statusCode).toBe(200);
        expect(res.body).toEqual({ status: true, message: ACCOUNT_MAIL_ANSWER });
        expect(MongoDbCrudOpration).not.toHaveBeenCalled();
    });

    it('answers before the mail goes out and logs a failed send', async () => {
        MongoDbCrudOpration.mockResolvedValue({ _id: USER });
        sendMail.SendEmail.mockImplementation((s, h, t, i, cb) => cb({ status: false, error: 'smtp down' }));
        const res = response();
        ctrl.forgotPassword({ body: { email: EMAIL } }, res);
        expect(res.statusCode).toBe(200);
        await settle();
        expect(logger.error).toHaveBeenCalledWith(expect.stringContaining('smtp down'));
        expect(res.body.message).toBe(ACCOUNT_MAIL_ANSWER);
    });

    it('still answers when the database fails, and logs it', async () => {
        MongoDbCrudOpration.mockRejectedValue(new Error('db down'));
        const res = response();
        ctrl.forgotPassword({ body: { email: EMAIL } }, res);
        await settle();
        expect(res.statusCode).toBe(200);
        expect(logger.error).toHaveBeenCalled();
    });
});

describe('tokenVerfiyForgotPassword', () => {
    const run = async (body) => {
        const res = response();
        ctrl.tokenVerfiyForgotPassword({ body }, res);
        await answered(res);
        return res;
    };

    it('returns the id and email of the account that holds the token, and nothing secret', async () => {
        const token = generateToken(600);
        MongoDbCrudOpration.mockResolvedValue({ _id: USER, email: EMAIL, token, passwordHash: 'secret-hash' });
        const res = await run({ token });
        expect(res.statusCode).toBe(200);
        expect(res.body).toEqual({ status: true, data: { _id: USER, email: EMAIL } });
        expect(MongoDbCrudOpration).toHaveBeenCalledWith(dbCollections.GLOBAL, { type: dbCollections.USER_AUTH, data: [{ token }] }, 'findOne');
    });

    it('answers user not found with key 5 when no account holds the token', async () => {
        MongoDbCrudOpration.mockResolvedValue(null);
        const res = await run({ token: generateToken(600) });
        expect(res.statusCode).toBe(400);
        expect(res.body).toEqual({ message: 'user not found', key: 5 });
    });

    it('refuses an expired token with key 1 without a database call', async () => {
        const expired = jwt.sign({ x: 1 }, process.env.JWT_SECRET, { expiresIn: -10 });
        const res = await run({ token: expired });
        expect(res.statusCode).toBe(400);
        expect(res.body.key).toBe(1);
        expect(MongoDbCrudOpration).not.toHaveBeenCalled();
    });

    it('refuses a token signed with another secret with key 2', async () => {
        const res = await run({ token: jwt.sign({ x: 1 }, 'another-secret') });
        expect(res.statusCode).toBe(400);
        expect(res.body.key).toBe(2);
        expect(MongoDbCrudOpration).not.toHaveBeenCalled();
    });

    it.each([[undefined], [{}], [{ token: '' }], [{ token: null }]])('refuses the body %p', async (body) => {
        const res = await run(body);
        expect(res.statusCode).toBe(400);
        expect(MongoDbCrudOpration).not.toHaveBeenCalled();
    });

    it('answers a database failure with a 400', async () => {
        MongoDbCrudOpration.mockRejectedValue(new Error('db down'));
        const res = await run({ token: generateToken(600) });
        expect(res.statusCode).toBe(400);
        expect(res.body.message).toBeTruthy();
    });
});

describe('resetPassword', () => {
    const run = async (body) => {
        const req = { body };
        const res = response();
        const next = jest.fn();
        await ctrl.resetPassword(req, res, next);
        await answered(res, next);
        return { req, res, next };
    };
    const live = (token) => async (db, query, method) => {
        if (method === 'findOne') {
            const wanted = query.data[0];
            return wanted._id === USER && wanted.token === token ? { _id: USER } : null;
        }
        return {};
    };

    it('stores the new password for the id in the link, clears the token, and marks the email verified', async () => {
        const token = generateToken(600);
        MongoDbCrudOpration.mockImplementation(live(token));
        const { res, next } = await run({ id: USER, token, password: NEW });
        expect(res.statusCode).toBe(200);
        expect(res.body).toEqual({ status: true, message: 'Your password has been successfully changed.' });
        expect(next).not.toHaveBeenCalled();
        const [check, write] = MongoDbCrudOpration.mock.calls;
        expect(check).toEqual([dbCollections.GLOBAL, { type: dbCollections.USER_AUTH, data: [{ _id: USER, token }] }, 'findOne']);
        expect(write[0]).toBe(dbCollections.GLOBAL);
        expect(write[2]).toBe('findOneAndUpdate');
        expect(write[1].data[0]).toEqual({ _id: USER });
        expect(write[1].data[1].token).toBe('');
        expect(JSON.stringify(write[1].data[1])).not.toContain(NEW);
        expect(await verifyPassword(USER + NEW, write[1].data[1])).toBe(true);
        expect(updateUserFun).toHaveBeenCalledWith(dbCollections.GLOBAL, {
            type: dbCollections.USERS,
            data: [{ _id: USER }, { verificationToken: '', isEmailVerified: true }],
        }, 'findOneAndUpdate');
    });

    it('refuses a link already used, and changes nothing', async () => {
        const token = generateToken(600);
        MongoDbCrudOpration.mockResolvedValue(null);
        const { req, res, next } = await run({ id: USER, token, password: NEW });
        expect(req.errorMessageObject).toEqual({ message: 'Reset link is invalid or has already been used.', key: 5 });
        expect(next).toHaveBeenCalledTimes(1);
        expect(res.json).not.toHaveBeenCalled();
        expect(MongoDbCrudOpration).toHaveBeenCalledTimes(1);
        expect(updateUserFun).not.toHaveBeenCalled();
    });

    it('does not let a valid token of one account reset another account', async () => {
        const token = generateToken(600);
        MongoDbCrudOpration.mockImplementation(live(token));
        const { req, next } = await run({ id: OTHER, token, password: NEW });
        expect(req.errorMessageObject.key).toBe(5);
        expect(next).toHaveBeenCalledTimes(1);
        expect(MongoDbCrudOpration).toHaveBeenCalledTimes(1);
        expect(updateUserFun).not.toHaveBeenCalled();
    });

    it('refuses an expired token with key 1 before any database call', async () => {
        const expired = jwt.sign({ x: 1 }, process.env.JWT_SECRET, { expiresIn: -10 });
        const { req, next } = await run({ id: USER, token: expired, password: NEW });
        expect(req.errorMessageObject.key).toBe(1);
        expect(next).toHaveBeenCalledTimes(1);
        expect(MongoDbCrudOpration).not.toHaveBeenCalled();
    });

    it('refuses a forged token with key 2 before any database call', async () => {
        const { req } = await run({ id: USER, token: jwt.sign({ x: 1 }, 'other'), password: NEW });
        expect(req.errorMessageObject.key).toBe(2);
        expect(MongoDbCrudOpration).not.toHaveBeenCalled();
    });

    it.each([[undefined], [{}], [{ id: USER }]])('refuses the body %p without a database call', async (body) => {
        const { req, next } = await run(body);
        expect(req.errorMessageObject).toBeDefined();
        expect(next).toHaveBeenCalledTimes(1);
        expect(MongoDbCrudOpration).not.toHaveBeenCalled();
    });

    it.each([[undefined], [''], ['short'], ['alllowercase1!'], ['NoSymbols123']])('refuses the weak password %p and keeps the link usable', async (password) => {
        const token = generateToken(600);
        MongoDbCrudOpration.mockImplementation(live(token));
        const { req, next } = await run({ id: USER, token, password });
        expect(req.errorMessageObject).toEqual({ message: PASSWORD_RULE_MESSAGE });
        expect(next).toHaveBeenCalledTimes(1);
        expect(MongoDbCrudOpration).toHaveBeenCalledTimes(1);
        expect(updateUserFun).not.toHaveBeenCalled();
    });

    it('hands a failed write to the error handler and does not mark the email verified', async () => {
        const token = generateToken(600);
        MongoDbCrudOpration.mockImplementation(async (db, query, method) => {
            if (method === 'findOne') return { _id: USER };
            throw new Error('write failed');
        });
        const { req, res, next } = await run({ id: USER, token, password: NEW });
        expect(req.errorMessageObject.message).toBeTruthy();
        expect(next).toHaveBeenCalledTimes(1);
        expect(res.json).not.toHaveBeenCalled();
        expect(updateUserFun).not.toHaveBeenCalled();
    });

    it('hands a failed verified-flag update to the error handler with its message', async () => {
        const token = generateToken(600);
        MongoDbCrudOpration.mockImplementation(live(token));
        updateUserFun.mockRejectedValue(new Error('user update failed'));
        const { req, res, next } = await run({ id: USER, token, password: NEW });
        expect(req.errorMessageObject).toEqual({ message: 'user update failed' });
        expect(next).toHaveBeenCalledTimes(1);
        expect(res.json).not.toHaveBeenCalled();
    });

    it('hands a failed token lookup to the error handler', async () => {
        const token = generateToken(600);
        MongoDbCrudOpration.mockRejectedValue(new Error('db down'));
        const { req, next } = await run({ id: USER, token, password: NEW });
        expect(req.errorMessageObject).toEqual({ message: 'db down' });
        expect(next).toHaveBeenCalledTimes(1);
    });
});
