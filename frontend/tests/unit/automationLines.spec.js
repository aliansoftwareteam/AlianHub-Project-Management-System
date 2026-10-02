import { describe, expect, it } from 'vitest';
import { AUTOMATION_HEADING, AUTOMATION_LINE_KINDS as kinds } from '@/components/molecules/IntentPreview/automationLines';

const t = (key, values, count) => {
    const parts = values ? Object.entries(values).map(([k, v]) => `${k}=${v}`).join(',') : '';
    return `${key}${parts ? `|${parts}` : ''}${count === undefined ? '' : `#${count}`}`;
};

describe('the automation preview', () => {
    it('keeps its heading keys fixed', () => {
        expect(Object.isFrozen(AUTOMATION_HEADING)).toBe(true);
        expect(AUTOMATION_HEADING).toEqual({ kind: 'AutomationPreview.heading', wants: 'AutomationPreview.wants' });
    });

    it.each(['ruleStart', 'rule', 'ruleProblem'])('shows the server words of %s, trimmed', (kind) => {
        const out = kinds[kind](t, { text: '  When a task is done  ' });
        expect(out.text).toBe('When a task is done');
        expect(out.label).toMatch(/^AutomationPreview\.line_/);
    });

    it.each(['ruleStart', 'rule', 'ruleProblem', 'ruleStep'])('shows nothing for %s without words', (kind) => {
        expect(kinds[kind](t, {})).toBeNull();
        expect(kinds[kind](t, { text: '   ' })).toBeNull();
        expect(kinds[kind](t, { text: 5 })).toBeNull();
    });

    it('numbers a step and rounds a fractional number down', () => {
        expect(kinds.ruleStep(t, { text: 'Assign to Sam', n: 2.9 })).toEqual({ label: 'AutomationPreview.line_step|n=2', text: 'Assign to Sam' });
    });

    it('numbers a step zero when the number is not a positive one', () => {
        expect(kinds.ruleStep(t, { text: 'x', n: -3 }).label).toBe('AutomationPreview.line_step|n=0');
        expect(kinds.ruleStep(t, { text: 'x', n: 'two' }).label).toBe('AutomationPreview.line_step|n=0');
        expect(kinds.ruleStep(t, { text: 'x', n: NaN }).label).toBe('AutomationPreview.line_step|n=0');
    });

    it('always states the reach line', () => {
        expect(kinds.ruleReach(t)).toEqual({ label: 'AutomationPreview.line_reach', text: 'AutomationPreview.reach' });
    });

    it('says on only for a real true', () => {
        expect(kinds.ruleState(t, { on: true }).text).toBe('AutomationPreview.state_on');
        expect(kinds.ruleState(t, { on: false }).text).toBe('AutomationPreview.state_off');
        expect(kinds.ruleState(t, { on: 'true' }).text).toBe('AutomationPreview.state_off');
        expect(kinds.ruleState(t, {}).text).toBe('AutomationPreview.state_off');
    });

    it('counts runs over a number of days', () => {
        const out = kinds.ruleRuns(t, { count: 3, days: 7 });
        expect(out.label).toBe('AutomationPreview.line_runs|days=7#7');
        expect(out.text).toBe('AutomationPreview.runs|n=3#3');
    });

    it('says there were no runs when the count is zero, missing or not a number', () => {
        expect(kinds.ruleRuns(t, { count: 0, days: 7 }).text).toBe('AutomationPreview.runs_none');
        expect(kinds.ruleRuns(t, { days: 7 }).text).toBe('AutomationPreview.runs_none');
        expect(kinds.ruleRuns(t, { count: '5', days: 7 }).text).toBe('AutomationPreview.runs_none');
    });

    it('lists example tasks, skipping blanks and non-text', () => {
        const out = kinds.ruleExamples(t, { tasks: ['Fix login', '  ', 7, ' Ship ', null] });
        expect(out).toEqual({ label: 'AutomationPreview.line_examples', text: 'Fix login, Ship' });
    });

    it('lists right-to-left example tasks in the order given', () => {
        expect(kinds.ruleExamples(t, { tasks: ['إصلاح الدخول', 'משימה'] }).text).toBe('إصلاح الدخول, משימה');
    });

    it('shows no examples line for none, an empty list or a wrong type', () => {
        expect(kinds.ruleExamples(t, {})).toBeNull();
        expect(kinds.ruleExamples(t, { tasks: [] })).toBeNull();
        expect(kinds.ruleExamples(t, { tasks: 'Fix login' })).toBeNull();
    });
});
