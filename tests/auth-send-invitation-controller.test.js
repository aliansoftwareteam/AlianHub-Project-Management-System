const mockDb = { calls: [], findOne: jest.fn() };
const mockSendEmail = jest.fn();
const mockUpdateCompany = jest.fn();
const mockGetUsers = jest.fn();
const mockUpdateMember = jest.fn();
const mockEmit = jest.fn();
const mockTemplate = jest.fn((link, companyName) => ({ subject: `Join ${companyName}`, mail: link }));

jest.mock('../Config/config', () => ({ WEBURL: 'https://hub.example.test', myCache: { get: () => undefined, set: () => {}, del: () => {} } }));
jest.mock('../Config/loggerConfig', () => ({ info: jest.fn(), error: jest.fn(), warn: jest.fn() }));
jest.mock('../utils/mongo-handler/mongoQueries', () => ({ MongoDbCrudOpration: (...a) => mockDb.findOne(...a) }));
jest.mock('../Modules/service.js', () => ({ SendEmail: (...a) => mockSendEmail(...a) }));
jest.mock('../Modules/Company/eventController.js', () => ({ emitListener: (...a) => mockEmit(...a) }));
jest.mock('../Modules/Company/controller/updateCompany.js', () => ({ updateCompanyFun: (...a) => mockUpdateCompany(...a) }));
jest.mock('../Modules/Users/controller.js', () => ({ getUserByQueyFun: (...a) => mockGetUsers(...a) }));
jest.mock('../Modules/settings/Members/controller.js', () => ({ updateMemberFunction: (...a) => mockUpdateMember(...a) }));
jest.mock('../Modules/Template/sendEmailInvitation', () => (...a) => mockTemplate(...a));

const logger = require('../Config/loggerConfig');
const { dbCollections } = require('../Config/collections');
const { SCHEMA_TYPE } = require('../Config/schemaType');
const invitation = require('../Modules/Auth/controller/sendInvitation');

const COMPANY = '6f0000000000000000000c01';
const OTHER_COMPANY = '6f0000000000000000000c02';
const ROW_ID = '6f0000000000000000000d01';
const ACCOUNT_ID = '6f0000000000000000000a01';
const HEX_TOKEN = /^[a-f0-9]{64}$/;

const reply = () => {
    const res = { statusCode: 200 };
    res.status = (code) => { res.statusCode = code; return res; };
    res.send = (body) => { res.body = body; return res; };
    res.json = (body) => { res.body = body; return res; };
    return res;
};
const settle = () => new Promise((resolve) => setImmediate(resolve));

const sendReq = (body = {}, over = {}) => ({
    headers: { companyid: COMPANY },
    aud: COMPANY,
    uid: 'u1',
    body: { email: 'Ada@Example.test', companyName: 'Acme', role: 2, designation: 'Dev', ...body },
    ...over,
});
const send = async (body, over) => {
    const res = reply();
    invitation.sendInvitationEmail(sendReq(body, over), res);
    await settle();
    await settle();
    return res;
};

const savedRow = (data) => ({ _id: ROW_ID, ...data });
const counterWrites = () => mockUpdateCompany.mock.calls;
const memberReads = () => mockDb.findOne.mock.calls.filter(([, obj]) => obj.type === dbCollections.COMPANY_USERS);

beforeEach(() => {
    jest.clearAllMocks();
    mockDb.findOne.mockResolvedValue(null);
    mockUpdateCompany.mockResolvedValue({});
    mockGetUsers.mockResolvedValue([]);
    mockUpdateMember.mockImplementation(async (_companyId, data, method) => (
        method === 'save' ? { data: savedRow(data) } : { data: savedRow({ ...data[1].$set, userEmail: data[0].userEmail, userId: ACCOUNT_ID, status: 1 }) }
    ));
    mockSendEmail.mockImplementation((_subject, _html, _to, _flag, cb) => cb({ status: true }));
});

