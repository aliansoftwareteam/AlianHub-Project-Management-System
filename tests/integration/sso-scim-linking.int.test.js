const crypto = require('node:crypto');
const http = require('node:http');
const jose = require('jose');
const { MongoClient, ObjectId } = require('mongodb');
const { resolveMongoUrl } = require('../../e2e/support/env');
const { createApiClient } = require('../../e2e/support/api');
const { assertOk, loginAs, readState, uniqueSuffix } = require('../../e2e/support/fixtures');

const state = readState();
const suffix = uniqueSuffix();
const VERIFIED = `acme-${suffix}.test`;
const UNVERIFIED = `outside-${suffix}.test`;
const OTHER_COMPANY = new ObjectId().toHexString();
const CLIENT_ID = 'alianhub-e2e';

let client;
let owner;
let idp;

/* A real OIDC provider on loopback: discovery, JWKS and a token endpoint that signs whatever email the test asks for. */
async function startIdp() {
    const { privateKey, publicKey } = await jose.generateKeyPair('RS256');
    const jwk = { ...(await jose.exportJWK(publicKey)), kid: 'e2e', alg: 'RS256', use: 'sig' };
    const codes = new Map();
    const server = http.createServer((req, res) => {
        const url = new URL(req.url, 'http://127.0.0.1');
        const issuer = `http://127.0.0.1:${server.address().port}`;
        const json = (body) => { res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify(body)); };
        if (url.pathname === '/.well-known/openid-configuration') {
            return json({
                issuer, authorization_endpoint: `${issuer}/authorize`, token_endpoint: `${issuer}/token`, jwks_uri: `${issuer}/jwks`,
                response_types_supported: ['code'], subject_types_supported: ['public'], id_token_signing_alg_values_supported: ['RS256'],
                token_endpoint_auth_methods_supported: ['client_secret_basic', 'client_secret_post'],
            });
        }
        if (url.pathname === '/jwks') return json({ keys: [jwk] });
        if (url.pathname === '/token') {
            let raw = '';
            req.on('data', (chunk) => { raw += chunk; });
            req.on('end', async () => {
                const grant = codes.get(new URLSearchParams(raw).get('code'));
                if (!grant) { res.writeHead(400, { 'content-type': 'application/json' }); res.end('{"error":"invalid_grant"}'); return; }
                const idToken = await new jose.SignJWT({ email: grant.email, given_name: 'Idp', family_name: 'Asserted', nonce: grant.nonce })
                    .setProtectedHeader({ alg: 'RS256', kid: 'e2e' })
                    .setIssuer(issuer).setAudience(CLIENT_ID).setSubject(grant.email)
                    .setIssuedAt().setExpirationTime('5m')
                    .sign(privateKey);
                json({ access_token: 'e2e-access', token_type: 'Bearer', expires_in: 300, id_token: idToken });
            });
            return undefined;
        }
        res.writeHead(404);
        return res.end();
    });
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    return { codes, issuer: `http://127.0.0.1:${server.address().port}`, close: () => new Promise((resolve) => server.close(resolve)) };
}

const ssoSignIn = async (email) => {
    const start = await fetch(`${state.baseURL}/api/v2/sso/oidc/initiate?companyId=${state.companyId}`, { redirect: 'manual' });
    const authorize = new URL(start.headers.get('location'));
    const code = crypto.randomBytes(12).toString('hex');
    idp.codes.set(code, { email, nonce: authorize.searchParams.get('nonce') });
    const back = await fetch(`${state.baseURL}/api/v2/sso/oidc/callback?code=${code}&state=${authorize.searchParams.get('state')}`, { redirect: 'manual' });
    return { location: back.headers.get('location'), cookies: back.headers.getSetCookie().join('\n') };
};

const globalDb = () => client.db('global');
const companyDb = () => client.db(state.companyId);
const userOf = (id) => globalDb().collection('users').findOne({ _id: new ObjectId(id) });
const seatOf = (email) => companyDb().collection('company_users').findOne({ userEmail: email });
const sessionsOf = (id) => globalDb().collection('sessions').countDocuments({ userId: { $in: [id, new ObjectId(id)] } });

