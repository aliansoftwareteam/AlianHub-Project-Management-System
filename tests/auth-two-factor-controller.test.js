process.env.JWT_SECRET = 'two-factor-controller-secret';

jest.mock('../Config/loggerConfig', () => ({ error: jest.fn(), info: jest.fn(), warn: jest.fn() }));
jest.mock('../utils/mongo-handler/mongoQueries', () => ({ MongoDbCrudOpration: jest.fn() }));
jest.mock('../Modules/Auth/controller/loginSession', () => ({ finalizeSession: jest.fn() }));

const { MongoDbCrudOpration } = require('../utils/mongo-handler/mongoQueries');
const { dbCollections } = require('../Config/collections');
const loginSession = require('../Modules/Auth/controller/loginSession');
const rules = require('../Modules/Auth/helpers/twoFactorRules');
const ctrl = require('../Modules/Auth/controller/twoFactor');

const USER = '6f0000000000000000000a01';
const OTHER = '6f0000000000000000000b02';
const EMAIL = 'ada@example.test';

let rows;
const response = () => {
    const res = { statusCode: 200, body: undefined };
    res.status = jest.fn((code) => { res.statusCode = code; return res; });
    res.json = jest.fn((body) => { res.body = body; return res; });
    return res;
};
const writes = () => MongoDbCrudOpration.mock.calls.filter(([, , method]) => method === 'updateOne');
const stored = (id = USER) => rows[id].twoFactor;

beforeEach(() => {
    jest.clearAllMocks();
    rows = {
        [USER]: { _id: USER, email: EMAIL },
        [OTHER]: { _id: OTHER, email: 'grace@example.test', twoFactor: { enabled: true, secretEnc: rules.encryptSecret('OTHERSECRET'), recoveryCodes: [] } },
    };
    MongoDbCrudOpration.mockImplementation(async (db, query, method) => {
        const id = String(query.data[0]._id);
        const row = rows[id];
        if (method === 'findOne') return row || null;
        if (method === 'updateOne') {
            if (row) Object.assign(row, query.data[1].$set);
            return { acknowledged: true };
        }
        return null;
    });
});

const enrolled = async (extra = {}) => {
    const secret = rules.generateSecret();
    const [recovery] = rules.generateRecoveryCodes(1);
    const second = rules.generateRecoveryCodes(1)[0];
    rows[USER].twoFactor = {
        enabled: true,
        secretEnc: rules.encryptSecret(secret),
        recoveryCodes: [await rules.hashRecoveryCode(recovery), await rules.hashRecoveryCode(second)],
        ...extra,
    };
    return { secret, recovery, second };
};

describe('twoFaStatus', () => {
    it('says 2FA is off for an account that never enrolled', async () => {
        const res = response();
        await ctrl.twoFaStatus({ uid: USER }, res);
        expect(res.statusCode).toBe(200);
        expect(res.body).toEqual({ status: true, data: { enabled: false } });
    });

    it('says 2FA is off while an enrolment is only pending', async () => {
        rows[USER].twoFactor = { enabled: false, pendingSecretEnc: 'x' };
        const res = response();
        await ctrl.twoFaStatus({ uid: USER }, res);
        expect(res.body.data.enabled).toBe(false);
    });

    it('says 2FA is on for an enrolled account and reads only the caller from the global userAuth', async () => {
        await enrolled();
        const res = response();
        await ctrl.twoFaStatus({ uid: USER }, res);
        expect(res.body.data.enabled).toBe(true);
        const [db, query, method] = MongoDbCrudOpration.mock.calls[0];
        expect(db).toBe(dbCollections.GLOBAL);
        expect(query.type).toBe(dbCollections.USER_AUTH);
        expect(String(query.data[0]._id)).toBe(USER);
        expect(method).toBe('findOne');
    });

    it('says 2FA is off for an unknown account', async () => {
        const res = response();
        await ctrl.twoFaStatus({ uid: '6f0000000000000000000f99' }, res);
        expect(res.body.data.enabled).toBe(false);
    });

    it('answers a malformed user id with a 400, not a crash', async () => {
        const res = response();
        await ctrl.twoFaStatus({ uid: 'not-an-id' }, res);
        expect(res.statusCode).toBe(400);
        expect(res.body.status).toBe(false);
    });

    it('answers a database failure with a 400 and its message', async () => {
        MongoDbCrudOpration.mockRejectedValueOnce(new Error('db down'));
        const res = response();
        await ctrl.twoFaStatus({ uid: USER }, res);
        expect(res.statusCode).toBe(400);
        expect(res.body).toEqual({ status: false, message: 'db down' });
    });

    it('never reports the 2FA state of a signed-out caller', async () => {
        const res = response();
        await ctrl.twoFaStatus({}, res);
        expect(res.body.data.enabled).toBe(false);
        expect(MongoDbCrudOpration.mock.calls.every(([, q]) => String(q.data[0]._id) !== OTHER)).toBe(true);
    });
});

