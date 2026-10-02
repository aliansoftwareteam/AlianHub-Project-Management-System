import { describe, expect, it } from 'vitest';
import { FOLDER_HEADING, LIST_SETUP_LINE_KINDS as kinds, SPRINT_HEADING } from '@/components/molecules/IntentPreview/listSetupLines';

const t = (key, values, count) => {
    const parts = values ? Object.entries(values).map(([k, v]) => `${k}=${v}`).join(',') : '';
    return `${key}${parts ? `|${parts}` : ''}${count === undefined ? '' : `#${count}`}`;
};

describe('headings', () => {
    it('are frozen and name their keys', () => {
        expect(Object.isFrozen(FOLDER_HEADING)).toBe(true);
        expect(Object.isFrozen(SPRINT_HEADING)).toBe(true);
        expect(FOLDER_HEADING.kind).toBe('IntentPreview.new_folder');
        expect(SPRINT_HEADING.kind).toBe('Scrum.preview_kind');
    });
});

describe('folder lines', () => {
    it('shows the folder a list goes into and a subfolder by name', () => {
        expect(kinds.inFolder(t, { name: ' Q3 ' })).toEqual({ label: 'IntentPreview.line_inside', text: 'Q3' });
        expect(kinds.subfolder(t, { name: 'Design' })).toEqual({ label: 'IntentPreview.line_subfolder', text: 'Design' });
    });

    it('shows nothing for a folder without a usable name', () => {
        expect(kinds.inFolder(t, {})).toBeNull();
        expect(kinds.subfolder(t, { name: '  ' })).toBeNull();
        expect(kinds.subfolder(t, { name: 3 })).toBeNull();
    });

    it('lists moved lists and the number that are not shown', () => {
        const out = kinds.movedLists(t, { names: ['Alpha', 'Beta'], others: 3 });
        expect(out.label).toBe('IntentPreview.line_moved_lists');
        expect(out.text).toBe('IntentPreview.lists_and_hidden|names=Alpha, Beta,hidden=IntentPreview.lists_not_shown|n=3#3');
    });

    it('lists moved lists alone when none are hidden', () => {
        expect(kinds.movedLists(t, { names: ['Alpha', ' ', 'Beta'] }).text).toBe('Alpha, Beta');
    });

    it('says only how many are hidden when no names come with it', () => {
        expect(kinds.movedLists(t, { others: 2 }).text).toBe('IntentPreview.lists_not_shown|n=2#2');
    });

    it('rounds a fractional hidden count down and ignores one that is not positive', () => {
        expect(kinds.movedLists(t, { names: ['A'], others: 2.8 }).text).toContain('n=2#2');
        expect(kinds.movedLists(t, { names: ['A'], others: -1 }).text).toBe('A');
        expect(kinds.movedLists(t, { names: ['A'], others: '4' }).text).toBe('A');
    });

    it('shows nothing when there are no lists to name and none hidden', () => {
        expect(kinds.movedLists(t, {})).toBeNull();
        expect(kinds.movedLists(t, { names: [], others: 0 })).toBeNull();
        expect(kinds.movedLists(t, { names: 'Alpha' })).toBeNull();
    });

    it('keeps right-to-left list names', () => {
        expect(kinds.movedLists(t, { names: ['قائمة', 'רשימה'] }).text).toBe('قائمة, רשימה');
    });
});

describe('sprint days', () => {
    it('shows a range of plain dates as the same days in the viewer locale', () => {
        const out = kinds.sprintDays(t, { from: '2024-02-26', to: '2024-03-08' }, 'en-US');
        expect(out).toEqual({ label: 'Scrum.preview_days', text: 'IntentPreview.due_range|from=Feb 26, 2024,to=Mar 8, 2024' });
    });

    it('keeps the leap day on the 29th', () => {
        const out = kinds.sprintDays(t, { from: '2024-02-28', to: '2024-02-29' }, 'en-US');
        expect(out.text).toBe('IntentPreview.due_range|from=Feb 28, 2024,to=Feb 29, 2024');
    });

    it('shows the first of January and last of December without sliding into the next year', () => {
        const out = kinds.sprintDays(t, { from: '2024-01-01', to: '2024-12-31' }, 'en-US');
        expect(out.text).toBe('IntentPreview.due_range|from=Jan 1, 2024,to=Dec 31, 2024');
    });

    it('words the same days in another locale', () => {
        const out = kinds.sprintDays(t, { from: '2024-02-26', to: '2024-03-08' }, 'de-DE');
        expect(out.text).toBe('IntentPreview.due_range|from=26.02.2024,to=08.03.2024');
    });

    it('uses the days-now label when the list already has its days', () => {
        const out = kinds.sprintDaysNow(t, { from: '2024-02-26', to: '2024-03-08' }, 'en-US');
        expect(out.label).toBe('Scrum.preview_days_now');
    });

    it('reads a full timestamp as the day it falls on for the viewer', () => {
        const noon = new Date(2024, 5, 15, 12, 0, 0).toISOString();
        const out = kinds.sprintDays(t, { from: noon, to: noon }, 'en-US');
        expect(out.text).toBe('IntentPreview.due_range|from=Jun 15, 2024,to=Jun 15, 2024');
    });

    it('falls back to the default locale when the given one is not valid', () => {
        const out = kinds.sprintDays(t, { from: '2024-02-26', to: '2024-03-08' }, 'not a locale!!');
        expect(out).not.toBeNull();
        expect(out.text).toMatch(/2024/);
    });

    it('shows nothing when either end is missing or is not a date', () => {
        expect(kinds.sprintDays(t, { from: '2024-02-26' }, 'en-US')).toBeNull();
        expect(kinds.sprintDays(t, { to: '2024-02-26' }, 'en-US')).toBeNull();
        expect(kinds.sprintDays(t, { from: 'soon', to: '2024-02-26' }, 'en-US')).toBeNull();
        expect(kinds.sprintDays(t, { from: '2024-02-30x', to: '2024-03-01' }, 'en-US')).toBeNull();
        expect(kinds.sprintDays(t, { from: 20240226, to: 20240301 }, 'en-US')).toBeNull();
    });
});
