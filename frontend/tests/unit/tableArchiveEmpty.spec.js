/* AP-495: with Show Archive on, the Table counted the live tasks it had loaded, drew its group headers over no rows
   and never reached its empty state. */
import { describe, expect, it } from 'vitest';
import { visibleTaskCount } from '@/views/Projects/TableView/visibleTaskCount';

const stored = (tasks) => ({ sprints: ['s1'], s1: { tasks } });
const live = { _id: 't1', deletedStatusKey: 0 };
const archived = { _id: 't2', deletedStatusKey: 2 };

describe('the rows the Table can draw', () => {
    it('are none while the archive is shown and only live tasks are loaded, so the empty state shows', () => {
        expect(visibleTaskCount({ stored: stored([live]), sprints: [{ tasks: 1, archiveTaskCount: 0 }], archive: true })).toBe(0);
    });

    it('are the archived ones while the archive is shown', () => {
        expect(visibleTaskCount({ stored: stored([live, archived]), sprints: [], archive: true })).toBe(1);
    });

    it('are the live ones otherwise, and the list counters for lists not loaded yet', () => {
        expect(visibleTaskCount({ stored: stored([live, archived]), sprints: [] })).toBe(1);
        expect(visibleTaskCount({ stored: undefined, sprints: [{ tasks: 3 }, { tasks: 2 }] })).toBe(5);
        expect(visibleTaskCount({ stored: undefined, sprints: [{ tasks: 3, archiveTaskCount: 1 }], archive: true })).toBe(1);
    });
});
