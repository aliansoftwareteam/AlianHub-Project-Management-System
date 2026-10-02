import { describe, expect, it } from 'vitest';
import { findingReasons, findingOffer, findingFix } from '@/views/Projects/ProjectDetail/findingText';

const t = (key, params = {}) => `${key}${Object.keys(params).length ? `(${Object.entries(params).map(([k, v]) => `${k}=${v}`).join(',')})` : ''}`;

describe('findingReasons', () => {
    it('a slipping task says how many days late', () => {
        expect(findingReasons(t, { rule: 'slipping', facts: { daysLate: 3 } })).toEqual(['ProjectManager.reason_slipping(n=3)']);
    });

    it('a slipping task with no days late has no reason to give', () => {
        expect(findingReasons(t, { rule: 'slipping', facts: { daysLate: 0 } })).toEqual([]);
        expect(findingReasons(t, { rule: 'slipping' })).toEqual([]);
    });

    it('a slipping task that waits on a blocker adds the blocker to the days late', () => {
        expect(findingReasons(t, { rule: 'slipping', facts: { daysLate: 2, blockerKey: 'AH-9', days: 4 } })).toEqual([
            'ProjectManager.reason_slipping(n=2)',
            'ProjectManager.reason_slipping_waits(blocker=AH-9,n=4)',
        ]);
    });

    it('blocked, overloaded and stale name their own facts', () => {
        expect(findingReasons(t, { rule: 'blocked', facts: { blockerKey: 'AH-1', quietDays: 6 } })).toEqual(['ProjectManager.reason_blocked(blocker=AH-1,n=6)']);
        expect(findingReasons(t, { rule: 'overloaded', facts: { plannedHours: 50, capacityHours: 40 } })).toEqual(['ProjectManager.reason_overloaded(planned=50,capacity=40)']);
        expect(findingReasons(t, { rule: 'stale', facts: { quietDays: 21 } })).toEqual(['ProjectManager.reason_stale(n=21)']);
    });

    it('an untriaged task says whether it came from a form or from email', () => {
        expect(findingReasons(t, { rule: 'untriaged', facts: { origin: 'form' } })[0]).toContain('origin=ProjectManager.origin_form');
        expect(findingReasons(t, { rule: 'untriaged', facts: { origin: 'anything' } })[0]).toContain('origin=ProjectManager.origin_email');
    });

    it('the rules with no facts to show give one fixed sentence', () => {
        expect(findingReasons(t, { rule: 'no_owner' })).toEqual(['ProjectManager.reason_no_owner']);
        expect(findingReasons(t, { rule: 'no_estimate' })).toEqual(['ProjectManager.reason_no_estimate']);
        expect(findingReasons(t, { rule: 'handed_over' })).toEqual(['ProjectManager.reason_handed_over']);
    });

    it('a rule it does not know gives no reasons', () => {
        expect(findingReasons(t, { rule: 'something_new', facts: {} })).toEqual([]);
    });
});

describe('findingOffer', () => {
    it('names the task by its key, else by its name, else by nothing', () => {
        expect(findingOffer(t, { rule: 'stale', facts: { taskKey: 'AH-5', taskName: 'Fix' } })).toBe('ProjectManager.offer_stale(task=AH-5)');
        expect(findingOffer(t, { rule: 'stale', facts: { taskName: 'Fix' } })).toBe('ProjectManager.offer_stale(task=Fix)');
        expect(findingOffer(t, { rule: 'stale' })).toBe('ProjectManager.offer_stale(task=)');
    });

    it('a slipping task that waits on another has its own offer', () => {
        expect(findingOffer(t, { rule: 'slipping', facts: { blockerKey: 'AH-2', taskKey: 'AH-3' } })).toBe('ProjectManager.offer_slipping_waits(task=AH-3)');
        expect(findingOffer(t, { rule: 'slipping', facts: { taskKey: 'AH-3' } })).toBe('ProjectManager.offer_slipping(task=AH-3)');
    });
});

describe('findingFix', () => {
    it('words the fix for a task waiting on a blocker, a blocked task and a stale task', () => {
        expect(findingFix(t, { rule: 'slipping', facts: { blockerKey: 'AH-2', taskKey: 'AH-3', days: 5 } })).toBe('ProjectManager.fix_slipping_waits(task=AH-3,n=5)');
        expect(findingFix(t, { rule: 'blocked', facts: { blockerKey: 'AH-2' } })).toBe('ProjectManager.fix_blocked(blocker=AH-2)');
        expect(findingFix(t, { rule: 'stale', facts: { taskName: 'Docs' } })).toBe('ProjectManager.fix_stale(task=Docs)');
    });

    it('a finding with no ready change gives an empty line', () => {
        expect(findingFix(t, { rule: 'overloaded', facts: {} })).toBe('');
        expect(findingFix(t, { rule: 'slipping', facts: { daysLate: 2 } })).toBe('');
        expect(findingFix(t, { rule: 'no_owner' })).toBe('');
    });
});
