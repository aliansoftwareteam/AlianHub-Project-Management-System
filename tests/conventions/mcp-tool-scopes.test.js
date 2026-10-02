const { SCOPES, MANAGE_SCOPES } = require('../../Config/mcpOAuth');

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
    const savedData = process.env.MCP_TOOLS_DATA;
    const savedManage = process.env.MCP_TOOLS_MANAGE;
    const savedWork = process.env.MCP_TOOLS_WORK;
    const restore = (key, value) => { if (value === undefined) delete process.env[key]; else process.env[key] = value; };

    beforeAll(() => {
        process.env.AGENT_PERFORMANCE_READ = 'on';
        process.env.EXTERNAL_AGENT_SESSIONS = 'on';
        process.env.MCP_TOOLS_DATA = 'on';
        process.env.MCP_TOOLS_MANAGE = 'on';
        process.env.MCP_TOOLS_WORK = 'on';
        tools = require('../../Modules/Mcp/tools');
        registry = require('../../Modules/Agents/registry');
        sessionTools = require('../../Modules/Mcp/sessionTools');
        ({ TOOL_SCOPES, scopeForTool } = require('../../Modules/Mcp/scopes'));
    });
    afterAll(() => { restore('AGENT_PERFORMANCE_READ', saved); restore('EXTERNAL_AGENT_SESSIONS', savedSessions); restore('MCP_TOOLS_DATA', savedData); restore('MCP_TOOLS_MANAGE', savedManage); restore('MCP_TOOLS_WORK', savedWork); });

    it('sees the flagged tools too (the scan works)', () => {
        expect(tools.names()).toContain('performance.read');
        expect(tools.names()).toContain('session.activity');
        expect(tools.names()).toContain('timesheet.read');
        expect(tools.names()).toContain('task.move');
        expect(tools.names()).toContain('list.create');
        expect(tools.names()).toContain('goal.target.set');
        expect(tools.names()).toContain('task.lists.add');
        expect(tools.names().length).toBeGreaterThan(10);
    });

    it('has a scope from the supported set for each tool, read for reads and write for writes', () => {
        const wrong = tools.registered().filter((tool) => {
            const scope = scopeForTool(tool.name);
            // Session tools write only the session record and are not registry actions; each needs tasks:write.
            if (sessionTools.owns(tool.name)) return scope !== 'tasks:write';
            const action = registry.get(tool.action);
            if (!SCOPES.includes(scope) || !action) return true;
            if (MANAGE_SCOPES.includes(scope)) return false;
            return scope.endsWith(':write') !== Boolean(action.write);
        }).map((tool) => tool.name);
        expect(wrong).toEqual([]);
    });

    /* A manage scope is wider than read or write, so nothing reaches a tool under one by accident: the tool
     * itself says which it needs, and that is what the caller's token is asked for. */
    it('maps a tool to a manage scope only when the tool declares that scope as its grant, and the other way round', () => {
        const variants = Object.values(require('../../Modules/Mcp/manageTools').VARIANTS);
        const own = tools.registered().filter((tool) => !variants.includes(tool));
        const mismatched = own.filter((tool) => (MANAGE_SCOPES.includes(scopeForTool(tool.name)) || Boolean(tool.grant)) && tool.grant !== scopeForTool(tool.name));
        expect(mismatched.map((tool) => tool.name)).toEqual([]);
        // The fuller form of an older tool keeps that tool's scope and asks for a manage scope besides.
        expect(variants.filter((tool) => MANAGE_SCOPES.includes(scopeForTool(tool.name)) || !MANAGE_SCOPES.includes(tool.grant)).map((tool) => tool.name)).toEqual([]);
        expect(Object.values(TOOL_SCOPES).filter((scope) => MANAGE_SCOPES.includes(scope))).toEqual([]);
        expect(own.filter((tool) => tool.grant).length).toBeGreaterThan(10);
    });

    it('names no tool that does not exist', () => {
        expect(Object.keys(TOOL_SCOPES).filter((name) => !tools.names().includes(name))).toEqual([]);
    });
});
