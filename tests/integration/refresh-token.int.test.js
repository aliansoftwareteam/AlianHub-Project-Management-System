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

});

describe('access tokens', () => {
    it('name the session and never carry the refresh token', async () => {
        const owner = await loginAs('owner');
        const claims = claimsOf(owner.accessToken);
        expect(claims.refreshToken).toBeUndefined();
        expect(Object.values(claims)).not.toContain(owner.refreshToken);
        expect(owner.accessToken).not.toContain(owner.refreshToken);
        expect(claims.uid).toBe(owner.uid);
        expect(claims.sid).toMatch(/^[a-f0-9]{24}$/);
    });

    it('carry a session through login, refresh and logout', async () => {
        const owner = await loginAs('owner');
        const signedIn = createApiClient({ baseURL: state.baseURL, accessToken: owner.accessToken });
        expect((await signedIn.get('/api/v2/users/sessions')).status).toBe(200);

        const refreshed = await refresh(owner.refreshToken, owner.uid);
        expect(refreshed.status).toBe(200);
        expect(claimsOf(refreshed.body.token).refreshToken).toBeUndefined();
        expect(claimsOf(refreshed.body.token).sid).toBe(claimsOf(owner.accessToken).sid);

        const stale = await signedIn.get('/api/v2/users/sessions');
        expect(stale.status).toBe(401);
        expect(stale.body.isJwtError).toBe(true);
        expect(stale.body.isLogout).toBeUndefined();

        const current = createApiClient({ baseURL: state.baseURL, accessToken: refreshed.body.token });
        expect((await current.get('/api/v2/users/sessions')).status).toBe(200);

        const loggedOut = await current.post('/api/v2/logout', { id: owner.uid });
        expect(loggedOut.status).toBe(200);

        const afterLogout = await current.get('/api/v2/users/sessions');
        expect(afterLogout.status).toBe(401);
        expect(afterLogout.body.isLogout).toBe(true);
        expect(refused(await refresh(refreshed.body.refreshToken, owner.uid))).toBe(true);
    });

    it('log out only the session they name', async () => {
        const [first, second] = await Promise.all([loginAs('member'), loginAs('member')]);
        const firstApi = createApiClient({ baseURL: state.baseURL, accessToken: first.accessToken });
        expect((await firstApi.post('/api/v2/logout', { id: first.uid })).status).toBe(200);
        expect((await createApiClient({ baseURL: state.baseURL, accessToken: second.accessToken }).get('/api/v2/users/sessions')).status).toBe(200);
    });
});

describe('tracker sign-in', () => {
    const trackerLogin = (body) => anonymous.post('/api/v1/auth/loginAuthTracker', body);
    const issueCode = async (accessToken) => {
        const res = await createApiClient({ baseURL: state.baseURL, accessToken }).post('/api/v2/auth/tracker-code', {});
        expect(res.status).toBe(200);
        return res.body.data.code;
    };

    it('exchanges a one-time code from the signed-in browser for a tracker session', async () => {
        const owner = await loginAs('owner');
        const code = await issueCode(owner.accessToken);
        expect(code).toMatch(/^[A-Za-z0-9_-]{43}$/);

        const tracker = await trackerLogin({ code, userId: owner.uid });
        expect(tracker.status).toBe(200);
        expect(tracker.body.uid).toBe(owner.uid);
        expect(claimsOf(tracker.body.accessToken).refreshToken).toBeUndefined();
        const trackerApi = createApiClient({ baseURL: state.baseURL, accessToken: tracker.body.accessToken });
        expect((await trackerApi.get('/api/v2/users/sessions')).status).toBe(200);

        const trackerRefresh = await refresh(tracker.body.refreshToken, owner.uid);
        expect(trackerRefresh.status).toBe(200);
        expect(claimsOf(trackerRefresh.body.token).uid).toBe(owner.uid);

        const reused = await trackerLogin({ code, userId: owner.uid });
        expect(refused(reused)).toBe(true);
        expect(reused.body.accessToken).toBeUndefined();
    });

    it('accepts the code the way older tracker builds send the deep-link value', async () => {
        const owner = await loginAs('owner');
        const code = await issueCode(owner.accessToken);
        const tracker = await trackerLogin({ refreshToken: code, userId: owner.uid });
        expect(tracker.status).toBe(200);
        expect(tracker.body.uid).toBe(owner.uid);
    });

    it("refuses a code presented with another user's id", async () => {
        const [owner, member] = await Promise.all([loginAs('owner'), loginAs('member')]);
        const res = await trackerLogin({ code: await issueCode(owner.accessToken), userId: member.uid });
        expect(refused(res)).toBe(true);
        expect(res.body.accessToken).toBeUndefined();
    });

    it('refuses a refresh token in place of a code', async () => {
        const owner = await loginAs('owner');
        const res = await trackerLogin({ refreshToken: owner.refreshToken, userId: owner.uid });
        expect(refused(res)).toBe(true);
        expect(res.body.accessToken).toBeUndefined();
    });

    it('refuses to issue a code without a session', async () => {
        const res = await anonymous.post('/api/v2/auth/tracker-code', {});
        expect(res.status).toBe(401);
    });
});