describe('twoFaSetup', () => {
    it('returns a manual key and QR that match, and stores the secret encrypted as pending', async () => {
        const res = response();
        await ctrl.twoFaSetup({ uid: USER }, res);
        expect(res.statusCode).toBe(200);
        const { otpauthUrl, qrDataUrl, secret } = res.body.data;
        expect(otpauthUrl).toContain(encodeURIComponent(EMAIL));
        expect(otpauthUrl).toContain(secret);
        expect(qrDataUrl).toMatch(/^data:image\/png;base64,/);
        const pending = stored().pendingSecretEnc;
        expect(pending).not.toContain(secret);
        expect(rules.decryptSecret(pending)).toBe(secret);
        expect(stored().enabled).toBe(false);
    });

    it('writes the pending secret to the caller\'s own userAuth row in the global database', async () => {
        await ctrl.twoFaSetup({ uid: USER }, response());
        expect(writes()).toHaveLength(1);
        const [db, query] = writes()[0];
        expect(db).toBe(dbCollections.GLOBAL);
        expect(query.type).toBe(dbCollections.USER_AUTH);
        expect(String(query.data[0]._id)).toBe(USER);
        expect(rows[OTHER].twoFactor.pendingSecretEnc).toBeUndefined();
    });

    it('keeps a re-started enrolment from using the old pending secret', async () => {
        const first = response();
        await ctrl.twoFaSetup({ uid: USER }, first);
        const second = response();
        await ctrl.twoFaSetup({ uid: USER }, second);
        expect(second.body.data.secret).not.toBe(first.body.data.secret);
        expect(rules.decryptSecret(stored().pendingSecretEnc)).toBe(second.body.data.secret);
    });

    it('refuses with 409 and writes nothing when 2FA is already on', async () => {
        await enrolled();
        const res = response();
        await ctrl.twoFaSetup({ uid: USER }, res);
        expect(res.statusCode).toBe(409);
        expect(res.body.status).toBe(false);
        expect(writes()).toHaveLength(0);
    });

    it('answers 404 and writes nothing for a signed-out caller', async () => {
        const res = response();
        await ctrl.twoFaSetup({}, res);
        expect(res.statusCode).toBe(404);
        expect(res.body).toEqual({ status: false, message: 'User not found' });
        expect(writes()).toHaveLength(0);
    });

    it('answers 404 for an id with no account', async () => {
        const res = response();
        await ctrl.twoFaSetup({ uid: '6f0000000000000000000f99' }, res);
        expect(res.statusCode).toBe(404);
        expect(writes()).toHaveLength(0);
    });

    it('answers 400 for a malformed id', async () => {
        const res = response();
        await ctrl.twoFaSetup({ uid: '' + 'zz' }, res);
        expect(res.statusCode).toBe(400);
    });
});

