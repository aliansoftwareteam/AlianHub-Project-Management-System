const mockDb = require('./fixtures/fakeMongo').create();
/* The fake stores anything; the real seat schema refuses a row with a required field empty. */
const mockValidateSeat = (row) => {
    const mongoose = require('mongoose');
    const { schema } = require('../utils/mongo-handler/schema');
    const Seat = mongoose.models.InvitedSeat || mongoose.model('InvitedSeat', new mongoose.Schema(schema.companyUsers, { strict: true }));
    const seat = new Seat(row);
    const refused = seat.validateSync();
    if (refused) throw refused;
    return { ...seat.toObject({ flattenMaps: true }), _id: String(seat._id) };
};
const mockCrud = async (db, query, method) => mockDb.crud(db, method === 'save' ? { ...query, data: mockValidateSeat(query.data) } : query, method);

jest.mock('../Config/loggerConfig', () => ({ error: jest.fn(), info: jest.fn(), warn: jest.fn() }));
jest.mock('../utils/mongo-handler/mongoQueries', () => ({ MongoDbCrudOpration: (...args) => mockCrud(...args) }));
jest.mock('../Modules/service.js', () => ({ SendEmail: jest.fn((subject, mail, to, flag, cb) => cb({ status: true })) }));
jest.mock('../Modules/Company/eventController.js', () => ({ emitListener: jest.fn() }));
jest.mock('../Modules/Company/controller/updateCompany.js', () => ({ updateCompanyFun: jest.fn(async () => ({})), getCompanyDataFun: jest.fn() }));
jest.mock('../Modules/Users/controller.js', () => ({ getUserByQueyFun: jest.fn(async () => []) }));
jest.mock('../Modules/settings/Members/controller.js', () => ({
    updateMemberFunction: async (companyId, data, method) => ({ data: await mockCrud(companyId, { type: 'company_users', data }, method) }),
}));

const { SCHEMA_TYPE } = require('../Config/schemaType');
const { updateCompanyFun } = require('../Modules/Company/controller/updateCompany.js');
const invitation = require('../Modules/Auth/controller/sendInvitation');

const COMPANY = '6f0000000000000000000d01';
const ADMIN = '6f0000000000000000000e01';
const EMAIL = 'invitee@own.test';

const seats = () => mockDb.store[SCHEMA_TYPE.COMPANY_USERS] || [];
const sendFromThePage = (body) => new Promise((resolve) => {
    const res = { status: () => res, json: resolve, send: resolve };
    invitation.sendInvitationEmail({ body, headers: { companyid: COMPANY }, uid: ADMIN, aud: COMPANY }, res);
});
const sendFromAnImport = (body) => invitation.sendInvitationEmailFun({ ...body, companyId: COMPANY }).catch((refusal) => refusal);
const invite = (fields = {}) => ({ email: EMAIL, companyName: 'Acme', role: 3, designation: 0, ...fields });

beforeEach(() => {
    Object.keys(mockDb.store).forEach((key) => { mockDb.store[key].length = 0; });
    updateCompanyFun.mockClear();
});

describe.each([
    ['from the Members page', sendFromThePage],
    ['from an import', sendFromAnImport],
])('an invitation sent %s', (label, send) => {
    test('with the designation left empty is stored with none, not refused', async () => {
        const answer = await send(invite({ designation: '' }));

        expect(answer.status).toBe(true);
        expect(seats()).toEqual([expect.objectContaining({ userEmail: EMAIL, designation: 0, roleType: 3, status: 1 })]);
    });

    test('sent again with the designation empty keeps a number on the seat', async () => {
        mockDb.seed(SCHEMA_TYPE.COMPANY_USERS, { companyId: COMPANY, userEmail: EMAIL, userId: '', roleType: 3, designation: 0, status: 1, isDelete: false, linkId: 'old' });

        const answer = await send(invite({ designation: '', isResend: true }));

        expect(answer.status).toBe(true);
        expect(seats()).toEqual([expect.objectContaining({ designation: 0 })]);
    });

    test.each([['empty', ''], ['not a number', 'owner']])('with a role that is %s is refused before a seat is counted or written', async (kind, role) => {
        const answer = await send(invite({ role }));

        expect(answer.status).toBe(false);
        expect(answer.statusText).toBe('role, fields are required.');
        expect(seats()).toEqual([]);
        expect(updateCompanyFun).not.toHaveBeenCalled();
    });

    test('keeps the designation it was sent with', async () => {
        await send(invite({ designation: 4 }));

        expect(seats()).toEqual([expect.objectContaining({ designation: 4 })]);
    });
});
