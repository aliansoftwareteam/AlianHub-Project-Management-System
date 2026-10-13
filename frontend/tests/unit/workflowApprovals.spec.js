import { describe, expect, it } from 'vitest';
import {
    APPROVAL_STATUSES,
    DECISIONS,
    SOON_MS,
    approvalStatusOf,
    canDecide,
    deadlineOf,
    escalationOf,
    handoversOf,
    isOpen,
    ownerOf,
    sortApprovals,
} from '@/views/Ai/workflowApprovals';

const NOW = Date.UTC(2024, 1, 29, 12, 0, 0);
const at = (ms) => new Date(NOW + ms).toISOString();
const HOUR = 60 * 60 * 1000;

describe('status', () => {
    it('knows the four statuses and two decisions', () => {
        expect(APPROVAL_STATUSES).toEqual(['pending', 'approved', 'rejected', 'expired']);
        expect(DECISIONS).toEqual(['approved', 'rejected']);
    });

    it('reads a known status as it is', () => {
        expect(approvalStatusOf({ status: 'rejected' })).toBe('rejected');
        expect(approvalStatusOf({ status: 'expired' })).toBe('expired');
    });

    it('reads an unknown or missing status as pending', () => {
        expect(approvalStatusOf({ status: 'weird' })).toBe('pending');
        expect(approvalStatusOf({})).toBe('pending');
        expect(approvalStatusOf(null)).toBe('pending');
        expect(approvalStatusOf({ status: 'APPROVED' })).toBe('pending');
    });

    it('is open only while pending', () => {
        expect(isOpen({ status: 'pending' })).toBe(true);
        expect(isOpen({})).toBe(true);
        expect(isOpen({ status: 'approved' })).toBe(false);
    });

    it('lets a person decide only an open request that the server says they may', () => {
        expect(canDecide({ status: 'pending', canDecide: true })).toBe(true);
        expect(canDecide({ status: 'pending', canDecide: 'yes' })).toBe(false);
        expect(canDecide({ status: 'pending' })).toBe(false);
        expect(canDecide({ status: 'approved', canDecide: true })).toBe(false);
        expect(canDecide(undefined)).toBe(false);
    });
});

describe('deadlineOf', () => {
    it('has no deadline when none is set or it is not a date', () => {
        expect(deadlineOf({}, NOW)).toBeNull();
        expect(deadlineOf(null, NOW)).toBeNull();
        expect(deadlineOf({ deadlineAt: 'tomorrow-ish' }, NOW)).toBeNull();
        expect(deadlineOf({ deadlineAt: '' }, NOW)).toBeNull();
    });

    it('counts the time left on a deadline that is ahead', () => {
        const out = deadlineOf({ deadlineAt: at(3 * HOUR) }, NOW);
        expect(out).toMatchObject({ ms: 3 * HOUR, overdue: false, soon: false });
        expect(out.at).toEqual(new Date(NOW + 3 * HOUR));
    });

    it('calls a deadline within the hour soon, including the hour itself', () => {
        expect(deadlineOf({ deadlineAt: at(SOON_MS) }, NOW).soon).toBe(true);
        expect(deadlineOf({ deadlineAt: at(SOON_MS + 1) }, NOW).soon).toBe(false);
        expect(deadlineOf({ deadlineAt: at(1) }, NOW).soon).toBe(true);
    });

    it('calls a deadline that has passed overdue, and one that is exactly now overdue too', () => {
        const past = deadlineOf({ deadlineAt: at(-HOUR) }, NOW);
        expect(past).toMatchObject({ ms: -HOUR, overdue: true, soon: false });
        expect(deadlineOf({ deadlineAt: at(0) }, NOW)).toMatchObject({ overdue: true, soon: false });
    });

    it('reads a deadline given as a number of milliseconds', () => {
        expect(deadlineOf({ deadlineAt: NOW + HOUR }, NOW).ms).toBe(HOUR);
    });

    it('measures across the leap day', () => {
        const feb28 = Date.UTC(2024, 1, 28, 12, 0, 0);
        const out = deadlineOf({ deadlineAt: '2024-03-01T12:00:00Z' }, feb28);
        expect(out.ms).toBe(2 * 24 * HOUR);
    });
});

