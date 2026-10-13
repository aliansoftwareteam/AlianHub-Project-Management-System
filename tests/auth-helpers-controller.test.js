process.env.JWT_SECRET = 'auth-helpers-controller-secret';
process.env.JWT_ALGORITHM = 'HS256';
process.env.JWT_EXP = '24h';
process.env.WEBURL = 'https://hub.example.test';

jest.mock('../Config/loggerConfig', () => ({ error: jest.fn(), info: jest.fn(), warn: jest.fn() }));
jest.mock('../utils/mongo-handler/mongoQueries', () => ({ MongoDbCrudOpration: jest.fn() }));
jest.mock('../Modules/service.js', () => ({ SendEmail: jest.fn((subject, html, to, isHtml, cb) => cb({ status: true })) }));
jest.mock('../Modules/Auth/helpers/socialIdentity', () => ({
    ...jest.requireActual('../Modules/Auth/helpers/socialIdentity'),
    verifySocialIdentity: jest.fn(),
    resolveSocialAccount: jest.fn(),
}));

const { MongoDbCrudOpration } = require('../utils/mongo-handler/mongoQueries');
const { dbCollections } = require('../Config/collections');
const sendMail = require('../Modules/service.js');
const logger = require('../Config/loggerConfig');
const social = require('../Modules/Auth/helpers/socialIdentity');
const ctrl = require('../Modules/Auth/controller/authHelpers');

const USER = '6f0000000000000000000a01';
const COMPANY = '6f0000000000000000000c01';
const EMAIL = 'ada@example.test';

const response = () => {
    const res = { statusCode: 200, body: undefined };
    res.status = jest.fn((code) => { res.statusCode = code; return res; });
    res.json = jest.fn((body) => { res.body = body; return res; });
    return res;
};
const viaCallback = (fn, ...args) => new Promise((resolve) => fn(...args, resolve));
const settle = () => new Promise((resolve) => setImmediate(resolve));

beforeEach(() => {
    jest.clearAllMocks();
    MongoDbCrudOpration.mockReset();
    sendMail.SendEmail.mockImplementation((subject, html, to, isHtml, cb) => cb({ status: true }));
});

describe('addAndRemoveUserInMongodbNotificationCount', () => {
    it('adds the user to the company\'s own notification-count collection', async () => {
        MongoDbCrudOpration.mockResolvedValue({ _id: 'row' });
        const answer = await ctrl.addAndRemoveUserInMongodbNotificationCount(COMPANY, USER, 'Add');
        expect(answer).toEqual({ status: true, statusText: { _id: 'row' } });
        expect(MongoDbCrudOpration).toHaveBeenCalledTimes(1);
        expect(MongoDbCrudOpration).toHaveBeenCalledWith(COMPANY, { type: dbCollections.USERID, data: { userId: USER } }, 'save');
    });

    it('removes the user from the company\'s own collection for any other type', async () => {
        MongoDbCrudOpration.mockResolvedValue({ _id: 'row' });
        const answer = await ctrl.addAndRemoveUserInMongodbNotificationCount(COMPANY, USER, 'Remove');
        expect(answer.status).toBe(true);
        expect(MongoDbCrudOpration).toHaveBeenCalledTimes(1);
        expect(MongoDbCrudOpration).toHaveBeenCalledWith(COMPANY, { type: dbCollections.USERID, data: [{ userId: USER }] }, 'findOneAndDelete');
    });

    it('treats a missing type as a removal, never an add', async () => {
        MongoDbCrudOpration.mockResolvedValue(null);
        await ctrl.addAndRemoveUserInMongodbNotificationCount(COMPANY, USER);
        expect(MongoDbCrudOpration.mock.calls[0][2]).toBe('findOneAndDelete');
    });

    it('rejects with the database error on an add', async () => {
        MongoDbCrudOpration.mockRejectedValue(new Error('write failed'));
        await expect(ctrl.addAndRemoveUserInMongodbNotificationCount(COMPANY, USER, 'Add')).rejects.toThrow('write failed');
    });

    it('rejects with the database error on a removal', async () => {
        MongoDbCrudOpration.mockRejectedValue(new Error('delete failed'));
        await expect(ctrl.addAndRemoveUserInMongodbNotificationCount(COMPANY, USER, 'Remove')).rejects.toThrow('delete failed');
    });

    it('rejects when the database call throws at once', async () => {
        MongoDbCrudOpration.mockImplementation(() => { throw new Error('sync boom'); });
        await expect(ctrl.addAndRemoveUserInMongodbNotificationCount(COMPANY, USER, 'Add')).rejects.toThrow('sync boom');
    });
});

