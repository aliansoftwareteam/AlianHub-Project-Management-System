import { describe, expect, it } from 'vitest';
import { rankAgents, routeTasks } from '@/views/Ai/agentFit';
import { fitReasonText, refusalText, workLabelText } from '@/views/Ai/fitText';

const t = (key, params = {}) => `${key}${Object.keys(params).length ? ` ${JSON.stringify(params)}` : ''}`;

const task = (over = {}) => ({ _id: 't1', TaskName: 'Audit login contrast', ProjectID: 'p1', tagsArray: [], ...over });
const agent = (over = {}) => ({ _id: 'a1', name: 'Reviewer', skills: ['review'], allowedActions: ['task.get', 'task.comment'], autonomy: 1, spendCapUsd: 10, paused: false, projectIds: [], ...over });

describe('agentFit reason codes', () => {
    it('keeps the English text and adds a code for every reason', () => {
        const [row] = rankAgents({ agents: [agent()], task: task() });
        expect(row.reason).toMatch(/Allowed to find the problems/);
        expect(row.reasons.map((r) => r.code)).toEqual(['allowed', 'no_history']);
        expect(row.reasons[0].params).toEqual({ work: 'review' });
    });

    it('codes each blocked state', () => {
        const paused = rankAgents({ agents: [agent({ paused: true, pausedReason: 'spend_cap' })], task: task() })[0];
        expect(paused.blockedReason).toBe('Paused (spend_cap).');
        expect(paused.reasons[0]).toEqual({ text: 'Paused (spend_cap).', code: 'paused', params: { reason: 'spend_cap' } });

        const scoped = rankAgents({ agents: [agent({ projectIds: ['other'] })], task: task() })[0];
        expect(scoped.reasons[0].code).toBe('not_scoped');

        const person = rankAgents({ agents: [agent()], task: task({ TaskName: 'Decide the pricing page layout' }) })[0];
        expect(person.reasons[0]).toMatchObject({ code: 'needs_person', params: { why: 'human_decision' } });
    });

    it('codes the router refusals', () => {
        const rows = routeTasks({ tasks: [task({ TaskName: 'Call the vendor' }), task({ _id: 't2', TaskName: 'Fix the failing tests' })], agents: [agent()] });
        expect(rows[0]).toMatchObject({ routed: false, refusalCode: 'needs_person', refusalParams: { why: 'human_talk' } });
        expect(rows[1]).toMatchObject({ routed: false, refusalCode: 'no_agent', refusal: 'no agent here is allowed to do this' });
    });
});

describe('fitText', () => {
    it('renders reasons through $t with the work and why labels translated', () => {
        const [row] = rankAgents({ agents: [agent()], task: task() });
        expect(fitReasonText(t, row)).toBe('Parity.fit_allowed {"work":"Parity.work_review"} Parity.fit_no_history');
    });

    it('renders a blocked reason with its parameters', () => {
        const [row] = rankAgents({ agents: [agent({ spendMonth: { usd: 12 } })], task: task() });
        expect(fitReasonText(t, row)).toBe('Parity.fit_cap_reached {"spent":"12.00","cap":10}');
    });

    it('renders refusals and falls back to the text when there is no code', () => {
        const [row] = routeTasks({ tasks: [task({ TaskName: 'Interview the candidate' })], agents: [agent()] });
        expect(refusalText(t, row)).toBe('Parity.fit_needs_person {"why":"Parity.why_human_decision"}');
        expect(refusalText(t, { refusal: 'plain text' })).toBe('plain text');
        expect(fitReasonText(t, { reason: 'plain text' })).toBe('plain text');
        expect(fitReasonText(t, null)).toBe('');
    });

    it('labels the kind of work', () => {
        expect(workLabelText(t, { labelKey: 'code', label: 'x' })).toBe('Parity.work_code');
        expect(workLabelText(t, { label: 'legacy' })).toBe('legacy');
    });
});
