const { FLAGS: DEFAULT_ON } = require('./fixtures/mcpFlagsOff');
jest.mock('../utils/mongo-handler/mongoQueries', () => ({ MongoDbCrudOpration: jest.fn() }));
jest.mock('../Modules/Audit/recorder', () => ({ recordAudit: jest.fn() }));
jest.mock('../event/socketEventEmitter', () => ({ emit: jest.fn() }));
jest.mock('../Modules/Agents/agentAudit', () => ({ recordRefusal: jest.fn(), recordAction: jest.fn() }));

const crypto = require('crypto');
const registry = require('../Modules/Agents/registry');
const actions = require('../Modules/Agents/actions');
const PINNED = require('./fixtures/agentRegistry.allFlags.json');

const FLAGS = {
    AGENT_PERFORMANCE_READ: { AGENT_PERFORMANCE_READ: 'on' },
    MCP_TOOLS_DATA: { MCP_TOOLS_DATA: 'on' },
    MCP_TOOLS_MANAGE: { MCP_TOOLS_MANAGE: 'on' },
    MCP_TOOLS_WORK: { MCP_TOOLS_WORK: 'on' },
    CONNECTORS: { CONNECTORS: 'slack', SECRETS_STORE: 'true', SECRETS_KEY: crypto.randomBytes(24).toString('hex'), AGENT_TAINT_ROUTING: 'on' },
};
const EVERY_FLAG = Object.assign({}, ...Object.values(FLAGS));

const withEnv = (env, read) => {
    const names = Object.keys(EVERY_FLAG);
    const before = Object.fromEntries(names.map((name) => [name, process.env[name]]));
    names.forEach((name) => { delete process.env[name]; });
    DEFAULT_ON.forEach((name) => { process.env[name] = 'off'; });
    Object.assign(process.env, env);
    try {
        return read();
    } finally {
        names.forEach((name) => { if (before[name] === undefined) delete process.env[name]; else process.env[name] = before[name]; });
    }
};

const capture = () => JSON.parse(JSON.stringify({
    actions: withEnv(EVERY_FLAG, () => registry.manifest().actions),
    ratings: withEnv(EVERY_FLAG, () => Object.entries(actions.ratings())),
    unflagged: withEnv({}, () => registry.keys()),
    byFlag: Object.fromEntries(Object.entries(FLAGS).map(([flag, env]) => [flag, withEnv(env, () => registry.keys())])),
}));

/* The fixture was written before the list was split into one file per group. A group added
 * later is not in it and needs no line in it: only the pinned actions are compared. */
const pinnedKeys = new Set(PINNED.actions.map((a) => a.key));
const isPinned = (key) => pinnedKeys.has(key);
const pinnedOnly = (captured) => ({
    actions: captured.actions.filter((a) => isPinned(a.key)),
    ratings: captured.ratings.filter(([key]) => isPinned(key)),
    unflagged: captured.unflagged.filter(isPinned),
    byFlag: Object.fromEntries(Object.entries(captured.byFlag).map(([flag, keys]) => [flag, keys.filter(isPinned)])),
});

describe('the agent registry, split into one file per group', () => {
    const now = pinnedOnly(capture());

    it('holds every pinned action with the same fields, in the same order', () => {
        expect(now.actions).toEqual(PINNED.actions);
    });

    it('rates every pinned action the same, in the same order', () => {
        expect(now.ratings).toEqual(PINNED.ratings);
    });

    it('registers each pinned action under the same flag', () => {
        expect(now.unflagged).toEqual(PINNED.unflagged);
        expect(now.byFlag).toEqual(PINNED.byFlag);
    });

    it('exports what it exported before', () => {
        expect(Object.keys(registry)).toEqual(expect.arrayContaining(PINNED.exports.registry));
        expect(Object.keys(actions)).toEqual(expect.arrayContaining(PINNED.exports.actions));
    });
});
