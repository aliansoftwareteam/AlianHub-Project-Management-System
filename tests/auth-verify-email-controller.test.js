const mockDb = require('./fixtures/fakeMongo').create();

jest.mock('../utils/mongo-handler/mongoQueries', () => ({ MongoDbCrudOpration: (...a) => mockDb.crud(...a) }));
jest.mock('../Config/loggerConfig', () => ({ info: jest.fn(), error: jest.fn(), warn: jest.fn() }));

const { dbCollections } = require('../Config/collections');
const { verifyEmail } = require('../Modules/Auth/controller/verifyEmail');

const UID = '6f0000000000000000000a01';
const OTHER_UID = '6f0000000000000000000a02';
const TOKEN = 'verify-secret';
const NOT_VALID = { status: false, statusText: 'This link is invalid or has expired.', showResendVerification: true };

const users = () => mockDb.store[dbCollections.USERS] || [];
const userRow = (id = UID) => users().find((u) => u._id === id);
const minutesAgo = (m) => new Date(Date.now() - m * 60 * 1000);

const seedUser = (over = {}) => mockDb.seed(dbCollections.USERS, {
    _id: UID,
    Employee_Email: 'ada@example.test',
    isEmailVerified: false,
    verificationToken: TOKEN,
    verificationTokenTime: minutesAgo(1),
    ...over,
});

const verify = (body) => {
    const res = { send: jest.fn() };
    verifyEmail({ body }, res);
    return new Promise((resolve) => setImmediate(() => resolve(res)));
};
const answer = (res) => res.send.mock.calls[0][0];

beforeEach(() => {
    Object.keys(mockDb.store).forEach((k) => { mockDb.store[k].length = 0; });
    mockDb.calls.length = 0;
    jest.clearAllMocks();
});