describe('sessionRefusalFor', () => {
    it('looks the user up by id in the global users collection', async () => {
        MongoDbCrudOpration.mockResolvedValue({ _id: USER, isEmailVerified: true });
        await ctrl.sessionRefusalFor(USER);
        expect(MongoDbCrudOpration).toHaveBeenCalledWith(dbCollections.GLOBAL, { type: dbCollections.USERS, data: [{ _id: USER }] }, 'findOne');
    });

    it('lets a verified user through', async () => {
        MongoDbCrudOpration.mockResolvedValue({ _id: USER, isEmailVerified: true });
        expect(await ctrl.sessionRefusalFor(USER)).toBeNull();
    });

    it('logs out a user that no longer exists', async () => {
        MongoDbCrudOpration.mockResolvedValue(null);
        expect(await ctrl.sessionRefusalFor(USER)).toEqual({ status: false, isLogout: true, message: 'user not found.' });
    });

    it('logs out an empty row', async () => {
        MongoDbCrudOpration.mockResolvedValue({});
        expect((await ctrl.sessionRefusalFor(USER)).message).toBe('user not found.');
    });

    it('logs out an unverified user, showing the auth view without secrets', async () => {
        MongoDbCrudOpration.mockResolvedValue({ _id: USER, email: EMAIL, isEmailVerified: false, verificationToken: 'secret-token' });
        const answer = await ctrl.sessionRefusalFor(USER);
        expect(answer).toMatchObject({ status: false, isLogout: true, isEmailVerified: false, message: 'Email is not verified.' });
        expect(JSON.stringify(answer)).not.toContain('secret-token');
    });
});

