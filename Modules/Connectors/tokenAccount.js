/* An id token here came straight from the provider's token endpoint over TLS, in answer to our own request, so its
 * claims are read for the account's name only and its signature is not checked. */
const idTokenClaims = (token) => {
    const part = String(token || '').split('.')[1];
    if (!part) return null;
    try {
        const claims = JSON.parse(Buffer.from(part, 'base64url').toString('utf8'));
        return claims && typeof claims === 'object' ? claims : null;
    } catch (e) {
        return null;
    }
};

const valueAt = (object, path) => path.split('.').reduce((at, key) => (at && typeof at === 'object' ? at[key] : undefined), object);

/* Many MCP apps' token answers do not name the account. The fields an app is known to send come first, then an id
 * token's subject; failing both, one stable id per person keeps their single live connection to the app, though a
 * reconnect to a different account then cannot be told apart. */
const accountFromToken = (fields = [], labelFields = []) => ({ tokenResponse = {} } = {}) => {
    const label = labelFields.map((field) => valueAt(tokenResponse, field)).find((value) => typeof value === 'string' && value) || '';
    const id = fields.map((field) => valueAt(tokenResponse, field)).find((value) => value !== undefined && value !== null && value !== '');
    if (id !== undefined) return { id: String(id), label };
    const claims = idTokenClaims(tokenResponse.id_token);
    if (claims && claims.sub) return { id: String(claims.sub), label: label || String(claims.email || claims.name || '') };
    return { id: 'member', label };
};

module.exports = { accountFromToken, idTokenClaims };
