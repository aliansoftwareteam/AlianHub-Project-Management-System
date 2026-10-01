import { describe, expect, it } from 'vitest';
import { countNotes, countRows, mergeSummaries } from '@/components/organisms/WorkspaceImport/importSummary';

const t = (key, values) => (values ? `${key}:${JSON.stringify(values)}` : key);

const one = {
    tasks: 2, subtasks: { level2: 1, level3: 0 }, checklistItems: 2, links: 1,
    comments: { imported: 3, skipped: 0, reason: '', unmatchedAuthors: ['Pat Example'] },
    fields: { created: ['Stage'], reused: ['Client'], asText: [], skipped: [], reason: '', valuesSet: 4, valuesDropped: 1 },
    tags: { added: ['urgent'], skipped: [] },
    people: { unmatched: ['ghost@nowhere.test'], cannotOpen: [] }
};
const two = {
    tasks: 1, subtasks: { level2: 0, level3: 2 }, checklistItems: 1, links: 0,
    comments: { imported: 0, skipped: 2, reason: 'no_permission', unmatchedAuthors: ['Pat Example', 'Sam'] },
    fields: { created: ['Budget'], reused: ['Stage', 'Client'], asText: ['Site'], skipped: ['Notes'], reason: 'no_permission', valuesSet: 2, valuesDropped: 0 },
    tags: { added: [], skipped: ['later'] },
    people: { unmatched: ['ghost@nowhere.test'], cannotOpen: ['lee@private.test'] }
};
const NOTHING_ELSE = {
    subtasks: { level2: 0, level3: 0 }, checklistItems: 0, links: 0,
    comments: { imported: 0, skipped: 0, reason: '', unmatchedAuthors: [] },
    fields: { created: [], reused: [], asText: [], skipped: [], reason: '', valuesSet: 0, valuesDropped: 0 },
    tags: { added: [], skipped: [] },
    people: { unmatched: [], cannotOpen: [] }
};

describe('the summaries of several lists as one', () => {
    it('adds the counts and names each thing once, as the server does for the preview', () => {
        expect(mergeSummaries([one, two])).toEqual({
            tasks: 3, subtasks: { level2: 1, level3: 2 }, checklistItems: 3, links: 1,
            comments: { imported: 3, skipped: 2, reason: 'no_permission', unmatchedAuthors: ['Pat Example', 'Sam'] },
            fields: { created: ['Stage', 'Budget'], reused: ['Client'], asText: ['Site'], skipped: ['Notes'], reason: 'no_permission', valuesSet: 6, valuesDropped: 1 },
            tags: { added: ['urgent'], skipped: ['later'] },
            people: { unmatched: ['ghost@nowhere.test'], cannotOpen: ['lee@private.test'] }
        });
    });

    it('is all zeroes for no lists, and passes over an answer without a summary', () => {
        expect(mergeSummaries([])).toMatchObject({ tasks: 0, links: 0, fields: { created: [], valuesSet: 0 } });
        expect(mergeSummaries([undefined, one]).tasks).toBe(2);
    });
});

describe('the counts a person reads', () => {
    const merged = mergeSummaries([one, two]);
    const rows = Object.fromEntries(countRows(merged, t, 'WorkspaceImport').map((row) => [row.key, row]));

    it('has a row per kind, each with what came in', () => {
        expect(Object.keys(rows)).toEqual(['tasks', 'subtasks_2', 'subtasks_3', 'comments', 'fields', 'values', 'checklist', 'tags', 'links', 'people']);
        expect(rows.tasks).toEqual({ key: 'tasks', label: 'WorkspaceImport.counts_tasks', into: 3, out: '' });
        expect([rows.subtasks_2.into, rows.subtasks_3.into, rows.comments.into, rows.values.into, rows.checklist.into, rows.tags.into, rows.links.into]).toEqual([1, 2, 3, 6, 3, 1, 1]);
        expect(rows.fields.into).toBe('WorkspaceImport.counts_fields_in:{"created":2,"reused":1}');
    });

    it('says what was left out and why', () => {
        expect(rows.comments.out).toBe('WorkspaceImport.out_comments_no_permission:{"count":2}');
        expect(rows.fields.out).toBe('WorkspaceImport.out_fields_no_permission:{"count":1}');
        expect(rows.values.out).toBe('WorkspaceImport.out_values:{"count":1}');
        expect(rows.tags.out).toBe('WorkspaceImport.out_tags:{"count":1}');
        expect(rows.people).toMatchObject({ into: '', out: 'WorkspaceImport.out_people_unmatched:{"count":1}; WorkspaceImport.out_people_cannot_open:{"count":1}' });
    });

    it('leaves out the kinds the file does not hold', () => {
        const bare = mergeSummaries([{ tasks: 2, ...NOTHING_ELSE }]);
        expect(countRows(bare, t, 'WorkspaceImport').map((row) => row.key)).toEqual(['tasks']);
        expect(countNotes(bare, t, 'WorkspaceImport', true)).toEqual([]);
    });

    it('says that attachments are links, before and after, and names what needs a second look', () => {
        expect(countNotes(merged, t, 'WorkspaceImport', true).map((note) => note.text)).toEqual([
            'WorkspaceImport.note_links_plan:{"count":1}',
            'WorkspaceImport.note_as_text:{"names":"Site"}',
            'WorkspaceImport.note_fields_skipped:{"names":"Notes"}',
            'WorkspaceImport.note_tags_skipped:{"names":"later"}',
            'WorkspaceImport.note_authors:{"names":"Pat Example, Sam"}',
            'WorkspaceImport.note_people_cannot_open:{"names":"lee@private.test"}'
        ]);
        expect(countNotes(merged, t, 'WorkspaceImport', false)[0].text).toBe('WorkspaceImport.note_links_done:{"count":1}');
    });

    it('says a comment or a field could not be saved when that is why it is missing', () => {
        const failed = mergeSummaries([{ ...one, comments: { imported: 1, skipped: 2, reason: 'failed', unmatchedAuthors: [] }, fields: { ...one.fields, skipped: ['Stage'], reason: 'failed' } }]);
        const out = Object.fromEntries(countRows(failed, t, 'WorkspaceImport').map((row) => [row.key, row.out]));
        expect(out.comments).toBe('WorkspaceImport.out_comments_failed:{"count":2}');
        expect(out.fields).toBe('WorkspaceImport.out_fields_failed:{"count":1}');
    });
});
