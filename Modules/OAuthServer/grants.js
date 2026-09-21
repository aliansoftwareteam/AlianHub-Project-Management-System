const crypto = require('crypto');
const store = require('./store');
const tokenHash = require('./tokenHash');
const config = require('./config');
const { challengeOf, CODE_VERIFIER_PATTERN } = require('../Auth/helpers/trackerCode');
const logger = require('../../Config/loggerConfig');

class GrantError extends Error {
    constructor(error, description) {
        super(description);
        this.name = 'GrantError';
        this.error = error;
    }
}

const invalidGrant = (description) => new GrantError('invalid_grant', description);

const REVOKED = Object.freeze({
    CODE_REUSE: 'code_reuse',
    CODE_REJECTED: 'code_rejected',
    REFRESH_REUSE: 'refresh_reuse',
    REFRESH_WRONG_CLIENT: 'refresh_wrong_client',
    REVOKED_BY_CLIENT: 'revoked_by_client',
    CLIENT_REVOKED: 'client_revoked',
});

const earlier = (a, b) => new Date(Math.min(a.getTime(), new Date(b).getTime()));

const audit = (grant, action, meta = {}) => {
    if (!grant || !grant.companyId) return;
    try {
        require('../Audit/recorder').recordAudit(grant.companyId, {
            actorId: String(grant.userId || 'system'),
            actorName: '',
            action,
            entityType: 'oauth_grant',
            entityId: grant.grantId,
            entityName: grant.clientId,
            meta,
        });
    } catch (error) {
        logger.error(`oauth: audit ${action} failed: ${error.message}`);
    }
};

/* Revoking a grant revokes every code and token issued under it: the refresh token family of OAuth 2.1
 * section 4.3.1 is the grant. */
async function revokeGrant(grantId, reason, now = new Date()) {
    const grant = await store.grants.revoke(grantId, reason, now);
    await store.tokens.revokeGrant(grantId, now);
    if (grant) audit(grant, 'oauth.grant_revoked', { reason });
    return Boolean(grant);
}

const tokenRow = (kind, raw, grant, { now, expiresAt, purgeAt, ...rest }) => ({
    tokenHash: tokenHash.hashOf(raw),
    kind,
    grantId: grant.grantId,
    clientId: grant.clientId,
    companyId: grant.companyId,
    userId: grant.userId,
    scopes: rest.scopes || grant.scopes,
    resource: grant.resource,
    ...(rest.redirectUri ? { redirectUri: rest.redirectUri } : {}),
    ...(rest.codeChallenge ? { codeChallenge: rest.codeChallenge } : {}),
    createdAt: now,
    expiresAt,
    purgeAt: purgeAt || expiresAt,
    spentAt: null,
    revokedAt: null,
});

/* Consent has been given: a new grant, capped at the grant lifetime, and its single-use code. */
async function issueCode({ client, companyId, userId, scopes, redirectUri, codeChallenge, now = new Date() }) {
    const life = config.lifetimes();
    const grant = {
        grantId: crypto.randomBytes(16).toString('hex'),
        clientId: client.clientId,
        companyId: String(companyId),
        userId: String(userId),
        scopes: [...scopes],
        resource: config.resource(),
        createdAt: now,
        expiresAt: new Date(now.getTime() + life.grantMs),
        revokedAt: null,
    };
    await store.grants.save(grant);
    const code = tokenHash.generate('code');
    const expiresAt = new Date(now.getTime() + life.codeMs);
    await store.tokens.save(tokenRow('code', code, grant, {
        now, expiresAt, purgeAt: new Date(expiresAt.getTime() + config.CODE_REUSE_WINDOW_MS), redirectUri, codeChallenge,
    }));
    audit(grant, 'oauth.grant_created', { scopes: grant.scopes });
    return { code, grant };
}

const liveGrant = async (grantId, now) => {
    const grant = await store.grants.find(grantId);
    if (!grant || grant.revokedAt || new Date(grant.expiresAt).getTime() <= now.getTime()) return null;
    return grant;
};

async function issueTokens(grant, { scopes = grant.scopes, now = new Date() } = {}) {
    const life = config.lifetimes();
    const access = tokenHash.generate('access');
    const refresh = tokenHash.generate('refresh');
    const accessExpiresAt = earlier(new Date(now.getTime() + life.accessMs), grant.expiresAt);
    const refreshExpiresAt = earlier(new Date(now.getTime() + life.refreshMs), grant.expiresAt);
    await store.tokens.save(tokenRow('access', access, grant, { now, expiresAt: accessExpiresAt, scopes }));
    await store.tokens.save(tokenRow('refresh', refresh, grant, { now, expiresAt: refreshExpiresAt, scopes }));
    return {
        access_token: access,
        token_type: 'Bearer',
        expires_in: Math.max(1, Math.floor((accessExpiresAt.getTime() - now.getTime()) / 1000)),
        refresh_token: refresh,
        scope: scopes.join(' '),
    };
}

/* The code is spent before anything about it is checked (the tracker sign-in pattern): a wrong verifier
 * cannot be retried against the same code. A spent code presented again means it leaked, so the grant and
 * every token issued under it are revoked (OAuth 2.1 section 4.1.3). */
