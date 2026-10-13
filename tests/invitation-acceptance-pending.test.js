jest.mock('../Config/loggerConfig', () => ({ info: jest.fn(), error: jest.fn(), warn: jest.fn(), debug: jest.fn() }));
jest.mock('../utils/mongo-handler/mongoQueries', () => ({ MongoDbCrudOpration: jest.fn(async () => null) }));

const { judgeInvitationAcceptance } = require('../Modules/settings/Members/membershipGuard');

const CALLER = 'c'.repeat(24);
const EMAIL = 'invitee@example.com';
const TOKEN = 'a'.repeat(64);
const accept = { userId: CALLER, status: 2 };
const judge = (invite, link = { linkId: TOKEN }) => judgeInvitationAcceptance({
    callerId: CALLER, callerEmail: EMAIL, invite: { userEmail: EMAIL, linkId: TOKEN, ...invite }, data: accept, ...link,
});

describe('accepting an invitation through root-members', () => {
    it('accepts a pending invitation sent to the caller, with its link token', () => {
        expect(judge({ status: 1 }).ok).toBe(true);
    });

    it.each([
        ['no token', {}],
        ['an empty token', { linkId: '' }],
        ['a wrong token', { linkId: 'b'.repeat(64) }],
        ['a truncated token', { linkId: 'a'.repeat(63) }],
    ])('refuses a pending invitation presented with %s, as it refuses one no longer pending', (label, link) => {
        const verdict = judge({ status: 1 }, link);
        expect(verdict.ok).toBe(false);
        expect(verdict).toEqual(judge({ status: 3 }));
    });

    it('refuses a pending invitation that has no stored token', () => {
        expect(judge({ status: 1, linkId: '' }, { linkId: '' }).ok).toBe(false);
    });

    it.each([
        ['withdrawn', { status: 3, isDelete: true }],
        ['cancelled', { status: 3 }],
        ['removed', { status: 2, isDelete: true, userId: CALLER }],
        ['deactivated', { status: 0, userId: CALLER }],
        ['already accepted', { status: 2, userId: CALLER }],
        ['without a status', { userId: CALLER }],
    ])('refuses an invitation that is %s', (label, invite) => {
        const verdict = judge(invite);
        expect(verdict.ok).toBe(false);
        expect(verdict.statusText).toBe('That invitation is no longer valid.');
    });
});
