import { beforeEach, describe, expect, it, vi } from 'vitest';
import { defineComponent, h } from 'vue';
import { flushPromises, mount } from '@vue/test-utils';
import { createStore } from 'vuex';

const { apiRequest, readSheet, permissions } = vi.hoisted(() => ({ apiRequest: vi.fn(), readSheet: vi.fn(), permissions: { create: true } }));

vi.mock('@/services', () => ({ apiRequest, apiRequestWithoutCompnay: vi.fn() }));
vi.mock('@/components/organisms/WorkspaceImport/readSheet', () => ({ readSheet }));
vi.mock('@/composable', () => ({ useCustomComposable: () => ({ checkPermission: (key) => (key === 'project.project_create' ? permissions.create : true) }) }));
vi.mock('@/components/organisms/ImportDialog/ImportSourceModals.vue', () => ({
    default: defineComponent({ name: 'ImportSourceModals', props: ['source', 'projectData', 'sprint', 'users'], setup: (props) => () => h('div', { class: 'modals-stub', 'data-source': props.source, 'data-project': props.projectData?._id, 'data-sprint': props.sprint?.id }) })
}));

import WorkspaceImportDialog from '@/components/organisms/WorkspaceImport/WorkspaceImportDialog.vue';
import { IMPORT_CLICKUP, IMPORT_CLICKUP_PREVIEW, IMPORT_CLICKUP_PROJECT } from '@/config/env';
import { resetProjectTreeCache } from '@/components/molecules/ProjectTree/projectTreeData';

const ROWS = [
    { 'Task Name': 'Plan', 'List Name': 'Backlog' },
    { 'Task Name': 'Build', 'List Name': 'Backlog' },
    { 'Task Name': '', 'List Name': 'Launch' },
    { 'Task Name': 'Ship', 'List Name': 'Launch' }
];

const PREVIEW = {
    total: 4,
    importable: 3,
    skippedRows: [{ row: 3, code: 'no_name', reason: 'The task has no name.' }],
    lists: [
        { key: 'b', name: 'Backlog', folder: '', space: 'Product', rowIndexes: [0, 1], tasks: 2, subtasks: 0 },
        { key: 'l', name: 'Launch', folder: '', space: 'Product', rowIndexes: [3], tasks: 1, subtasks: 0 }
    ],
    statuses: [], newStatuses: [{ name: 'In Review', type: 'active' }], tags: [], newTags: ['billing'], customFields: [],
    matchedAssignees: ['max@member.test'], unmatchedAssignees: ['ghost@nowhere.test'], assigneeEmails: [], unnamedAssignees: []
};

const PROJECT = { _id: 'p1', ProjectName: 'Web', sprintsObj: { s1: { id: 's1', name: 'Sprint 1' } }, sprintsfolders: { f1: { folderId: 'f1', folderName: 'Q3', sprintsObj: { s2: { id: 's2', name: 'Sprint 2' } } } } };

const reloadFields = vi.fn();

const store = () => createStore({
    modules: {
        settings: { namespaced: true, actions: { setfinalCustomFields: reloadFields } },
        projectData: { namespaced: true, getters: { projects: () => ({ data: [PROJECT, { _id: 'gone', ProjectName: 'Gone', deletedStatusKey: 1 }] }) } },
        users: { namespaced: true, getters: { users: () => [] } }
    }
});

const open = (props = {}) => mount(WorkspaceImportDialog, { props, global: { plugins: [store()], stubs: { teleport: true } } });
const step = (wrapper) => wrapper.find('[data-test="wim-step"]').text();
const posted = (url) => apiRequest.mock.calls.filter(([method, endpoint]) => method === 'post' && endpoint === url).map(([, , body]) => body);

const uploadFile = async (wrapper) => {
    const input = wrapper.find('[data-test="wim-file"]');
    Object.defineProperty(input.element, 'files', { value: [new File(['x'], 'clickup.csv')], configurable: true });
    await input.trigger('change');
    await flushPromises();
};

const summaryOf = (over = {}) => ({
    tasks: 2, subtasks: { level2: 1, level3: 0 }, checklistItems: 2, links: 1,
    comments: { imported: 3, skipped: 0, reason: '', unmatchedAuthors: ['Pat Example'] },
    fields: { created: ['Stage'], reused: [], asText: [], skipped: [], reason: '', valuesSet: 4, valuesDropped: 1 },
    tags: { added: ['urgent'], skipped: [] },
    people: { unmatched: ['ghost@nowhere.test'], cannotOpen: [] },
    ...over
});