describe('twoFaVerify', () => {
    const startSetup = async () => {
        const res = response();
        await ctrl.twoFaSetup({ uid: USER }, res);
        return res.body.data.secret;
    };

    it('enables 2FA with the right code and returns ten one-time recovery codes that are stored hashed', async () => {
        const secret = await startSetup();
        const pending = stored().pendingSecretEnc;
        const res = response();
        await ctrl.twoFaVerify({ uid: USER, body: { code: rules.generateTotp(secret) } }, res);
        expect(res.statusCode).toBe(200);
        const codes = res.body.data.recoveryCodes;
        expect(codes).toHaveLength(rules.RECOVERY_COUNT);
        const saved = stored();
        expect(saved.enabled).toBe(true);
        expect(saved.secretEnc).toBe(pending);
        expect(saved.pendingSecretEnc).toBeUndefined();
        expect(saved.recoveryCodes).toHaveLength(codes.length);
        expect(saved.recoveryCodes).not.toContain(codes[0]);
        expect(await rules.verifyRecoveryCode(codes[0], saved.recoveryCodes[0])).toBe(true);
        expect(saved.enrolledAt).toBeInstanceOf(Date);
    });

    it('refuses a wrong code and leaves 2FA off', async () => {
        const secret = await startSetup();
        const wrong = rules.generateTotp(secret) === '000000' ? '111111' : '000000';
        const res = response();
        await ctrl.twoFaVerify({ uid: USER, body: { code: wrong } }, res);
        expect(res.statusCode).toBe(400);
        expect(res.body.message).toMatch(/not valid/);
        expect(stored().enabled).toBe(false);
    });

    it.each([[undefined], [''], ['12345'], ['abcdef'], [123456789]])('refuses the malformed code %p', async (code) => {
        await startSetup();
        const res = response();
        await ctrl.twoFaVerify({ uid: USER, body: { code } }, res);
        expect(res.statusCode).toBe(400);
        expect(stored().enabled).toBe(false);
    });

    it('refuses a missing body', async () => {
        await startSetup();
        const res = response();
        await ctrl.twoFaVerify({ uid: USER }, res);
        expect(res.statusCode).toBe(400);
    });

    it('asks to start setup first when nothing is pending', async () => {
        const res = response();
        await ctrl.twoFaVerify({ uid: USER, body: { code: '123456' } }, res);
        expect(res.statusCode).toBe(400);
        expect(res.body.message).toBe('Start 2FA setup first.');
        expect(writes()).toHaveLength(0);
    });

    it('refuses a pending secret that cannot be decrypted', async () => {
        rows[USER].twoFactor = { enabled: false, pendingSecretEnc: 'garbage' };
        const res = response();
        await ctrl.twoFaVerify({ uid: USER, body: { code: '123456' } }, res);
        expect(res.statusCode).toBe(400);
        expect(writes()).toHaveLength(0);
    });

    it('does not accept a code made from another account\'s secret', async () => {
        await startSetup();
        const res = response();
        await ctrl.twoFaVerify({ uid: USER, body: { code: rules.generateTotp(rules.generateSecret()) } }, res);
        expect(stored().enabled).toBe(false);
    });

    it('answers 404 and writes nothing for a signed-out caller', async () => {
        const res = response();
        await ctrl.twoFaVerify({ body: { code: '123456' } }, res);
        expect(res.statusCode).toBe(404);
        expect(writes()).toHaveLength(0);
    });

    it('writes only to the caller\'s global userAuth row', async () => {
        const secret = await startSetup();
        MongoDbCrudOpration.mockClear();
        await ctrl.twoFaVerify({ uid: USER, body: { code: rules.generateTotp(secret) } }, response());
        expect(MongoDbCrudOpration.mock.calls.length).toBeGreaterThan(0);
        MongoDbCrudOpration.mock.calls.forEach(([db, query]) => {
            expect(db).toBe(dbCollections.GLOBAL);
            expect(query.type).toBe(dbCollections.USER_AUTH);
            expect(String(query.data[0]._id)).toBe(USER);
        });
    });
});