describe('escalationOf', () => {
    it('has no path when there is neither a second person nor a time', () => {
        expect(escalationOf({}, NOW)).toBeNull();
        expect(escalationOf(null, NOW)).toBeNull();
    });

    it('describes a path that is still ahead', () => {
        const out = escalationOf({ escalateToUserId: 'u2', escalateToName: 'Sam', escalateAt: at(2 * HOUR) }, NOW);
        expect(out).toMatchObject({ userId: 'u2', name: 'Sam', escalated: false, escalatedAt: null, due: false });
        expect(out.at).toEqual(new Date(NOW + 2 * HOUR));
    });

    it('says the handover is due once its time has come and it has not happened', () => {
        expect(escalationOf({ escalateToUserId: 'u2', escalateAt: at(-1) }, NOW).due).toBe(true);
        expect(escalationOf({ escalateToUserId: 'u2', escalateAt: at(0) }, NOW).due).toBe(true);
    });

    it('is not due once it was taken', () => {
        const out = escalationOf({ escalateToUserId: 'u2', escalateAt: at(-HOUR), escalatedAt: at(-30 * 60 * 1000) }, NOW);
        expect(out.escalated).toBe(true);
        expect(out.due).toBe(false);
        expect(out.escalatedAt).toEqual(new Date(NOW - 30 * 60 * 1000));
    });

    it('counts a taken path even when the time to hand over was never set', () => {
        const out = escalationOf({ escalatedAt: at(-HOUR) }, NOW);
        expect(out).toMatchObject({ userId: null, name: null, at: null, escalated: true });
    });

    it('describes a second person with no time as a path with no time', () => {
        expect(escalationOf({ escalateToUserId: 'u9' }, NOW)).toMatchObject({ userId: 'u9', at: null, due: false });
    });
});

describe('ownerOf', () => {
    it('reads the owner, with nulls for what is missing', () => {
        expect(ownerOf({ ownerUserId: 'u1', ownerName: 'Ada', ownerRole: 'Lead' })).toEqual({ userId: 'u1', name: 'Ada', role: 'Lead' });
        expect(ownerOf({})).toEqual({ userId: null, name: null, role: null });
        expect(ownerOf(undefined)).toEqual({ userId: null, name: null, role: null });
    });
});

describe('handoversOf', () => {
    it('lists each handover with who moved it and to whom, in the order given', () => {
        const rows = handoversOf({
            reassignments: [
                { from: 'u1', fromName: 'Ada', to: 'u2', toName: 'Sam', by: 'u1', byName: 'Ada', at: '2024-02-29T08:00:00Z', reason: 'On leave' },
                { from: 'u2', to: 'u3', at: '2024-02-29T10:00:00Z' },
            ],
        });
        expect(rows).toHaveLength(2);
        expect(rows[0]).toMatchObject({ from: 'u1', fromName: 'Ada', to: 'u2', toName: 'Sam', byName: 'Ada', reason: 'On leave' });
        expect(rows[0].at).toEqual(new Date('2024-02-29T08:00:00Z'));
        expect(rows[1]).toMatchObject({ fromName: null, toName: null, by: null, reason: '' });
    });

    it('keeps a reason written right to left', () => {
        expect(handoversOf({ reassignments: [{ reason: 'في إجازة' }] })[0].reason).toBe('في إجازة');
    });

    it('answers an empty list when there are none or the shape is wrong', () => {
        expect(handoversOf({})).toEqual([]);
        expect(handoversOf(null)).toEqual([]);
        expect(handoversOf({ reassignments: 'x' })).toEqual([]);
    });

    it('leaves the time empty when a handover has none', () => {
        expect(handoversOf({ reassignments: [{ from: 'u1' }] })[0].at).toBeNull();
    });

    it('survives an empty entry', () => {
        expect(handoversOf({ reassignments: [null] })[0]).toMatchObject({ from: null, to: null, reason: '' });
    });
});

describe('sortApprovals', () => {
    const row = (id, deadlineAt, createdAt) => ({ id, deadlineAt, createdAt });

    it('puts overdue first, then the soonest, then those with no deadline oldest first', () => {
        const rows = [
            row('none-new', undefined, '2024-02-28T00:00:00Z'),
            row('later', at(5 * HOUR)),
            row('overdue', at(-2 * HOUR)),
            row('none-old', undefined, '2024-02-01T00:00:00Z'),
            row('soon', at(HOUR / 2)),
        ];
        expect(sortApprovals(rows, NOW).map((r) => r.id)).toEqual(['overdue', 'soon', 'later', 'none-old', 'none-new']);
    });

    it('does not change the list it was given', () => {
        const rows = [row('b', at(HOUR)), row('a', at(-HOUR))];
        sortApprovals(rows, NOW);
        expect(rows.map((r) => r.id)).toEqual(['b', 'a']);
    });

    it('copes with none, one and rows without a created date', () => {
        expect(sortApprovals([], NOW)).toEqual([]);
        expect(sortApprovals(undefined, NOW)).toEqual([]);
        expect(sortApprovals([row('only')], NOW)).toHaveLength(1);
        expect(sortApprovals([row('a'), row('b')], NOW)).toHaveLength(2);
    });
});