describe('sendInvitationEmail', () => {
    describe('who may call it', () => {
        it('refuses a signed-out caller before reading or writing anything', async () => {
            const res = await send({}, { aud: undefined });
            expect(res.statusCode).toBe(403);
            expect(res.body.status).toBe(false);
            expect(mockDb.findOne).not.toHaveBeenCalled();
            expect(mockUpdateMember).not.toHaveBeenCalled();
            expect(mockSendEmail).not.toHaveBeenCalled();
            expect(counterWrites()).toHaveLength(0);
        });

        it('refuses a caller whose session does not include the company named in the header', async () => {
            const res = await send({}, { aud: OTHER_COMPANY });
            expect(res.statusCode).toBe(403);
            expect(mockUpdateMember).not.toHaveBeenCalled();
            expect(mockSendEmail).not.toHaveBeenCalled();
        });

        it('refuses a request that names no valid company', async () => {
            const res = await send({}, { headers: {} });
            expect(res.statusCode).toBe(403);
            const bad = await send({}, { headers: { companyid: 'acme' } });
            expect(bad.statusCode).toBe(403);
            expect(mockUpdateMember).not.toHaveBeenCalled();
        });

        it('refuses a body that steers the invitation into a company other than the header\'s', async () => {
            const res = await send({ companyId: OTHER_COMPANY });
            expect(res.statusCode).toBe(403);
            expect(mockUpdateMember).not.toHaveBeenCalled();
            expect(counterWrites()).toHaveLength(0);
        });
    });

    describe('wrong input', () => {
        it.each([
            ['email', { email: undefined }],
            ['companyName', { companyName: null }],
            ['role', { role: undefined }],
            ['designation', { designation: undefined }],
        ])('names the missing %s and does nothing', async (field, body) => {
            const res = await send(body);
            expect(res.body).toEqual({ status: false, statusText: `${field}, fields are required.` });
            expect(mockDb.findOne).not.toHaveBeenCalled();
            expect(mockSendEmail).not.toHaveBeenCalled();
            expect(counterWrites()).toHaveLength(0);
        });

        it('names every missing field together', async () => {
            const res = await send({ email: undefined, role: undefined, designation: undefined, companyName: undefined });
            expect(res.body.statusText).toBe('email, companyName, role, designation, fields are required.');
        });

        it('answers a request with no body as missing fields', async () => {
            const res = reply();
            invitation.sendInvitationEmail({ headers: { companyid: COMPANY }, aud: COMPANY }, res);
            await settle();
            expect(res.body.status).toBe(false);
            expect(mockSendEmail).not.toHaveBeenCalled();
        });

        it('accepts a role of 0 as given', async () => {
            await send({ role: 0 });
            expect(mockUpdateMember.mock.calls[0][1].roleType).toBe(0);
        });
    });

    describe('an address with no account', () => {
        it('stores a pending invitation row in the caller\'s company with a lower-cased address', async () => {
            await send();
            expect(mockUpdateMember).toHaveBeenCalledTimes(1);
            const [companyId, row, method] = mockUpdateMember.mock.calls[0];
            expect(companyId).toBe(COMPANY);
            expect(method).toBe('save');
            expect(row).toMatchObject({
                companyId: COMPANY, userId: '', isDelete: false, roleType: 2, status: 1, userEmail: 'ada@example.test', designation: 'Dev',
            });
            expect(row.linkId).toMatch(HEX_TOKEN);
            expect(row.sendInvitationTime).toBeInstanceOf(Date);
        });

        it('mails the sign-up link carrying the row id and token to the lower-cased address', async () => {
            await send();
            const token = mockUpdateMember.mock.calls[0][1].linkId;
            const link = `https://hub.example.test/#/invitation?companyId=${COMPANY}-${ROW_ID}&token=${token}`;
            expect(mockTemplate).toHaveBeenCalledWith(link, 'Acme');
            expect(mockSendEmail).toHaveBeenCalledWith('Join Acme', link, 'ada@example.test', true, expect.any(Function));
        });

        it('answers sent, handing back the row and the join link to share', async () => {
            const res = await send();
            const token = mockUpdateMember.mock.calls[0][1].linkId;
            expect(res.body.status).toBe(true);
            expect(res.body.statusText).toBe('Invitation_mail_sent_sucessfully');
            expect(res.body.joinLink).toBe(`https://hub.example.test/#/invitation?companyId=${COMPANY}-${ROW_ID}&token=${token}`);
            expect(res.body.data).toMatchObject({ _id: ROW_ID, userEmail: 'ada@example.test', status: 1 });
        });

        it('gives each invitation its own token', async () => {
            await send();
            await send({ email: 'grace@example.test' });
            const [a, b] = mockUpdateMember.mock.calls.map((call) => call[1].linkId);
            expect(a).not.toBe(b);
        });
    });

    describe('an address that already has an account', () => {
        beforeEach(() => mockGetUsers.mockResolvedValue([{ _id: ACCOUNT_ID }]));

        it('looks the account up by the lower-cased address, active accounts only', async () => {
            await send();
            expect(mockGetUsers).toHaveBeenCalledWith({ Employee_Email: 'ada@example.test', isActive: true });
        });

        it('stores the account id on the row and mails a verify link that names the company and row', async () => {
            await send();
            const row = mockUpdateMember.mock.calls[0][1];
            expect(row.userId).toBe(ACCOUNT_ID);
            const link = mockTemplate.mock.calls[0][0];
            expect(link.startsWith('https://hub.example.test/#/verify-invitation?id=')).toBe(true);
            const decoded = Buffer.from(link.split('id=')[1], 'base64').toString('binary');
            expect(decoded).toBe(`userId=${ACCOUNT_ID}&companyId=${COMPANY}&docId=${ROW_ID}&linkId=${row.linkId}`);
        });

        it('does not show the account id in the answer while the invitation is pending', async () => {
            const res = await send();
            expect(res.body.status).toBe(true);
            expect(res.body.data.userId).toBeUndefined();
            expect(JSON.stringify(res.body)).not.toContain(ACCOUNT_ID);
        });

        it('answers a failed lookup with a generic failure and sends nothing', async () => {
            mockGetUsers.mockRejectedValue(new Error('users db down at db-host:27017'));
            const res = await send();
            expect(res.body).toEqual({ status: false, statusText: 'Could not send the invitation.' });
            expect(mockSendEmail).not.toHaveBeenCalled();
            expect(logger.error).toHaveBeenCalledWith(expect.stringContaining(COMPANY));
        });
    });

    describe('reading existing invitations', () => {
        it('looks for the address among the caller\'s company members only', async () => {
            await send();
            expect(memberReads()).toHaveLength(1);
            const [companyId, obj, method] = memberReads()[0];
            expect(companyId).toBe(COMPANY);
            expect(method).toBe('findOne');
            expect(obj.data).toEqual([{ userEmail: 'ada@example.test' }]);
        });

        it('refuses an address that is already a member, and sends nothing', async () => {
            mockDb.findOne.mockResolvedValue({ status: 2, isDelete: false });
            const res = await send();
            expect(res.body).toEqual({ status: false, statusText: 'User is already in the company.' });
            expect(mockUpdateMember).not.toHaveBeenCalled();
            expect(mockSendEmail).not.toHaveBeenCalled();
        });

        it.each([
            ['a pending invitation', { status: 1, isDelete: false }],
            ['a cancelled member', { status: 3, isDelete: false }],
            ['a removed member', { status: 2, isDelete: true }],
        ])('renews %s with a fresh token, matching on the address in the same company', async (_name, existing) => {
            mockDb.findOne.mockResolvedValue(existing);
            const res = await send({ role: 3, designation: 'Lead' });
            expect(mockUpdateMember).toHaveBeenCalledTimes(1);
            const [companyId, data, method] = mockUpdateMember.mock.calls[0];
            expect(companyId).toBe(COMPANY);
            expect(method).toBe('findOneAndUpdate');
            expect(data[0]).toEqual({ userEmail: 'ada@example.test' });
            expect(data[1].$set).toMatchObject({ status: 1, roleType: 3, designation: 'Lead', isDelete: false });
            expect(data[1].$set.linkId).toMatch(HEX_TOKEN);
            expect(data[2]).toEqual({ returnDocument: 'after' });
            expect(res.body.status).toBe(true);
            expect(mockSendEmail).toHaveBeenCalledTimes(1);
        });

        it('answers a failed save of a renewal with a generic failure', async () => {
            mockDb.findOne.mockResolvedValue({ status: 1, isDelete: false });
            mockUpdateMember.mockRejectedValue(new Error('write failed on db-host'));
            const res = await send();
            expect(res.body).toEqual({ status: false, statusText: 'Could not send the invitation.' });
            expect(mockSendEmail).not.toHaveBeenCalled();
        });
    });

    describe('when the mail does not go out', () => {
        it('keeps the row, answers the mail failure and still hands back the join link', async () => {
            mockSendEmail.mockImplementation((_s, _h, _t, _f, cb) => cb({ status: false, error: new Error('smtp down at mail-host:465') }));
            const res = await send();
            expect(mockUpdateMember).toHaveBeenCalledTimes(1);
            expect(res.body.status).toBe(false);
            expect(res.body.statusText).toBe('Invitation_mail_failed');
            expect(res.body.joinLink).toContain(`companyId=${COMPANY}-${ROW_ID}`);
            expect(res.body.data._id).toBe(ROW_ID);
            expect(JSON.stringify(res.body)).not.toContain('mail-host');
            expect(logger.error).toHaveBeenCalledWith(expect.stringContaining('mail-host'));
        });
    });

    describe('when saving fails', () => {
        it('answers a generic failure without the cause and sends no mail', async () => {
            mockUpdateMember.mockRejectedValue(new Error('E11000 duplicate key at db-host'));
            const res = await send();
            expect(res.body).toEqual({ status: false, statusText: 'Could not send the invitation.' });
            expect(JSON.stringify(res.body)).not.toContain('db-host');
            expect(mockSendEmail).not.toHaveBeenCalled();
            expect(logger.error).toHaveBeenCalledWith(expect.stringContaining(COMPANY));
        });

        it('answers a generic failure when the member lookup fails', async () => {
            mockDb.findOne.mockRejectedValue(new Error('read failed on db-host'));
            const res = await send();
            expect(res.body).toEqual({ status: false, statusText: 'Could not send the invitation.' });
            expect(mockUpdateMember).not.toHaveBeenCalled();
        });
    });

    describe('the seat counter', () => {
        const expectedCounter = {
            type: SCHEMA_TYPE.COMPANIES,
            data: [
                { _id: expect.anything() },
                { $inc: { 'companyData.$[elementIndex].users': 1 } },
                { arrayFilters: [{ 'elementIndex.users': { $exists: true } }], upsert: true },
            ],
        };

        it('adds one to the caller\'s company in the global companies', async () => {
            await send();
            expect(counterWrites()).toHaveLength(1);
            const [scope, obj, method, companyId] = counterWrites()[0];
            expect([scope, method, companyId]).toEqual(['global', 'findOneAndUpdate', COMPANY]);
            expect(obj).toMatchObject(expectedCounter);
            expect(String(obj.data[0]._id)).toBe(COMPANY);
        });

        it('leaves it alone when resending', async () => {
            await send({ isResend: true });
            expect(counterWrites()).toHaveLength(0);
            expect(mockSendEmail).toHaveBeenCalledTimes(1);
        });

        it('still sends when the counter update fails, and logs it', async () => {
            mockUpdateCompany.mockRejectedValue(new Error('counter down'));
            const res = await send();
            expect(res.body.status).toBe(true);
            expect(logger.error).toHaveBeenCalledWith(expect.stringContaining('counter down'));
        });

        it.failing('does not take a seat back for an invitation that never took one (bad email type)', async () => {
            const res = await send({ email: 12345 });
            expect(res.body.status).toBe(false);
            expect(counterWrites().filter(([, obj]) => obj.data[1].$inc['companyData.$[elementIndex].users'] === -1)).toHaveLength(0);
        });
    });
});

