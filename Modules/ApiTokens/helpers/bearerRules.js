const jwt = require('jsonwebtoken');
const { STEP_CREDENTIAL_KIND, looksLikeServiceIdentity } = require('../../Agents/serviceIdentity');

// What a presented bearer value must never be taken for. A step credential is
// signed with a key of its own and a service identity is never a token at all,
// so both would fail the session check anyway; naming them here means the
// refusal says why instead of "invalid signature".

const looksLikeStepCredential = (raw) => {
    if (typeof raw !== 'string' || raw.split('.').length !== 3) return false;
    const payload = jwt.decode(raw);
    return Boolean(payload && typeof payload === 'object' && payload.kind === STEP_CREDENTIAL_KIND);
};

const bearerRefusal = (raw) => {
    if (looksLikeStepCredential(raw)) return 'A step-scoped credential cannot be presented as a bearer token.';
    if (looksLikeServiceIdentity(raw)) return 'A service identity cannot be presented as a bearer token.';
    return null;
};

module.exports = { looksLikeStepCredential, bearerRefusal };
