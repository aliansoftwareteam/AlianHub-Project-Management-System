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

const store = () => createStore({
    modules: {
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

beforeEach(() => {
    permissions.create = true;
    readSheet.mockResolvedValue(ROWS);
    apiRequest.mockImplementation(async (method, url, body) => {
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

    it('imports into a chosen project and list, previewing against that project', async () => {
        const wrapper = open({ initialSource: 'clickup' });
        await uploadFile(wrapper);
        await wrapper.find('[data-test="wim-mode-existing"]').setValue(true);
        expect(wrapper.find('[data-test="wim-next"]').attributes('disabled')).toBeDefined();
        const projects = wrapper.find('[data-test="wim-project"]');
        expect(projects.findAll('option').map((o) => o.text())).toEqual(['WorkspaceImport.project_pick', 'Web']);
        await projects.setValue('p1');
        await wrapper.find('[data-test="wim-sprint"]').setValue('s2');
        await wrapper.find('[data-test="wim-next"]').trigger('click');
        await flushPromises();
        expect(posted(IMPORT_CLICKUP_PREVIEW)[1]).toEqual({ rows: ROWS, projectId: 'p1' });
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
        expect(posted(IMPORT_CLICKUP_PREVIEW)[1]).toEqual({ rows: ROWS, projectId: 'p1' });
    });

    it('hands the other sources to their own importer for the chosen project', async () => {
        const wrapper = open();
        await wrapper.find('[data-source="jira"]').trigger('click');
        expect(step(wrapper)).toBe('WorkspaceImport.step_target');
        await wrapper.find('[data-test="wim-project"]').setValue('p1');
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