describe('sendInvitationEmailFun', () => {
    const entry = (over = {}) => ({ email: 'Grace@Example.test', companyId: COMPANY, companyName: 'Acme', role: 2, designation: 'Dev', ...over });

    it('rejects naming the missing fields, touching nothing', async () => {
        await expect(invitation.sendInvitationEmailFun(entry({ role: undefined, designation: null })))
            .rejects.toEqual({ status: false, statusText: 'role, designation, fields are required.' });
        expect(mockDb.findOne).not.toHaveBeenCalled();
        expect(counterWrites()).toHaveLength(0);
    });

    it('stores the invitation and counts the seat in the company the entry names', async () => {
        const result = await invitation.sendInvitationEmailFun(entry());
        expect(result.status).toBe(true);
        expect(memberReads()[0][0]).toBe(COMPANY);
        expect(mockUpdateMember.mock.calls[0][0]).toBe(COMPANY);
        expect(mockUpdateMember.mock.calls[0][1]).toMatchObject({ companyId: COMPANY, userEmail: 'grace@example.test', status: 1 });
        expect(counterWrites()[0][3]).toBe(COMPANY);
        expect(String(counterWrites()[0][1].data[0]._id)).toBe(COMPANY);
        expect(mockSendEmail.mock.calls[0][2]).toBe('grace@example.test');
    });

    it('does not count a seat when resending', async () => {
        await invitation.sendInvitationEmailFun(entry({ isResend: true }));
        expect(counterWrites()).toHaveLength(0);
    });

    it('rejects an address that is already a member', async () => {
        mockDb.findOne.mockResolvedValue({ status: 2, isDelete: false });
        await expect(invitation.sendInvitationEmailFun(entry())).rejects.toEqual({ status: false, statusText: 'User is already in the company.' });
        expect(mockSendEmail).not.toHaveBeenCalled();
    });

    it('resolves with the mail failure and the join link when the mail does not go out', async () => {
        mockSendEmail.mockImplementation((_s, _h, _t, _f, cb) => cb({ status: false, error: 'smtp' }));
        const result = await invitation.sendInvitationEmailFun(entry());
        expect(result).toMatchObject({ status: false, statusText: 'Invitation_mail_failed' });
        expect(result.joinLink).toContain(`companyId=${COMPANY}-${ROW_ID}`);
    });

    it('rejects with a generic failure when the mailer throws', async () => {
        mockSendEmail.mockImplementation(() => { throw new Error('mail-host exploded'); });
        await expect(invitation.sendInvitationEmailFun(entry())).rejects.toEqual({ status: false, statusText: 'Could not send the invitation.' });
    });

    it('rejects with a generic failure when saving fails', async () => {
        mockUpdateMember.mockRejectedValue(new Error('db-host down'));
        await expect(invitation.sendInvitationEmailFun(entry())).rejects.toEqual({ status: false, statusText: 'Could not send the invitation.' });
    });

    it.failing('does not take a seat back for an entry that never took one (bad email type)', async () => {
        await expect(invitation.sendInvitationEmailFun(entry({ email: 42 }))).rejects.toBeDefined();
        expect(counterWrites().filter(([, obj]) => obj.data[1].$inc['companyData.$[elementIndex].users'] === -1)).toHaveLength(0);
    });
});

