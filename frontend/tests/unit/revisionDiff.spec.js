import { describe, expect, it } from 'vitest';
import { diffSnapshots, defaultPair, formatValue, sameValue } from '@/views/Ai/revisionDiff';

const t = (key, params) => (params ? `${key} ${JSON.stringify(params)}` : key);

describe('diffSnapshots', () => {
    it('lists only the fields whose value changed, in a stable order, with readable text', () => {
        const from = { name: 'Reviewer', autonomy: 1, allowedActions: ['task.comment'], skills: [{ key: 'qa-review', name: 'QA', enabled: true }], spendCapUsd: 30 };
        const to = { name: 'Reviewer', autonomy: 2, allowedActions: ['task.comment', 'subtask.create'], skills: [{ key: 'qa-review', name: 'QA Review', enabled: false }], spendCapUsd: 30, model: 'gpt-x' };
        const rows = diffSnapshots(from, to, t);
        expect(rows.map((r) => r.field)).toEqual(['skills', 'allowedActions', 'autonomy', 'model']);
        expect(rows[0]).toMatchObject({ fromText: 'qa-review', toText: 'Ai.revision_skill_off {"key":"qa-review"}' });
        expect(rows[1]).toMatchObject({ fromText: 'task.comment', toText: 'task.comment, subtask.create' });
        expect(rows[2]).toMatchObject({ from: 1, to: 2, fromText: '1', toText: '2' });
        expect(rows[3]).toMatchObject({ fromText: 'Ai.revision_value_empty', toText: 'gpt-x' });
    });

    it('treats a missing snapshot as empty and ignores key order inside objects', () => {
        expect(diffSnapshots(null, { autonomy: 1 }, t)).toEqual([{ field: 'autonomy', from: undefined, to: 1, fromText: 'Ai.revision_value_empty', toText: '1' }]);
        expect(diffSnapshots({ schedule: { a: 1, b: 2 } }, { schedule: { b: 2, a: 1 } }, t)).toEqual([]);
        expect(sameValue([1, 2], [1, 2])).toBe(true);
        expect(sameValue([1, 2], [2, 1])).toBe(false);
    });

    it('formats empties, booleans, arrays and objects', () => {
        expect(formatValue('projectIds', [], t)).toBe('Ai.revision_value_empty');
        expect(formatValue('paused', true, t)).toBe('Ai.revision_value_true');
        expect(formatValue('schedule', { every: 'day' }, t)).toBe('{"every":"day"}');
        expect(formatValue('skills', ['qa-review', { key: 'digest' }], t)).toBe('qa-review, digest');
    });
});

describe('defaultPair', () => {
    it('opens on the live revision against the one before it', () => {
        expect(defaultPair([{ n: 1, state: 'superseded' }, { n: 3, state: 'candidate' }, { n: 2, state: 'live' }])).toEqual({ from: 1, to: 2 });
        expect(defaultPair([{ n: 1, state: 'live' }])).toEqual({ from: null, to: 1 });
        expect(defaultPair([])).toEqual({ from: null, to: null });
    });
});