const TREE = {
    sprints: [{ _id: 's1', projectId: 'p1', name: 'Sprint 1' }, { _id: 's2', projectId: 'p1', folderId: 'f1', name: 'Sprint 2' }],
    folders: [{ _id: 'f1', projectId: 'p1', name: 'Q3' }]
};

beforeEach(() => {
    resetProjectTreeCache();
    reloadFields.mockClear();
    permissions.create = true;
    readSheet.mockResolvedValue(ROWS);
    apiRequest.mockImplementation(async (method, url, body) => {
        if (method === 'get' && url.endsWith('collection=sprints')) return { data: TREE.sprints };
        if (method === 'get' && url.endsWith('collection=folders')) return { data: TREE.folders };
        if (url === IMPORT_CLICKUP_PREVIEW) return { data: { status: true, data: PREVIEW } };
        if (url === IMPORT_CLICKUP_PROJECT) return { data: { status: true, data: { projectId: `new-${body.listName}`, created: body.rows.length, skipped: 0, unmatchedAssignees: ['ghost@nowhere.test'] } } };
        if (url === IMPORT_CLICKUP) return { data: { status: true, data: { created: body.rows.length, skipped: 0 } } };
        return { data: { status: false } };
    });
});

describe('the workspace import dialog', () => {
    it('starts by asking for the source, ClickUp among the rest', () => {
        const wrapper = open();
        expect(step(wrapper)).toBe('WorkspaceImport.step_source');
        expect(wrapper.findAll('[data-source]').map((b) => b.attributes('data-source'))).toEqual(['clickup', 'csv', 'jira', 'trello', 'asana', 'monday']);
    });

    it('walks ClickUp from file to target, preview, run and summary, one new project per list', async () => {
        const wrapper = open();
        await wrapper.find('[data-source="clickup"]').trigger('click');
        expect(step(wrapper)).toBe('WorkspaceImport.step_file');

        await uploadFile(wrapper);
        expect(posted(IMPORT_CLICKUP_PREVIEW)[0]).toEqual({ rows: ROWS });
        expect(step(wrapper)).toBe('WorkspaceImport.step_target');
        expect(wrapper.find('[data-test="wim-mode-new"]').element.checked).toBe(true);

        await wrapper.find('[data-test="wim-next"]').trigger('click');
        await flushPromises();
        expect(step(wrapper)).toBe('WorkspaceImport.step_preview');
        const preview = wrapper.find('[data-test="wim-preview"]');
        expect(preview.findAll('tbody tr').map((row) => row.findAll('td').map((cell) => cell.text().split('\n')[0].trim()))).toEqual([['BacklogProduct', '2', '0'], ['LaunchProduct', '1', '0']]);
        expect(preview.text()).toContain('WorkspaceImport.fact_unmatched');
        expect(preview.text()).toContain('WorkspaceImport.fact_skipped');

        await wrapper.find('[data-test="wim-run"]').trigger('click');
        await flushPromises();
        expect(posted(IMPORT_CLICKUP_PROJECT)).toEqual([
            { rows: [ROWS[0], ROWS[1]], listName: 'Backlog' },
            { rows: [ROWS[3]], listName: 'Launch' }
        ]);
        expect(step(wrapper)).toBe('WorkspaceImport.step_done');
        const summary = wrapper.find('[data-test="wim-summary"]');
        expect(summary.text()).toContain('WorkspaceImport.summary_created');
        expect(summary.text()).toContain('WorkspaceImport.summary_skipped_row');
        expect(summary.text()).toContain('WorkspaceImport.summary_unmatched');
        expect(wrapper.emitted('imported')).toHaveLength(1);

        await wrapper.find('[data-test="wim-finish"]').trigger('click');
        expect(wrapper.emitted('close')).toHaveLength(1);
    });

    it('says in the summary which subtasks could not keep the place the file gave them', async () => {
        apiRequest.mockImplementation(async (method, url, body) => {
            if (url === IMPORT_CLICKUP_PREVIEW) return { data: { status: true, data: PREVIEW } };
            const adjusted = body.listName === 'Backlog'
                ? { tooDeep: 2, parentMissing: 0, cycle: 0, rows: [{ name: 'Too deep', reason: 'TOO_DEEP' }, { name: 'Deeper still', reason: 'TOO_DEEP' }] }
                : { tooDeep: 1, parentMissing: 1, cycle: 0, rows: [{ name: 'Deepest', reason: 'TOO_DEEP' }, { name: 'Orphan', reason: 'PARENT_MISSING' }] };
            return { data: { status: true, data: { projectId: `new-${body.listName}`, created: body.rows.length, skipped: 0, adjusted } } };
        });
        const wrapper = open({ initialSource: 'clickup' });
        await uploadFile(wrapper);
        await wrapper.find('[data-test="wim-next"]').trigger('click');
        await flushPromises();
        await wrapper.find('[data-test="wim-run"]').trigger('click');
        await flushPromises();

        const lines = wrapper.findAll('[data-test="wim-adjusted"] li').map((line) => line.text());
        expect(lines).toHaveLength(2);
        expect(lines[0]).toContain('WorkspaceImport.summary_too_deep');
        expect(lines[0]).toContain('Too deep, Deeper still, Deepest');
        expect(lines[1]).toContain('WorkspaceImport.summary_parent_missing');
        expect(lines[1]).toContain('Orphan');
    });

    it('has no such line when every subtask kept its place', async () => {
        const wrapper = open({ initialSource: 'clickup' });
        await uploadFile(wrapper);
        await wrapper.find('[data-test="wim-next"]').trigger('click');
        await flushPromises();
        await wrapper.find('[data-test="wim-run"]').trigger('click');
        await flushPromises();
        expect(wrapper.find('[data-test="wim-summary"]').exists()).toBe(true);
        expect(wrapper.find('[data-test="wim-adjusted"]').exists()).toBe(false);
    });

    it('shows before the import what it will bring in, and after it what came in across the lists', async () => {
        apiRequest.mockImplementation(async (method, url, body) => {
            if (url === IMPORT_CLICKUP_PREVIEW) return { data: { status: true, data: { ...PREVIEW, plan: summaryOf({ tasks: 3 }) } } };
            const summary = body.rows.length === 2 ? summaryOf() : summaryOf({ tasks: 1, subtasks: { level2: 0, level3: 0 }, links: 2, fields: { created: [], reused: ['Stage'], asText: [], skipped: [], reason: '', valuesSet: 1, valuesDropped: 0 } });
            return { data: { status: true, data: { created: body.rows.length, skipped: 0, summary } } };
        });
        const wrapper = open({ initialSource: 'clickup', project: PROJECT });
        await uploadFile(wrapper);
        await wrapper.find('[data-test="wim-next"]').trigger('click');
        await flushPromises();

        const cells = (root, kind) => root.find(`[data-kind="${kind}"]`).findAll('td').map((cell) => cell.text());
        const plan = wrapper.find('[data-test="wim-plan"]');
        expect(plan.text()).toContain('WorkspaceImport.counts_caption_plan');
        expect(cells(plan, 'tasks')).toEqual(['3', '']);
        expect(plan.find('[data-note="note_links"]').text()).toBe('WorkspaceImport.note_links_plan');

        await wrapper.find('[data-test="wim-run"]').trigger('click');
        await flushPromises();
        const counts = wrapper.find('[data-test="wim-counts"]');
        expect(counts.text()).toContain('WorkspaceImport.counts_caption_done');
        expect(cells(counts, 'tasks')).toEqual(['3', '']);
        expect(cells(counts, 'links')).toEqual(['3', '']);
        expect(cells(counts, 'values')).toEqual(['5', 'WorkspaceImport.out_values']);
        expect(cells(counts, 'people')).toEqual(['', 'WorkspaceImport.out_people_unmatched']);
        expect(counts.find('[data-note="note_links"]').text()).toBe('WorkspaceImport.note_links_done');
        expect(reloadFields).toHaveBeenCalledTimes(1);
    });

    it('shows no counts table for an answer that carries none, and reloads no fields', async () => {
        const wrapper = open({ initialSource: 'clickup' });
        await uploadFile(wrapper);
        await wrapper.find('[data-test="wim-next"]').trigger('click');
        await flushPromises();
        expect(wrapper.find('[data-test="wim-plan"]').exists()).toBe(false);
        await wrapper.find('[data-test="wim-run"]').trigger('click');
        await flushPromises();
        expect(wrapper.find('[data-test="wim-counts"]').exists()).toBe(false);
        expect(reloadFields).not.toHaveBeenCalled();
    });

    it('imports into a chosen project and list, previewing against that project', async () => {
        const wrapper = open({ initialSource: 'clickup' });
        await uploadFile(wrapper);
        await wrapper.find('[data-test="wim-mode-existing"]').setValue(true);
        expect(wrapper.find('[data-test="wim-next"]').attributes('disabled')).toBeDefined();
        const projects = wrapper.find('[data-test="wim-project"]');
        expect(projects.findAll('option').map((o) => o.text())).toEqual(['WorkspaceImport.project_pick', 'Web']);
        await projects.setValue('p1');
        await flushPromises();
        await wrapper.find('[data-test="wim-sprint"]').setValue('s2');
        await wrapper.find('[data-test="wim-next"]').trigger('click');
        await flushPromises();
        expect(posted(IMPORT_CLICKUP_PREVIEW)[1]).toEqual({ rows: ROWS, projectId: 'p1', options: { createMissingStatuses: true } });
        await wrapper.find('[data-test="wim-run"]').trigger('click');
        await flushPromises();
        expect(posted(IMPORT_CLICKUP)).toEqual([
            { rows: [ROWS[0], ROWS[1]], projectId: 'p1', sprintId: 's2', options: { createMissingStatuses: true } },
            { rows: [ROWS[3]], projectId: 'p1', sprintId: 's2', options: { createMissingStatuses: true } }
        ]);
        expect(posted(IMPORT_CLICKUP_PROJECT)).toEqual([]);
    });

    it('offers no new projects to someone who may not create them', async () => {
        permissions.create = false;
        const wrapper = open({ initialSource: 'clickup' });
        await uploadFile(wrapper);
        expect(wrapper.find('[data-test="wim-mode-new"]').attributes('disabled')).toBeDefined();
        expect(wrapper.find('[data-test="wim-mode-existing"]').element.checked).toBe(true);
    });

    it('from a project toolbar, keeps that project and goes straight to the file', async () => {
        const wrapper = open({ initialSource: 'clickup', project: PROJECT });
        expect(step(wrapper)).toBe('WorkspaceImport.step_file');
        expect(wrapper.find('[data-test="wim-back"]').exists()).toBe(false);
        await uploadFile(wrapper);
        expect(wrapper.find('[data-test="wim-mode-new"]').exists()).toBe(false);
        expect(wrapper.find('[data-test="wim-project"]').exists()).toBe(false);
        await wrapper.find('[data-test="wim-next"]').trigger('click');
        await flushPromises();
        expect(posted(IMPORT_CLICKUP_PREVIEW)[1]).toEqual({ rows: ROWS, projectId: 'p1', options: { createMissingStatuses: true } });
    });

    it('hands the other sources to their own importer for the chosen project', async () => {
        const wrapper = open();
        await wrapper.find('[data-source="jira"]').trigger('click');
        expect(step(wrapper)).toBe('WorkspaceImport.step_target');
        await wrapper.find('[data-test="wim-project"]').setValue('p1');
        await flushPromises();
        await wrapper.find('[data-test="wim-next"]').trigger('click');
        const modals = wrapper.find('.modals-stub');
        expect(modals.attributes('data-source')).toBe('jira');
        expect(modals.attributes('data-project')).toBe('p1');
        expect(modals.attributes('data-sprint')).toBe('s1');
        expect(wrapper.find('[data-test="wim-step"]').exists()).toBe(false);
        expect(wrapper.emitted('imported')).toEqual([[{ source: 'jira' }]]);
    });

    it('says why a file cannot be read and stays on the file step', async () => {
        apiRequest.mockResolvedValueOnce({ data: { status: false, statusText: 'The file has no "Task Name" column.' } });
        const wrapper = open({ initialSource: 'clickup' });
        await uploadFile(wrapper);
        expect(step(wrapper)).toBe('WorkspaceImport.step_file');
        expect(wrapper.find('[role="alert"]').text()).toContain('Task Name');
    });

    it('closes on Escape', async () => {
        const wrapper = open();
        await wrapper.find('[role="dialog"]').trigger('keydown', { key: 'Escape' });
        expect(wrapper.emitted('close')).toHaveLength(1);
    });
});
