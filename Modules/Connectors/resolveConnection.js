const connection = require('./connection');

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

/* The reasons `connection` answers with, mapped to the contract's codes (063 §5). `reauth_required` means a
 * company app changed under the connection, so the person reconnects: that is `broken` to the tool. */
const CODE_OF = Object.freeze({
    off: CODE.PROVIDER_OFF,
    no_seat: CODE.NOT_MEMBER,
    not_connected: CODE.NOT_CONNECTED,
    broken: CODE.BROKEN,
    reauth_required: CODE.BROKEN,
});

/* The real lookup (066), replacing the 063 stub. Only the person's own live connection is returned; the access
 * token stays inside the caller of `getAccessToken()` and is never returned by a route, logged, emitted or
 * audited (FR-15). `connectionId` is the only id B stores. */
const resolveConnection = async ({ companyId, userId, provider } = {}) => {
    if (!companyId || !userId) throw new TypeError('resolveConnection needs companyId and userId');
    const found = await connection.findUsable({ companyId: String(companyId), userId: String(userId), provider });
    if (found.reason) throw new ConnectorError(CODE_OF[found.reason] || CODE.NOT_CONNECTED, String(provider || ''));
    const { row } = found;
    return {
        connectionId: String(row._id),
        scopes: [...(row.scopes || [])],
        getAccessToken: async () => {
            const { token, reason } = await connection.accessTokenFor({ companyId: String(companyId), userId: String(userId), provider });
            if (token) return token;
            if (CODE_OF[reason]) throw new ConnectorError(CODE_OF[reason], String(provider || ''));
            throw Object.assign(new Error(`a fresh access token for ${provider} could not be obtained (${reason})`), { code: reason });
        },
    };
};

const markBackoff = ({ companyId, connectionId, until } = {}) => connection.markBackoff({ companyId, connectionId, until });

const recordHealth = ({ companyId, connectionId, lastUsedAt, lastError } = {}) => connection.recordHealth({ companyId, connectionId, lastUsedAt, lastError });

const markBroken = ({ companyId, connectionId, reason } = {}) => connection.markBrokenById({ companyId, connectionId, reason });

module.exports = { CODE, ConnectorError, resolveConnection, markBackoff, recordHealth, markBroken };
