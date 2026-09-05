const policy = require('../Modules/Agents/policy');
const registry = require('../Modules/Agents/registry');

const safe = { write: true, reversible: true, scope: 'task', money: false };
const read = { write: false, reversible: true, scope: 'task', money: false };
const task = { _id: 't1', ProjectID: 'p1' };
const run = { _id: 'r1', projectId: 'p1' };
const agent = (over = {}) => ({ autonomy: 2, allowedActions: [], projectIds: [], ...over });
const decide = (over = {}) => policy.decide({ agent: agent(), action: 'task.comment', params: { taskId: 't1' }, rating: safe, run, task, ...over });

describe('rule 1 — never-list and unknown actions are refused at every level', () => {
    it.each([0, 1, 2, 3])('L%i refuses project.delete with the never-list reason', (autonomy) => {
        expect(decide({ agent: agent({ autonomy }), action: 'project.delete' })).toEqual({ decision: 'refuse', reason: 'project.delete is on the never-list', rating: safe });
    });

    it('matches the billing.* wildcard', () => {
        expect(policy.isNever('billing.refund')).toBe(true);
        expect(policy.isNever('billing')).toBe(false);
        expect(decide({ action: 'billing.charge' }).reason).toBe('billing.charge is on the never-list');
    });

    it('refuses an action the registry does not know, and an empty one', () => {
        expect(decide({ action: 'sprint.close' })).toMatchObject({ decision: 'refuse', reason: 'sprint.close is not a registry action' });
        expect(decide({ action: '' })).toMatchObject({ decision: 'refuse', reason: '(unknown action) is not a registry action' });
    });

    it('refuses a Done status through the registry check', () => {
        const out = decide({ action: 'task.status.set', params: { taskId: 't1', status: { statusType: 'close', name: 'Done' } } });
        expect(out).toMatchObject({ decision: 'refuse', reason: 'Agents cannot perform task.status.set("Done")' });
    });

    it('refuses a task.update on a field outside the allowed list', () => {
        const out = decide({ action: 'task.update', params: { taskId: 't1', fields: { AssigneeUserId: ['u2'] } } });
        expect(out).toMatchObject({ decision: 'refuse', reason: 'Agents cannot perform task.update on AssigneeUserId' });
    });
});

describe('rule 2 — outside allowedActions is refused', () => {
    it('refuses with the action named when the agent has a list and this is not on it', () => {
        expect(decide({ agent: agent({ allowedActions: ['task.get', 'subtask.create'] }) })).toEqual({ decision: 'refuse', reason: 'task.comment is outside this agent\'s allowed actions', rating: safe });
    });

    it('an empty list means no restriction, and a listed action passes', () => {
        expect(decide({ agent: agent({ allowedActions: [] }) }).decision).toBe('act');
        expect(decide({ agent: agent({ allowedActions: ['task.comment'] }) }).decision).toBe('act');
    });
});

describe('rule 3 — outside the agent\'s projects is refused', () => {
    it('refuses when the task\'s project is not in projectIds', () => {
        expect(decide({ agent: agent({ projectIds: ['p2'] }) })).toEqual({ decision: 'refuse', reason: 'project p1 is outside this agent\'s projects', rating: safe });
    });

    it('takes the project from params first, then the task, then the run', () => {
        expect(decide({ agent: agent({ projectIds: ['p2'] }), action: 'task.create', params: { projectId: 'p2', title: 'x' } }).decision).toBe('act');
        expect(decide({ agent: agent({ projectIds: ['p1'] }), task: null }).decision).toBe('act');
        expect(decide({ agent: agent({ projectIds: ['p3'] }), task: null, run: null }).reason).toBe('project (none) is outside this agent\'s projects');
    });

    it('an agent without projectIds may work anywhere', () => {
        expect(decide({ agent: agent({ projectIds: undefined }) }).decision).toBe('act');
    });
});

describe('rule 4 — a missing or incomplete rating is refused', () => {
    it.each([null, undefined, {}, { write: true, reversible: true, scope: 'task' }, { write: true, reversible: true, scope: 'company', money: false }])('%p is refused', (rating) => {
        expect(decide({ rating })).toEqual({ decision: 'refuse', reason: 'task.comment has no risk rating', rating: null });
    });
});