describe('verifyEmail', () => {
    it('marks the account verified and clears the stored token', async () => {
        seedUser();
        const res = await verify({ uid: UID, token: TOKEN });
        expect(answer(res)).toEqual({ status: true, statusText: 'Email verified successfully.', showResendVerification: false });
        expect(userRow()).toMatchObject({ isEmailVerified: true, verificationToken: '' });
    });

    it('only changes the account the link names', async () => {
        seedUser();
        seedUser({ _id: OTHER_UID, verificationToken: 'other-secret' });
        await verify({ uid: UID, token: TOKEN });
        expect(userRow(OTHER_UID)).toMatchObject({ isEmailVerified: false, verificationToken: 'other-secret' });
    });

    it('reads and writes the global user collection, naming only the uid in the filter', async () => {
        seedUser();
        await verify({ uid: UID, token: TOKEN });
        expect(mockDb.calls).toEqual([
            { companyId: 'global', type: dbCollections.USERS, method: 'findOne', data: [{ _id: UID }] },
            {
                companyId: 'global',
                type: dbCollections.USERS,
                method: 'findOneAndUpdate',
                data: [{ _id: UID }, { $set: { verificationToken: '', isEmailVerified: true } }],
            },
        ]);
    });

    it('cannot be replayed once the token is used', async () => {
        seedUser();
        await verify({ uid: UID, token: TOKEN });
        const again = await verify({ uid: UID, token: TOKEN });
        expect(answer(again)).toEqual(NOT_VALID);
    });

    it('accepts a token issued just inside the ten minute window', async () => {
        seedUser({ verificationTokenTime: minutesAgo(9) });
        const res = await verify({ uid: UID, token: TOKEN });
        expect(answer(res).status).toBe(true);
    });

    it('refuses an expired token and leaves the account unverified', async () => {
        seedUser({ verificationTokenTime: minutesAgo(11) });
        const res = await verify({ uid: UID, token: TOKEN });
        expect(answer(res)).toEqual(NOT_VALID);
        expect(userRow()).toMatchObject({ isEmailVerified: false, verificationToken: TOKEN });
    });

    it.each([
        ['missing', undefined],
        ['unreadable', 'not a date'],
        ['empty', ''],
    ])('treats a %s issue time as expired', async (_name, verificationTokenTime) => {
        seedUser({ verificationTokenTime });
        const res = await verify({ uid: UID, token: TOKEN });
        expect(answer(res)).toEqual(NOT_VALID);
        expect(userRow().isEmailVerified).toBe(false);
    });

    it('refuses a wrong token', async () => {
        seedUser();
        const res = await verify({ uid: UID, token: 'guess' });
        expect(answer(res)).toEqual(NOT_VALID);
        expect(userRow()).toMatchObject({ isEmailVerified: false, verificationToken: TOKEN });
    });

    it('refuses one account\'s token presented for another account', async () => {
        seedUser();
        seedUser({ _id: OTHER_UID, verificationToken: 'other-secret' });
        const res = await verify({ uid: OTHER_UID, token: TOKEN });
        expect(answer(res)).toEqual(NOT_VALID);
        expect(userRow(OTHER_UID).isEmailVerified).toBe(false);
    });

    it.each([
        ['an empty', ''],
        ['a missing', undefined],
    ])('refuses %s stored token even when the caller sends the same', async (_name, verificationToken) => {
        seedUser({ verificationToken });
        const res = await verify({ uid: UID, token: '' });
        expect(answer(res).status).toBe(false);
        expect(userRow().isEmailVerified).toBe(false);
    });

    it('answers an unknown account and an already verified one exactly like a bad token', async () => {
        seedUser({ _id: OTHER_UID, isEmailVerified: true });
        const unknown = await verify({ uid: '6f0000000000000000000aff', token: TOKEN });
        const verified = await verify({ uid: OTHER_UID, token: TOKEN });
        expect(answer(unknown)).toEqual(NOT_VALID);
        expect(answer(verified)).toEqual(NOT_VALID);
        expect(JSON.stringify(answer(verified))).not.toContain('ada@example.test');
    });

    it('answers the same refusal when the lookup fails', async () => {
        mockDb.crud.mockRejectedValueOnce(new Error('connection refused to db-host:27017'));
        const res = await verify({ uid: UID, token: TOKEN });
        expect(answer(res)).toEqual(NOT_VALID);
    });

    it('reports a failure to save the verification', async () => {
        seedUser();
        const stored = userRow();
        mockDb.crud.mockResolvedValueOnce(stored);
        mockDb.crud.mockRejectedValueOnce(new Error('write failed'));
        const res = await verify({ uid: UID, token: TOKEN });
        expect(answer(res)).toEqual({ status: false, statusText: 'write failed' });
    });

    describe('wrong input', () => {
        it.each([
            ['no uid', { token: TOKEN }, 'uid is required.'],
            ['an empty uid', { uid: '', token: TOKEN }, 'uid is required.'],
            ['a non-string uid', { uid: { $ne: null }, token: TOKEN }, 'uid is required.'],
            ['a numeric uid', { uid: 5, token: TOKEN }, 'uid is required.'],
            ['no token', { uid: UID }, 'token is required.'],
            ['an empty token', { uid: UID, token: '' }, 'token is required.'],
            ['a non-string token', { uid: UID, token: { $ne: '' } }, 'token is required.'],
            ['an array token', { uid: UID, token: [TOKEN] }, 'token is required.'],
        ])('refuses %s without touching the database', async (_name, body, statusText) => {
            seedUser();
            const res = await verify(body);
            expect(answer(res)).toEqual({ status: false, statusText });
            expect(mockDb.calls).toEqual([]);
            expect(userRow().isEmailVerified).toBe(false);
        });

        it('answers an error instead of throwing when there is no body', () => {
            const res = { send: jest.fn() };
            expect(() => verifyEmail({}, res)).not.toThrow();
            expect(res.send).toHaveBeenCalledWith(expect.objectContaining({ status: false }));
        });
    });
});