/* An account that exists on the instance and belongs to another company only. */
const seedOutsideAccount = async (email, first, last) => {
    const _id = new ObjectId();
    await globalDb().collection('userAuth').insertOne({ _id, email, isBlocked: false });
    await globalDb().collection('users').insertOne({
        _id, Employee_Email: email, Employee_FName: first, Employee_LName: last, Employee_Name: `${first} ${last}`,
        AssignCompany: [OTHER_COMPANY], isEmailVerified: true, isActive: true, isDeleted: false,
    });
    return _id.toHexString();
};

const REFUSED = '/login?ssoError=not_allowed';

beforeAll(async () => {
    client = await MongoClient.connect(resolveMongoUrl());
    owner = await loginAs('owner');
    idp = await startIdp();
    assertOk(await owner.api.put('/api/v2/sso/config', {
        provider: 'oidc', isEnabled: true, enforcement: 'optional', autoProvisionUsers: true, defaultRoleType: 3,
        domains: [VERIFIED, UNVERIFIED],
        oidc: { discoveryUrl: `${idp.issuer}/.well-known/openid-configuration`, clientId: CLIENT_ID, clientSecret: 'e2e-secret' },
    }), 'save SSO config');
    await companyDb().collection('sso_configs').updateOne({ deletedStatusKey: 0 }, { $set: { verifiedDomains: [{ domain: VERIFIED, verifiedAt: new Date() }] } });
});

afterAll(async () => {
    if (owner) {
        await companyDb().collection('sso_configs').updateOne({ deletedStatusKey: 0 }, { $set: { isEnabled: false } });
        await owner.api.put('/api/v2/scim/config', { isEnabled: false });
    }
    if (idp) await idp.close();
    if (client) await client.close();
});

describe('SSO sign-in through a company IdP', () => {
    it('refuses an account with no seat in the company on a domain it has not verified', async () => {
        const email = `pat.${suffix}@${UNVERIFIED}`;
        const uid = await seedOutsideAccount(email, 'Pat', 'Outside');
        const before = await userOf(uid);

        const { location, cookies } = await ssoSignIn(email);

        expect(location).toBe(REFUSED);
        expect(cookies).not.toContain('accessToken=');
        expect(await sessionsOf(uid)).toBe(0);
        expect(await userOf(uid)).toEqual(before);
        expect(await seatOf(email)).toBeNull();
    });

    it('links an existing account on a verified domain', async () => {
        const email = `ann.${suffix}@${VERIFIED}`;
        const uid = await seedOutsideAccount(email, 'Ann', 'Acme');

        const { location, cookies } = await ssoSignIn(email);

        expect(location).toBe(`/${state.companyId}`);
        expect(cookies).toContain('accessToken=');
        expect(await sessionsOf(uid)).toBe(1);
        expect((await userOf(uid)).AssignCompany).toEqual([OTHER_COMPANY, state.companyId]);
        expect(await seatOf(email)).toMatchObject({ userId: uid, status: 2, isDelete: false });
    });

    it('still signs in a member of the company on an unverified domain', async () => {
        const { location } = await ssoSignIn(state.users.member.email);
        expect(location).toBe(`/${state.companyId}`);
    });

    it('creates no account for a new address on an unverified domain', async () => {
        const email = `new.${suffix}@${UNVERIFIED}`;
        expect((await ssoSignIn(email)).location).toBe(REFUSED);
        expect(await globalDb().collection('userAuth').findOne({ email })).toBeNull();
    });
});