describe('rule 5 — below L2 every write is proposed, reads act', () => {
    it.each([0, 1])('L%i proposes a safe write with the level in the reason', (autonomy) => {
        expect(decide({ agent: agent({ autonomy }) })).toEqual({ decision: 'propose', reason: `autonomy L${autonomy} proposes every write`, rating: safe });
    });

    it.each([0, 1, 2, 3])('L%i acts on a read', (autonomy) => {
        expect(decide({ agent: agent({ autonomy }), action: 'task.get', rating: read })).toEqual({ decision: 'act', reason: 'task.get only reads', rating: read });
    });

    it('treats a missing or non-numeric autonomy as L0', () => {
        expect(decide({ agent: agent({ autonomy: undefined }) }).reason).toBe('autonomy L0 proposes every write');
        expect(decide({ agent: agent({ autonomy: 'high' }) }).reason).toBe('autonomy L0 proposes every write');
    });
});

describe('rule 6 — L2 acts on a reversible task-scoped write with no money, proposes the rest', () => {
    it('acts on the safe case with a reason a person can check', () => {
        expect(decide()).toEqual({ decision: 'act', reason: 'task.comment is a reversible task-scoped write with no money in it', rating: safe });
    });

    it('proposes an irreversible write', () => {
        expect(decide({ action: 'chat.post', rating: { ...safe, reversible: false } })).toMatchObject({ decision: 'propose', reason: 'chat.post cannot be undone' });
    });

    it.each(['project', 'workspace'])('proposes a write that reaches the whole %s', (scope) => {
        expect(decide({ action: 'task.create', params: { projectId: 'p1', title: 'x' }, rating: { ...safe, scope } })).toMatchObject({ decision: 'propose', reason: `task.create reaches the whole ${scope}` });
    });

    it('proposes a write that touches money', () => {
        expect(decide({ rating: { ...safe, money: true } })).toMatchObject({ decision: 'propose', reason: 'task.comment touches money' });
    });

    it('lists every escalation when several apply', () => {
        expect(decide({ rating: { write: true, reversible: false, scope: 'workspace', money: true } }).reason).toBe('task.comment cannot be undone, reaches the whole workspace, touches money');
    });

    it('proposes a propose-only, gated action even with a safe rating', () => {
        expect(registry.get('deploy.staging')).toMatchObject({ proposeOnly: true, gate: 'owner_admin' });
        expect(decide({ action: 'deploy.staging', rating: safe })).toMatchObject({ decision: 'propose', reason: 'deploy.staging must be proposed to an owner or admin' });
    });

    it('L3 decides exactly as L2 for now', () => {
        const cases = [
            { action: 'task.comment', rating: safe },
            { action: 'chat.post', rating: { ...safe, reversible: false } },
            { action: 'task.create', params: { projectId: 'p1', title: 'x' }, rating: { ...safe, scope: 'project' } },
            { action: 'task.comment', rating: { ...safe, money: true } },
            { action: 'deploy.staging', rating: safe },
            { action: 'task.get', rating: read },
        ];
        cases.forEach((c) => expect(decide({ ...c, agent: agent({ autonomy: 3 }) })).toEqual(decide({ ...c, agent: agent({ autonomy: 2 }) })));
    });
});

describe('the decision is deterministic and never mutates its inputs', () => {
    it('returns the same object for the same inputs, with a copy of the rating', () => {
        const first = decide();
        const second = decide();
        expect(first).toEqual(second);
        first.rating.money = true;
        expect(decide().rating.money).toBe(false);
        expect(safe.money).toBe(false);
    });

    it('checks the rules in order: never-list before allowedActions before projects before rating', () => {
        const strict = agent({ allowedActions: ['task.get'], projectIds: ['p9'] });
        expect(decide({ agent: strict, action: 'task.delete', rating: null }).reason).toBe('task.delete is on the never-list');
        expect(decide({ agent: strict, rating: null }).reason).toBe('task.comment is outside this agent\'s allowed actions');
        expect(decide({ agent: agent({ projectIds: ['p9'] }), rating: null }).reason).toBe('project p1 is outside this agent\'s projects');
        expect(decide({ rating: null }).reason).toBe('task.comment has no risk rating');
    });
});