describe('generateTokenV2Fun', () => {
    const refreshToken = () => require('../Modules/Auth/helpers/refreshTokenRules').signRefreshToken({ userId: USER, sessionId: 'sid1' }).token;

    it('answers an expired session when the token is not a refresh token, without touching the database', async () => {
        const answer = await viaCallback(ctrl.generateTokenV2Fun, USER, 'not-a-token');
        expect(answer).toEqual({ status: false, isLogout: true, message: 'Your session is expired' });
        expect(MongoDbCrudOpration).not.toHaveBeenCalled();
    });

    it('answers an expired session for an empty token', async () => {
        const answer = await viaCallback(ctrl.generateTokenV2Fun, USER, undefined);
        expect(answer.isLogout).toBe(true);
    });

    it('reads the user by id from the global users collection and puts its companies in the access token', async () => {
        MongoDbCrudOpration.mockResolvedValue({ _id: USER, isEmailVerified: true, AssignCompany: [COMPANY] });
        const answer = await viaCallback(ctrl.generateTokenV2Fun, USER, refreshToken());
        expect(answer.status).toBe(true);
        expect(MongoDbCrudOpration).toHaveBeenCalledWith(dbCollections.GLOBAL, { type: dbCollections.USERS, data: [{ _id: USER }] }, 'findOne');
        const claims = require('jsonwebtoken').decode(answer.token);
        expect(claims.uid).toBe(USER);
        expect(claims.aud).toBe(COMPANY);
        expect(claims.companyIds).toBeUndefined();
    });

    it('issues a token with no companies for a user assigned to none', async () => {
        MongoDbCrudOpration.mockResolvedValue({ _id: USER, isEmailVerified: true });
        const answer = await viaCallback(ctrl.generateTokenV2Fun, USER, refreshToken());
        expect(answer.status).toBe(true);
        expect(require('jsonwebtoken').decode(answer.token).aud || '').toBe('');
    });

    it('logs out when the user is gone', async () => {
        MongoDbCrudOpration.mockResolvedValue(null);
        const answer = await viaCallback(ctrl.generateTokenV2Fun, USER, refreshToken());
        expect(answer).toEqual({ status: false, isLogout: true, message: 'user not found.' });
    });

    it('logs out an unverified user and issues no token', async () => {
        MongoDbCrudOpration.mockResolvedValue({ _id: USER, isEmailVerified: false });
        const answer = await viaCallback(ctrl.generateTokenV2Fun, USER, refreshToken());
        expect(answer.status).toBe(false);
        expect(answer.isEmailVerified).toBe(false);
        expect(answer.token).toBeUndefined();
    });

    it('logs out and logs the error when the lookup fails', async () => {
        MongoDbCrudOpration.mockRejectedValue(new Error('db down'));
        const answer = await viaCallback(ctrl.generateTokenV2Fun, USER, refreshToken());
        expect(answer).toMatchObject({ status: false, isLogout: true, message: 'user not found.' });
        expect(logger.error).toHaveBeenCalled();
    });

    it('answers authentication failed when the lookup throws at once', async () => {
        MongoDbCrudOpration.mockImplementation(() => { throw new Error('sync boom'); });
        const answer = await viaCallback(ctrl.generateTokenV2Fun, USER, refreshToken());
        expect(answer).toEqual({ status: false, isLogout: true, message: 'Authentication failed!' });
    });
});

describe('insertAuthFun', () => {
    it.each([[undefined], [null], [{}], [{ password: 'x' }], [{ email: '' , password: 'x' }]])('asks for an email for %p', async (data) => {
        const answer = await viaCallback(ctrl.insertAuthFun, data);
        expect(answer).toEqual({ status: false, message: 'Email is require' });
        expect(MongoDbCrudOpration).not.toHaveBeenCalled();
    });

    it.each([[{ email: EMAIL }], [{ email: EMAIL, password: '' }]])('asks for a password for %p', async (data) => {
        const answer = await viaCallback(ctrl.insertAuthFun, data);
        expect(answer).toEqual({ status: false, message: 'Password is require' });
        expect(MongoDbCrudOpration).not.toHaveBeenCalled();
    });

    it('saves the account in the global userAuth without the plain password, then re-keys the hash on its id', async () => {
        MongoDbCrudOpration.mockImplementation(async (db, query, method) => (method === 'save' ? { _id: USER } : {}));
        const answer = await viaCallback(ctrl.insertAuthFun, { email: EMAIL, password: 'Right-Passw0rd!' });
        expect(answer).toEqual({ status: true, data: { email: EMAIL, password: 'Right-Passw0rd!', _id: USER } });
        const [save, update] = MongoDbCrudOpration.mock.calls;
        expect(save[0]).toBe(dbCollections.GLOBAL);
        expect(save[2]).toBe('save');
        expect(save[1].type).toBe(dbCollections.USER_AUTH);
        expect(save[1].data.email).toBe(EMAIL);
        expect(JSON.stringify(save[1].data)).not.toContain('Right-Passw0rd!');
        expect(update[0]).toBe(dbCollections.GLOBAL);
        expect(update[2]).toBe('updateOne');
        expect(update[1].data[0]).toEqual({ email: EMAIL });
        expect(JSON.stringify(update[1].data[1])).not.toContain('Right-Passw0rd!');
    });

    it('answers with the database message when the save fails, and does not re-key', async () => {
        MongoDbCrudOpration.mockRejectedValue({ code: 11000, keyValue: { email: EMAIL }, message: 'dup' });
        const answer = await viaCallback(ctrl.insertAuthFun, { email: EMAIL, password: 'Right-Passw0rd!' });
        expect(answer.status).toBe(false);
        expect(answer.message).toBeTruthy();
        expect(MongoDbCrudOpration).toHaveBeenCalledTimes(1);
    });

    it('answers with the database message when the re-key fails', async () => {
        MongoDbCrudOpration.mockImplementation(async (db, query, method) => {
            if (method === 'save') return { _id: USER };
            throw new Error('update failed');
        });
        const answer = await viaCallback(ctrl.insertAuthFun, { email: EMAIL, password: 'Right-Passw0rd!' });
        expect(answer.status).toBe(false);
        expect(answer.message).toBeTruthy();
    });
});

