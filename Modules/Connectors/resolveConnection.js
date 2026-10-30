const registry = require('./registry');
const { named } = require('../Agents/connectors/flag');

const CODE = Object.freeze({
    NOT_CONNECTED: 'not_connected',
    NOT_MEMBER: 'not_member',
    BROKEN: 'broken',
    SCOPE_MISSING: 'scope_missing',
    PROVIDER_OFF: 'provider_off',
});

class ConnectorError extends Error {
    constructor(code, provider) {
        super(`${code}: ${provider}`);
        this.name = 'ConnectorError';
        this.code = code;
        this.provider = provider;
    }
}

/* The 063 contract's stub: the signature track B builds against. 066 replaces the body with the real lookup;
 * until then no connection exists, so every call is refused the way a person without one would be. */
const resolveConnection = async ({ companyId, userId, provider } = {}) => {
    if (!companyId || !userId) throw new TypeError('resolveConnection needs companyId and userId');
    // The app half of "offered" needs 065's company app lookup; until then CONNECTORS alone decides.
    if (!registry.get(provider) || !named().includes(provider)) throw new ConnectorError(CODE.PROVIDER_OFF, String(provider || ''));
    throw new ConnectorError(CODE.NOT_CONNECTED, provider);
};

module.exports = { CODE, ConnectorError, resolveConnection };