describe('SCIM provisioning', () => {
    let scim;

    beforeAll(async () => {
        const { data } = assertOk(await owner.api.post('/api/v2/scim/token', {}), 'mint SCIM token');
        const headers = { authorization: `Bearer ${data.token}`, 'content-type': 'application/scim+json' };
        scim = async (method, path, body) => {
            const res = await fetch(`${state.baseURL}/scim/v2${path}`, { method, headers, body: body ? JSON.stringify(body) : undefined });
            return { status: res.status, body: await res.json() };
        };
    });

    it('invites an outside account instead of seating it, and answers from the request', async () => {
        const email = `sam.${suffix}@${UNVERIFIED}`;
        const uid = await seedOutsideAccount(email, 'Samantha', 'Sharedname');
        const before = await userOf(uid);

        const res = await scim('POST', '/Users', { userName: email, name: { givenName: 'Req', familyName: 'Name' }, active: true });

        expect(res.status).toBe(201);
        expect(res.body).toMatchObject({ userName: email, active: false, name: { givenName: 'Req', familyName: 'Name' } });
        expect(JSON.stringify(res.body)).not.toContain('Sharedname');
        expect(res.body.id).not.toBe(uid);
        expect(await seatOf(email)).toMatchObject({ status: 1, isDelete: false });
        expect(await userOf(uid)).toEqual(before);

        await scim('PATCH', `/Users/${res.body.id}`, { Operations: [{ op: 'replace', value: { active: true } }] });
        expect((await seatOf(email)).status).toBe(1);
    });

    describe('a deactivated seat that SCIM left for an outside account before #911', () => {
        const leftByScim = async (name) => {
            const email = `${name}.${suffix}@${UNVERIFIED}`;
            const uid = await seedOutsideAccount(email, 'Legacy', 'Outside');
            await companyDb().collection('company_users').insertOne({
                companyId: state.companyId, userId: uid, userEmail: email, roleType: 3, designation: 0, status: 0, isDelete: true,
            });
            return { email, uid };
        };

        it('gets the invitation from a SCIM create, not a seat', async () => {
            const { email, uid } = await leftByScim('legacy-create');
            const before = await userOf(uid);

            const res = await scim('POST', '/Users', { userName: email, name: { givenName: 'Req', familyName: 'Name' }, active: true });

            expect(res.status).toBe(201);
            expect(res.body.active).toBe(false);
            expect(await seatOf(email)).toMatchObject({ status: 1, isDelete: false });
            expect(await userOf(uid)).toEqual(before);
        });

        it('stays deactivated after a SCIM activation', async () => {
            const { email, uid } = await leftByScim('legacy-patch');

            const res = await scim('PATCH', `/Users/${uid}`, { Operations: [{ op: 'replace', value: { active: true } }] });

            expect(res.status).toBe(200);
            expect(res.body.active).toBe(false);
            expect(await seatOf(email)).toMatchObject({ status: 0, isDelete: true });
            expect((await userOf(uid)).AssignCompany).toEqual([OTHER_COMPANY]);
        });
    });

    it('keeps an IdP rename inside the company', async () => {
        const { userId } = state.users.member;
        const res = await scim('PATCH', `/Users/${userId}`, {
            Operations: [{ op: 'replace', path: 'name.givenName', value: 'Scimmed' }, { op: 'replace', path: 'name.familyName', value: 'Rename' }],
        });

        expect(res.status).toBe(200);
        expect(res.body.name).toMatchObject({ givenName: 'Scimmed', familyName: 'Rename' });
        const shared = await userOf(userId);
        expect(shared.Employee_Name).toBe('Max Member');
        expect(shared.Employee_FName).toBe('Max');
        expect((await scim('GET', `/Users/${userId}`)).body.name.givenName).toBe('Scimmed');
    });
});

describe('SSO discovery', () => {
    const discover = (email) => createApiClient({ baseURL: state.baseURL }).get('/api/v2/sso/discover', { query: { email } });

    it('says nothing about an existing account on an unverified domain', async () => {
        const unknown = await discover(`nobody.${suffix}@e2e.alianhub.test`);
        const known = await discover(state.users.owner.email);
        expect(unknown.status).toBe(404);
        expect(known.status).toBe(404);
        expect(known.body).toEqual(unknown.body);
    });

    it('answers for a verified domain', async () => {
        const res = await discover(`anyone@${VERIFIED}`);
        expect(res.status).toBe(200);
        expect(res.body.data.companyId).toBe(state.companyId);
    });
});
