import { describe, expect, it } from 'vitest';
import { snappedBack } from '@/views/Projects/GanttView/dragSnap';
import en from '@/locales/en';

const task = { startDate: '2026-10-05T00:00:00.000Z', DueDate: '2026-10-09T00:00:00.000Z' };

describe('a Gantt drag that ends on the dates it began on', () => {
    it('is told to the person, since the scale moves a bar a week at a time', () => {
        expect(snappedBack(task, { start_date: new Date('2026-10-05T00:00:00.000Z'), end_date: new Date('2026-10-09T00:00:00.000Z') })).toBe(true);
        expect(en.Views.drag_snapped_back).toContain('Switch to Days');
    });

    it('is not told when the dates moved', () => {
        expect(snappedBack(task, { start_date: new Date('2026-10-12T00:00:00.000Z'), end_date: new Date('2026-10-16T00:00:00.000Z') })).toBe(false);
        expect(snappedBack(task, { start_date: new Date('2026-10-05T00:00:00.000Z'), end_date: new Date('2026-10-10T00:00:00.000Z') })).toBe(false);
    });
});