describe('twoFaDisable', () => {
    it('turns 2FA off with a current code', async () => {
        const { secret } = await enrolled();
        const res = response();
        await ctrl.twoFaDisable({ uid: USER, body: { code: rules.generateTotp(secret) } }, res);
        expect(res.statusCode).toBe(200);
        expect(stored()).toEqual({ enabled: false });
    });

    it('turns 2FA off with a recovery code, with or without the dash', async () => {
        const { recovery } = await enrolled();
        const res = response();
        await ctrl.twoFaDisable({ uid: USER, body: { code: recovery.replace('-', '').toUpperCase() } }, res);
        expect(res.statusCode).toBe(200);
        expect(stored().enabled).toBe(false);
    });

    it('refuses a wrong code and leaves 2FA on', async () => {
        await enrolled();
        const res = response();
        await ctrl.twoFaDisable({ uid: USER, body: { code: '00000-00000' } }, res);
        expect(res.statusCode).toBe(400);
        expect(stored().enabled).toBe(true);
        expect(writes()).toHaveLength(0);
    });

    it.each([[undefined], [''], [null]])('refuses the empty code %p', async (code) => {
        await enrolled();
        const res = response();
        await ctrl.twoFaDisable({ uid: USER, body: { code } }, res);
        expect(res.statusCode).toBe(400);
        expect(stored().enabled).toBe(true);
    });

    it('refuses an account whose recovery codes are missing and the code is wrong', async () => {
        await enrolled({ recoveryCodes: undefined });
        const res = response();
        await ctrl.twoFaDisable({ uid: USER, body: { code: 'abcde-12345' } }, res);
        expect(res.statusCode).toBe(400);
        expect(stored().enabled).toBe(true);
    });

    it('says 2FA is not enabled when it is off', async () => {
        const res = response();
        await ctrl.twoFaDisable({ uid: USER, body: { code: '123456' } }, res);
        expect(res.statusCode).toBe(400);
        expect(res.body.message).toBe('Two-factor authentication is not enabled.');
        expect(writes()).toHaveLength(0);
    });

    it('answers 404 for a signed-out caller and leaves other accounts alone', async () => {
        const res = response();
        await ctrl.twoFaDisable({ body: { code: '123456' } }, res);
        expect(res.statusCode).toBe(404);
        expect(writes()).toHaveLength(0);
        expect(rows[OTHER].twoFactor.enabled).toBe(true);
    });

    it('writes only to the caller\'s global userAuth row', async () => {
        const { secret } = await enrolled();
        await ctrl.twoFaDisable({ uid: USER, body: { code: rules.generateTotp(secret) } }, response());
        const [db, query] = writes()[0];
        expect(db).toBe(dbCollections.GLOBAL);
        expect(String(query.data[0]._id)).toBe(USER);
        expect(rows[OTHER].twoFactor.enabled).toBe(true);
    });
});