describe('checkSendInviatation', () => {
    const check = async (body, over = {}) => {
        const res = reply();
        invitation.checkSendInviatation({ headers: { companyid: COMPANY }, aud: COMPANY, body: { email: 'ada@example.test', ...body }, ...over }, res);
        await settle();
        return res;
    };

    it('asks for the email when none is given', async () => {
        const res = await check({ email: '' });
        expect(res.body).toEqual({ status: false, statusText: 'email is required' });
        expect(mockDb.findOne).not.toHaveBeenCalled();
    });

    it('asks for the email when there is no body', async () => {
        const res = reply();
        invitation.checkSendInviatation({ headers: { companyid: COMPANY }, aud: COMPANY }, res);
        expect(res.body).toEqual({ status: false, statusText: 'email is required' });
    });

    it('refuses a signed-out caller and a caller outside the company, reading nothing', async () => {
        expect((await check({}, { aud: undefined })).statusCode).toBe(403);
        expect((await check({}, { aud: OTHER_COMPANY })).statusCode).toBe(403);
        expect((await check({ companyId: OTHER_COMPANY })).statusCode).toBe(403);
        expect(mockDb.findOne).not.toHaveBeenCalled();
    });

    it('looks the address up in the caller\'s company only', async () => {
        await check({});
        expect(memberReads()).toHaveLength(1);
        const [companyId, obj, method] = memberReads()[0];
        expect(companyId).toBe(COMPANY);
        expect(method).toBe('findOne');
        expect(obj.data).toEqual([{ userEmail: 'ada@example.test' }]);
    });

    it.each([
        ['an unknown address', null],
        ['a cancelled member', { status: 3 }],
    ])('lets the caller go on for %s', async (_name, found) => {
        mockDb.findOne.mockResolvedValue(found);
        const res = await check({});
        expect(res.body).toEqual({ status: true, statusText: 'All Okay', furtherProceed: true });
    });

    it('says an active member is already in the company', async () => {
        mockDb.findOne.mockResolvedValue({ status: 2, isDelete: false });
        const res = await check({});
        expect(res.body).toEqual({ status: true, statusText: 'User is already in the company.', furtherProceed: false });
    });

    it.each([
        ['a pending invitation', { status: 1, isDelete: false }],
        ['a removed member', { status: 2, isDelete: true }],
    ])('tells the caller to resend for %s', async (_name, found) => {
        mockDb.findOne.mockResolvedValue(found);
        const res = await check({});
        expect(res.body).toEqual({
            status: true,
            statusText: 'You have already sent an invitation. Please resend invitation from members list.',
            furtherProceed: false,
        });
    });

    it('answers a generic failure when the lookup fails', async () => {
        mockDb.findOne.mockRejectedValue(new Error('read failed on db-host'));
        const res = await check({});
        expect(res.body).toEqual({ status: false, statusText: 'Could not send the invitation.' });
        expect(logger.error).toHaveBeenCalledWith(expect.stringContaining('db-host'));
    });
});