describe('verifyAuth', () => {
    it.each([[undefined], [null], [{}], [{ email: '' }]])('asks for an email for %p', async (data) => {
        const answer = await viaCallback(ctrl.verifyAuth, data);
        expect(answer).toEqual({ status: false, message: 'Email is required' });
        expect(MongoDbCrudOpration).not.toHaveBeenCalled();
    });

    it('asks for a password when none is sent, without querying', async () => {
        const answer = await viaCallback(ctrl.verifyAuth, { email: EMAIL });
        expect(answer).toEqual({ status: false, message: 'Password is required' });
        expect(MongoDbCrudOpration).not.toHaveBeenCalled();
    });

    it('looks the account up by email in the global userAuth collection', async () => {
        MongoDbCrudOpration.mockResolvedValue(null);
        await viaCallback(ctrl.verifyAuth, { email: EMAIL, password: 'Wrong-Passw0rd!' });
        expect(MongoDbCrudOpration).toHaveBeenCalledWith(dbCollections.GLOBAL, { type: dbCollections.USER_AUTH, data: [{ email: EMAIL }] }, 'findOne');
    });

    it('reports the 2FA gate for a right password on an enrolled account', async () => {
        const bcrypt = require('bcrypt');
        const passwordHash = await bcrypt.hash(USER + 'Right-Passw0rd!', 4);
        MongoDbCrudOpration.mockResolvedValue({ _id: USER, email: EMAIL, passwordHash, twoFactor: { enabled: true } });
        const answer = await viaCallback(ctrl.verifyAuth, { email: EMAIL, password: 'Right-Passw0rd!' });
        expect(answer.status).toBe(true);
        expect(answer.data.twoFactorEnabled).toBe(true);
    });

    it('reports no 2FA gate while enrolment is only pending', async () => {
        const bcrypt = require('bcrypt');
        const passwordHash = await bcrypt.hash(USER + 'Right-Passw0rd!', 4);
        MongoDbCrudOpration.mockResolvedValue({ _id: USER, email: EMAIL, passwordHash, twoFactor: { enabled: false, pendingSecretEnc: 'x' } });
        const answer = await viaCallback(ctrl.verifyAuth, { email: EMAIL, password: 'Right-Passw0rd!' });
        expect(answer.data.twoFactorEnabled).toBe(false);
    });

    it('answers a database failure with a message and not the right-password success', async () => {
        MongoDbCrudOpration.mockRejectedValue(new Error('db down'));
        const answer = await viaCallback(ctrl.verifyAuth, { email: EMAIL, password: 'Wrong-Passw0rd!' });
        expect(answer.status).toBe(false);
        expect(answer.message).toBeTruthy();
    });

    it('mails a set-password link to a verified account that has no password, within 10 minutes of validity', async () => {
        MongoDbCrudOpration.mockImplementation(async (db, query, method) => (method === 'findOne' ? { _id: USER, email: EMAIL } : { _id: USER }));
        const answer = await viaCallback(ctrl.verifyAuth, { email: EMAIL, password: 'Any-Passw0rd!', isLoginType: 'frontend' });
        await settle();
        expect(answer).toEqual({ status: false, message: 'The email or password is incorrect.' });
        const tokenWrite = MongoDbCrudOpration.mock.calls.find(([, , method]) => method === 'findOneAndUpdate');
        expect(tokenWrite[0]).toBe(dbCollections.GLOBAL);
        expect(tokenWrite[1].data[0]).toEqual({ email: EMAIL });
        const { token } = tokenWrite[1].data[1];
        expect(sendMail.SendEmail).toHaveBeenCalledTimes(1);
        const [, html, to] = sendMail.SendEmail.mock.calls[0];
        expect(to).toBe(EMAIL);
        expect(html).toContain(`https://hub.example.test/#/set-new-password/${token}`);
        const { exp, iat } = require('jsonwebtoken').decode(token);
        expect(exp - iat).toBe(600);
    });

    it('puts the admin path in the set-password link for an admin sign-in', async () => {
        MongoDbCrudOpration.mockImplementation(async (db, query, method) => (method === 'findOne' ? { _id: USER, email: EMAIL } : { _id: USER }));
        await viaCallback(ctrl.verifyAuth, { email: EMAIL, password: 'Any-Passw0rd!', isLoginType: 'admin' });
        await settle();
        expect(sendMail.SendEmail.mock.calls[0][1]).toContain('https://hub.example.test/admin/#/set-new-password/');
    });

    it('sends no mail to a blocked account without a password', async () => {
        MongoDbCrudOpration.mockResolvedValue({ _id: USER, email: EMAIL, isBlocked: true });
        await viaCallback(ctrl.verifyAuth, { email: EMAIL, password: 'Any-Passw0rd!' });
        await settle();
        expect(sendMail.SendEmail).not.toHaveBeenCalled();
    });

    it('sends no mail for an email with no account', async () => {
        MongoDbCrudOpration.mockResolvedValue(null);
        await viaCallback(ctrl.verifyAuth, { email: 'nobody@example.test', password: 'Any-Passw0rd!' });
        await settle();
        expect(sendMail.SendEmail).not.toHaveBeenCalled();
    });

    it('still refuses with the same answer when the set-password mail fails to send', async () => {
        MongoDbCrudOpration.mockImplementation(async (db, query, method) => (method === 'findOne' ? { _id: USER, email: EMAIL } : { _id: USER }));
        sendMail.SendEmail.mockImplementation((s, h, t, i, cb) => cb({ status: false, error: 'smtp down' }));
        const answer = await viaCallback(ctrl.verifyAuth, { email: EMAIL, password: 'Any-Passw0rd!' });
        await settle();
        expect(answer.message).toBe('The email or password is incorrect.');
        expect(logger.error).toHaveBeenCalledWith(expect.stringContaining('smtp down'));
    });

    describe('social sign-in', () => {
        it('signs in the account the provider identity resolves to, without a password', async () => {
            social.verifySocialIdentity.mockResolvedValue({ label: 'Google' });
            social.resolveSocialAccount.mockResolvedValue({ _id: USER });
            const answer = await viaCallback(ctrl.verifyAuth, { authProvider: 'google', email: EMAIL, idToken: 't' });
            expect(answer).toEqual({ status: true, data: { _id: USER }, message: 'Google login successful' });
            expect(social.resolveSocialAccount).toHaveBeenCalledWith({ label: 'Google' }, EMAIL);
            expect(MongoDbCrudOpration).not.toHaveBeenCalled();
        });

        it('answers a refusal with its own message', async () => {
            social.verifySocialIdentity.mockRejectedValue(new social.SocialSignInRefusal('Google account is not verified'));
            const answer = await viaCallback(ctrl.verifyAuth, { authProvider: 'google', email: EMAIL });
            expect(answer).toEqual({ status: false, message: 'Google account is not verified' });
        });

        it('answers an unexpected provider failure with a message', async () => {
            social.verifySocialIdentity.mockRejectedValue(new Error('provider down'));
            const answer = await viaCallback(ctrl.verifyAuth, { authProvider: 'google', email: EMAIL });
            expect(answer.status).toBe(false);
            expect(answer.message).toBeTruthy();
        });

        it('does not treat an unknown provider name as social sign-in', async () => {
            const answer = await viaCallback(ctrl.verifyAuth, { authProvider: 'myspace', email: EMAIL });
            expect(social.verifySocialIdentity).not.toHaveBeenCalled();
            expect(answer.message).toBe('Password is required');
        });
    });
});

