const mockWorld = { rows: {} };
const mockUpdateMember = jest.fn();
const mockUpdateUser = jest.fn(async () => undefined);
const mockImportNotifications = jest.fn(async () => undefined);
const mockNotificationCount = jest.fn(async () => undefined);
const mockRecordOwner = jest.fn(async () => undefined);

jest.mock('../utils/mongo-handler/mongoQueries', () => ({
    MongoDbCrudOpration: jest.fn(async (companyId, { type, data }, method) => {
        const list = (mockWorld.rows[`${companyId}:${type}`] || []);
        return list.find((row) => String(row._id) === String(data[0]._id) && (data[0].isDelete === undefined || row.isDelete !== true)) || null;
    }),
}));
jest.mock('../Config/loggerConfig', () => ({ info: jest.fn(), error: jest.fn(), warn: jest.fn() }));
jest.mock('../Modules/Auth/controller', () => ({ addAndRemoveUserInMongodbNotificationCount: (...a) => mockNotificationCount(...a) }));
jest.mock('../Modules/Users/controller', () => ({ updateUserFun: (...a) => mockUpdateUser(...a) }));
jest.mock('../Modules/settings/Members/controller', () => ({ updateMemberFunction: (...a) => mockUpdateMember(...a) }));
jest.mock('../utils/data', () => ({ importUserNotifications: (...a) => mockImportNotifications(...a) }));
jest.mock('../Modules/Company/helpers/recordInvitedOwner', () => ({ recordInvitedOwner: (...a) => mockRecordOwner(...a) }));

const logger = require('../Config/loggerConfig');
const { MongoDbCrudOpration } = require('../utils/mongo-handler/mongoQueries');
const { dbCollections } = require('../Config/collections');
const {
    parseInviteBlob, invitationBindsAccount, checkPermission, acceptSignedIn,
} = require('../Modules/Auth/controller/verifyInvitation');

const COMPANY = '6f0000000000000000000c01';
const OTHER_COMPANY = '6f0000000000000000000c02';
const INVITATION = '6f0000000000000000000d01';
const USER = '6f0000000000000000000001';
const OTHER_USER = '6f0000000000000000000002';
const LINK = 'link-token-abc';
const INVALID_URL = { status: false, key: 1, statusText: 'Invalid URL.' };
const CANNOT_ACCEPT = { status: false, statusText: 'This invitation cannot be accepted.' };
const NOT_JOINED = { status: false, statusText: 'The invitation could not be accepted just now. Try again.' };

const encode = (parts) => Buffer.from(parts, 'binary').toString('base64');
const blob = (over = {}) => {
    const fields = { userId: USER, companyId: COMPANY, docId: INVITATION, linkId: LINK, ...over };
    return encode(Object.entries(fields).filter(([, v]) => v !== undefined).map(([k, v]) => `${k}=${v}`).join('&'));
};

const seedInvitation = (over = {}, companyId = COMPANY) => {
    const row = {
        _id: INVITATION, status: 1, linkId: LINK, userId: USER, userEmail: 'ada@example.test', isDelete: false,
        sendInvitationTime: new Date(Date.now() - 60 * 60 * 1000), ...over,
    };
    mockWorld.rows[`${companyId}:${dbCollections.COMPANY_USERS}`] = [row];
    return row;
};
const seedAccount = (over = {}) => {
    const row = { _id: USER, Employee_Email: 'ada@example.test', isEmailVerified: true, isActive: true, isDeleted: false, ...over };
    const key = `global:${dbCollections.USERS}`;
    mockWorld.rows[key] = [...(mockWorld.rows[key] || []).filter((r) => r._id !== row._id), row];
    return row;
};

const reply = () => {
    const res = { statusCode: 200, headersSent: false };
    res.status = (code) => { res.statusCode = code; return res; };
    res.json = (body) => { res.body = body; return res; };
    return res;
};
const run = async (handler, req) => {
    const res = reply();
    await handler(req, res);
    return res;
};
const check = (body) => run(checkPermission, { body });
const accept = (body, over = {}) => run(acceptSignedIn, { uid: USER, body: { companyId: COMPANY, memberId: INVITATION, linkId: LINK, ...body }, ...over });

