jest.mock('../utils/mongo-handler/mongoQueries', () => ({ MongoDbCrudOpration: jest.fn() }));
jest.mock('../Modules/Audit/recorder', () => ({ recordAudit: jest.fn() }));
jest.mock('../event/socketEventEmitter', () => ({ emit: jest.fn() }));
jest.mock('../Modules/Tasks/helpers/taskMongo/internals.js', () => ({ updateTaskKey: jest.fn().mockResolvedValue(undefined) }));
jest.mock('../Modules/Agents/agentAudit', () => ({ recordRefusal: jest.fn(async () => 'ref-1'), recordAction: jest.fn(async () => 'act-1') }));

const registry = require('../Modules/Agents/registry');
const actions = require('../Modules/Agents/actions');
const policy = require('../Modules/Agents/policy');
const audit = require('../Modules/Agents/agentAudit');
const mcp = require('../Modules/Mcp/tools');
const { SEEDS } = require('../Modules/Agents/skills/seeds');

const safe = { write: true, reversible: true, scope: 'task', money: false };

describe('every registry action carries a complete risk rating', () => {
    it.each(registry.keys())('%s is rated on write, reversible, scope and money', (key) => {
        const r = actions.rating(key);
        expect(r).not.toBeNull();
        expect(Object.keys(r).sort()).toEqual([...actions.RATING_KEYS].sort());
        expect(typeof r.write).toBe('boolean');
        expect(typeof r.reversible).toBe('boolean');
        expect(['task', 'project', 'workspace']).toContain(r.scope);
        expect(typeof r.money).toBe('boolean');
        expect(policy.isComplete(r)).toBe(true);
    });

    it('fails the moment an action is added without a rating', () => {
        expect(actions.unrated()).toEqual([]);
        expect(actions.unrated([...registry.keys(), 'sprint.close'])).toEqual(['sprint.close']);
        expect(actions.rating('sprint.close')).toBeNull();
        expect(actions.isCompleteRating({ write: true, reversible: true, scope: 'task' })).toBe(false);
        expect(actions.isCompleteRating({ write: true, reversible: true, scope: 'company', money: false })).toBe(false);
    });

    it('rates nothing that is not in the registry', () => {
        Object.keys(actions.ratings()).forEach((key) => expect(registry.has(key)).toBe(true));
    });

    it('agrees with the registry on write and, for writes, on reversibility', () => {
        registry.ACTIONS.forEach((a) => {
            const r = actions.rating(a.key);
            expect({ key: a.key, write: r.write }).toEqual({ key: a.key, write: a.write });
            if (a.write) expect({ key: a.key, reversible: r.reversible }).toEqual({ key: a.key, reversible: a.undoable });
        });
    });

    it('every MCP tool maps to a rated action', () => {
        mcp.TOOLS.forEach((t) => expect(actions.rating(t.action)).not.toBeNull());
    });

    it('rating() hands out a copy, so a caller cannot edit the table', () => {
        const r = actions.rating('task.comment');
        r.money = true;
        expect(actions.rating('task.comment').money).toBe(false);
        expect(actions.RATINGS['task.comment'].money).toBe(false);
    });
});

describe('the never-list stays absent, unrated and refused', () => {
    const literal = registry.NEVER.filter((n) => !n.includes('*') && !n.includes('('));

    it.each(literal)('%s is not a registry action and has no rating', (key) => {
        expect(registry.has(key)).toBe(false);
        expect(actions.rating(key)).toBeNull();
        expect(actions.executors[key]).toBeUndefined();
    });

    it('no billing.* action exists', () => {
        expect(registry.keys().filter((k) => k.startsWith('billing.'))).toEqual([]);
        expect(Object.keys(actions.ratings()).filter((k) => k.startsWith('billing.'))).toEqual([]);
    });

    it.each([...literal, 'billing.refund'])('%s is refused by the policy even at L3 with a safe rating handed in', (key) => {
        const out = policy.decide({ agent: { autonomy: 3, allowedActions: [] }, action: key, rating: safe });
        expect(out.decision).toBe('refuse');
        expect(out.reason).toBe(`${key} is on the never-list`);
    });

    it('status.set("Done") is refused through task.status.set', () => {
        const out = policy.decide({ agent: { autonomy: 3 }, action: 'task.status.set', params: { status: { statusType: 'close', name: 'Done' } }, rating: actions.rating('task.status.set') });
        expect(out).toMatchObject({ decision: 'refuse', reason: 'Agents cannot perform task.status.set("Done")' });
    });
});