async function exchangeCode({ client, code, codeVerifier, redirectUri, resource, now = new Date() }) {
    if (!tokenHash.looksLike('code', code)) throw invalidGrant('the authorization code is not valid');
    const hash = tokenHash.hashOf(code);
    const row = await store.tokens.spend(hash, 'code', now);
    if (!row) {
        const seen = await store.tokens.find(hash, 'code');
        if (seen && seen.spentAt) await revokeGrant(seen.grantId, REVOKED.CODE_REUSE, now);
        throw invalidGrant('the authorization code is not valid');
    }
    const rejected = async (error) => {
        await revokeGrant(row.grantId, REVOKED.CODE_REJECTED, now);
        throw error;
    };
    if (row.clientId !== client.clientId) return rejected(invalidGrant('the authorization code was issued to another client'));
    if (new Date(row.expiresAt).getTime() <= now.getTime()) return rejected(invalidGrant('the authorization code has expired'));
    if (typeof redirectUri !== 'string' || redirectUri !== row.redirectUri) return rejected(invalidGrant('redirect_uri does not match the authorization request'));
    if (typeof codeVerifier !== 'string' || !CODE_VERIFIER_PATTERN.test(codeVerifier) || !row.codeChallenge
        || !tokenHash.sameSecret(challengeOf(codeVerifier), row.codeChallenge)) {
        return rejected(invalidGrant('code_verifier does not match the code challenge'));
    }
    if (resource !== row.resource) return rejected(new GrantError('invalid_target', 'resource does not match the authorization request'));
    const grant = await liveGrant(row.grantId, now);
    if (!grant) throw invalidGrant('the grant is no longer valid');
    return issueTokens(grant, { now });
}

/* Rotation (OAuth 2.1 section 4.3.1): every refresh spends the presented token and issues a new pair. A
 * spent refresh token presented again means two parties hold the family, so the whole grant goes. */
async function refresh({ client, refreshToken, scope, resource, now = new Date() }) {
    if (!tokenHash.looksLike('refresh', refreshToken)) throw invalidGrant('the refresh token is not valid');
    const hash = tokenHash.hashOf(refreshToken);
    const existing = await store.tokens.find(hash, 'refresh');
    if (!existing) throw invalidGrant('the refresh token is not valid');
    if (existing.clientId !== client.clientId) {
        await revokeGrant(existing.grantId, REVOKED.REFRESH_WRONG_CLIENT, now);
        throw invalidGrant('the refresh token was issued to another client');
    }
    if (resource !== existing.resource) throw new GrantError('invalid_target', 'resource does not match the grant');
    if (new Date(existing.expiresAt).getTime() <= now.getTime()) throw invalidGrant('the refresh token has expired');
    const requested = scope === undefined || scope === '' ? existing.scopes : String(scope).split(' ').filter(Boolean);
    if (!requested.length || !requested.every((s) => existing.scopes.includes(s))) throw new GrantError('invalid_scope', 'a refresh may only narrow the granted scopes');
    const row = await store.tokens.spend(hash, 'refresh', now);
    if (!row) {
        if (existing.spentAt || (await store.tokens.find(hash, 'refresh') || {}).spentAt) await revokeGrant(existing.grantId, REVOKED.REFRESH_REUSE, now);
        throw invalidGrant('the refresh token is not valid');
    }
    const grant = await liveGrant(row.grantId, now);
    if (!grant) throw invalidGrant('the grant is no longer valid');
    return issueTokens(grant, { scopes: [...new Set(requested)], now });
}

/* RFC 7009. An unknown token is not an error. A refresh token takes its grant with it (section 2.1); an
 * access token goes alone. */
async function revoke({ client, token, now = new Date() }) {
    const kind = tokenHash.looksLike('access', token) ? 'access' : (tokenHash.looksLike('refresh', token) ? 'refresh' : null);
    if (!kind) return { revoked: false };
    const row = await store.tokens.find(tokenHash.hashOf(token), kind);
    if (!row) return { revoked: false };
    if (row.clientId !== client.clientId) throw new GrantError('unauthorized_client', 'the token was issued to another client');
    if (kind === 'refresh') await revokeGrant(row.grantId, REVOKED.REVOKED_BY_CLIENT, now);
    else await store.tokens.revoke(row.tokenHash, now);
    return { revoked: true };
}

/* What the MCP server will read in slice S4. Opaque tokens are checked against their rows on every use,
 * so a revocation takes effect on the next request. */
async function introspect(accessToken, now = new Date()) {
    if (!tokenHash.looksLike('access', accessToken)) return { active: false };
    const row = await store.tokens.find(tokenHash.hashOf(accessToken), 'access');
    if (!row || row.revokedAt || new Date(row.expiresAt).getTime() <= now.getTime()) return { active: false };
    const grant = await liveGrant(row.grantId, now);
    if (!grant) return { active: false };
    return {
        active: true,
        aud: row.resource,
        companyId: row.companyId,
        userId: row.userId,
        scopes: row.scopes,
        grantId: row.grantId,
        clientId: row.clientId,
        exp: Math.floor(new Date(row.expiresAt).getTime() / 1000),
    };
}

async function revokeClientGrants(clientId, now = new Date()) {
    await store.grants.revokeForClient(clientId, REVOKED.CLIENT_REVOKED, now);
    await store.tokens.revokeClient(clientId, now);
}

module.exports = { GrantError, REVOKED, issueCode, exchangeCode, refresh, revoke, introspect, revokeGrant, revokeClientGrants };
