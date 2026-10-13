import { beforeEach, describe, expect, it, vi } from 'vitest';
import { defineComponent, h } from 'vue';
import { flushPromises, mount } from '@vue/test-utils';
import { createStore } from 'vuex';

const { apiRequest, readSheet } = vi.hoisted(() => ({ apiRequest: vi.fn(), readSheet: vi.fn() }));

vi.mock('@/services', () => ({ apiRequest, apiRequestWithoutCompnay: vi.fn() }));
vi.mock('@/components/organisms/WorkspaceImport/readSheet', () => ({ readSheet }));
vi.mock('@/composable', () => ({ useCustomComposable: () => ({ checkPermission: () => true }) }));
vi.mock('@/components/organisms/ImportDialog/ImportSourceModals.vue', () => ({
    default: defineComponent({ name: 'ImportSourceModals', props: ['source', 'projectData', 'sprint', 'users'], setup: (props) => () => h('div', { class: 'modals-stub', 'data-sprint': props.sprint?.id }) })
}));

import WorkspaceImportDialog from '@/components/organisms/WorkspaceImport/WorkspaceImportDialog.vue';
import { resetProjectTreeCache } from '@/components/molecules/ProjectTree/projectTreeData';
import { listsOfTree } from '@/components/organisms/WorkspaceImport/workspaceImportState';

const SANDBOX = { _id: 'qa', ProjectName: 'QA Sandbox', sprintsObj: {}, sprintsfolders: {} };
const OTHER = { _id: 'other', ProjectName: 'Other' };

const LISTS = [
    { _id: 'l1', projectId: 'qa', name: 'Backlog' },
    { _id: 'l2', projectId: 'qa', name: 'Launch', folderId: 'f1' },
    { _id: 'l3', projectId: 'qa', name: 'Dropped', deletedStatusKey: 1 }
];
const FOLDERS = [{ _id: 'f1', projectId: 'qa', name: 'Q3' }];

const store = () => createStore({
    modules: {
        settings: { namespaced: true, actions: { setfinalCustomFields: vi.fn() } },
        projectData: { namespaced: true, getters: { projects: () => ({ data: [SANDBOX, OTHER] }) } },
        users: { namespaced: true, getters: { users: () => [] } }
    }
});

const treeCalls = () => apiRequest.mock.calls.filter(([method, url]) => method === 'get' && url.includes('collection='));
const sprintCalls = (id) => treeCalls().filter(([, url]) => url.includes(`/${id}?collection=sprints`));

const open = (props = {}) => mount(WorkspaceImportDialog, { props, global: { plugins: [store()], stubs: { teleport: true } } });

const toTarget = async (wrapper) => {
    const input = wrapper.find('[data-test="wim-file"]');
    Object.defineProperty(input.element, 'files', { value: [new File(['x'], 'clickup.csv')], configurable: true });
    await input.trigger('change');
    await flushPromises();
    await wrapper.find('[data-test="wim-mode-existing"]').setValue(true);
};

const pick = async (wrapper, id) => {
    await wrapper.find('[data-test="wim-project"]').setValue(id);
    await flushPromises();
};

const nextDisabled = (wrapper) => wrapper.find('[data-test="wim-next"]').attributes('disabled') !== undefined;
const listOptions = (wrapper) => wrapper.find('[data-test="wim-sprint"]').findAll('option').map((option) => option.text());

let treeAnswer;

beforeEach(() => {
    resetProjectTreeCache();
    apiRequest.mockReset();
    readSheet.mockResolvedValue([{ 'Task Name': 'Plan', 'List Name': 'Backlog' }]);
    treeAnswer = async (url) => ({ data: url.endsWith('collection=sprints') ? LISTS : FOLDERS });
    apiRequest.mockImplementation(async (method, url) => {
        if (method === 'get') return treeAnswer(url);
        return { data: { status: true, data: { total: 1, importable: 1, skippedRows: [], lists: [], newStatuses: [], newTags: [], customFields: [], matchedAssignees: [], unmatchedAssignees: [] } } };
    });
});

