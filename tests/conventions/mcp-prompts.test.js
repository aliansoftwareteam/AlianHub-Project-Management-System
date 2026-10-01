/* What the MCP server tells an agent, and each ready-made prompt, may name only a tool that exists and that the
 * connection reading it is offered. A name the connection cannot call sends the agent to a tool that answers
 * "unknown", so every mix of settings and connections is read here. Tool names are written in backticks. */
describe('the MCP instructions and prompts name only tools the connection is offered', () => {
    const FLAGS = ['MCP_TOOLS_DATA', 'MCP_TOOLS_MANAGE', 'MCP_TOOLS_WORK', 'MCP_TOOLS_V2', 'AGENT_PERFORMANCE_READ', 'EXTERNAL_AGENT_SESSIONS'];
    const saved = Object.fromEntries(FLAGS.map((flag) => [flag, process.env[flag]]));
    const set = (on) => FLAGS.forEach((flag) => { if (on.includes(flag)) process.env[flag] = 'on'; else delete process.env[flag]; });

    let tools;
    let instructions;
    let prompts;

    beforeAll(() => {
        tools = require('../../Modules/Mcp/tools');
        instructions = require('../../Modules/Mcp/instructions');
        prompts = require('../../Modules/Mcp/prompts');
    });
    afterAll(() => FLAGS.forEach((flag) => { if (saved[flag] === undefined) delete process.env[flag]; else process.env[flag] = saved[flag]; }));

    const UID = '6f0000000000000000000001';
    const personal = (scopes, grants, extra = {}) => ({
        companyId: '6f00000000000000000000c1', userId: UID, projectIds: [], canWrite: scopes.includes('write'),
        token: { _id: 't', userId: UID, scopes, ...(grants ? { grants } : {}), active: true }, ...extra,
    });
    const app = (scopes) => ({
        companyId: '6f00000000000000000000c1', userId: UID, projectIds: [], canWrite: scopes.some((scope) => scope.endsWith(':write')),
        token: { oauth: true, scopes }, oauth: { clientId: 'c', grantId: 'g', scopes },
    });
    const READS = ['tasks:read', 'projects:read', 'docs:read', 'time:read'];
    const WRITES = ['tasks:write', 'time:write'];
    const MANAGE = ['tasks:manage', 'docs:manage'];

    const CALLERS = {
        'personal, reads and writes': () => personal(['read', 'write']),
        'personal, only reads': () => personal(['read']),
        'personal, manages tasks': () => personal(['read', 'write'], ['tasks:manage']),
        'personal, writes docs': () => personal(['read', 'write'], ['docs:manage']),
        'personal, manages both': () => personal(['read', 'write'], MANAGE),
        'personal, manage grants but only reads': () => personal(['read'], MANAGE),
        'personal, kept to three reads': () => personal(['read', 'write'], MANAGE, { allowedActions: ['tasks.next', 'tasks.search', 'task.get'] }),
        'app, only reads': () => app(READS),
        'app, reads tasks only': () => app(['tasks:read']),
        'app, reads docs only': () => app(['docs:read']),
        'app, reads and writes': () => app([...READS, ...WRITES]),
        'app, manages both': () => app([...READS, ...WRITES, ...MANAGE]),
        'app, manages tasks without the plain write': () => app([...READS, 'tasks:manage']),
    };
    const subsets = (items) => items.reduce((all, item) => [...all, ...all.map((kept) => [...kept, item])], [[]]);
    const MIXES = subsets(['MCP_TOOLS_DATA', 'MCP_TOOLS_MANAGE', 'MCP_TOOLS_WORK', 'MCP_TOOLS_V2', 'AGENT_PERFORMANCE_READ']);
    const ARGUMENTS = [undefined, { project: 'Website relaunch', period: 'this week' }];

    const named = (text) => [...text.matchAll(/`([^`]+)`/g)].map((match) => match[1]);
    const outsideBackticks = (text) => text.replace(/`[^`]+`/g, ' ');
    const escaped = (name) => name.replace(/\./g, '\\.');

    /* Every text one connection can be sent, under one mix of settings. */
    const textsFor = (ctx) => [
        ['the instructions', instructions.forCaller(ctx)],
        ...prompts.list(ctx).flatMap((prompt) => ARGUMENTS.map((args) => [
            `the prompt ${prompt.name}${args ? ' with arguments' : ''}`,
            prompts.get(ctx, prompt.name, args).messages.map((message) => message.content.text).join('\n'),
        ])),
    ];

    const everyText = (visit) => MIXES.forEach((mix) => {
        set(mix);
        Object.entries(CALLERS).forEach(([who, caller]) => {
            const ctx = caller();
            textsFor(ctx).forEach(([what, text]) => visit({ where: `${what}, for ${who}, with ${mix.join(' + ') || 'no extra tools'}`, ctx, text }));
        });
    });

    it('sees the texts and the tool names in them (the scan works)', () => {
        set(['MCP_TOOLS_DATA', 'MCP_TOOLS_MANAGE', 'MCP_TOOLS_WORK', 'MCP_TOOLS_V2', 'AGENT_PERFORMANCE_READ']);
        const ctx = CALLERS['personal, manages both']();
        const texts = textsFor(ctx);
        expect(texts.length).toBe(1 + 5 * ARGUMENTS.length);
        expect(named(texts[0][1])).toEqual(expect.arrayContaining(['tasks.search', 'task.get', 'projects.list', 'screen.link']));
        texts.forEach(([, text]) => expect(named(text).length).toBeGreaterThan(1));
    });

    it('names only tools that exist', () => {
        const registered = new Set(tools.registered().map((tool) => tool.name));
        const unknown = [];
        everyText(({ where, text }) => named(text).filter((name) => !registered.has(name)).forEach((name) => unknown.push(`${name} in ${where}`)));
        expect(unknown).toEqual([]);
    });

    it('names only tools the connection lists', () => {
        const unlisted = [];
        everyText(({ where, ctx, text }) => {
            const listed = new Set(tools.manifest(ctx).map((tool) => tool.name));
            named(text).filter((name) => !listed.has(name)).forEach((name) => unlisted.push(`${name} in ${where}`));
        });
        expect(unlisted).toEqual([]);
    });

    it('names only tools the connection may run', () => {
        const refused = [];
        everyText(({ where, ctx, text }) => {
            const usable = new Set(tools.usable(ctx).map((tool) => tool.name));
            named(text).filter((name) => !usable.has(name)).forEach((name) => refused.push(`${name} in ${where}`));
        });
        expect(refused).toEqual([]);
    });

    it('writes every tool name in backticks, so none is missed above', () => {
        const all = tools.registered().map((tool) => tool.name);
        const bare = [];
        everyText(({ where, text }) => {
            const plain = outsideBackticks(text);
            all.filter((name) => new RegExp(`(^|[^\\w.])${escaped(name)}($|[^\\w])`).test(plain)).forEach((name) => bare.push(`${name} in ${where}`));
        });
        expect(bare).toEqual([]);
    });

    it('offers a prompt only when the connection may run every tool the prompt cannot do without', () => {
        const short = [];
        MIXES.forEach((mix) => {
            set(mix);
            Object.entries(CALLERS).forEach(([who, caller]) => {
                const ctx = caller();
                const usable = new Set(tools.usable(ctx).map((tool) => tool.name));
                prompts.PROMPTS.forEach((prompt) => {
                    const offered = prompts.list(ctx).some((listed) => listed.name === prompt.name);
                    const may = prompt.needs.every((name) => usable.has(name));
                    if (offered !== may) short.push(`${prompt.name} for ${who}, with ${mix.join(' + ') || 'no extra tools'}`);
                });
            });
        });
        expect(short).toEqual([]);
    });

    it('offers a connection that changes nothing only prompts that read', () => {
        set(['MCP_TOOLS_DATA', 'MCP_TOOLS_MANAGE', 'MCP_TOOLS_WORK']);
        const writing = prompts.PROMPTS.filter((prompt) => prompt.changes).map((prompt) => prompt.name);
        expect(writing).toEqual(['set_up_my_project']);
        ['personal, only reads', 'personal, manage grants but only reads', 'app, only reads', 'personal, kept to three reads'].forEach((who) => {
            expect(prompts.list(CALLERS[who]()).map((prompt) => prompt.name).filter((name) => writing.includes(name))).toEqual([]);
        });
    });
});
