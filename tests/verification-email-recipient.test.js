jest.mock('../Config/loggerConfig', () => ({ error: jest.fn(), info: jest.fn(), warn: jest.fn() }));
jest.mock('../utils/mongo-handler/mongoQueries', () => ({ MongoDbCrudOpration: jest.fn() }));
jest.mock('../Modules/service.js', () => ({ SendEmail: jest.fn((subject, html, to, isHtml, cb) => cb({ status: true })) }));

const fs = require('fs');
const path = require('path');
const { MongoDbCrudOpration } = require('../utils/mongo-handler/mongoQueries');
const { SendEmail } = require('../Modules/service.js');
const { newLinkToken } = require('../Modules/Auth/helpers/linkToken');
const ctrl = require('../Modules/Auth/controller/sendVerificationMail');

const UID = '6f0000000000000000000a01';
const STORED_EMAIL = 'account.owner@example.test';

const callController = (body) => new Promise((resolve) => {
    const res = {};
    res.status = jest.fn(() => res);
    res.send = jest.fn((payload) => resolve(payload));
    res.json = res.send;
    ctrl.sendVerificationEmail({ body }, res);
});

let account;

beforeEach(() => {
    SendEmail.mockClear();
    account = { _id: UID, Employee_Email: STORED_EMAIL, isEmailVerified: false };
    MongoDbCrudOpration.mockReset();
    MongoDbCrudOpration.mockImplementation(async (db, obj, method) => (method === 'findOne' ? account : { acknowledged: true }));
});

describe('sendVerificationEmail', () => {
    it('sends the link to the stored address, not the one in the request', async () => {
        const payload = await callController({ uid: UID, email: 'attacker@evil.test' });
        expect(payload.status).toBe(true);
        expect(SendEmail).toHaveBeenCalledTimes(1);
        expect(SendEmail.mock.calls[0][2]).toBe(STORED_EMAIL);
    });

    it('does not need an email in the request', async () => {
        const payload = await callController({ uid: UID });
        expect(payload.status).toBe(true);
        expect(SendEmail.mock.calls[0][2]).toBe(STORED_EMAIL);
    });

    it('stores a 256-bit token and puts it in the link', async () => {
        await callController({ uid: UID, email: STORED_EMAIL });
        const update = MongoDbCrudOpration.mock.calls.find((call) => call[2] === 'updateOne');
        const token = update[1].data[1].verificationToken;
        expect(token).toMatch(/^[0-9a-f]{64}$/);
        expect(SendEmail.mock.calls[0][1]).toContain(`/verify-email/${UID}/${token}`);
    });

    it.each([[{}], [{ uid: 'not-an-id', email: 'attacker@evil.test' }]])('refuses %j without sending', async (body) => {
        const payload = await callController(body);
        expect(payload.status).toBe(false);
        expect(SendEmail).not.toHaveBeenCalled();
    });

    it('refuses an unknown account without sending', async () => {
        account = null;
        const payload = await callController({ uid: UID, email: 'attacker@evil.test' });
        expect(payload.status).toBe(false);
        expect(SendEmail).not.toHaveBeenCalled();
    });

    it('refuses an account that is already verified', async () => {
        account.isEmailVerified = true;
        const payload = await callController({ uid: UID });
        expect(payload.status).toBe(false);
        expect(SendEmail).not.toHaveBeenCalled();
    });
});

describe('invite and verification link tokens', () => {
    it('are 32 random bytes, hex encoded', () => {
        const tokens = new Set(Array.from({ length: 50 }, newLinkToken));
        expect(tokens.size).toBe(50);
        tokens.forEach((token) => expect(token).toMatch(/^[0-9a-f]{64}$/));
    });

    it.each(['sendInvitation.js', 'sendVerificationMail.js'])('%s no longer builds tokens with Math.random', (file) => {
        const source = fs.readFileSync(path.join(__dirname, '../Modules/Auth/controller', file), 'utf8');
        expect(source).not.toMatch(/Math\.random/);
        expect(source).toMatch(/newLinkToken\(\)/);
    });
});
