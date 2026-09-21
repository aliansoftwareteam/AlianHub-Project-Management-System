const { SCOPES } = require('../../Config/mcpOAuth');

/* Every MCP tool needs exactly one OAuth scope, or a scope challenge cannot name
 * what the call lacks. Flagged tools count: they are offered whenever their flag is on. */
describe('every registered MCP tool maps to one scope', () => {
    let tools;
    let registry;
    let TOOL_SCOPES;
    const saved = process.env.AGENT_PERFORMANCE_READ;

    beforeAll(() => {
        process.env.AGENT_PERFORMANCE_READ = 'on';
        tools = require('../../Modules/Mcp/tools');
        registry = require('../../Modules/Agents/registry');
        ({ TOOL_SCOPES } = require('../../Modules/Mcp/scopes'));
    });
    afterAll(() => { if (saved === undefined) delete process.env.AGENT_PERFORMANCE_READ; else process.env.AGENT_PERFORMANCE_READ = saved; });

    it('sees the flagged tools too (the scan works)', () => {
        expect(tools.names()).toContain('performance.read');
        expect(tools.names().length).toBeGreaterThan(10);
    });

    it('has a scope from the supported set for each tool, read for reads and write for writes', () => {
        const wrong = tools.names().filter((name) => {
            const scope = TOOL_SCOPES[name];
            const action = registry.get(name);
            if (!SCOPES.includes(scope) || !action) return true;
            return scope.endsWith(':write') !== Boolean(action.write);
        });
        expect(wrong).toEqual([]);
    });

    it('names no tool that does not exist', () => {
        expect(Object.keys(TOOL_SCOPES).filter((name) => !tools.names().includes(name))).toEqual([]);
    });
});
