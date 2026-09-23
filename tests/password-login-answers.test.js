jest.mock('../Config/loggerConfig', () => ({ error: jest.fn(), info: jest.fn(), warn: jest.fn() }));
jest.mock('../utils/mongo-handler/mongoQueries', () => ({ MongoDbCrudOpration: jest.fn() }));
jest.mock('../Modules/service.js', () => ({ SendEmail: jest.fn((subject, html, to, isHtml, cb) => cb({ status: true })) }));

const bcrypt = require('bcrypt');
const { MongoDbCrudOpration } = require('../utils/mongo-handler/mongoQueries');
const { verifyAuth } = require('../Modules/Auth/controller/authHelpers');

const ID = '6f0000000000000000000a01';
const EMAIL = 'owner@example.test';
const PASSWORD = 'Right-Passw0rd!';

let row;
const signIn = (body) => new Promise((resolve) => verifyAuth({ isLoginType: 'frontend', ...body }, resolve));

beforeAll(async () => {
    row = { _id: ID, email: EMAIL, passwordHash: await bcrypt.hash(ID + PASSWORD, 4) };
});

let account;
beforeEach(() => {
    account = { ...row };
    MongoDbCrudOpration.mockReset();
    MongoDbCrudOpration.mockImplementation(async (db, obj, method) => {
        if (method === 'findOne') return account && obj.data[0].email === account.email ? account : null;
        return account;
    });
    jest.restoreAllMocks();
});

const wrongPasswordAnswer = async () => {
    const answer = await signIn({ email: EMAIL, password: 'Wrong-Passw0rd!' });
    expect(answer.status).toBe(false);
    return answer;
};

describe('password sign-in', () => {
    it('answers an unknown email as it answers a wrong password', async () => {
        const wrong = await wrongPasswordAnswer();
        const unknown = await signIn({ email: 'nobody@example.test', password: 'Wrong-Passw0rd!' });
        expect(unknown).toEqual(wrong);
    });

    it('checks a password hash for an unknown email too, so the answer takes as long', async () => {
        const compare = jest.spyOn(bcrypt, 'compare');
        await signIn({ email: 'nobody@example.test', password: 'Wrong-Passw0rd!' });
        expect(compare).toHaveBeenCalledTimes(1);
    });

    it('answers a blocked account with the wrong password as it answers any wrong password', async () => {
        const wrong = await wrongPasswordAnswer();
        account.isBlocked = true;
        expect(await signIn({ email: EMAIL, password: 'Wrong-Passw0rd!' })).toEqual(wrong);
    });

    it('says an account is blocked only after the right password', async () => {
        account.isBlocked = true;
        const answer = await signIn({ email: EMAIL, password: PASSWORD });
        expect(answer.status).toBe(false);
        expect(answer.message).toMatch(/blocked/i);
    });

    it('answers an account with no password as it answers a wrong password', async () => {
        const wrong = await wrongPasswordAnswer();
        delete account.passwordHash;
        expect(await signIn({ email: EMAIL, password: 'Wrong-Passw0rd!' })).toEqual(wrong);
    });

    it('treats an email that is not a string as no account, without querying with it', async () => {
        const wrong = await wrongPasswordAnswer();
        MongoDbCrudOpration.mockClear();
        expect(await signIn({ email: { $ne: null }, password: 'Wrong-Passw0rd!' })).toEqual(wrong);
        const queried = MongoDbCrudOpration.mock.calls.map((call) => call[1].data[0].email);
        queried.forEach((email) => expect(typeof email).toBe('string'));
    });

    it('still signs in with the right password', async () => {
        const answer = await signIn({ email: EMAIL, password: PASSWORD });
        expect(answer.status).toBe(true);
        expect(String(answer.data._id)).toBe(ID);
    });
});
