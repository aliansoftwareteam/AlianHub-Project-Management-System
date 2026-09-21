const { SCOPES } = require('../../Config/mcpOAuth');

/* Every MCP tool needs exactly one OAuth scope, or a scope challenge cannot name
 * what the call lacks. Flagged tools count: they are offered whenever their flag is on. */
describe('every registered MCP tool maps to one scope', () => {
    let tools;
    let registry;
    let TOOL_SCOPES;
    let scopeForTool;
    let sessionTools;
    const saved = process.env.AGENT_PERFORMANCE_READ;
    const savedSessions = process.env.EXTERNAL_AGENT_SESSIONS;
    const restore = (key, value) => { if (value === undefined) delete process.env[key]; else process.env[key] = value; };

    beforeAll(() => {
        process.env.AGENT_PERFORMANCE_READ = 'on';
        process.env.EXTERNAL_AGENT_SESSIONS = 'on';
        tools = require('../../Modules/Mcp/tools');
        registry = require('../../Modules/Agents/registry');
        sessionTools = require('../../Modules/Mcp/sessionTools');
        ({ TOOL_SCOPES, scopeForTool } = require('../../Modules/Mcp/scopes'));
    });
    afterAll(() => { restore('AGENT_PERFORMANCE_READ', saved); restore('EXTERNAL_AGENT_SESSIONS', savedSessions); });

    it('sees the flagged tools too (the scan works)', () => {
        expect(tools.names()).toContain('performance.read');
        expect(tools.names()).toContain('session.activity');
        expect(tools.names().length).toBeGreaterThan(10);
    });

    it('has a scope from the supported set for each tool, read for reads and write for writes', () => {
        const wrong = tools.names().filter((name) => {
            // Session tools write only the session record and are not registry actions; each needs tasks:write.
            if (sessionTools.owns(name)) return scopeForTool(name) !== 'tasks:write';
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