describe('twoFaValidate', () => {
    const next = jest.fn();
    const call = async (body) => {
        const req = { body };
        const res = response();
        await ctrl.twoFaValidate(req, res, next);
        return req;
    };
    const tempFor = (uid) => rules.issueTempToken(uid);

    beforeEach(() => {
        next.mockClear();
        loginSession.finalizeSession.mockImplementation(async () => {});
    });

    it('finishes the login of the token\'s account when the code is right', async () => {
        const { secret } = await enrolled();
        const req = { body: { tempToken: tempFor(USER), code: rules.generateTotp(secret) } };
        const res = response();
        await ctrl.twoFaValidate(req, res, next);
        expect(loginSession.finalizeSession).toHaveBeenCalledWith(req, res, USER, next);
        expect(req.errorMessageObject).toBeUndefined();
    });

    it('spends a recovery code once and keeps the rest', async () => {
        const { recovery, second } = await enrolled();
        const req = { body: { tempToken: tempFor(USER), code: recovery } };
        await ctrl.twoFaValidate(req, response(), next);
        expect(loginSession.finalizeSession).toHaveBeenCalledTimes(1);
        const left = stored().recoveryCodes;
        expect(left).toHaveLength(1);
        expect(await rules.verifyRecoveryCode(second, left[0])).toBe(true);
        expect(stored().enabled).toBe(true);
        expect(stored().secretEnc).toBeDefined();

        loginSession.finalizeSession.mockClear();
        const again = await call({ tempToken: tempFor(USER), code: recovery });
        expect(loginSession.finalizeSession).not.toHaveBeenCalled();
        expect(again.errorMessageObject.message).toMatch(/not valid/);
    });

    it('writes the spent recovery code to the token\'s own global userAuth row', async () => {
        const { recovery } = await enrolled();
        await call({ tempToken: tempFor(USER), code: recovery });
        const [db, query] = writes()[0];
        expect(db).toBe(dbCollections.GLOBAL);
        expect(query.type).toBe(dbCollections.USER_AUTH);
        expect(String(query.data[0]._id)).toBe(USER);
    });

    it('hands a wrong code to the attempt limiter and starts no session', async () => {
        await enrolled();
        const req = await call({ tempToken: tempFor(USER), code: '000000' });
        expect(req.errorMessageObject.message).toMatch(/not valid/);
        expect(next).toHaveBeenCalledTimes(1);
        expect(loginSession.finalizeSession).not.toHaveBeenCalled();
        expect(writes()).toHaveLength(0);
    });

    it.each([[undefined], [''], [null], ['12']])('refuses the code %p', async (code) => {
        await enrolled();
        const req = await call({ tempToken: tempFor(USER), code });
        expect(req.errorMessageObject).toBeDefined();
        expect(loginSession.finalizeSession).not.toHaveBeenCalled();
    });

    it.each([[undefined], [{}], [{ tempToken: '' }], [{ tempToken: 'garbage', code: '123456' }]])('says the verification session expired for %p', async (body) => {
        const req = await call(body);
        expect(req.errorMessageObject.message).toMatch(/expired/);
        expect(next).toHaveBeenCalledTimes(1);
        expect(MongoDbCrudOpration).not.toHaveBeenCalled();
    });

    it('refuses a normal access token as a temp token', async () => {
        const jwt = require('jsonwebtoken');
        const access = jwt.sign({ uid: USER }, process.env.JWT_SECRET, { algorithm: 'HS256' });
        const req = await call({ tempToken: access, code: '123456' });
        expect(req.errorMessageObject.message).toMatch(/expired/);
        expect(loginSession.finalizeSession).not.toHaveBeenCalled();
    });

    it('refuses a temp token for an account that has not enabled 2FA', async () => {
        const req = await call({ tempToken: tempFor(USER), code: '123456' });
        expect(req.errorMessageObject.message).toMatch(/not enabled/);
        expect(loginSession.finalizeSession).not.toHaveBeenCalled();
    });

    it('refuses a temp token for an unknown account', async () => {
        const req = await call({ tempToken: tempFor('6f0000000000000000000f99'), code: '123456' });
        expect(req.errorMessageObject.message).toMatch(/not enabled/);
    });

    it('does not accept another account\'s code for the token\'s account', async () => {
        await enrolled();
        const req = await call({ tempToken: tempFor(USER), code: rules.generateTotp(rules.generateSecret()) });
        expect(req.errorMessageObject).toBeDefined();
        expect(loginSession.finalizeSession).not.toHaveBeenCalled();
    });

    it('reads the global userAuth row of the token\'s account', async () => {
        await enrolled();
        await call({ tempToken: tempFor(USER), code: '000000' });
        const [db, query, method] = MongoDbCrudOpration.mock.calls[0];
        expect(db).toBe(dbCollections.GLOBAL);
        expect(query.type).toBe(dbCollections.USER_AUTH);
        expect(String(query.data[0]._id)).toBe(USER);
        expect(method).toBe('findOne');
    });

    it.failing('bug: finalizeSession is returned without await, so its rejection escapes the catch and never reaches the limiter', async () => {
        const { secret } = await enrolled();
        loginSession.finalizeSession.mockRejectedValueOnce(new Error('session store down'));
        const req = await call({ tempToken: tempFor(USER), code: rules.generateTotp(secret) });
        expect(req.errorMessageObject).toEqual({ message: 'session store down' });
    });
});
