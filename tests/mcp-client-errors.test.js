jest.mock('../utils/mongo-handler/mongoQueries', () => ({ MongoDbCrudOpration: jest.fn() }));
jest.mock('../Config/loggerConfig', () => ({ error: jest.fn(), info: jest.fn(), warn: jest.fn() }));
jest.mock('../Modules/ApiTokens/controller', () => ({ verifyToken: jest.fn(), logTokenActivity: jest.fn() }));
jest.mock('../Modules/Agents/actions', () => ({ RefusedError: class RefusedError extends Error {} }));
jest.mock('../Modules/Mcp/tools', () => ({ manifest: () => [], call: jest.fn() }));

const logger = require('../Config/loggerConfig');
const tools = require('../Modules/Mcp/tools');
const server = require('../Modules/Mcp/server');
const { GENERIC } = require('../Modules/Mcp/clientError');

const callTool = () => server.handleRpc({}, { jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'tasks.search', arguments: {} } });
const answerOf = (reply) => JSON.parse(reply.result.content[0].text);

beforeEach(() => jest.clearAllMocks());

describe('what a client is told when a tool fails', () => {
    it('gives a general answer for an unexpected failure and keeps the detail in the server log', async () => {
        tools.call.mockRejectedValue(Object.assign(new Error('E11000 duplicate key error collection: c1.tasks index: TaskKey_1'), { code: 11000 }));
        const reply = await callTool();
        expect(reply.result.isError).toBe(true);
        expect(answerOf(reply)).toEqual({ error: GENERIC });
        expect(JSON.stringify(reply)).not.toMatch(/E11000|TaskKey/);
        expect(logger.error).toHaveBeenCalledWith(expect.stringMatching(/E11000/));
    });

    it('passes on the answers a tool writes for the client', async () => {
        for (const error of [
            Object.assign(new Error('This connection can only read.'), { code: -32004 }),
            Object.assign(new Error('not_visible: that task was not found.'), { notVisible: true }),
            Object.assign(new Error('That proposal is not valid.'), { status: 400 }),
        ]) {
            tools.call.mockRejectedValueOnce(error);
            expect(answerOf(await callTool())).toEqual({ error: error.message });
        }
    });
});
