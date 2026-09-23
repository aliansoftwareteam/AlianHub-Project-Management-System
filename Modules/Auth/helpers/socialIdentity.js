const axios = require('axios');
const mongoC = require('../../../utils/mongo-handler/mongoQueries');
const { dbCollections } = require('../../../Config/collections');
const logger = require('../../../Config/loggerConfig');

const PROVIDER_TIMEOUT_MS = 8000;

class SocialSignInRefusal extends Error {
    constructor(message, statusCode = 401) {
        super(message);
        this.statusCode = statusCode;
    }
}

const refuse = (message, statusCode) => { throw new SocialSignInRefusal(message, statusCode); };

const normalEmail = (value) => (typeof value === 'string' ? value.trim().toLowerCase() : '');

/* GitHub's /user email is only the public profile field and is never marked verified, so the
 * address comes from /user/emails (user:email scope), and only an entry GitHub has verified. */
const githubIdentity = async (accessToken, claimedEmail) => {
    const headers = { Authorization: `token ${accessToken}`, 'User-Agent': 'AlianHub', Accept: 'application/vnd.github+json' };
    const [{ data: user }, emails] = await Promise.all([
        axios.get('https://api.github.com/user', { headers, timeout: PROVIDER_TIMEOUT_MS }),
        axios.get('https://api.github.com/user/emails', { headers, timeout: PROVIDER_TIMEOUT_MS })
            .then(({ data }) => (Array.isArray(data) ? data : []))
            .catch(() => []),
    ]);
    const verified = emails.filter((entry) => entry && entry.verified === true && normalEmail(entry.email));
    const chosen = verified.find((entry) => normalEmail(entry.email) === claimedEmail) || verified.find((entry) => entry.primary === true);
    return { providerId: user && user.id, email: chosen ? normalEmail(chosen.email) : '' };
};

const gitlabApiBase = () => (process.env.GITLAB_BASE_API_URL || 'https://gitlab.com/api/v4').replace(/\/+$/, '');

const gitlabIdentity = async (accessToken) => {
    const { data: user } = await axios.get(`${gitlabApiBase()}/user`, {
        headers: { Authorization: `Bearer ${accessToken}` },
        timeout: PROVIDER_TIMEOUT_MS,
    });
    return { providerId: user && user.id, email: user && user.confirmed_at ? normalEmail(user.email) : '' };
};

const googleAudience = () => process.env.GOOGLE_OAUTH_CLIENT_ID || process.env.GOOGLE_CLIENT_ID || '';

/* verifyIdToken checks the signature against Google's keys, the issuer, the expiry and the audience. */
const googleIdentity = async (idToken) => {
    const audience = googleAudience();
    if (!audience) refuse('Google sign-in is not configured on this server.', 503);
    const { OAuth2Client } = require('google-auth-library');
    const ticket = await new OAuth2Client(audience).verifyIdToken({ idToken, audience });
    const payload = (ticket && ticket.getPayload()) || {};
    const emailVerified = payload.email_verified === true || payload.email_verified === 'true';
    return { providerId: payload.sub, email: emailVerified ? normalEmail(payload.email) : '' };
};

const PROVIDERS = {
    github: { label: 'GitHub', idField: 'githubId', credential: 'accessToken', identify: githubIdentity },
    gitlab: { label: 'GitLab', idField: 'gitlabId', credential: 'accessToken', identify: gitlabIdentity },
    google: { label: 'Google', idField: 'googleId', credential: 'idToken', identify: googleIdentity },
};

const isSocialProvider = (provider) => Object.prototype.hasOwnProperty.call(PROVIDERS, provider);

/* The provider user id and the provider-verified email (empty when there is none). Nothing
 * in the request body other than the provider's own credential is trusted. */
const verifySocialIdentity = async (provider, body = {}) => {
    if (!isSocialProvider(provider)) refuse('Unknown sign-in provider.', 400);
    const spec = PROVIDERS[provider];
    const credential = body[spec.credential];
    if (typeof credential !== 'string' || !credential.trim()) {
        refuse(`Sign in with ${spec.label} again: the ${spec.label} sign-in token is missing.`);
    }
    let identity;
    try {
        identity = await spec.identify(credential.trim(), normalEmail(body.email));
    } catch (error) {
        if (error instanceof SocialSignInRefusal) throw error;
        logger.warn(`${spec.label} sign-in could not be verified: ${error.message}`);
        refuse(`${spec.label} could not confirm this sign-in. Try again.`);
    }
    const providerId = identity && identity.providerId !== undefined && identity.providerId !== null ? String(identity.providerId) : '';
    if (!providerId) refuse(`${spec.label} could not confirm this sign-in. Try again.`);
    return { provider, label: spec.label, idField: spec.idField, providerId, email: identity.email || '' };
};

const noVerifiedEmail = ({ label }) => `${label} did not share a verified email address. Verify your email address with ${label}, then try again.`;

/* A client that names an email must name the one the provider verified. */
const assertClaimedEmail = (identity, claimed) => {
    const claimedEmail = normalEmail(claimed);
    if (claimedEmail && claimedEmail !== identity.email) {
        refuse(`The email address does not match the one ${identity.label} verified (${identity.email}).`, 400);
    }
};

const findAuth = (filter) => mongoC.MongoDbCrudOpration(dbCollections.GLOBAL, { type: dbCollections.USER_AUTH, data: [filter] }, 'findOne');

const findAuthByProviderId = (identity) => findAuth({ [identity.idField]: identity.providerId });

const linkProviderId = (account, identity) => mongoC.MongoDbCrudOpration(dbCollections.GLOBAL, {
    type: dbCollections.USER_AUTH,
    data: [
        { _id: account._id, $or: [{ [identity.idField]: { $exists: false } }, { [identity.idField]: null }, { [identity.idField]: '' }] },
        { $set: { [identity.idField]: identity.providerId } },
    ],
}, 'findOneAndUpdate');

/* An account bound to the provider id is that person's, whatever email the provider now reports.
 * Otherwise the provider-verified email finds the account, which is bound on first use and
 * refused when it is already bound to a different provider id. */
const resolveSocialAccount = async (identity, claimedEmail) => {
    const bound = await findAuthByProviderId(identity);
    const account = bound || await (async () => {
        if (!identity.email) refuse(noVerifiedEmail(identity));
        assertClaimedEmail(identity, claimedEmail);
        const found = await findAuth({ email: identity.email });
        if (!(found && found._id)) refuse('User not found', 404);
        if (found[identity.idField] && String(found[identity.idField]) !== identity.providerId) {
            refuse(`This account is linked to a different ${identity.label} account.`, 403);
        }
        return found;
    })();
    if (account.isBlocked) refuse('Your email has been blocked. Please contact the administrator.', 403);
    if (!bound) {
        const linked = await linkProviderId(account, identity);
        if (!(linked && linked._id)) refuse(`This account is linked to a different ${identity.label} account.`, 403);
    }
    return account;
};

module.exports = {
    PROVIDERS,
    SocialSignInRefusal,
    assertClaimedEmail,
    findAuth,
    findAuthByProviderId,
    isSocialProvider,
    noVerifiedEmail,
    normalEmail,
    resolveSocialAccount,
    verifySocialIdentity,
};
