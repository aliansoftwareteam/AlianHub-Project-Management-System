jest.mock('../utils/mongo-handler/mongoQueries', () => ({ MongoDbCrudOpration: jest.fn() }));

const hop = require('../Modules/Workflows/hop');
const typed = require('../Modules/Workflows/typed');

// Task 028 sprint 5 step 4. The two pure halves of the slice: what a hop is
// allowed to take out of the run, and whether a step's result is the shape its
// contract promised. The engine wiring around them is proved against real Mongo
// in tests/integration/workflow-hop.int.test.js.

const ENV_KEYS = ['WORKFLOW_RUN_DEADLINE_MS', 'WORKFLOW_RUN_BUDGET_USD'];
const saved = {};

const step = (over = {}) => ({ runId: 'r1', stepId: 's1', type: 'wait', status: 'pending', dependsOn: [], config: {}, ...over });

beforeAll(() => { ENV_KEYS.forEach((k) => { saved[k] = process.env[k]; }); });
beforeEach(() => { ENV_KEYS.forEach((k) => delete process.env[k]); });
afterAll(() => { ENV_KEYS.forEach((k) => { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; }); });

describe('the per-hop deadline and budget', () => {
    it('lets a step through when the run is unbounded', () => {
        const permit = hop.allow({ _id: 'r1' }, [step()], step());
        expect(permit.ok).toBe(true);
        expect(permit.grant).toEqual({ deadlineAt: null, budgetUsd: null });
    });

    it('hands on what is left rather than what the run started with', () => {
        const run = { _id: 'r1', budgetUsd: 10, spentUsd: 6.5, deadlineAt: new Date(Date.now() + 60000) };
        const permit = hop.allow(run, [step()], step());
        expect(permit.grant.budgetUsd).toBeCloseTo(3.5, 6);
        expect(permit.grant.deadlineAt.getTime()).toBeLessThanOrEqual(run.deadlineAt.getTime());
    });

    it('gives a step the smaller of what it asked for and what remains', () => {
        const run = { _id: 'r1', budgetUsd: 10, spentUsd: 6 };
        expect(hop.allow(run, [step()], step({ config: { budgetUsd: 1 } })).grant.budgetUsd).toBe(1);
    });

    it('refuses a step that would outspend what is left, naming both numbers', () => {
        const run = { _id: 'r1', budgetUsd: 10, spentUsd: 9 };
        const permit = hop.allow(run, [step()], step({ config: { budgetUsd: 5 } }));
        expect(permit.ok).toBe(false);
        expect(permit.code).toBe(hop.BUDGET_EXHAUSTED);
        expect(permit.reason).toContain('$5.00');
        expect(permit.reason).toContain('$1.00');
    });

    it('refuses every step once the budget is spent', () => {
        const permit = hop.allow({ _id: 'r1', budgetUsd: 4, spentUsd: 4 }, [step()], step());
        expect(permit).toMatchObject({ ok: false, code: hop.BUDGET_EXHAUSTED });
        expect(permit.reason).toContain('is spent');
    });

    it('refuses a step that would outlive the deadline, and one after it has passed', () => {
        const soon = { _id: 'r1', deadlineAt: new Date(Date.now() + 5000) };
        expect(hop.allow(soon, [step()], step({ config: { deadlineMs: 60000 } }))).toMatchObject({ ok: false, code: hop.DEADLINE_EXCEEDED });
        const gone = { _id: 'r1', deadlineAt: new Date(Date.now() - 5000) };
        expect(hop.allow(gone, [step()], step())).toMatchObject({ ok: false, code: hop.DEADLINE_EXCEEDED });
    });

    it('takes the workspace ceiling when it is tighter than the ask', () => {
        process.env.WORKFLOW_RUN_BUDGET_USD = '2';
        process.env.WORKFLOW_RUN_DEADLINE_MS = '1000';
        const bounds = hop.ceilingFor({ budgetUsd: 50, deadlineMs: 60000 });
        expect(bounds.budgetUsd).toBe(2);
        expect(bounds.deadlineAt.getTime()).toBeLessThanOrEqual(Date.now() + 1000);
    });

    it('reads a cost off whichever shape a step reported it in', () => {
        expect(hop.costOf({ costUsd: 1.5 })).toBe(1.5);
        expect(hop.costOf({ spend: { usd: 2 } })).toBe(2);
        expect(hop.costOf({})).toBe(0);
        expect(hop.costOf(null)).toBe(0);
    });
});

