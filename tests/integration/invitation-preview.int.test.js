const crypto = require('node:crypto');
const { createApiClient } = require('../../e2e/support/api');
const { loginAs, readState } = require('../../e2e/support/fixtures');

const state = readState();
const anonymous = createApiClient({ baseURL: state.baseURL });

const preview = (body) => anonymous.post('/api/v2/auth/invitation-preview', body);

const inviteSomeone = async () => {
    const owner = await loginAs('owner');
    const email = `invitee.${crypto.randomBytes(3).toString('hex')}@e2e.alianhub.test`;
    const res = await owner.api.post('/api/v2/sendInvitationEmail', {
        email, companyId: state.companyId, companyName: state.companyName, role: 3, designation: 0,
    });
    const row = res.body && res.body.data;
    if (!row || !row._id) throw new Error(`invite failed (${res.status}): ${JSON.stringify(res.body).slice(0, 300)}`);
    return { email, memberId: String(row._id), linkId: String(row.linkId || '') };
};

describe('invitation preview', () => {
    it('gives the invitee the workspace and the address the invitation was sent to', async () => {
        const invite = await inviteSomeone();
        const res = await preview({ companyId: state.companyId, memberId: invite.memberId, linkId: invite.linkId });
        expect(res.body.status).toBe(true);
        expect(res.body.data.email).toBe(invite.email);
        expect(res.body.data.workspaceName).toBe(state.companyName);
    });

    it('sends a link token the invitee can present', async () => {
        const invite = await inviteSomeone();
        expect(invite.linkId).toMatch(/^[a-f0-9]{64}$/);
    });

    it('refuses a preview that does not carry the link token', async () => {
        const invite = await inviteSomeone();
        const res = await preview({ companyId: state.companyId, memberId: invite.memberId });
        expect(res.body.status).toBe(false);
        expect(res.body.data).toBeUndefined();
    });

    it('refuses a preview carrying the wrong link token', async () => {
        const invite = await inviteSomeone();
        const res = await preview({ companyId: state.companyId, memberId: invite.memberId, linkId: crypto.randomBytes(32).toString('hex') });
        expect(res.body.status).toBe(false);
        expect(res.body.data).toBeUndefined();
    });

    it('refuses an invitation id that does not exist', async () => {
        const res = await preview({ companyId: state.companyId, memberId: new Array(24).fill('a').join(''), linkId: 'whatever' });
        expect(res.body.status).toBe(false);
    });
});