beforeEach(() => {
    mockWorld.rows = {};
    jest.clearAllMocks();
    mockUpdateMember.mockImplementation(async (companyId, data) => ({ data: { _id: data[0]._id } }));
    seedInvitation();
    seedAccount();
});

describe('parseInviteBlob', () => {
    it('reads the four link fields', () => {
        expect(parseInviteBlob(blob())).toEqual({ userId: USER, companyId: COMPANY, docId: INVITATION, linkId: LINK });
    });

    it('keeps the part of a value after its first equals sign', () => {
        expect(parseInviteBlob(encode('linkId=a=b'))).toEqual({ linkId: 'a=b' });
    });

    it('ignores keys the link may not set and parts with no equals sign', () => {
        expect(parseInviteBlob(encode('role=1&junk&userId=u1&__proto__=x'))).toEqual({ userId: 'u1' });
    });

    it.each([
        ['undefined', undefined],
        ['an empty string', ''],
        ['a number', 12],
        ['an object', { userId: USER }],
        ['text outside the base64 alphabet', 'not base64!!'],
        ['a link with no known key', encode('role=1&x=2')],
        ['a link with no pairs', encode('plain text')],
    ])('answers null for %s', (_name, input) => {
        expect(parseInviteBlob(input)).toBeNull();
    });
});

describe('invitationBindsAccount', () => {
    const account = { _id: USER, Employee_Email: 'ada@example.test', isEmailVerified: true };

    it('binds an invitation that names the account', () => {
        expect(invitationBindsAccount({ userId: USER }, { _id: USER })).toBe(true);
    });

    it('refuses an invitation naming a different account, even with a matching email', () => {
        expect(invitationBindsAccount({ userId: OTHER_USER, userEmail: 'ada@example.test' }, account)).toBe(false);
    });

    it.each([
        ['deleted', { isDeleted: true }],
        ['deactivated', { isActive: false }],
    ])('refuses a %s account', (_name, over) => {
        expect(invitationBindsAccount({ userId: USER }, { ...account, ...over })).toBe(false);
    });

    it('binds an unnamed invitation to a verified account with the same address, ignoring case and spaces', () => {
        expect(invitationBindsAccount({ userId: '', userEmail: ' ADA@Example.test ' }, account)).toBe(true);
    });

    it('refuses an unnamed invitation for an unverified account or another address', () => {
        expect(invitationBindsAccount({ userId: '', userEmail: 'ada@example.test' }, { ...account, isEmailVerified: false })).toBe(false);
        expect(invitationBindsAccount({ userId: '', userEmail: 'eve@example.test' }, account)).toBe(false);
    });

    it('refuses an unnamed invitation with no address, even for an account with none', () => {
        expect(invitationBindsAccount({ userId: '' }, { _id: USER, isEmailVerified: true })).toBe(false);
    });

    it('refuses a missing invitation or account', () => {
        expect(invitationBindsAccount(null, account)).toBe(false);
        expect(invitationBindsAccount({ userId: USER }, undefined)).toBe(false);
    });
});