describe('the depth guard on workflow re-entry', () => {
    const body = [
        step({ stepId: 'sLoop', type: 'loop', config: { body: ['sFan'] } }),
        step({ stepId: 'sFan', type: 'fan_out', config: { type: 'agent_run' } }),
        step({ stepId: 'sFan#1', type: 'agent_run', parentStepId: 'sFan' }),
    ];

    it('counts a loop body and a fan-out child as re-entry, and nests them', () => {
        const nesting = hop.nestingOf(body);
        expect(nesting.get('sLoop')).toBe(0);
        expect(nesting.get('sFan')).toBe(1);
        expect(nesting.get('sFan#1')).toBe(2);
    });

    it('adds the depth the run inherited to the nesting inside it', () => {
        expect(hop.depthOf({ depth: 1 }, body, body[2])).toBe(3);
    });

    it('refuses a hop past the guard with the same code the agents module uses', () => {
        const permit = hop.allow({ _id: 'r1', depth: 1 }, body, body[2]);
        expect(permit.ok).toBe(false);
        expect(permit.code).toBe(hop.LOOP_DEPTH_EXCEEDED);
        expect(permit.reason).toContain(String(hop.MAX_DEPTH));
    });

    it('allows the same hop when the run did not start deep', () => {
        expect(hop.allow({ _id: 'r1', depth: 0 }, body, body[2]).ok).toBe(true);
    });

    it('does not let a cycle in the graph loop forever', () => {
        const cycle = [
            step({ stepId: 'a', type: 'loop', config: { body: ['b'] } }),
            step({ stepId: 'b', type: 'loop', config: { body: ['a'] } }),
        ];
        expect(hop.nestingOf(cycle).get('a')).toBe(2);
    });
});

describe('the typed result at each edge', () => {
    it('accepts an output that honours its contract', () => {
        expect(typed.checkOutput('fan_in', { total: 2, succeeded: 2, failed: 0, results: [] })).toEqual({ valid: true, errors: [] });
    });

    it('names the field whose type is wrong', () => {
        const { valid, errors } = typed.checkOutput('agent_run', { status: 'done', costUsd: '1.20', findings: [] });
        expect(valid).toBe(false);
        expect(errors[0]).toContain('"costUsd"');
        expect(errors[0]).toContain('number');
        expect(errors[0]).toContain('string');
    });

    it('names the field a step promised and did not produce', () => {
        const { errors } = typed.checkOutput('condition', { matched: true, taken: [] });
        expect(errors).toEqual(['"skipped" is required by the condition contract and the step produced none']);
    });

    it('says nothing about a step type with no contract', () => {
        expect(typed.checkOutput('automation_rule', { anything: 1 })).toEqual({ valid: true, errors: [] });
    });

    it('throws a deterministic error naming the step and the field', () => {
        expect(() => typed.assertOutput({ stepId: 's2', type: 'condition' }, { matched: 'yes', taken: [], skipped: [] }))
            .toThrow(/step s2 \(condition\).*"matched"/);
        try { typed.assertOutput({ stepId: 's2', type: 'condition' }, {}); } catch (error) {
            expect(error.deterministic).toBe(true);
            expect(error.name).toBe('DeterministicError');
        }
    });

    it('refuses a step reading a field its producer does not declare', () => {
        const steps = [
            step({ stepId: 'sA', type: 'fan_in', status: 'success', output: { total: 1, succeeded: 1, failed: 0, results: [] } }),
            step({ stepId: 'sB', type: 'condition', config: { when: { op: 'eq', args: [{ field: '$sA.winner' }, { value: 1 }] } } }),
        ];
        const { valid, errors } = typed.checkInputs(steps[1], steps);
        expect(valid).toBe(false);
        expect(errors[0]).toContain('"$sA.winner"');
        expect(errors[0]).toContain('a fan_in step produces no "winner"');
    });

    it('accepts a reference to a field the producer does declare', () => {
        const steps = [
            step({ stepId: 'sA', type: 'fan_in', status: 'success', output: { total: 1, succeeded: 1, failed: 0, results: [] } }),
            step({ stepId: 'sB', type: 'condition', config: { when: { op: 'eq', args: [{ field: '$sA.total' }, { value: 1 }] } } }),
        ];
        expect(typed.checkInputs(steps[1], steps)).toEqual({ valid: true, errors: [] });
    });

    it('says nothing about a producer that has not run yet', () => {
        const steps = [
            step({ stepId: 'sA', type: 'agent_run', status: 'pending' }),
            step({ stepId: 'sB', type: 'condition', config: { when: { op: 'eq', args: [{ field: '$sA.costUsd' }, { value: 0 }] } } }),
        ];
        expect(typed.checkInputs(steps[1], steps).valid).toBe(true);
    });

    it('ignores a reference to a step that is not in the run', () => {
        expect(typed.checkInputs(step({ config: { itemsFrom: '$sNope.children' } }), [step()]).valid).toBe(true);
    });
});
