import { beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import { defineComponent, h } from 'vue';
import { createStore } from 'vuex';

const { apiRequest, readSheet } = vi.hoisted(() => ({ apiRequest: vi.fn(), readSheet: vi.fn() }));

vi.mock('@/services', () => ({ apiRequest, apiRequestWithoutCompnay: vi.fn() }));
vi.mock('@/components/organisms/WorkspaceImport/readSheet', () => ({ readSheet }));
vi.mock('@/composable', () => ({ useCustomComposable: () => ({ checkPermission: () => true }) }));
vi.mock('@/components/organisms/ImportDialog/ImportSourceModals.vue', () => ({
    default: defineComponent({ name: 'ImportSourceModals', setup: () => () => h('div') })
}));

import WorkspaceImportDialog from '@/components/organisms/WorkspaceImport/WorkspaceImportDialog.vue';
import ImportUndo from '@/components/organisms/WorkspaceImport/ImportUndo.vue';
import RecentImports from '@/components/organisms/WorkspaceImport/RecentImports.vue';
import { countRows, mergeSummaries } from '@/components/organisms/WorkspaceImport/importSummary';
import { IMPORT_CLICKUP, IMPORT_CLICKUP_PREVIEW, IMPORTS } from '@/config/env';

const ROWS = [
    { 'Task ID': 'a1', 'Task Name': 'Plan', 'List Name': 'Backlog' },
    { 'Task ID': 'a2', 'Task Name': 'Build', 'List Name': 'Backlog' },
    { 'Task ID': 'a3', 'Task Name': 'Ship', 'List Name': 'Backlog' }
];

const previewOf = (over = {}) => ({
    total: 3, importable: 3, alreadyImported: 0, canAddDetails: true, skippedRows: [],
    lists: [{ key: 'b', name: 'Backlog', folder: '', space: 'Product', rowIndexes: [0, 1, 2], tasks: 3, subtasks: 0, alreadyImported: 0 }],
    statuses: [], newStatuses: [], tags: [], newTags: [], customFields: [], matchedAssignees: [], unmatchedAssignees: [], assigneeEmails: [], unnamedAssignees: [],
    unreadDates: [], dayFirstColumns: [], unreadColumns: [], ignoredColumns: [],
    ...over
});

const PROJECT = { _id: 'p1', ProjectName: 'Web', sprintsObj: { s1: { id: 's1', name: 'Sprint 1' } }, sprintsfolders: {} };
const t = (key, values) => (values ? `${key}:${JSON.stringify(values)}` : key);

const store = () => createStore({
    modules: {
        settings: { namespaced: true, actions: { setfinalCustomFields: vi.fn() } },
        projectData: { namespaced: true, getters: { projects: () => ({ data: [PROJECT] }) } },
        users: { namespaced: true, getters: { users: () => [] } }
    }
});

const posted = (url) => apiRequest.mock.calls.filter(([method, endpoint]) => method === 'post' && endpoint === url).map(([, , body]) => body);

const answers = { preview: previewOf(), imported: { jobId: 'j1', created: 3, skipped: 0 }, undo: [], jobs: [] };

const openInProject = async () => {
    const wrapper = mount(WorkspaceImportDialog, { props: { initialSource: 'clickup', project: PROJECT }, global: { plugins: [store()], stubs: { teleport: true } } });
    const input = wrapper.find('[data-test="wim-file"]');
    Object.defineProperty(input.element, 'files', { value: [new File(['x'], 'clickup.csv')], configurable: true });
    await input.trigger('change');
    await flushPromises();
    return wrapper;
};

const toPreview = async (wrapper) => {
    await wrapper.find('[data-test="wim-next"]').trigger('click');
    await flushPromises();
};

beforeEach(() => {
    Object.assign(answers, { preview: previewOf(), imported: { jobId: 'j1', created: 3, skipped: 0 }, undo: [], jobs: [] });
    readSheet.mockResolvedValue(ROWS);
    apiRequest.mockReset();
    apiRequest.mockImplementation(async (method, url) => {
        if (url === IMPORT_CLICKUP_PREVIEW) return { data: { status: true, data: answers.preview } };
        if (url === IMPORT_CLICKUP) return { data: { status: true, data: answers.imported } };
        if (method === 'get' && url.startsWith(IMPORTS)) return { data: { status: true, data: answers.jobs } };
        if (url.endsWith('/undo')) {
            const answer = answers.undo.shift();
            if (answer.refused) throw Object.assign(new Error('refused'), { response: { data: answer.refused } });
            return { data: { status: true, data: answer } };
        }
        return { data: { status: false } };
    });
});

describe('a file whose tasks are already in the project', () => {
    it('says how many, leaves them alone unless asked, and counts only the new ones on the button', async () => {
        answers.preview = previewOf({ alreadyImported: 2 });
        const wrapper = await openInProject();
        await toPreview(wrapper);

        expect(wrapper.find('[data-test="wim-existing"]').text()).toContain('WorkspaceImport.existing_legend');
        expect(wrapper.find('[data-test="wim-existing-skip"]').element.checked).toBe(true);
        expect(wrapper.find('[data-test="wim-run"]').text()).toBe('WorkspaceImport.run');
        expect(wrapper.find('[data-test="wim-run"]').attributes('disabled')).toBeUndefined();

        await wrapper.find('[data-test="wim-run"]').trigger('click');
        await flushPromises();
        expect(posted(IMPORT_CLICKUP)).toEqual([{ rows: ROWS, projectId: 'p1', sprintId: 's1', options: { createMissingStatuses: true } }]);
    });

    it('offers nothing to import when every task is already here', async () => {
        answers.preview = previewOf({ alreadyImported: 3 });
        const wrapper = await openInProject();
        await toPreview(wrapper);
        expect(wrapper.find('[data-test="wim-run"]').attributes('disabled')).toBeDefined();
    });

    it('previews again and imports with "update" once the person chooses it, with the date order the file showed', async () => {
        answers.preview = previewOf({ alreadyImported: 3, dayFirstColumns: ['due'] });
        const wrapper = await openInProject();
        await toPreview(wrapper);

        await wrapper.find('[data-test="wim-existing-update"]').setValue(true);
        await flushPromises();
        const previews = posted(IMPORT_CLICKUP_PREVIEW);
        expect(previews[previews.length - 1]).toEqual({ rows: ROWS, projectId: 'p1', options: { createMissingStatuses: true, existing: 'update' } });
        expect(wrapper.find('[data-test="wim-run"]').attributes('disabled')).toBeUndefined();

        answers.imported = { jobId: 'j1', created: 0, updated: 3, skipped: 0 };
        await wrapper.find('[data-test="wim-run"]').trigger('click');
        await flushPromises();
        expect(posted(IMPORT_CLICKUP)).toEqual([{ rows: ROWS, projectId: 'p1', sprintId: 's1', options: { createMissingStatuses: true, existing: 'update', dayFirst: ['due'] } }]);
        expect(wrapper.find('[data-test="wim-updated"]').text()).toBe('WorkspaceImport.summary_updated');
        expect(wrapper.find('[data-test="wim-undo"]').exists()).toBe(false);
    });
});

describe('a task counts as already here in one project only', () => {
    it('says so in the preview, whether or not this project holds any of the file', async () => {
        const wrapper = await openInProject();
        await toPreview(wrapper);
        expect(wrapper.find('[data-test="wim-existing"]').exists()).toBe(false);
        expect(wrapper.find('[data-test="wim-duplicates-scope"]').text()).toBe('WorkspaceImport.fact_duplicates_scope');
    });
});

describe('a status the project does not have, on a task that is updated', () => {
    it('is named when the import finishes: the task kept its status', async () => {
        answers.preview = previewOf({ alreadyImported: 3 });
        const wrapper = await openInProject();
        await toPreview(wrapper);
        await wrapper.find('[data-test="wim-existing-update"]').setValue(true);
        await flushPromises();

        answers.imported = { jobId: 'j1', created: 0, updated: 3, skipped: 0, skippedCells: [{ name: 'Plan', column: 'status', value: 'in review', code: 'UNKNOWN_STATUS' }] };
        await wrapper.find('[data-test="wim-run"]').trigger('click');
        await flushPromises();

        const cells = wrapper.findAll('[data-test="wim-skipped-cell"]');
        expect(cells).toHaveLength(1);
        expect(cells[0].text()).toBe('WorkspaceImport.skipped_cell_UNKNOWN_STATUS');
    });

    it('says nothing when every cell was applied', async () => {
        const wrapper = await openInProject();
        await toPreview(wrapper);
        await wrapper.find('[data-test="wim-run"]').trigger('click');
        await flushPromises();
        expect(wrapper.find('[data-test="wim-skipped-cells"]').exists()).toBe(false);
    });
});

describe('what the preview owns up to', () => {
    it('names each date it cannot read, the columns it does not import and the ones it does not know', async () => {
        answers.preview = previewOf({
            unreadDates: [{ row: 4, name: 'Ship', column: 'Start Date', value: 'next sprint' }],
            unreadColumns: ['Time Logged', 'Dependencies'],
            ignoredColumns: ['Internal Ref']
        });
        const wrapper = await openInProject();
        await toPreview(wrapper);
        expect(wrapper.findAll('[data-test="wim-unread-date"]')).toHaveLength(1);
        expect(wrapper.find('[data-test="wim-unread-columns"]').exists()).toBe(true);
        expect(wrapper.find('[data-test="wim-ignored-columns"]').exists()).toBe(true);
    });

    it('switches "add missing statuses and tags" off for a person who may not edit the project, before anything is refused', async () => {
        answers.preview = previewOf({ canAddDetails: false });
        const wrapper = await openInProject();
        expect(wrapper.find('[data-test="wim-add-missing"]').element.checked).toBe(true);
        await toPreview(wrapper);

        const previews = posted(IMPORT_CLICKUP_PREVIEW);
        expect(previews[previews.length - 1].options).toEqual({ createMissingStatuses: false });
        expect(wrapper.find('[data-test="wim-add-denied-fact"]').text()).toBe('WorkspaceImport.add_missing_denied');
        await wrapper.find('[data-test="wim-run"]').trigger('click');
        await flushPromises();
        expect(posted(IMPORT_CLICKUP)[0].options).toEqual({ createMissingStatuses: false });
    });
});

describe('undoing an import', () => {
    const undoOf = (props) => mount(ImportUndo, { props });

    it('is offered when the import finishes, asks first, and says what went to the trash', async () => {
        const wrapper = await openInProject();
        await toPreview(wrapper);
        await wrapper.find('[data-test="wim-run"]').trigger('click');
        await flushPromises();

        const undo = wrapper.find('[data-test="wim-undo"]');
        expect(undo.exists()).toBe(true);
        await undo.find('[data-test="imu-start"]').trigger('click');
        expect(posted(`${IMPORTS}/j1/undo`)).toEqual([]);
        expect(undo.find('[data-test="imu-question"]').text()).toBe('WorkspaceImport.undo_confirm');

        answers.undo = [{ trashed: 3, kept: [] }];
        await undo.find('[data-test="imu-confirm"]').trigger('click');
        await flushPromises();
        expect(posted(`${IMPORTS}/j1/undo`)).toEqual([{ keepEdited: false }]);
        expect(undo.find('[data-test="imu-done"]').text()).toBe('WorkspaceImport.undo_done');
    });

    it('stops when tasks have been worked on, names them, and keeps them once the person agrees', async () => {
        const wrapper = undoOf({ jobIds: ['j1', 'j2'], count: 5 });
        await wrapper.find('[data-test="imu-start"]').trigger('click');
        answers.undo = [
            { trashed: 2, kept: [] },
            { refused: { status: false, code: 'EDITED', data: { edited: [{ id: 't1', name: 'Hero illustration' }], editedCount: 1 } } }
        ];
        await wrapper.find('[data-test="imu-confirm"]').trigger('click');
        await flushPromises();

        expect(wrapper.find('[data-test="imu-edited"]').text()).toBe('Hero illustration');
        expect(wrapper.find('[data-test="imu-confirm"]').text()).toBe('WorkspaceImport.undo_keep_edited');
        expect(wrapper.emitted('undone')).toBeUndefined();

        answers.undo = [{ trashed: 2, kept: [{ id: 't1', name: 'Hero illustration' }] }];
        await wrapper.find('[data-test="imu-confirm"]').trigger('click');
        await flushPromises();
        expect(posted(`${IMPORTS}/j2/undo`)).toEqual([{ keepEdited: false }, { keepEdited: true }]);
        expect(posted(`${IMPORTS}/j1/undo`)).toHaveLength(1);
        expect(wrapper.find('[data-test="imu-kept"]').text()).toBe('Hero illustration');
        expect(wrapper.emitted('undone')[0]).toEqual([{ trashed: 4 }]);
    });

    it('says so when it fails, and can be tried again', async () => {
        const wrapper = undoOf({ jobIds: ['j1'], count: 1 });
        await wrapper.find('[data-test="imu-start"]').trigger('click');
        answers.undo = [{ refused: { status: false, code: 'NOT_ALLOWED', statusText: 'Only the person who ran an import can undo it.' } }];
        await wrapper.find('[data-test="imu-confirm"]').trigger('click');
        await flushPromises();
        expect(wrapper.find('[role="alert"]').text()).toBe('Only the person who ran an import can undo it.');
        expect(wrapper.find('[data-test="imu-confirm"]').exists()).toBe(true);
    });
});

describe('the list of recent imports', () => {
    it('shows each import of the project with what it made, and offers undo for the ones that can be undone', async () => {
        answers.jobs = [
            { _id: 'j2', source: 'clickup', status: 'done', created: 20, updated: 0, createdAt: '2026-10-01T10:00:00.000Z' },
            { _id: 'j1', source: 'csv', status: 'undone', created: 4, createdAt: '2026-09-30T10:00:00.000Z' },
            { _id: 'j0', source: 'clickup', status: 'done', created: 0, updated: 12, createdAt: '2026-09-29T10:00:00.000Z' }
        ];
        const wrapper = mount(RecentImports, { props: { projectId: 'p1' } });
        await flushPromises();

        expect(apiRequest).toHaveBeenCalledWith('get', `${IMPORTS}?projectId=p1`);
        const rows = wrapper.findAll('[data-test="rim-job"]');
        expect(rows).toHaveLength(3);
        expect(rows.map((row) => row.find('[data-test="imu-start"]').exists())).toEqual([true, false, false]);
        expect(rows[1].find('[data-test="rim-status"]').text()).toBe('WorkspaceImport.recent_status_undone');
    });

    it('shows nothing where there has been no import', async () => {
        const wrapper = mount(RecentImports);
        await flushPromises();
        expect(wrapper.find('section').exists()).toBe(false);
    });
});

describe('the counts of an import that found tasks already here', () => {
    const summaryOf = (existing) => ({
        tasks: 1, subtasks: { level2: 0, level3: 0 }, checklistItems: 0, links: 0,
        comments: { imported: 0, skipped: 0, reason: '', unmatchedAuthors: [] },
        fields: { created: [], reused: [], asText: [], skipped: [], reason: '', valuesSet: 0, valuesDropped: 0 },
        tags: { added: [], skipped: [] }, people: { unmatched: [], cannotOpen: [] }, existing
    });

    it('adds them up over the lists and gives them a row', () => {
        const merged = mergeSummaries([summaryOf({ skipped: 2, updated: 0 }), summaryOf({ skipped: 1, updated: 4 })]);
        expect(merged.existing).toEqual({ skipped: 3, updated: 4 });
        const row = countRows(merged, t, 'WorkspaceImport').find((entry) => entry.key === 'existing');
        expect(row).toEqual({ key: 'existing', label: 'WorkspaceImport.counts_existing', into: 'WorkspaceImport.counts_existing_updated:{"count":4}', out: 'WorkspaceImport.out_existing:{"count":3}' });
    });

    it('has no such row when nothing was already here, and reads an older answer without the count', () => {
        const { existing, ...older } = summaryOf({ skipped: 0, updated: 0 });
        expect(existing).toEqual({ skipped: 0, updated: 0 });
        expect(countRows(mergeSummaries([older]), t, 'WorkspaceImport').map((row) => row.key)).toEqual(['tasks']);
    });
});
