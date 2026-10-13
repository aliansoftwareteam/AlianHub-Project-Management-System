import { describe, expect, it } from 'vitest';
import { assignLanes } from '@/views/Projects/composables/sprintLanes';

const range = (id, from, to) => ({ id, from, to });
const lanesOf = (ranges) => assignLanes(ranges).map((entry) => entry.lane);

describe('assignLanes', () => {
    it('puts two identical ranges in lanes 0 and 1', () => {
        expect(lanesOf([range('a', '2026-10-05', '2026-10-18'), range('b', '2026-10-05', '2026-10-18')])).toEqual([0, 1]);
    });

    it('keeps ranges that do not overlap in lane 0', () => {
        expect(lanesOf([range('a', '2026-10-01', '2026-10-07'), range('b', '2026-10-09', '2026-10-15')])).toEqual([0, 0]);
    });

    it('gives three overlapping ranges lanes 0, 1 and 2', () => {
        expect(lanesOf([
            range('a', '2026-10-01', '2026-10-20'),
            range('b', '2026-10-05', '2026-10-25'),
            range('c', '2026-10-10', '2026-10-12'),
        ])).toEqual([0, 1, 2]);
    });

    it('reuses a lane for a range that starts the day after another ends', () => {
        expect(lanesOf([range('a', '2026-10-01', '2026-10-07'), range('b', '2026-10-08', '2026-10-14')])).toEqual([0, 0]);
    });

    it('does not reuse a lane for a range that starts on the day another ends', () => {
        expect(lanesOf([range('a', '2026-10-01', '2026-10-07'), range('b', '2026-10-07', '2026-10-14')])).toEqual([0, 1]);
    });

    it('keeps the input order and reuses the first free lane', () => {
        const result = assignLanes([
            range('late', '2026-10-20', '2026-10-27'),
            range('long', '2026-10-01', '2026-10-30'),
            range('early', '2026-10-01', '2026-10-10'),
        ]);
        expect(result.map((entry) => entry.id)).toEqual(['late', 'long', 'early']);
        expect(result.map((entry) => entry.lane)).toEqual([1, 0, 1]);
    });

    it('returns nothing for nothing', () => {
        expect(assignLanes([])).toEqual([]);
    });
});
