const { createApiClient } = require('../../e2e/support/api');
const { loginAs, readState, uniqueSuffix } = require('../../e2e/support/fixtures');

/* The harness runs with MCP_OAUTH unset, so /mcp must answer exactly as it did before
 * the protected resource metadata and scope challenges existed. */

const state = readState();
const anonymous = createApiClient({ baseURL: state.baseURL, companyId: state.companyId });

describe('MCP with MCP_OAUTH off', () => {
    let owner;
    let token;

    beforeAll(async () => {
        owner = await loginAs('owner');
        const res = await owner.api.post('/api/v2/api-tokens', { name: `[QA oauth-off] ${uniqueSuffix()}`, scopes: ['read'], expiresInDays: 1 });
        expect(res.body.status).toBe(true);
        token = res.body.data;
    });

    afterAll(async () => {
        if (token) await owner.api.delete(`/api/v2/api-tokens/${token._id}`);
    });

    it.each(['/.well-known/oauth-protected-resource', '/.well-known/oauth-protected-resource/mcp'])('has no %s', async (path) => {
        const res = await anonymous.get(path);
        expect(res.status).toBe(404);
    });

    it('answers a missing token with today\'s 401, header and body', async () => {
        const res = await anonymous.post('/mcp', { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'task.comment', arguments: {} } });
        expect(res.status).toBe(401);
        expect(res.headers.get('www-authenticate')).toBe('Bearer realm="alianhub-mcp"');
        expect(res.body).toEqual({ jsonrpc: '2.0', id: null, error: { code: -32001, message: 'A valid bearer token and companyId are required.' } });
    });

    it('still refuses a read-only token\'s write in band, and ignores a token in the query string', async () => {
        const client = createApiClient({ baseURL: state.baseURL, accessToken: token.token, companyId: state.companyId });
        const write = await client.post('/mcp', { jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'task.comment', arguments: { taskId: '6f0000000000000000000d01', body: 'x' } } });
        expect(write.status).toBe(200);
        expect(write.body.result.isError).toBe(true);

        const init = await client.request('POST', '/mcp', {
            body: { jsonrpc: '2.0', id: 3, method: 'initialize', params: { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'qa', version: '1' } } },
            query: { access_token: token.token },
        });
        expect(init.status).toBe(200);
        expect(init.body.result.protocolVersion).toBe('2025-06-18');
    });
});