describe('decreaseUserCount', () => {
    it('takes one seat off the named company in the global companies', () => {
        invitation.decreaseUserCount(COMPANY);
        expect(counterWrites()).toHaveLength(1);
        const [scope, obj, method, companyId] = counterWrites()[0];
        expect([scope, method, companyId]).toEqual(['global', 'updateOne', COMPANY]);
        expect(obj.type).toBe(SCHEMA_TYPE.COMPANIES);
        expect(String(obj.data[0]._id)).toBe(COMPANY);
        expect(obj.data[1]).toEqual({ $inc: { 'companyData.$[elementIndex].users': -1 } });
    });

    it('logs and carries on when the update fails', async () => {
        mockUpdateCompany.mockRejectedValue(new Error('counter down'));
        expect(() => invitation.decreaseUserCount(COMPANY)).not.toThrow();
        await settle();
        expect(logger.error).toHaveBeenCalledWith(expect.stringContaining('counter down'));
    });

    it('logs and writes nothing for a company id that is not an object id', () => {
        expect(() => invitation.decreaseUserCount('acme')).not.toThrow();
        expect(counterWrites()).toHaveLength(0);
        expect(logger.error).toHaveBeenCalled();
    });
});

describe('joinLinkFor', () => {
    it('builds the sign-up link from the company, row and token', () => {
        expect(invitation.joinLinkFor(COMPANY, { _id: ROW_ID, linkId: 'tok' }))
            .toBe(`https://hub.example.test/#/invitation?companyId=${COMPANY}-${ROW_ID}&token=tok`);
    });

    it.each([
        ['no row', undefined],
        ['a row with no id', { linkId: 'tok' }],
        ['a row with no token', { _id: ROW_ID }],
        ['a row whose token was cleared', { _id: ROW_ID, linkId: '' }],
    ])('is empty for %s', (_name, row) => {
        expect(invitation.joinLinkFor(COMPANY, row)).toBe('');
    });
});

