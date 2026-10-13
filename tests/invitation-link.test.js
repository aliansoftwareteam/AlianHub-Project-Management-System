const { buildVerifyInvitationLink } = require('../Modules/Auth/controller/sendInvitation');
const { parseInviteBlob } = require('../Modules/Auth/controller/verifyInvitation');

describe('INVITATION - verify link', () => {
    test('link id round-trips through parseInviteBlob with no stray characters', () => {
        const link = buildVerifyInvitationLink('u1', 'c1', 'd1', 'Ab12Cd34');
        const id = link.split('/#/verify-invitation?id=')[1];
        expect(id).toMatch(/^[A-Za-z0-9+/]+={0,2}$/);
        expect(parseInviteBlob(id)).toEqual({ userId: 'u1', companyId: 'c1', docId: 'd1', linkId: 'Ab12Cd34' });
    });
});
