process.env.STORAGE_TYPE = process.env.STORAGE_TYPE || 'server';

jest.mock('../Config/loggerConfig', () => ({ error: jest.fn(), info: jest.fn(), warn: jest.fn() }));
jest.mock('../utils/mongo-handler/mongoQueries', () => ({ MongoDbCrudOpration: jest.fn() }));
jest.mock('../utils/data', () => ({ importUserNotifications: jest.fn(async () => undefined) }));
jest.mock('../Modules/Auth/controller', () => ({ addAndRemoveUserInMongodbNotificationCount: jest.fn(async () => undefined), insertAuthFun: jest.fn() }));
jest.mock('../Modules/service.js', () => ({ SendEmail: jest.fn() }));

const logger = require('../Config/loggerConfig');
const { MongoDbCrudOpration } = require('../utils/mongo-handler/mongoQueries');
const { insertAuthFun } = require('../Modules/Auth/controller');
const { SendEmail } = require('../Modules/service.js');
const { createUserV2 } = require('../Modules/Auth/controller/createUser');

const USER_ID = '6f0000000000000000000001';
const TOKEN_SET_AFTER_SIGNUP = 'b'.repeat(64);

let account;
let mails;
let failTokenWrite;

/* A database answers on a later turn of the event loop, which is what lets a write outlive the response. */
const later = (ms = 5) => new Promise((resolve) => setTimeout(resolve, ms));

const signUp = () => new Promise((resolve) => {
    const res = { send: (body) => resolve({ body, storedAtAnswer: account && account.verificationToken }) };
    createUserV2({ body: { firstName: 'Ada', lastName: 'Lovelace', email: 'Ada@Example.test', password: 'Sup3r-Secret!' } }, res);
});

const mailStarted = async () => {
    while (!mails.length) await later();
    return mails[0];
};

beforeEach(() => {
    jest.clearAllMocks();
    account = null;
    mails = [];
    failTokenWrite = false;
    insertAuthFun.mockImplementation((data, callback) => callback({ status: true, data: { _id: USER_ID } }));
    MongoDbCrudOpration.mockImplementation(async (db, { type, data }, method) => {
        await later();
        if (type !== 'users') return null;
        if (method === 'save') {
            account = { ...data };
            return { ...account };
        }
        if (method === 'updateOne' && account && String(data[0]._id) === String(account._id)) {
            if (failTokenWrite) throw new Error('write refused');
            Object.assign(account, data[1]);
            return { matchedCount: 1, modifiedCount: 1 };
        }
        return null;
    });
    SendEmail.mockImplementation((subject, html, to, isHtml, finish) => { mails.push({ html, to, finish }); });
});

describe('POST /api/v2/createUser verification token', () => {
    it('is stored when the signup answers, without waiting for the mail', async () => {
        const { body, storedAtAnswer } = await signUp();

        expect(body.status).toBe(true);
        expect(storedAtAnswer).toMatch(/^[0-9a-f]{64}$/);
        const mail = await mailStarted();
        expect(mail.to).toBe('ada@example.test');
        expect(mail.html).toContain(`/verify-email/${USER_ID}/${storedAtAnswer}`);
    });

    it('is not rewritten once the signup has answered, however late the mail finishes', async () => {
        await signUp();
        account.verificationToken = TOKEN_SET_AFTER_SIGNUP;

        (await mailStarted()).finish({ status: true });
        await later(30);

        expect(account.verificationToken).toBe(TOKEN_SET_AFTER_SIGNUP);
    });

    it('does not fail the signup when the mail fails, and logs why', async () => {
        const { body } = await signUp();
        (await mailStarted()).finish({ status: false, error: 'SMTP refused' });
        await later(30);

        expect(body.status).toBe(true);
        expect(logger.error).toHaveBeenCalledWith('SMTP refused');
    });

    it('does not fail the signup when the token cannot be stored, logs why and mails no link', async () => {
        failTokenWrite = true;
        const { body } = await signUp();
        await later(30);

        expect(body.status).toBe(true);
        expect(logger.error).toHaveBeenCalledWith(expect.stringContaining('write refused'));
        expect(mails).toEqual([]);
    });
});