describe('the import dialog and the lists of a project that has not been opened', () => {
    it('loads the lists when the project is picked, then offers them and enables Next', async () => {
        const wrapper = open({ initialSource: 'clickup' });
        await toTarget(wrapper);
        expect(treeCalls()).toHaveLength(0);

        let release;
        const gate = new Promise((resolve) => { release = resolve; });
        treeAnswer = async (url) => {
            await gate;
            return { data: url.endsWith('collection=sprints') ? LISTS : FOLDERS };
        };
        await wrapper.find('[data-test="wim-project"]').setValue('qa');
        await flushPromises();
        expect(wrapper.find('[data-test="wim-sprint"]').attributes('disabled')).toBeDefined();
        expect(listOptions(wrapper)).toEqual(['WorkspaceImport.sprint_loading']);
        expect(nextDisabled(wrapper)).toBe(true);

        release();
        await flushPromises();

        expect(sprintCalls('qa')).toHaveLength(1);
        expect(wrapper.find('[data-test="wim-sprint"]').attributes('disabled')).toBeUndefined();
        expect(listOptions(wrapper)).toEqual(['Backlog', 'Q3 / Launch']);
        expect(wrapper.find('[data-test="wim-sprint"]').element.value).toBe('l1');
        expect(nextDisabled(wrapper)).toBe(false);
    });

    it('does not load a project again when it is picked a second time', async () => {
        const wrapper = open({ initialSource: 'clickup' });
        await toTarget(wrapper);
        await pick(wrapper, 'qa');
        await pick(wrapper, 'other');
        await pick(wrapper, 'qa');
        expect(sprintCalls('qa')).toHaveLength(1);
        expect(sprintCalls('other')).toHaveLength(1);
        expect(listOptions(wrapper)).toEqual(['Backlog', 'Q3 / Launch']);
        expect(nextDisabled(wrapper)).toBe(false);
    });

    it('says so when the load fails, keeps Next disabled, and loads again on Try again', async () => {
        treeAnswer = async () => { throw new Error('offline'); };
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        const wrapper = open({ initialSource: 'clickup' });
        await toTarget(wrapper);
        await pick(wrapper, 'qa');

        expect(wrapper.find('[data-test="wim-lists-failed"]').text()).toContain('WorkspaceImport.sprint_load_failed');
        expect(wrapper.find('[data-test="wim-sprint"]').attributes('disabled')).toBeDefined();
        expect(nextDisabled(wrapper)).toBe(true);

        treeAnswer = async (url) => ({ data: url.endsWith('collection=sprints') ? LISTS : FOLDERS });
        await wrapper.find('[data-test="wim-lists-retry"]').trigger('click');
        await flushPromises();
        expect(wrapper.find('[data-test="wim-lists-failed"]').exists()).toBe(false);
        expect(nextDisabled(wrapper)).toBe(false);
        warn.mockRestore();
    });

    it('says so when the project has no lists, and keeps Next disabled', async () => {
        treeAnswer = async () => ({ data: [] });
        const wrapper = open({ initialSource: 'clickup' });
        await toTarget(wrapper);
        await pick(wrapper, 'qa');
        expect(wrapper.find('[data-test="wim-lists-none"]').exists()).toBe(true);
        expect(nextDisabled(wrapper)).toBe(true);
    });

    it('hands the other sources the first list of a project it had to load', async () => {
        const wrapper = open();
        await wrapper.find('[data-source="jira"]').trigger('click');
        await pick(wrapper, 'qa');
        expect(nextDisabled(wrapper)).toBe(false);
        await wrapper.find('[data-test="wim-next"]').trigger('click');
        expect(wrapper.find('.modals-stub').attributes('data-sprint')).toBe('l1');
    });

    it('keeps Next disabled for the other sources while the lists are loading or failed', async () => {
        treeAnswer = async () => { throw new Error('offline'); };
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        const wrapper = open();
        await wrapper.find('[data-source="jira"]').trigger('click');
        await pick(wrapper, 'qa');
        expect(wrapper.find('[data-test="wim-lists-failed"]').exists()).toBe(true);
        expect(nextDisabled(wrapper)).toBe(true);
        warn.mockRestore();
    });

    it('loads nothing for the project a toolbar passes in', async () => {
        const wrapper = open({ initialSource: 'clickup', project: { _id: 'qa', ProjectName: 'QA Sandbox', sprintsObj: { l1: { id: 'l1', name: 'Backlog' } } } });
        await flushPromises();
        expect(treeCalls()).toHaveLength(0);
        expect(wrapper.exists()).toBe(true);
    });
});

describe('listsOfTree', () => {
    it('puts lists in their folders and leaves out deleted lists and the lists of deleted folders', () => {
        const folders = [{ _id: 'f1', name: 'Live' }, { _id: 'f2', name: 'Gone', deletedStatusKey: 1 }];
        const sprints = [{ _id: 'a', name: 'A' }, { _id: 'b', name: 'B', folderId: 'f1' }, { _id: 'c', name: 'C', folderId: 'f2' }, { _id: 'd', name: 'D', deletedStatusKey: 1 }];
        const { sprintsObj, sprintsfolders } = listsOfTree({ sprints, folders });
        expect(Object.keys(sprintsObj)).toEqual(['a']);
        expect(Object.keys(sprintsfolders)).toEqual(['f1']);
        expect(Object.keys(sprintsfolders.f1.sprintsObj)).toEqual(['b']);
        expect(sprintsObj.a.id).toBe('a');
    });
});
