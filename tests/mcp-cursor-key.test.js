jest.mock('../Modules/Mcp/routes', () => ({ init: jest.fn() }));

const cursor = require('../Modules/Mcp/cursor');
const init = require('../Modules/Mcp/init');

const KEYS = ['MCP_TOOLS_V2', 'MCP_CURSOR_SECRET', 'JWT_SECRET'];
const saved = Object.fromEntries(KEYS.map((k) => [k, process.env[k]]));
const LONG = 'k'.repeat(32);

beforeEach(() => {
    KEYS.forEach((k) => { delete process.env[k]; });
    process.env.JWT_SECRET = 'j'.repeat(40);
});

afterAll(() => {
    KEYS.forEach((k) => { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; });
});

describe('MCP_CURSOR_SECRET is checked before the server starts', () => {
    it('refuses to start with the flag on and a key shorter than 32 characters', () => {
        process.env.MCP_TOOLS_V2 = 'on';
        process.env.MCP_CURSOR_SECRET = 'k'.repeat(31);
        expect(() => init.init({})).toThrow(/MCP_CURSOR_SECRET/);
    });

    it('refuses to start with the flag on and the key equal to JWT_SECRET', () => {
        process.env.MCP_TOOLS_V2 = 'on';
        process.env.MCP_CURSOR_SECRET = process.env.JWT_SECRET;
        expect(() => init.init({})).toThrow(/JWT_SECRET/);
    });

    it('starts with a long, distinct key, or with none set', () => {
        process.env.MCP_TOOLS_V2 = 'on';
        process.env.MCP_CURSOR_SECRET = LONG;
        expect(() => init.init({})).not.toThrow();
        delete process.env.MCP_CURSOR_SECRET;
        expect(() => init.init({})).not.toThrow();
    });

    it('does not judge the key while the flag is off', () => {
        process.env.MCP_CURSOR_SECRET = 'short';
        expect(() => init.init({})).not.toThrow();
    });

    it('does not sign with a key it would refuse at start', () => {
        process.env.MCP_TOOLS_V2 = 'on';
        process.env.MCP_CURSOR_SECRET = 'short';
        const ctx = { companyId: 'c', userId: 'u', token: { _id: 't' } };
        expect(() => cursor.issue(ctx, 'tasks.search', {}, 25)).toThrow(/MCP_CURSOR_SECRET/);
    });
});
