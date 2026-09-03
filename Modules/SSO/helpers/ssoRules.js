// SEC-02 SSO rules. Pure — no I/O — shared by the SSO controllers and tests.

const SSO_PROVIDERS = Object.freeze(['oidc', 'saml']);
const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

/* Validate an admin's SSO config payload. Returns { valid, reason }. */
const validateSsoConfig = ({ provider, oidc, saml } = {}) => {
    if (!SSO_PROVIDERS.includes(String(provider))) {
        return { valid: false, reason: `provider must be one of: ${SSO_PROVIDERS.join(', ')}.` };
    }
    if (provider === 'oidc') {
        if (!oidc || typeof oidc !== 'object') return { valid: false, reason: 'oidc config is required.' };
        if (!oidc.issuer && !oidc.discoveryUrl) return { valid: false, reason: 'oidc.issuer or oidc.discoveryUrl is required.' };
        if (!oidc.clientId) return { valid: false, reason: 'oidc.clientId is required.' };
        if (!oidc.clientSecret) return { valid: false, reason: 'oidc.clientSecret is required.' };
    }
    if (provider === 'saml') {
        if (!saml || typeof saml !== 'object') return { valid: false, reason: 'saml config is required.' };
        if (!saml.entryPoint) return { valid: false, reason: 'saml.entryPoint (IdP SSO URL) is required.' };
        if (!saml.idpCert) return { valid: false, reason: 'saml.idpCert (IdP signing certificate) is required.' };
    }
    return { valid: true, reason: '' };
};

/* Strip secrets — the only fields safe to expose to the (unauthenticated) login page. */
const publicSsoView = (cfg) => {
    if (!cfg || !cfg.isEnabled) return null;
    return { provider: cfg.provider, isEnabled: true, displayName: cfg.displayName || '', enforcement: cfg.enforcement || 'optional' };
};

/* Normalise an identity from SSO claims/attributes using an optional attribute
 * map. Returns { valid, reason, email, firstName, lastName, externalId }. */
const extractIdentity = (claims = {}, map = {}) => {
    const pick = (key, def) => {
        const attr = (map && map[key]) || def;
        const v = claims ? claims[attr] : undefined;
        return v === undefined || v === null ? '' : String(v);
    };
    const email = pick('email', 'email').trim().toLowerCase();
    if (!email || !EMAIL_RE.test(email)) {
        return { valid: false, reason: 'The SSO assertion did not include a valid email.' };
    }
    let firstName = pick('firstName', 'given_name');
    let lastName = pick('lastName', 'family_name');
    const fullName = pick('name', 'name');
    if (!firstName && fullName) firstName = fullName.split(' ')[0];
    if (!lastName && fullName) lastName = fullName.split(' ').slice(1).join(' ');
    if (!firstName) firstName = email.split('@')[0];
    if (!lastName) lastName = '-';
    const externalId = pick('id', 'sub') || String((claims && claims.nameID) || '');
    return { valid: true, reason: '', email, firstName, lastName, externalId };
};

module.exports = { SSO_PROVIDERS, validateSsoConfig, publicSsoView, extractIdentity };