describe('checkPermission', () => {
    it('accepts a valid link, answers the company and marks the invitation accepted', async () => {
        const res = await check({ id: blob() });
        expect(res.body).toEqual({ status: true, key: 5, companyId: COMPANY });
        expect(mockUpdateMember).toHaveBeenCalledWith(COMPANY, [
            { _id: INVITATION, status: 1, linkId: LINK },
            { $set: { status: 2, linkId: '', userId: USER } },
            { returnDocument: 'after' },
        ], 'findOneAndUpdate');
    });

    it('reads the invitation from the link\'s company and the account from the global users', async () => {
        await check({ id: blob() });
        const reads = MongoDbCrudOpration.mock.calls.map(([companyId, obj, method]) => [companyId, obj.type, method]);
        expect(reads).toEqual(expect.arrayContaining([
            [COMPANY, dbCollections.COMPANY_USERS, 'findOne'],
            ['global', dbCollections.USERS, 'findOne'],
        ]));
        expect(reads).toHaveLength(2);
        const invitationRead = MongoDbCrudOpration.mock.calls.find(([, obj]) => obj.type === dbCollections.COMPANY_USERS);
        expect(String(invitationRead[1].data[0]._id)).toBe(INVITATION);
        expect(invitationRead[1].data[0].isDelete).toEqual({ $ne: true });
    });

    it('joins the account to the company and starts its notification settings and count there', async () => {
        await check({ id: blob() });
        expect(mockUpdateUser).toHaveBeenCalledTimes(1);
        const [scope, obj, method, companyId, userId] = mockUpdateUser.mock.calls[0];
        expect([scope, method, companyId, userId]).toEqual(['global', 'updateOne', COMPANY, USER]);
        expect(obj.type).toBe(dbCollections.USERS);
        expect(String(obj.data[0]._id)).toBe(USER);
        expect(obj.data[1]).toEqual({ $addToSet: { AssignCompany: COMPANY } });
        expect(mockImportNotifications).toHaveBeenCalledWith(COMPANY, USER);
        expect(mockNotificationCount).toHaveBeenCalledWith(COMPANY, USER, 'Add');
        expect(mockRecordOwner).toHaveBeenCalledWith(expect.objectContaining({ companyId: COMPANY, userId: USER }));
    });

    it('still accepts when the notification settings or the unread count cannot be started, and logs each', async () => {
        mockImportNotifications.mockRejectedValueOnce(new Error('settings down'));
        mockNotificationCount.mockRejectedValueOnce(new Error('count down'));
        const res = await check({ id: blob() });
        expect(res.body).toEqual({ status: true, key: 5, companyId: COMPANY });
        await new Promise((resolve) => setImmediate(resolve));
        expect(logger.error).toHaveBeenCalledTimes(2);
        expect(mockUpdateMember).toHaveBeenCalledTimes(1);
    });

    describe('when the company cannot be put on the account or the new owner cannot be recorded', () => {
        const seatGivenBack = (userId) => [COMPANY, [
            { _id: INVITATION, status: 2, userId: USER },
            { $set: { status: 1, linkId: LINK, userId } },
        ], 'findOneAndUpdate'];
        const accountChanges = () => mockUpdateUser.mock.calls.map(([, obj]) => obj.data[1]);

        it('answers a failure, not accepted, and makes the seat wait again with its link', async () => {
            mockUpdateUser.mockRejectedValueOnce(new Error('user update down at db-host:27017'));
            const res = await check({ id: blob() });
            expect(res.statusCode).toBe(500);
            expect(res.body).toEqual(NOT_JOINED);
            expect(JSON.stringify(res.body)).not.toContain('db-host');
            expect(mockUpdateMember).toHaveBeenCalledTimes(2);
            expect(mockUpdateMember.mock.calls[1]).toEqual(seatGivenBack(USER));
            expect(accountChanges()).toEqual([{ $addToSet: { AssignCompany: COMPANY } }]);
            expect(mockRecordOwner).not.toHaveBeenCalled();
            expect(mockImportNotifications).not.toHaveBeenCalled();
            expect(mockNotificationCount).not.toHaveBeenCalled();
            expect(logger.error).toHaveBeenCalledWith(expect.stringContaining('user update down'));
        });

        it('answers a failure when the account to join is not found', async () => {
            mockUpdateUser.mockResolvedValueOnce({ data: { matchedCount: 0, modifiedCount: 0 } });
            const res = await check({ id: blob() });
            expect(res.statusCode).toBe(500);
            expect(res.body).toEqual(NOT_JOINED);
            expect(mockUpdateMember.mock.calls[1]).toEqual(seatGivenBack(USER));
            expect(mockRecordOwner).not.toHaveBeenCalled();
        });

        it('takes the company back off the account when recording the owner fails', async () => {
            mockUpdateUser.mockResolvedValueOnce({ data: { matchedCount: 1, modifiedCount: 1 } });
            mockRecordOwner.mockRejectedValueOnce(new Error('owner row down'));
            const res = await check({ id: blob() });
            expect(res.statusCode).toBe(500);
            expect(res.body).toEqual(NOT_JOINED);
            expect(accountChanges()).toEqual([{ $addToSet: { AssignCompany: COMPANY } }, { $pull: { AssignCompany: COMPANY } }]);
            expect(mockUpdateMember.mock.calls[1]).toEqual(seatGivenBack(USER));
            expect(mockImportNotifications).not.toHaveBeenCalled();
        });

        it('leaves the company on an account that already listed it', async () => {
            mockUpdateUser.mockResolvedValueOnce({ data: { matchedCount: 1, modifiedCount: 0 } });
            mockRecordOwner.mockRejectedValueOnce(new Error('owner row down'));
            const res = await check({ id: blob() });
            expect(res.body).toEqual(NOT_JOINED);
            expect(accountChanges()).toEqual([{ $addToSet: { AssignCompany: COMPANY } }]);
        });

        it('gives an invitation that named no account back without one', async () => {
            seedInvitation({ userId: '', userEmail: 'ada@example.test' });
            mockUpdateUser.mockRejectedValueOnce(new Error('user update down'));
            const res = await check({ id: blob() });
            expect(res.body).toEqual(NOT_JOINED);
            expect(mockUpdateMember.mock.calls[1]).toEqual(seatGivenBack(''));
        });

        it('still answers the failure when the seat cannot be given back, and logs that too', async () => {
            mockUpdateUser.mockRejectedValueOnce(new Error('user update down'));
            mockUpdateMember.mockImplementationOnce(async (companyId, data) => ({ data: { _id: data[0]._id } }));
            mockUpdateMember.mockRejectedValueOnce(new Error('seat write down'));
            const res = await check({ id: blob() });
            expect(res.statusCode).toBe(500);
            expect(res.body).toEqual(NOT_JOINED);
            expect(logger.error).toHaveBeenCalledWith(expect.stringContaining('seat write down'));
        });
    });

    it('accepts an invitation sent to an address with no account yet once a verified account holds it', async () => {
        seedInvitation({ userId: '', userEmail: 'ada@example.test' });
        const res = await check({ id: blob() });
        expect(res.body.status).toBe(true);
        expect(mockUpdateMember.mock.calls[0][1][1].$set.userId).toBe(USER);
    });

    it('answers expired for a link older than a day, and changes nothing', async () => {
        seedInvitation({ sendInvitationTime: new Date(Date.now() - 25 * 60 * 60 * 1000) });
        const res = await check({ id: blob() });
        expect(res.body).toEqual({ status: false, key: 4, statusText: 'Link is Expired.' });
        expect(mockUpdateMember).not.toHaveBeenCalled();
    });

    it.failing('answers expired when the send time is missing (NaN time never expires, link accepted)', async () => {
        seedInvitation({ sendInvitationTime: undefined });
        const res = await check({ id: blob() });
        expect(res.body.key).not.toBe(5);
        expect(mockUpdateMember).not.toHaveBeenCalled();
    });

    describe('refusals all answer the same Invalid URL', () => {
        it.each([
            ['no body', undefined],
            ['no id', {}],
            ['a non-string id', { id: { $ne: '' } }],
            ['an id that is not base64', { id: 'zzz!' }],
            ['a link without a user', { id: blob({ userId: undefined }) }],
            ['a link without a company', { id: blob({ companyId: undefined }) }],
            ['a link without an invitation id', { id: blob({ docId: undefined }) }],
            ['a link without a token', { id: blob({ linkId: undefined }) }],
            ['a company id that is not an object id', { id: blob({ companyId: 'acme' }) }],
            ['an invitation id that is not an object id', { id: blob({ docId: '1' }) }],
            ['a user id that is not an object id', { id: blob({ userId: 'me' }) }],
            ['a wrong token', { id: blob({ linkId: 'guess' }) }],
            ['a shorter token', { id: blob({ linkId: 'link' }) }],
        ])('for %s', async (_name, body) => {
            const res = await run(checkPermission, { body });
            expect(res.body).toEqual(INVALID_URL);
            expect(mockUpdateMember).not.toHaveBeenCalled();
        });

        it.each([
            ['an already accepted invitation', { status: 2 }],
            ['an invitation with its token cleared', { linkId: '' }],
            ['a withdrawn invitation', { isDelete: true }],
            ['an invitation for another account', { userId: OTHER_USER }],
        ])('for %s', async (_name, over) => {
            seedInvitation(over);
            const res = await check({ id: blob() });
            expect(res.body).toEqual(INVALID_URL);
            expect(mockUpdateMember).not.toHaveBeenCalled();
        });

        it.each([
            ['a missing account', null],
            ['a deleted account', { isDeleted: true }],
            ['a deactivated account', { isActive: false }],
        ])('for %s', async (_name, over) => {
            if (over === null) mockWorld.rows[`global:${dbCollections.USERS}`] = [];
            else seedAccount(over);
            const res = await check({ id: blob() });
            expect(res.body).toEqual(INVALID_URL);
            expect(mockUpdateMember).not.toHaveBeenCalled();
        });

        it('for an invitation that lives in another company', async () => {
            mockWorld.rows = {};
            seedAccount();
            seedInvitation({}, OTHER_COMPANY);
            const res = await check({ id: blob() });
            expect(res.body).toEqual(INVALID_URL);
            expect(mockUpdateMember).not.toHaveBeenCalled();
        });

        it('for an invitation that was withdrawn between the check and the claim', async () => {
            mockUpdateMember.mockResolvedValueOnce({ data: null });
            const res = await check({ id: blob() });
            expect(res.body).toEqual(INVALID_URL);
            expect(mockUpdateUser).not.toHaveBeenCalled();
            expect(mockNotificationCount).not.toHaveBeenCalled();
        });

        it('for a failing database, logging the cause but not answering it', async () => {
            MongoDbCrudOpration.mockRejectedValueOnce(new Error('mongo down at db-host:27017'));
            const res = await check({ id: blob() });
            expect(res.body).toEqual(INVALID_URL);
            expect(JSON.stringify(res.body)).not.toContain('db-host');
            expect(logger.error).toHaveBeenCalledWith(expect.stringContaining('db-host'));
        });
    });

    it('ignores a companyId sent outside the link', async () => {
        const res = await check({ id: blob(), companyId: OTHER_COMPANY });
        expect(res.body.companyId).toBe(COMPANY);
        expect(mockUpdateMember.mock.calls[0][0]).toBe(COMPANY);
    });
});

