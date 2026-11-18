import { describe, expect, it } from 'vitest';
import {
    VALUE_MAX,
    accountableOf,
    chainOf,
    edgesOf,
    refsIn,
    rootsOf,
    summariseValue,
} from '@/views/Ai/workflowLineage';

const step = (stepId, extra = {}) => ({ stepId, type: 'tool_call', status: 'success', index: 0, ...extra });
const byIdOf = (steps) => new Map(steps.map((row) => [String(row.stepId), row]));

describe('refsIn', () => {
    it('finds a bare step reference and a field reference', () => {
        expect(refsIn('$s1')).toEqual([{ stepId: 's1', field: null, raw: '$s1' }]);
        expect(refsIn('$s1.findings')).toEqual([{ stepId: 's1', field: 'findings', raw: '$s1.findings' }]);
    });

    it('keeps only the first part of a nested field path', () => {
        expect(refsIn('$s1.report.title.text')[0].field).toBe('report');
    });

    it('finds references inside nested objects and lists', () => {
        const found = refsIn({ a: ['$s1.x', { b: '$s2' }], c: 'plain', d: 5, e: null });
        expect(found.map((ref) => ref.stepId)).toEqual(['s1', 's2']);
    });

    it('ignores text that only contains a reference or has the wrong shape', () => {
        expect(refsIn('see $s1.x for more')).toEqual([]);
        expect(refsIn('$')).toEqual([]);
        expect(refsIn('$ s1')).toEqual([]);
        expect(refsIn('s1.x')).toEqual([]);
    });

    it('finds nothing in nothing', () => {
        expect(refsIn(null)).toEqual([]);
        expect(refsIn(undefined)).toEqual([]);
        expect(refsIn(7)).toEqual([]);
        expect(refsIn({})).toEqual([]);
    });

    it('stops reading a structure nested too deep', () => {
        let deep = '$s1';
        for (let i = 0; i < 30; i += 1) deep = { next: deep };
        expect(refsIn(deep)).toEqual([]);
        let shallow = '$s1';
        for (let i = 0; i < 5; i += 1) shallow = { next: shallow };
        expect(refsIn(shallow)).toHaveLength(1);
    });

    it('does not mix results of separate calls', () => {
        refsIn('$s1');
        expect(refsIn('$s2').map((ref) => ref.stepId)).toEqual(['s2']);
    });
});

describe('summariseValue', () => {
    it('says nothing for nothing', () => {
        expect(summariseValue(null)).toBe('');
        expect(summariseValue(undefined)).toBe('');
    });

    it('shows a list as its length and an object as its first three keys', () => {
        expect(summariseValue([1, 2, 3, 4])).toBe('[4]');
        expect(summariseValue([])).toBe('[0]');
        expect(summariseValue({ a: 1, b: 2, c: 3, d: 4 })).toBe('{a, b, c}');
        expect(summariseValue({})).toBe('{}');
    });

    it('shows short text and numbers as they are, including zero and false', () => {
        expect(summariseValue('ok')).toBe('ok');
        expect(summariseValue(0)).toBe('0');
        expect(summariseValue(false)).toBe('false');
    });

    it('cuts long text to the limit with an ellipsis', () => {
        const out = summariseValue('x'.repeat(200));
        expect(out).toHaveLength(VALUE_MAX);
        expect(out.endsWith('…')).toBe(true);
    });

    it('leaves text of exactly the limit alone', () => {
        const text = 'y'.repeat(VALUE_MAX);
        expect(summariseValue(text)).toBe(text);
    });
});

describe('edgesOf', () => {
    const producer = step('a', { type: 'agent_run', output: { score: 9, items: [1, 2] } });
    const consumer = step('b', { dependsOn: ['a'], config: { input: '$a.score', also: '$a.items' } });
    const byId = byIdOf([producer, consumer]);

    it('has an edge for the handoff itself and one per field read', () => {
        const edges = edgesOf(consumer, byId);
        expect(edges.map((edge) => edge.field)).toEqual([null, 'score', 'items']);
    });

    it('says what travelled along each field edge', () => {
        const edges = edgesOf(consumer, byId);
        expect(edges[1]).toMatchObject({ from: 'a', fromType: 'agent_run', fromStatus: 'success', value: '9', produced: true });
        expect(edges[2].value).toBe('[2]');
    });

    it('marks a field the producer never settled with as not produced', () => {
        const hungry = step('c', { config: { x: '$a.missing' } });
        const [edge] = edgesOf(hungry, byId);
        expect(edge).toMatchObject({ field: 'missing', value: '', produced: false });
    });

    it('does not repeat an edge for the same step and field', () => {
        const twice = step('c', { dependsOn: ['a', 'a'], config: { x: '$a.score', y: '$a.score' } });
        expect(edgesOf(twice, byId)).toHaveLength(2);
    });

    it('drops a reference to a step that is not in the run', () => {
        const lost = step('c', { dependsOn: ['ghost'], config: { x: '$ghost.out' } });
        expect(edgesOf(lost, byId)).toEqual([]);
    });

    it('has no edges for a step that reads nothing', () => {
        expect(edgesOf(step('c'), byId)).toEqual([]);
        expect(edgesOf(undefined, byId)).toEqual([]);
    });

    it('reads a numeric step id as the text it is stored as', () => {
        const rows = [step(1, { output: { v: 'x' } }), step(2, { dependsOn: [1] })];
        expect(edgesOf(rows[1], byIdOf(rows))[0].from).toBe('1');
    });
});

