jest.mock('../utils/mongo-handler/mongoQueries', () => ({ MongoDbCrudOpration: jest.fn() }));
jest.mock('../Config/loggerConfig', () => ({ error: jest.fn(), info: jest.fn() }));
jest.mock('../Modules/ApiTokens/controller', () => ({ verifyToken: jest.fn(), logTokenActivity: jest.fn() }));
jest.mock('../Modules/Agents/actions', () => ({ RefusedError: class RefusedError extends Error {} }));
jest.mock('../Modules/Mcp/tools', () => ({ manifest: () => [], call: jest.fn() }));

const tools = require('../Modules/Mcp/tools');
const server = require('../Modules/Mcp/server');

describe('an invalid cursor is a JSON-RPC invalid-params error', () => {
    it('answers -32602 rather than a tool result', async () => {
        tools.call.mockRejectedValue(Object.assign(new Error('Invalid cursor.'), { code: -32602 }));
        const reply = await server.handleRpc({}, { jsonrpc: '2.0', id: 7, method: 'tools/call', params: { name: 'tasks.search', arguments: { cursor: 'x' } } });
        expect(reply).toEqual({ jsonrpc: '2.0', id: 7, error: { code: -32602, message: 'Invalid cursor.' } });
    });
});