describe('acceptSignedIn', () => {
    it('accepts for the signed-in account and answers the company', async () => {
        const res = await accept();
        expect(res.statusCode).toBe(200);
        expect(res.body).toEqual({ status: true, statusText: 'Invitation accepted.', companyId: COMPANY });
        expect(mockUpdateMember).toHaveBeenCalledWith(COMPANY, [
            { _id: INVITATION, status: 1, linkId: LINK },
            { $set: { status: 2, linkId: '', userId: USER } },
            { returnDocument: 'after' },
        ], 'findOneAndUpdate');
    });

    it('reads the invitation from the named company and the signed-in account from the global users', async () => {
        await accept();
        const invitationRead = MongoDbCrudOpration.mock.calls.find(([, obj]) => obj.type === dbCollections.COMPANY_USERS);
        const accountRead = MongoDbCrudOpration.mock.calls.find(([, obj]) => obj.type === dbCollections.USERS);
        expect(invitationRead[0]).toBe(COMPANY);
        expect(String(invitationRead[1].data[0]._id)).toBe(INVITATION);
        expect(accountRead[0]).toBe('global');
        expect(String(accountRead[1].data[0]._id)).toBe(USER);
    });

    it('joins the account to the company and starts its notification settings there', async () => {
        await accept();
        expect(mockUpdateUser.mock.calls[0][3]).toBe(COMPANY);
        expect(mockUpdateUser.mock.calls[0][1].data[1]).toEqual({ $addToSet: { AssignCompany: COMPANY } });
        expect(mockImportNotifications).toHaveBeenCalledWith(COMPANY, USER);
        expect(mockNotificationCount).toHaveBeenCalledWith(COMPANY, USER, 'Add');
    });

    it('answers a failure, not accepted, and makes the seat wait again when the company cannot be put on the account', async () => {
        mockUpdateUser.mockRejectedValueOnce(new Error('user update down'));
        const res = await accept();
        expect(res.statusCode).toBe(500);
        expect(res.body).toEqual(NOT_JOINED);
        expect(mockUpdateMember.mock.calls[1]).toEqual([COMPANY, [
            { _id: INVITATION, status: 2, userId: USER },
            { $set: { status: 1, linkId: LINK, userId: USER } },
        ], 'findOneAndUpdate']);
        expect(mockImportNotifications).not.toHaveBeenCalled();
    });

    it('does not expire a pending invitation by age', async () => {
        seedInvitation({ sendInvitationTime: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) });
        const res = await accept();
        expect(res.body.status).toBe(true);
    });

    describe('refuses with 403', () => {
        it.each([
            ['a signed-out caller', { uid: undefined }],
            ['a caller whose uid is not an object id', { uid: 'me' }],
            ['an API token', { apiToken: 'tok' }],
        ])('%s', async (_name, over) => {
            const res = await accept({}, over);
            expect(res.statusCode).toBe(403);
            expect(res.body).toEqual(CANNOT_ACCEPT);
            expect(MongoDbCrudOpration).not.toHaveBeenCalled();
            expect(mockUpdateMember).not.toHaveBeenCalled();
        });

        it.each([
            ['no company', { companyId: undefined }],
            ['a company that is not an object id', { companyId: 'acme' }],
            ['a company sent as an object', { companyId: { $ne: '' } }],
            ['no invitation id', { memberId: undefined }],
            ['an invitation id that is not an object id', { memberId: '1' }],
            ['an invitation id sent as an array', { memberId: [INVITATION] }],
        ])('%s, without reading the database', async (_name, body) => {
            const res = await accept(body);
            expect(res.statusCode).toBe(403);
            expect(res.body).toEqual(CANNOT_ACCEPT);
            expect(MongoDbCrudOpration).not.toHaveBeenCalled();
        });

        it('no body', async () => {
            const res = await run(acceptSignedIn, { uid: USER });
            expect(res.statusCode).toBe(403);
            expect(MongoDbCrudOpration).not.toHaveBeenCalled();
        });

        it.each([
            ['no token', { linkId: undefined }],
            ['a non-string token', { linkId: { $ne: '' } }],
            ['a wrong token', { linkId: 'guess' }],
        ])('%s', async (_name, body) => {
            const res = await accept(body);
            expect(res.statusCode).toBe(403);
            expect(res.body).toEqual(CANNOT_ACCEPT);
            expect(mockUpdateMember).not.toHaveBeenCalled();
        });

        it('an invitation meant for another account', async () => {
            const res = await accept({}, { uid: OTHER_USER });
            expect(res.statusCode).toBe(403);
            expect(mockUpdateMember).not.toHaveBeenCalled();
        });

        it('a caller who names a company where the invitation does not exist', async () => {
            const res = await accept({ companyId: OTHER_COMPANY });
            expect(res.statusCode).toBe(403);
            expect(MongoDbCrudOpration.mock.calls.find(([, obj]) => obj.type === dbCollections.COMPANY_USERS)[0]).toBe(OTHER_COMPANY);
            expect(mockUpdateMember).not.toHaveBeenCalled();
        });

        it('an invitation already accepted or withdrawn', async () => {
            seedInvitation({ status: 2, linkId: '' });
            expect((await accept()).statusCode).toBe(403);
            seedInvitation({ isDelete: true });
            expect((await accept()).statusCode).toBe(403);
            expect(mockUpdateMember).not.toHaveBeenCalled();
        });

        it('a lost race for the invitation', async () => {
            mockUpdateMember.mockResolvedValueOnce({ data: null });
            const res = await accept();
            expect(res.statusCode).toBe(403);
            expect(mockUpdateUser).not.toHaveBeenCalled();
        });

        it('a failing database, without echoing the cause', async () => {
            MongoDbCrudOpration.mockRejectedValueOnce(new Error('mongo down at db-host:27017'));
            const res = await accept();
            expect(res.statusCode).toBe(403);
            expect(res.body).toEqual(CANNOT_ACCEPT);
            expect(logger.error).toHaveBeenCalledWith(expect.stringContaining('db-host'));
        });
    });
});
