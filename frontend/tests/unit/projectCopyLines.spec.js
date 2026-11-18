import { describe, expect, it } from 'vitest';
import { PROJECT_COPY_HEADING, PROJECT_COPY_LINE_KINDS as kinds } from '@/components/molecules/IntentPreview/projectCopyLines';

const t = (key, params, count) => `${key}${params ? `(${Object.entries(params).map(([k, v]) => `${k}=${v}`).join(',')})` : ''}${count === undefined ? '' : `#${count}`}`;

describe('project copy preview lines', () => {
    it('has a heading made of two keys', () => {
        expect(PROJECT_COPY_HEADING).toEqual({ kind: 'IntentPreview.new_project_copy', wants: 'IntentPreview.wants_project_copy' });
    });

    it('names the project being copied, trimmed', () => {
        expect(kinds.copyOf(t, { project: '  Apollo  ' })).toEqual({ label: 'IntentPreview.line_copy_of', text: 'Apollo' });
    });

    it('with no project name, or a name that is not text, the line is left out', () => {
        expect(kinds.copyOf(t, { project: '   ' })).toBeNull();
        expect(kinds.copyOf(t, {})).toBeNull();
        expect(kinds.copyOf(t, { project: 42 })).toBeNull();
    });

    it('the parts and dates lines are fixed sentences', () => {
        expect(kinds.copyParts(t)).toEqual({ label: 'IntentPreview.line_copy_parts', text: 'IntentPreview.copy_parts' });
        expect(kinds.copyDates(t)).toEqual({ label: 'IntentPreview.line_copy_dates', text: 'IntentPreview.copy_dates_kept' });
    });

    it('when tasks were not asked for the line says no tasks are copied', () => {
        expect(kinds.copyTasks(t, { asked: false, count: 9 }).text).toBe('IntentPreview.copy_tasks_none');
        expect(kinds.copyTasks(t, { count: 9 }).text).toBe('IntentPreview.copy_tasks_none');
        expect(kinds.copyTasks(t, { asked: 'yes', count: 9 }).text).toBe('IntentPreview.copy_tasks_none');
    });

    it('asked for but with nothing to copy says there are none', () => {
        ['0', 0, -4, NaN, null, undefined, 'x'].forEach((count) => {
            expect(kinds.copyTasks(t, { asked: true, count }).text).toBe('IntentPreview.copy_tasks_zero');
        });
    });

    it('says how many tasks will be copied, whole numbers only', () => {
        expect(kinds.copyTasks(t, { asked: true, count: 12 }).text).toBe('IntentPreview.copy_tasks_count(n=12)#12');
        expect(kinds.copyTasks(t, { asked: true, count: 12.9 }).text).toBe('IntentPreview.copy_tasks_count(n=12)#12');
    });

    it('when a copy would take fewer tasks than the project has, says so with the limit', () => {
        expect(kinds.copyTasks(t, { asked: true, count: 800, limit: 500 }).text).toBe('IntentPreview.copy_tasks_too_many(n=800,limit=500)');
    });

    it('a limit of zero or less is ignored', () => {
        expect(kinds.copyTasks(t, { asked: true, count: 5, limit: 0 }).text).toBe('IntentPreview.copy_tasks_count(n=5)#5');
    });
});
