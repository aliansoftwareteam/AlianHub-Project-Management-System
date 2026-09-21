/* Every MCP tool answers only for what its caller could open in the web app. A tool
 * declares visibility 'filtered' and receives the caller's filter, or 'none' with a
 * written reason; a registration without either fails here, not in production. */
describe('every registered MCP tool goes through the visibility filter', () => {
    let tools;
    const saved = process.env.AGENT_PERFORMANCE_READ;

    beforeAll(() => {
        process.env.AGENT_PERFORMANCE_READ = 'on';
        tools = require('../../Modules/Mcp/tools');
    });
    afterAll(() => { if (saved === undefined) delete process.env.AGENT_PERFORMANCE_READ; else process.env.AGENT_PERFORMANCE_READ = saved; });

    const registered = () => tools.registered();

    it('sees the flagged tools too (the scan works)', () => {
        expect(registered().map((t) => t.name)).toContain('performance.read');
    });

    it('declares filtered or none on every tool', () => {
        const undeclared = registered().filter((t) => !['filtered', 'none'].includes(t.visibility)).map((t) => t.name);
        expect(undeclared).toEqual([]);
    });

    it('gives a written reason for every tool that skips the filter', () => {
        const unexplained = registered()
            .filter((t) => t.visibility === 'none' && !(typeof t.visibilityReason === 'string' && t.visibilityReason.trim().length >= 20))
            .map((t) => t.name);
        expect(unexplained).toEqual([]);
    });

    it('hands the filter to every filtered read, which takes it as its third argument', () => {
        const ignoring = registered().filter((t) => t.visibility === 'filtered' && t.run && t.run.length < 3).map((t) => t.name);
        expect(ignoring).toEqual([]);
    });

    it('names the target of every filtered write so it is checked before the action runs', () => {
        const untargeted = registered().filter((t) => t.visibility === 'filtered' && !t.run && typeof t.target !== 'function').map((t) => t.name);
        expect(untargeted).toEqual([]);
    });
});