describe('GET /agents/registry payload — actions.manifest()', () => {
    it('adds a rating to every action and keeps the registry fields, never-list and autonomy ladder', () => {
        const m = actions.manifest();
        expect(m.actions.map((a) => a.key)).toEqual(registry.keys());
        m.actions.forEach((a) => {
            expect(policy.isComplete(a.rating)).toBe(true);
            expect(a).toMatchObject({ label: registry.get(a.key).label, risk: registry.get(a.key).risk, write: registry.get(a.key).write });
        });
        expect(m.never).toEqual([...registry.NEVER]);
        expect(m.autonomy).toEqual(registry.manifest().autonomy);
        expect(m.ratingKeys).toEqual(['write', 'reversible', 'scope', 'money']);
        expect(m.scopes).toEqual(['task', 'project', 'workspace']);
    });

    it('rates the writes L2 acts on as reversible task-scoped, and the ones it proposes as wider or irreversible', () => {
        expect(actions.rating('subtask.create')).toEqual(safe);
        expect(actions.rating('task.comment')).toEqual(safe);
        expect(actions.rating('task.create')).toMatchObject({ write: true, scope: 'project' });
        expect(actions.rating('task.sprint.move')).toMatchObject({ write: true, scope: 'project' });
        expect(actions.rating('chat.post')).toMatchObject({ write: true, reversible: false });
        expect(actions.rating('deploy.staging')).toMatchObject({ write: true, reversible: false, scope: 'workspace' });
        expect(actions.rating('task.get')).toMatchObject({ write: false });
    });
});

describe('perform() honours a policy refusal', () => {
    beforeEach(() => jest.clearAllMocks());

    it('audits the policy reason and throws RefusedError without touching the registry or an executor', async () => {
        const actor = { kind: 'agent', userId: 'u1', agentId: 'a1' };
        const decision = { decision: 'refuse', reason: 'project p9 is outside this agent\'s projects', rating: safe };
        await expect(actions.perform({ companyId: 'c1', actor, action: 'task.comment', params: { taskId: 't1', body: 'x' }, decision }))
            .rejects.toMatchObject({ name: 'RefusedError', status: 403, message: decision.reason, auditId: 'ref-1' });
        expect(audit.recordRefusal).toHaveBeenCalledWith('c1', actor, expect.objectContaining({ action: 'task.comment', reason: decision.reason, entityId: 't1' }));
        expect(audit.recordAction).not.toHaveBeenCalled();
    });

    it('an act decision changes nothing — the registry still has the final say', async () => {
        const actor = { kind: 'agent', userId: 'u1', agentId: 'a1' };
        await expect(actions.perform({ companyId: 'c1', actor, action: 'task.comment', params: { taskId: 't1' }, allowedActions: ['task.get'], decision: { decision: 'act', reason: 'x' } }))
            .rejects.toMatchObject({ name: 'RefusedError', message: 'Agents cannot perform task.comment (not in this agent\'s skills)' });
        await expect(actions.perform({ companyId: 'c1', actor, action: 'project.delete', params: {}, decision: { decision: 'act', reason: 'x' } }))
            .rejects.toMatchObject({ name: 'RefusedError', message: 'Agents cannot perform project.delete (never_listed)' });
    });
});

/* digest.ceo and project.guide ship as documents, so the actions they emit are
 * data. Each one is put through the policy here, for an agent that names the
 * project and for one with no scope at all. */
describe('the skills that ship as data, run through the policy', () => {
    const agent = (over = {}) => ({ autonomy: 2, allowedActions: [], projectIds: ['p1'], ...over });
    const task = { _id: 't1', ProjectID: 'p1' };
    const emitted = (seed) => [...new Set(seed.emit.map((e) => e.action))];
    const verdict = (seed, over = {}) => emitted(seed).map((action) => ({
        action,
        ...policy.decide({ agent: agent(), action, params: { taskId: 't1' }, rating: actions.rating(action), task, ...over }),
    }));
    const skills = [['digest.ceo', SEEDS.digest], ['project.guide', SEEDS.projectGuide]];

    it.each(skills)('%s emits only rated registry writes', (key, seed) => {
        expect(emitted(seed).length).toBeGreaterThan(0);
        emitted(seed).forEach((action) => {
            expect(registry.has(action)).toBe(true);
            expect(policy.isComplete(actions.rating(action))).toBe(true);
        });
    });

    it.each(skills)('%s still acts in a project its agent is scoped to', (key, seed) => {
        verdict(seed).forEach((out) => expect(out).toMatchObject({ decision: 'act' }));
    });

    it.each(skills)('%s is refused outside its agent\'s projects', (key, seed) => {
        verdict(seed, { agent: agent({ projectIds: ['p2'] }) })
            .forEach((out) => expect(out).toMatchObject({ decision: 'refuse', reason: "project p1 is outside this agent's projects" }));
    });

    it.each(skills)('%s writes nowhere when its agent has no project scope', (key, seed) => {
        verdict(seed, { agent: agent({ projectIds: [] }) })
            .forEach((out) => expect(out).toMatchObject({ decision: 'refuse', reason: `${out.action} writes, and this agent has no project scope` }));
    });
});