describe('importUser', () => {
    afterEach(() => jest.useRealTimers());

    const importUsers = async (body) => {
        const res = reply();
        invitation.importUser({ body }, res);
        await jest.advanceTimersByTimeAsync(10000);
        return res;
    };
    const entry = (n, companyId = COMPANY) => ({ email: `user${n}@example.test`, companyId, companyName: 'Acme', role: 2, designation: 'Dev' });

    beforeEach(() => jest.useFakeTimers({ doNotFake: ['setImmediate', 'nextTick'] }));

    it('answers 400 for a body with no user list, without sending anything', async () => {
        const res = await importUsers({ eventId: 'e1' });
        expect(res.statusCode).toBe(400);
        expect(res.body.status).toBe(false);
        expect(mockSendEmail).not.toHaveBeenCalled();
    });

    it('answers 400 when the request has no body', async () => {
        const res = reply();
        invitation.importUser({}, res);
        await jest.advanceTimersByTimeAsync(10);
        expect(res.statusCode).toBe(400);
        expect(res.body.status).toBe(false);
    });

    it('answers success with nothing to import and tells the listener it is done', async () => {
        const res = await importUsers({ users: [], eventId: 'e1' });
        expect(res.statusCode).toBe(200);
        expect(res.body).toEqual({ status: true, data: [] });
        expect(mockEmit).toHaveBeenCalledWith('e1', { step: 'STOP' });
    });

    it('invites each user in the company that entry names and reports progress to the listener', async () => {
        const users = [entry(1), entry(2), entry(3, OTHER_COMPANY)];
        const res = await importUsers({ users, eventId: 'e1' });
        expect(res.statusCode).toBe(200);
        expect(res.body.status).toBe(true);
        expect(res.body.data).toHaveLength(3);
        expect(mockUpdateMember.mock.calls.map(([companyId, row]) => [companyId, row.userEmail])).toEqual([
            [COMPANY, 'user1@example.test'],
            [COMPANY, 'user2@example.test'],
            [OTHER_COMPANY, 'user3@example.test'],
        ]);
        expect(memberReads().map(([companyId]) => companyId)).toEqual([COMPANY, COMPANY, OTHER_COMPANY]);
        expect(mockEmit.mock.calls.map(([id, payload]) => [id, payload.step])).toEqual([
            ['e1', '0.00'], ['e1', '66.67'], ['e1', 'STOP'],
        ]);
    });

    it('stops with 400 when a user in a batch fails, and sends nothing for later batches', async () => {
        mockUpdateMember.mockRejectedValueOnce(new Error('db-host down'));
        const res = await importUsers({ users: [entry(1), entry(2), entry(3)], eventId: 'e1' });
        expect(res.statusCode).toBe(400);
        expect(res.body).toEqual({ status: false, statusText: 'Batch update stopped due to failure in batch 1' });
        expect(JSON.stringify(res.body)).not.toContain('db-host');
        expect(mockUpdateMember).toHaveBeenCalledTimes(2);
    });

    it('stops with 400 when an entry lacks required fields', async () => {
        const res = await importUsers({ users: [{ email: 'x@example.test', companyId: COMPANY }], eventId: 'e1' });
        expect(res.statusCode).toBe(400);
        expect(res.body.status).toBe(false);
        expect(mockUpdateMember).not.toHaveBeenCalled();
    });
});