describe('sendForgotPassword', () => {
    const run = async (body) => {
        const req = { body };
        const res = response();
        const next = jest.fn();
        ctrl.sendForgotPassword(req, res, next);
        await settle();
        await settle();
        return { req, res, next };
    };

    it('stores a 10-minute token on the account by email in the global userAuth and mails the reset link', async () => {
        MongoDbCrudOpration.mockResolvedValue({ _id: USER });
        const { res, next } = await run({ email: EMAIL });
        expect(res.statusCode).toBe(200);
        expect(res.body).toEqual({ status: true, message: 'Forgot Password Email sent successfully.' });
        expect(next).not.toHaveBeenCalled();
        const [db, query, method] = MongoDbCrudOpration.mock.calls[0];
        expect(db).toBe(dbCollections.GLOBAL);
        expect(query.type).toBe(dbCollections.USER_AUTH);
        expect(query.data[0]).toEqual({ email: EMAIL });
        expect(method).toBe('findOneAndUpdate');
        const { token } = query.data[1];
        const { exp, iat } = require('jsonwebtoken').decode(token);
        expect(exp - iat).toBe(600);
        const [, html, to] = sendMail.SendEmail.mock.calls[0];
        expect(to).toBe(EMAIL);
        expect(html).toContain(`https://hub.example.test/#/reset-password/${token}`);
    });

    it('puts the admin path in the link when the key is admin', async () => {
        MongoDbCrudOpration.mockResolvedValue({ _id: USER });
        await run({ email: EMAIL, key: 'admin' });
        expect(sendMail.SendEmail.mock.calls[0][1]).toContain('https://hub.example.test/admin/#/reset-password/');
    });

    it('hands user not found to the error handler and sends no mail for an unknown email', async () => {
        MongoDbCrudOpration.mockResolvedValue(null);
        const { req, res, next } = await run({ email: 'nobody@example.test' });
        expect(req.errorMessageObject).toEqual({ message: 'user not found.' });
        expect(next).toHaveBeenCalledTimes(1);
        expect(res.json).not.toHaveBeenCalled();
        expect(sendMail.SendEmail).not.toHaveBeenCalled();
    });

    it('hands a mail failure to the error handler', async () => {
        MongoDbCrudOpration.mockResolvedValue({ _id: USER });
        sendMail.SendEmail.mockImplementation((s, h, t, i, cb) => cb({ status: false, error: 'smtp down' }));
        const { req, res, next } = await run({ email: EMAIL });
        expect(req.errorMessageObject).toEqual({ message: 'smtp down' });
        expect(next).toHaveBeenCalledTimes(1);
        expect(res.json).not.toHaveBeenCalled();
    });

    it('hands a database failure to the error handler', async () => {
        MongoDbCrudOpration.mockRejectedValue(new Error('db down'));
        const { req, next } = await run({ email: EMAIL });
        expect(req.errorMessageObject.message).toBeTruthy();
        expect(next).toHaveBeenCalledTimes(1);
    });

    it('hands a missing body to the error handler without a database call', async () => {
        const { req, next } = await run(undefined);
        expect(req.errorMessageObject.message).toBeTruthy();
        expect(next).toHaveBeenCalledTimes(1);
        expect(MongoDbCrudOpration).not.toHaveBeenCalled();
    });
});
