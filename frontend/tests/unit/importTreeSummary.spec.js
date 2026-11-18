import { describe, expect, it } from 'vitest';
import { adjustedLines, adjustedTotals, droppedFieldValuesTotal, importChunks } from '@/plugins/importTasks/importTree';

const t = (key, values) => `${key}:${values.count}`;

describe('what an import says about the subtask tree', () => {
    it('adds up what each request re-hung', () => {
        expect(adjustedTotals([
            { adjusted: { tooDeep: 2, parentMissing: 0, cycle: 0, rows: [{ name: 'A', reason: 'TOO_DEEP' }, { name: 'B', reason: 'TOO_DEEP' }] } },
            { created: 4 },
            { adjusted: { tooDeep: 1, parentMissing: 1, cycle: 2, rows: [{ name: 'C', reason: 'TOO_DEEP' }, { name: 'D', reason: 'PARENT_MISSING' }, { name: 'E', reason: 'CYCLE' }, { name: 'F', reason: 'CYCLE' }] } }
        ])).toEqual({
            tooDeep: 3,
            parentMissing: 1,
            cycle: 2,
            rows: [
                { name: 'A', reason: 'TOO_DEEP' }, { name: 'B', reason: 'TOO_DEEP' }, { name: 'C', reason: 'TOO_DEEP' },
                { name: 'D', reason: 'PARENT_MISSING' }, { name: 'E', reason: 'CYCLE' }, { name: 'F', reason: 'CYCLE' }
            ]
        });
    });

    it('writes one line per reason that happened, with the rows it names', () => {
        const totals = adjustedTotals([{ adjusted: { tooDeep: 3, parentMissing: 0, cycle: 1, rows: [{ name: 'A', reason: 'TOO_DEEP' }, { name: 'L', reason: 'CYCLE' }] } }]);
        expect(adjustedLines(totals, t, 'Import.adjusted')).toEqual([
            { reason: 'TOO_DEEP', text: 'Import.adjusted_too_deep:3', names: 'A' },
            { reason: 'CYCLE', text: 'Import.adjusted_cycle:1', names: 'L' }
        ]);
    });

    it('writes nothing when every row kept its place', () => {
        expect(adjustedLines(adjustedTotals([{ created: 2 }]), t, 'Import.adjusted')).toEqual([]);
    });
});

describe('the field values an import left out', () => {
    it('adds up what each request dropped', () => {
        expect(droppedFieldValuesTotal([{ created: 2, droppedFieldValues: 3 }, { created: 1 }, { droppedFieldValues: 2 }])).toBe(5);
        expect(droppedFieldValuesTotal([{ created: 2 }])).toBe(0);
    });
});

describe('how a CSV is sent', () => {
    const rows = Array.from({ length: 450 }, (_, index) => ({ Title: `Row ${index}` }));

    it('goes in chunks when no column names a parent', () => {
        expect(importChunks(rows, { taskName: 'Title', parent: '' }, 200).map((chunk) => chunk.length)).toEqual([200, 200, 50]);
    });

    it('goes whole when a column names a parent, so a subtask is never sent without it', () => {
        expect(importChunks(rows, { taskName: 'Title', parent: 'Parent' }, 200).map((chunk) => chunk.length)).toEqual([450]);
    });
});
