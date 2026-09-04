import { describe, expect, it } from 'vitest';
import { deriveHealth } from '@/views/Projects/ProjectsListing/useProjectHealth';

const DAY = 86400000;
const snap = (over = {}) => ({ loading: false, loaded: true, total: 10, done: 5, overdue: 0, progressPct: 50, sprint: null, ...over });

describe('deriveHealth', () => {
    it('is unknown until the snapshot has loaded', () => {
        expect(deriveHealth({}, null).key).toBe('unknown');
        expect(deriveHealth({}, { loaded: false }).key).toBe('unknown');
    });

    it('lets an agent-set health win over the computed one', () => {
        const result = deriveHealth({ health: 'blocked', healthReason: 'Vendor late' }, snap({ overdue: 0 }));
        expect(result.key).toBe('blocked');
        expect(result.reasons).toEqual(['Vendor late']);
    });

    it('is on track with nothing overdue and no sprint drift', () => {
        expect(deriveHealth({}, snap()).key).toBe('on-track');
    });

    it('is at risk when a little work is overdue', () => {
        expect(deriveHealth({}, snap({ overdue: 1, progressPct: 80 })).key).toBe('at-risk');
    });

    it('is blocked when overdue work meets low progress', () => {
        expect(deriveHealth({}, snap({ overdue: 1, progressPct: 20 })).key).toBe('blocked');
    });

    it('is blocked when the sprint ended with work left', () => {
        const sprint = { startDate: new Date(Date.now() - 10 * DAY).toISOString(), endDate: new Date(Date.now() - DAY).toISOString() };
        expect(deriveHealth({}, snap({ sprint, progressPct: 60 })).key).toBe('blocked');
    });
});