describe('accountableOf', () => {
    const run = { startedBy: 'u1', ruleId: 'r1', ruleName: 'Nightly' };

    it('names who decided an approval', () => {
        const out = accountableOf(step('s', { type: 'human_approval', output: { decidedBy: 'u2', decision: 'approved' } }), run);
        expect(out).toMatchObject({ kind: 'person', userId: 'u2', decided: true, decision: 'approved', escalated: false, system: false });
    });

    it('names the owner of an approval that is still waiting', () => {
        const out = accountableOf(step('s', { type: 'human_approval', config: { ownerUserId: 'u3', ownerRole: 'Lead' } }), run);
        expect(out).toMatchObject({ userId: 'u3', role: 'Lead', decided: false, decision: null });
    });

    it('says the system decided when it was an automatic answer', () => {
        const out = accountableOf(step('s', { type: 'human_approval', output: { decidedBy: 'system', escalated: true } }), run);
        expect(out).toMatchObject({ userId: null, system: true, decided: true, escalated: true });
    });

    it('names the agent and the agent run for an agent step, with the starter as the person', () => {
        const out = accountableOf(step('s', { type: 'agent_run', config: { agentId: 7 }, output: { agentRunId: 'ar1' } }), run);
        expect(out).toEqual({ kind: 'agent', agentId: '7', agentRunId: 'ar1', userId: 'u1' });
    });

    it('leaves out the agent when none is configured', () => {
        const out = accountableOf(step('s', { type: 'agent_run' }), {});
        expect(out).toEqual({ kind: 'agent', agentId: null, agentRunId: null, userId: null });
    });

    it('names the rule behind an automation step', () => {
        expect(accountableOf(step('s', { type: 'automation_rule' }), run)).toEqual({ kind: 'automation', ruleId: 'r1', ruleName: 'Nightly' });
        expect(accountableOf(step('s', { type: 'automation_rule' }), null)).toEqual({ kind: 'automation', ruleId: null, ruleName: '' });
    });

    it('holds whoever started the run accountable for any other step', () => {
        expect(accountableOf(step('s', { type: 'timer' }), run)).toEqual({ kind: 'person', userId: 'u1', forRun: true });
        expect(accountableOf(step('s', { type: 'timer' }), null)).toEqual({ kind: 'person', userId: null, forRun: true });
    });
});

describe('chainOf', () => {
    it('lists the steps in the order the run executes them', () => {
        const rows = [step('b', { index: 2, dependsOn: ['a'] }), step('a', { index: 1 })];
        const chain = chainOf(rows, { startedBy: 'u1' });
        expect(chain.map((node) => node.step.stepId)).toEqual(['a', 'b']);
        expect(chain[1].edges.map((edge) => edge.from)).toEqual(['a']);
        expect(chain[0].accountable.userId).toBe('u1');
    });

    it('keeps a fan-out as one link and shows the failed child', () => {
        const rows = [
            step('fan', { type: 'fan_out', index: 1 }),
            step('c1', { parentStepId: 'fan', index: 2, status: 'success' }),
            step('c2', { parentStepId: 'fan', index: 3, status: 'failed' }),
        ];
        const chain = chainOf(rows, null);
        expect(chain).toHaveLength(1);
        expect(chain[0].children).toHaveLength(2);
        expect(chain[0].shown.map((child) => child.step.stepId)).toEqual(['c2']);
        expect(chain[0].hidden).toBe(1);
    });

    it('shows every child of a fan-out that was expanded', () => {
        const rows = [
            step('fan', { type: 'fan_out', index: 1 }),
            step('c1', { parentStepId: 'fan', index: 2 }),
            step('c2', { parentStepId: 'fan', index: 3 }),
        ];
        const chain = chainOf(rows, null, { expanded: ['fan'] });
        expect(chain[0].shown).toHaveLength(2);
        expect(chain[0].hidden).toBe(0);
    });

    it('answers an empty chain for no steps', () => {
        expect(chainOf()).toEqual([]);
        expect(chainOf([])).toEqual([]);
        expect(chainOf(null)).toEqual([]);
    });
});

describe('rootsOf', () => {
    it('finds the steps nothing hands to', () => {
        const rows = [step('a'), step('b', { dependsOn: ['a'] }), step('c'), step('d', { parentStepId: 'c' })];
        expect(rootsOf(rows)).toEqual(['a', 'c']);
    });

    it('answers nothing for no steps', () => {
        expect(rootsOf()).toEqual([]);
        expect(rootsOf(null)).toEqual([]);
    });
});
