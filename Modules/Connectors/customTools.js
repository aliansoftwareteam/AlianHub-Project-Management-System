const argsSchema = require('../Mcp/argsSchema');
const customFlag = require('./customFlag');

/* A custom server belongs to one workspace and its tools are known only at run time, so none is registered on its
 * own. Three tools are registered once instead, like any connector tool: one lists what this workspace's reviewers
 * turned on, and two run one such tool, a read or a write, on the caller's own connection to its server. A model
 * only ever sees the words a reviewer accepted, never what a server says about itself (FR-45). */

const PROVIDER = 'custom';
const KIND = Object.freeze({ READ: 'read', WRITE: 'write' });
const ARGUMENTS_MAX = 16000;
const SERVER_ID = /^(?:custom_)?([a-f0-9]{24})$/;

const DEFINITION = Object.freeze({ id: PROVIDER, name: 'custom app', egressHosts: Object.freeze([]), products: Object.freeze({}) });

const refusal = (code, message) => Object.assign(new Error(`${code}: ${message}`), { code, deterministic: true });

const callInput = (description) => Object.freeze({
    type: 'object',
    additionalProperties: false,
    description,
    properties: {
        server: { type: 'string', maxLength: 64, description: 'The app, as custom.tools.list names it.' },
        tool: { type: 'string', maxLength: 128, description: 'The tool, as custom.tools.list names it.' },
        arguments: { type: 'object', description: 'What the tool takes, as custom.tools.list describes it. Leave out when it takes nothing.' },
    },
    required: ['server', 'tool'],
});

const review = () => require('./customReview');
const servers = () => require('./customServers');

const accessWords = (access) => (access === KIND.READ ? 'reads only: call it with custom.tool.read' : 'changes things in the app: call it with custom.tool.write, and it waits for your approval');

const listing = async ({ companyId, userId }) => {
    const offered = await review().offeredTools(companyId);
    if (!offered.length) return 'No custom app tools are turned on in this workspace.';
    const connection = require('./connection');
    const blocks = [];
    for (const { definition, tools } of offered) {
        // eslint-disable-next-line no-await-in-loop
        const mine = await connection.describe(String(companyId), String(userId), definition.id);
        const state = mine.connected && mine.status === 'connected' ? 'you are connected' : 'you are not connected: connect it on the Connectors screen before using it';
        blocks.push([
            `App "${definition.name}" (server: ${definition.serverId}), ${state}.`,
            ...tools.map((row) => [
                `- tool: ${row.tool}. ${row.label}. It ${accessWords(row.access)}.`,
                ...(row.description ? [`  ${row.description}`] : []),
                `  It takes: ${JSON.stringify(row.inputSchema || { type: 'object', properties: {} })}`,
            ].join('\n')),
        ].join('\n'));
    }
    return blocks.join('\n\n');
};

/* One call of a reviewed tool: the app and the tool are found in this workspace, the tool must be on, reviewed as
 * this kind and still described as reviewed, and the arguments must fit what was reviewed. The answer stands in for
 * a catalog tool from here on, so the runner's connection, caps, quotas, taint and audit all apply unchanged. */
const bindFor = (generic) => async ({ companyId, input }) => {
    const id = (SERVER_ID.exec(String(input.server || '')) || [])[1] || '';
    const row = id ? await servers().findRow(companyId, id) : null;
    if (!row || row.status !== servers().STATUS.ACTIVE) throw refusal('tool_off', 'There is no such custom app in this workspace. Use custom.tools.list to see the apps you can use.');
    const definition = servers().definitionOf(row);
    const reviewed = await review().reviewedTool(companyId, definition.id, input.tool);
    if (!reviewed) throw refusal('tool_off', `${definition.name} has no tool by that name that is turned on. Use custom.tools.list to see what you can use.`);
    if (reviewed.access !== generic.kind) {
        throw refusal('tool_off', reviewed.access === KIND.READ ? `${reviewed.tool} only reads, so call it with custom.tool.read.` : `${reviewed.tool} changes things in ${definition.name}, so call it with custom.tool.write.`);
    }
    const args = input.arguments === undefined ? {} : input.arguments;
    if (JSON.stringify(args).length > ARGUMENTS_MAX) throw refusal('bad_input', `What you send to ${reviewed.tool} is too long.`);
    const problem = argsSchema.problemIn(reviewed.inputSchema || { type: 'object', properties: {} }, args);
    if (problem) throw refusal('bad_input', `${reviewed.tool}: ${problem}`);
    const tool = Object.freeze({
        ...generic,
        provider: definition.id,
        definition,
        mcp: Object.freeze({ tool: reviewed.tool, shape: reviewed.reviewedShape }),
        run: async ({ connection }) => connection.mcp(reviewed.tool, args),
        ...(generic.kind === KIND.WRITE ? {
            card: () => ({
                target: definition.name,
                title: reviewed.label,
                text: JSON.stringify(args, null, 2),
                rows: [{ label: 'Connectors.card.customTool', value: reviewed.tool }],
            }),
        } : {}),
    });
    return { tool, args: { server: definition.serverId, tool: reviewed.tool, arguments: args } };
};

const common = Object.freeze({ provider: PROVIDER, definition: DEFINITION, custom: true, product: 'server' });

const LIST = Object.freeze({
    ...common,
    key: 'custom.tools.list',
    label: 'Connectors.tool.customToolsList',
    kind: KIND.READ,
    local: true,
    input: Object.freeze({
        type: 'object',
        additionalProperties: false,
        description: 'List the custom apps this workspace added and the tools on them that were checked and turned on, with what each one takes and whether it reads or changes things. Use it before calling one.',
        properties: {},
    }),
    mcpDescription: 'List the custom apps this workspace added and the tools on them that were checked and turned on, with what each one takes and whether it reads or changes things. Use it before custom.tool.read or custom.tool.write.',
    caps: Object.freeze({ maxItems: 100, maxChars: 12000 }),
    list: listing,
});

const READ = Object.freeze({
    ...common,
    key: 'custom.tool.read',
    label: 'Connectors.tool.customToolRead',
    kind: KIND.READ,
    input: callInput('Run a tool of a custom app that only reads, on your own connection to that app. Name the app and the tool as custom.tools.list gives them, with what the tool takes.'),
    caps: Object.freeze({ maxItems: 50, maxChars: 8000 }),
});

const WRITE = Object.freeze({
    ...common,
    key: 'custom.tool.write',
    label: 'Connectors.tool.customToolWrite',
    kind: KIND.WRITE,
    input: callInput('Run a tool of a custom app that changes things there, on your own connection to that app. Name the app and the tool as custom.tools.list gives them, with what the tool takes.'),
    caps: Object.freeze({ maxItems: 50, maxChars: 4000 }),
});

const TOOLS = Object.freeze([LIST, Object.freeze({ ...READ, bind: bindFor(READ) }), Object.freeze({ ...WRITE, bind: bindFor(WRITE) })]);

const isOn = () => customFlag.on();

module.exports = { PROVIDER, TOOLS, isOn };
