require('./fixtures/mcpFlagsOff');
jest.mock('../utils/mongo-handler/mongoQueries', () => ({ MongoDbCrudOpration: jest.fn(async () => null) }));
jest.mock('../Config/loggerConfig', () => ({ error: jest.fn(), info: jest.fn(), warn: jest.fn() }));

const logger = require('../Config/loggerConfig');
const flag = require('../Modules/Agents/connectors/flag');
const registry = require('../Modules/Agents/registry');
const actions = require('../Modules/Agents/actions');
const policy = require('../Modules/Agents/policy');

const ACTION = 'slack.message.post';
const KEYS = ['CONNECTORS', 'SECRETS_STORE', 'SECRETS_KEY', 'AGENT_TAINT_ROUTING'];
const READY = { CONNECTORS: 'slack', SECRETS_STORE: 'true', SECRETS_KEY: 'k'.repeat(40), AGENT_TAINT_ROUTING: 'on' };

const withEnv = (env, fn) => {
    const before = Object.fromEntries(KEYS.map((k) => [k, process.env[k]]));
    KEYS.forEach((k) => { if (env[k] === undefined) delete process.env[k]; else process.env[k] = env[k]; });
    try { return fn(); } finally { KEYS.forEach((k) => { if (before[k] === undefined) delete process.env[k]; else process.env[k] = before[k]; }); }
};

beforeEach(() => { logger.error.mockClear(); logger.info.mockClear(); });

describe('the CONNECTORS flag', () => {
    it('is off by default: nothing is requested and the action does not exist', () => withEnv({}, () => {
        expect(flag.status('slack')).toEqual({ requested: false, on: false, problems: [] });
        expect(registry.has(ACTION)).toBe(false);
        expect(registry.keys()).not.toContain(ACTION);
        expect(actions.rating(ACTION)).toBeNull();
        flag.logBootState();
        expect(logger.error).not.toHaveBeenCalled();
        expect(logger.info).not.toHaveBeenCalled();
    }));

    it.each(['off', 'false', '', '  '])('reads "%s" as off', (value) => withEnv({ ...READY, CONNECTORS: value }, () => {
        expect(flag.requested()).toEqual([]);
        expect(flag.slackOn()).toBe(false);
    }));

    it('switches Slack on when the secrets store and taint routing are on', () => withEnv(READY, () => {
        expect(flag.status('slack')).toEqual({ requested: true, on: true, problems: [] });
        expect(registry.has(ACTION)).toBe(true);
        flag.logBootState();
        expect(logger.error).not.toHaveBeenCalled();
        expect(logger.info).toHaveBeenCalledWith(expect.stringContaining('slack'));
    }));

    it.each([
        ['the secrets store off', { SECRETS_STORE: undefined }, ['secrets_store_off'], 'SECRETS_STORE'],
        ['no key', { SECRETS_KEY: undefined }, ['secrets_key_invalid'], 'SECRETS_KEY'],
        ['a short key', { SECRETS_KEY: 'short' }, ['secrets_key_invalid'], 'SECRETS_KEY'],
        ['taint routing off', { AGENT_TAINT_ROUTING: undefined }, ['taint_routing_off'], 'AGENT_TAINT_ROUTING'],
        ['neither', { SECRETS_STORE: undefined, AGENT_TAINT_ROUTING: 'off' }, ['secrets_store_off', 'taint_routing_off'], 'AGENT_TAINT_ROUTING'],
    ])('refuses to switch on with %s, and says why at startup', (label, change, codes, named) => withEnv({ ...READY, ...change }, () => {
        const status = flag.status('slack');
        expect(status.requested).toBe(true);
        expect(status.on).toBe(false);
        expect(status.problems.map((p) => p.code)).toEqual(codes);
        expect(registry.has(ACTION)).toBe(false);
        expect(actions.rating(ACTION)).toBeNull();
        flag.logBootState();
        expect(logger.error).toHaveBeenCalledTimes(1);
        expect(logger.error.mock.calls[0][0]).toContain('slack');
        expect(logger.error.mock.calls[0][0]).toContain(named);
        expect(logger.info).not.toHaveBeenCalled();
    }));

    it('names a connector this build does not have, and switches nothing on for it', () => withEnv({ ...READY, CONNECTORS: 'slack, teleport' }, () => {
        expect(flag.requested()).toEqual(['slack']);
        flag.logBootState();
        expect(logger.error).toHaveBeenCalledWith(expect.stringContaining('teleport'));
    }));
});

describe('slack.message.post is propose-only', () => {
    const agent = (autonomy) => ({ autonomy, projectIds: ['p1'], allowedActions: [] });
    const params = { channelId: 'C012345678', text: 'Release is out.', projectId: 'p1' };

    it('is a gated, irreversible, workspace-wide write', () => withEnv(READY, () => {
        const entry = registry.get(ACTION);
        expect(entry).toMatchObject({ write: true, undoable: false, proposeOnly: true, gate: 'owner_admin' });
        expect(actions.rating(ACTION)).toEqual({ write: true, reversible: false, scope: 'workspace', money: false });
        expect(actions.unrated()).toEqual([]);
        expect(registry.mayActDirectly(3, ACTION)).toBe(false);
    }));

    it('is refused when called directly and allowed only inside a proposal', () => withEnv(READY, () => {
        expect(registry.evaluate(ACTION, params).allowed).toBe(false);
        expect(registry.evaluate(ACTION, { ...params, __proposal: true }).allowed).toBe(true);
    }));

    it.each([0, 1, 2, 3])('is proposed at autonomy L%s, tainted or not', (autonomy) => withEnv(READY, () => {
        const rating = actions.rating(ACTION);
        const clean = policy.decide({ agent: agent(autonomy), action: ACTION, params, rating, run: { projectId: 'p1' } });
        const tainted = policy.decide({ agent: agent(autonomy), action: ACTION, params, rating, run: { projectId: 'p1', tainted: true, taintSources: [{ kind: 'fetch', ref: 'example.com' }] } });
        expect(clean.decision).toBe(policy.DECISION.PROPOSE);
        expect(tainted.decision).toBe(policy.DECISION.PROPOSE);
    }));
});
