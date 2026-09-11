const { createApiClient } = require('../../e2e/support/api');
const { loginAs, readState } = require('../../e2e/support/fixtures');

const state = readState();
const anonymous = createApiClient({ baseURL: state.baseURL });
const refused = (res) => res.status >= 400 || Boolean(res.body && res.body.status === false);
const claimsOf = (token) => JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString('utf8'));
const tailOf = (token) => token.slice(-6);

const refresh = (refreshToken, uid) => anonymous.post('/api/v2/generateToken', { uid }, { headers: { 'refresh-token': refreshToken } });
const sessionTails = async (accessToken) => {
    const res = await createApiClient({ baseURL: state.baseURL, accessToken }).get('/api/v2/users/sessions');
    expect(res.status).toBe(200);
    return res.body.data.map((session) => session.tokenTail);
};

describe('refresh tokens', () => {
    it('gives two users signed in together different refresh tokens', async () => {
        const [owner, member] = await Promise.all([loginAs('owner'), loginAs('member')]);
        expect(owner.refreshToken).not.toBe(member.refreshToken);
    });

    it('refreshes each user into their own session, whatever uid the body names', async () => {
        const [owner, member] = await Promise.all([loginAs('owner'), loginAs('member')]);
        const [ownerRes, memberRes] = await Promise.all([
            refresh(owner.refreshToken, member.uid),
            refresh(member.refreshToken, owner.uid),
        ]);

        expect(ownerRes.status).toBe(200);
        expect(memberRes.status).toBe(200);
        expect(claimsOf(ownerRes.body.token).uid).toBe(owner.uid);
        expect(claimsOf(memberRes.body.token).uid).toBe(member.uid);

        const ownerTails = await sessionTails(ownerRes.body.token);
        expect(ownerTails).toContain(tailOf(ownerRes.body.refreshToken));
        expect(ownerTails).not.toContain(tailOf(memberRes.body.refreshToken));
        const memberTails = await sessionTails(memberRes.body.token);
        expect(memberTails).toContain(tailOf(memberRes.body.refreshToken));
        expect(memberTails).not.toContain(tailOf(ownerRes.body.refreshToken));
    });

    it('refuses a refresh token that was already used', async () => {
        const owner = await loginAs('owner');
        const first = await refresh(owner.refreshToken, owner.uid);
        expect(first.status).toBe(200);

        const again = await refresh(owner.refreshToken, owner.uid);
        expect(refused(again)).toBe(true);
        expect(again.body.token).toBeUndefined();

        const next = await refresh(first.body.refreshToken, owner.uid);
        expect(next.status).toBe(200);
        expect(claimsOf(next.body.token).uid).toBe(owner.uid);
    });

    it("refuses tracker login with another user's id", async () => {
        const [owner, member] = await Promise.all([loginAs('owner'), loginAs('member')]);
        const res = await anonymous.post('/api/v1/auth/loginAuthTracker', { refreshToken: owner.refreshToken, userId: member.uid });
        expect(refused(res)).toBe(true);
        expect(res.body.accessToken).toBeUndefined();
    });
});
