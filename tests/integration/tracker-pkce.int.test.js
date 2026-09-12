const crypto = require('node:crypto');
const { createApiClient } = require('../../e2e/support/api');
const { loginAs, readState } = require('../../e2e/support/fixtures');

const state = readState();
const anonymous = createApiClient({ baseURL: state.baseURL });
const refused = (res) => res.status >= 400 || Boolean(res.body && res.body.status === false);
const claimsOf = (token) => JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString('utf8'));

const newVerifier = () => crypto.randomBytes(32).toString('base64url');
const challengeOf = (verifier) => crypto.createHash('sha256').update(verifier).digest('base64url');

const trackerLogin = (body) => anonymous.post('/api/v1/auth/loginAuthTracker', body);
const requestCode = (accessToken, body) => createApiClient({ baseURL: state.baseURL, accessToken }).post('/api/v2/auth/tracker-code', body);
const issueCode = async (accessToken, body = {}) => {
    const res = await requestCode(accessToken, body);
    expect(res.status).toBe(200);
    return res.body.data.code;
};

describe('tracker sign-in bound to the tracker that asked for it', () => {
    it('exchanges a bound code for the matching verifier and nothing else', async () => {
        const owner = await loginAs('owner');
        const verifier = newVerifier();
        const code = await issueCode(owner.accessToken, { codeChallenge: challengeOf(verifier) });

        const tracker = await trackerLogin({ code, userId: owner.uid, codeVerifier: verifier });
        expect(tracker.status).toBe(200);
        expect(tracker.body.uid).toBe(owner.uid);
        expect(claimsOf(tracker.body.accessToken).uid).toBe(owner.uid);
        const trackerApi = createApiClient({ baseURL: state.baseURL, accessToken: tracker.body.accessToken });
        expect((await trackerApi.get('/api/v2/users/sessions')).status).toBe(200);
    });

    it('refuses a bound code presented by another tracker, and spends it', async () => {
        const owner = await loginAs('owner');
        const verifier = newVerifier();
        const code = await issueCode(owner.accessToken, { codeChallenge: challengeOf(verifier) });

        const stolen = await trackerLogin({ code, userId: owner.uid, codeVerifier: newVerifier() });
        expect(refused(stolen)).toBe(true);
        expect(stolen.body.accessToken).toBeUndefined();

        const retry = await trackerLogin({ code, userId: owner.uid, codeVerifier: verifier });
        expect(refused(retry)).toBe(true);
        expect(retry.body.accessToken).toBeUndefined();
    });

    it('refuses a bound code presented with no verifier at all', async () => {
        const owner = await loginAs('owner');
        const code = await issueCode(owner.accessToken, { codeChallenge: challengeOf(newVerifier()) });
        const res = await trackerLogin({ code, userId: owner.uid });
        expect(refused(res)).toBe(true);
        expect(res.body.accessToken).toBeUndefined();
    });

    it('refuses to issue a code for a challenge that is not a base64url sha-256 digest', async () => {
        const owner = await loginAs('owner');
        const res = await requestCode(owner.accessToken, { codeChallenge: 'not-a-challenge' });
        expect(res.status).toBe(400);
        expect(res.body.data).toBeUndefined();
    });

    it('still signs in a tracker build that sends no challenge, while the legacy window is open', async () => {
        const owner = await loginAs('owner');
        const code = await issueCode(owner.accessToken);
        const tracker = await trackerLogin({ code, userId: owner.uid });
        expect(tracker.status).toBe(200);
        expect(tracker.body.uid).toBe(owner.uid);
    });
});
