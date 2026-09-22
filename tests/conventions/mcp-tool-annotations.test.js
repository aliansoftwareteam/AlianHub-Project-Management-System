jest.mock('../../utils/mongo-handler/mongoQueries', () => ({ MongoDbCrudOpration: jest.fn() }));
jest.mock('../../event/socketEventEmitter', () => ({ emit: jest.fn() }));

/* An MCP client decides how carefully to call a tool from its annotations, so a
 * hint that says less than the rating (a destructive write marked safe) is a
 * lie the client acts on. Each hint is worked out here from the rating alone. */
const expectedFrom = (r) => ({
    readOnlyHint: !r.write,
    destructiveHint: r.write && (!r.reversible || r.scope === 'workspace'),
    idempotentHint: !r.write,
    openWorldHint: false,
});

describe('every MCP tool is rated and its annotations agree with the rating', () => {
    const saved = { v2: process.env.MCP_TOOLS_V2, perf: process.env.AGENT_PERFORMANCE_READ, data: process.env.MCP_TOOLS_DATA };
    let tools;
    let actions;

    beforeAll(() => {
        process.env.MCP_TOOLS_V2 = 'on';
        process.env.AGENT_PERFORMANCE_READ = 'on';
        process.env.MCP_TOOLS_DATA = 'on';
        tools = require('../../Modules/Mcp/tools');
        actions = require('../../Modules/Agents/actions');
    });

    afterAll(() => {
        if (saved.v2 === undefined) delete process.env.MCP_TOOLS_V2; else process.env.MCP_TOOLS_V2 = saved.v2;
        if (saved.perf === undefined) delete process.env.AGENT_PERFORMANCE_READ; else process.env.AGENT_PERFORMANCE_READ = saved.perf;
        if (saved.data === undefined) delete process.env.MCP_TOOLS_DATA; else process.env.MCP_TOOLS_DATA = saved.data;
    });

    it('offers every tool, flagged ones included', () => {
        expect(tools.manifest().map((t) => t.name)).toEqual(expect.arrayContaining(['tasks.next', 'task.comment', 'performance.read', 'projects.list', 'comment.create', 'timelog.create']));
    });

    it('rates the action behind every tool', () => {
        expect(actions.unrated(tools.actionsOffered())).toEqual([]);
    });

    it('annotates every tool exactly as its rating says', () => {
        const wrong = tools.manifest().filter((t) => {
            const r = actions.rating(tools.actionOf(t.name));
            return !r || JSON.stringify(t.annotations) !== JSON.stringify(expectedFrom(r));
        }).map((t) => t.name);
        expect(wrong).toEqual([]);
    });
});
