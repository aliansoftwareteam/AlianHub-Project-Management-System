jest.mock('../Config/loggerConfig', () => ({ error: jest.fn(), info: jest.fn() }));
jest.mock('../Config/jwt', () => ({ verifyCompanyMembership: jest.fn() }));
jest.mock('../Modules/ApiTokens/controller', () => ({ verifyToken: jest.fn(), logTokenActivity: jest.fn() }));
jest.mock('../Modules/Agents/actor', () => ({ resolveActor: jest.fn(async () => ({ kind: 'agent', userId: '6f0000000000000000000001' })) }));
jest.mock('../Modules/Agents/actions', () => ({ RefusedError: class RefusedError extends Error {} }));
jest.mock('../Modules/Agents/registry', () => ({ NEVER: [] }));
jest.mock('../Modules/Mcp/tools', () => ({ manifest: () => [], call: jest.fn() }));

const { verifyCompanyMembership } = require('../Config/jwt');
const apiTokens = require('../Modules/ApiTokens/controller');
const server = require('../Modules/Mcp/server');

const USER_ID = '6f0000000000000000000001';
const C = '6f0000000000000000000c01';
const token = { _id: '6f0000000000000000000101', name: 'Laptop', userId: USER_ID, scopes: ['read'], active: true };

const request = (body = { jsonrpc: '2.0', id: 1, method: 'ping' }) => ({
    headers: { authorization: 'Bearer ah_abc' }, query: { companyId: C }, body, ip: '1.1.1.1',
});
const response = () => {
    const res = { statusCode: 200, headers: {}, body: undefined };
    res.set = jest.fn((k, v) => { res.headers[k] = v; return res; });
    res.status = jest.fn((code) => { res.statusCode = code; return res; });
    res.json = jest.fn((body) => { res.body = body; return res; });
    res.end = jest.fn(() => res);
    return res;
};

beforeEach(() => {
    jest.clearAllMocks();
    apiTokens.verifyToken.mockResolvedValue(token);
});

describe('defect 8 — the MCP server re-checks company membership on every request', () => {
    it('rejects a removed member with the 403 the REST token path returns, before any RPC runs', async () => {
        verifyCompanyMembership.mockResolvedValue(false);
        const res = response();
        await server.post(request(), res);
        expect(verifyCompanyMembership).toHaveBeenCalledWith(USER_ID, C);
        expect(res.statusCode).toBe(403);
        expect(res.body).toMatchObject({ status: false, error: 'You are no longer a member of this company', statusText: 'Forbidden' });
        expect(apiTokens.logTokenActivity).not.toHaveBeenCalled();
    });

    it('rejects the GET probe the same way', async () => {
        verifyCompanyMembership.mockResolvedValue(false);
        const res = response();
        await server.get(request(), res);
        expect(res.statusCode).toBe(403);
        expect(res.body).toMatchObject({ status: false, statusText: 'Forbidden' });
    });

    it('answers a current member as before', async () => {
        verifyCompanyMembership.mockResolvedValue(true);
        const res = response();
        await server.post(request(), res);
        expect(res.statusCode).toBe(200);
        expect(res.body).toEqual({ jsonrpc: '2.0', id: 1, result: {} });
    });

    it('still answers 401 for a bad token without consulting membership', async () => {
        apiTokens.verifyToken.mockResolvedValue(null);
        const res = response();
        await server.post(request(), res);
        expect(res.statusCode).toBe(401);
        expect(verifyCompanyMembership).not.toHaveBeenCalled();
    });
});
