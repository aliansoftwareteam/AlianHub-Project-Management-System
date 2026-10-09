/* Task 047, tenth sweep — "Show Archive" shows the project's archived lists, each with Restore,
   wherever in the project the person is, and the archive confirm points to that place. */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { config, flushPromises, mount } from '@vue/test-utils';
import { createStore } from 'vuex';
import { ref } from 'vue';
import { readFileSync } from 'fs';
import path from 'path';

const { toast, sprintActions, rights } = vi.hoisted(() => ({
    toast: { success: vi.fn(), error: vi.fn() },
    sprintActions: { setSprintStatus: vi.fn() },
    rights: { restore: true }
}));

vi.mock('vue-toast-notification', () => ({ useToast: () => toast }));
vi.mock('@/services', () => ({ apiRequest: vi.fn(() => Promise.resolve({ data: [] })) }));
vi.mock('@/views/Projects/sprintActions', () => sprintActions);
vi.mock('@/composable', () => ({
    useCustomComposable: () => ({ checkPermission: (key) => (key === 'project.sprint_restore' ? rights.restore : true) })
}));
vi.mock('@/components/organisms/Shell/ShellIcon.vue', () => ({ default: { name: 'ShellIcon', render: () => null } }));

import ArchivedLists from '@/views/Projects/components/ArchivedLists.vue';
import { archivedListsOf } from '@/views/Projects/folderSprints';
import en from '@/locales/en.js';

const i18n = config.global.plugins[0];
i18n.global.setLocaleMessage('en', en);

const list = (id, name, deletedStatusKey = 0, extra = {}) => ({ id, _id: id, name, deletedStatusKey, ...extra });
const PROJECT = {
    _id: 'proj-1', ProjectName: 'Website', isGlobalPermission: true, status: 'open',
    sprintsObj: { l1: list('l1', 'Backlog'), l2: list('l2', 'Old ideas', 2), l3: list('l3', 'Gone', 1) },
    sprintsfolders: {
        f1: { folderId: 'f1', _id: 'f1', name: 'Design', deletedStatusKey: 0, sprintsObj: { l4: list('l4', 'Round one', 2, { folderId: 'f1' }), l5: list('l5', 'Round two', 0, { folderId: 'f1' }) } },
        f2: { folderId: 'f2', _id: 'f2', name: 'Shelved', deletedStatusKey: 2, sprintsObj: { l6: list('l6', 'In an archived folder', 2, { folderId: 'f2' }) } }
    }
};

const open = () => mount(ArchivedLists, {
    props: { project: PROJECT, lists: archivedListsOf(PROJECT) },
    global: { plugins: [createStore({})], mocks: { $t: i18n.global.t }, provide: { $companyId: ref('company-1') } }
});
const rows = (wrapper) => wrapper.findAll('[data-test="archived-list"]');

beforeEach(() => {
    rights.restore = true;
    sprintActions.setSprintStatus.mockReset();
    sprintActions.setSprintStatus.mockResolvedValue({ ok: true, data: {} });
});

describe('the archived lists of a project', () => {
    it('are the archived lists at the top level and in live folders, each with its path', () => {
        expect(archivedListsOf(PROJECT).map((row) => [row.id, row.folderId, row.path])).toEqual([
            ['l2', '', 'Old ideas'],
            ['l4', 'f1', 'Design / Round one']
        ]);
        expect(archivedListsOf({})).toEqual([]);
    });

    it('are named under "Archived lists", each with Restore', () => {
        const wrapper = open();
        expect(wrapper.get('.al__title').text()).toBe('Archived lists');
        expect(rows(wrapper).map((row) => row.get('.al__name').text())).toEqual(['Old ideas', 'Design / Round one']);
        expect(rows(wrapper).map((row) => row.get('button').text())).toEqual(['Restore', 'Restore']);
        expect(rows(wrapper)[1].get('button').attributes('aria-label')).toBe('Restore Round one');
        wrapper.unmount();
    });

    it('restore the list that is pressed, once, and say so', async () => {
        let answer;
        sprintActions.setSprintStatus.mockReturnValue(new Promise((resolve) => { answer = resolve; }));
        const wrapper = open();
        const button = rows(wrapper)[1].get('button');
        await button.trigger('click');
        await button.trigger('click');
        expect(sprintActions.setSprintStatus).toHaveBeenCalledTimes(1);
        expect(sprintActions.setSprintStatus.mock.calls[0][1]).toMatchObject({ companyId: 'company-1', project: PROJECT, sprint: { id: 'l4', name: 'Round one', folderId: 'f1' }, status: 0 });
        expect(button.attributes('aria-busy')).toBe('true');
        answer({ ok: true, data: {} });
        await flushPromises();
        expect(toast.success).toHaveBeenCalledWith('Round one restored', { position: 'top-right' });
        wrapper.unmount();
    });

    it('say why when the server refuses', async () => {
        sprintActions.setSprintStatus.mockResolvedValue({ ok: false, message: 'You cannot restore this list.' });
        const wrapper = open();
        await rows(wrapper)[0].get('button').trigger('click');
        await flushPromises();
        expect(toast.error).toHaveBeenCalledWith('You cannot restore this list.', { position: 'top-right' });
        wrapper.unmount();
    });

    it('show no Restore to a person who may not restore a list', () => {
        rights.restore = false;
        const wrapper = open();
        expect(rows(wrapper)).toHaveLength(2);
        expect(wrapper.findAll('button')).toHaveLength(0);
        wrapper.unmount();
    });
});

describe('where the words point', () => {
    const read = (file) => readFileSync(path.resolve(__dirname, '../../src', file), 'utf8');

    it('the project page draws the archived lists while Show Archive is on, above whatever view is open', () => {
        const page = read('views/Projects/Projects.vue');
        expect(page).toContain('<ArchivedLists v-if="showArchived && archivedLists.length" :project="projectData" :lists="archivedLists" />');
        expect(page.indexOf('<ArchivedLists')).toBeLessThan(page.indexOf('<FolderEmptyState'));
    });

    it('the archive confirm names the menu entry that shows them', () => {
        expect(en.Projects.list_archive_text).toBe('Its tasks are archived with it. To get it back, open More in this project, choose Show Archive and press Restore.');
        expect(en.Projects.list_archive_text).toContain(en.ProjectSlider.show_archive);
        expect(en.Projects.list_archive_text).toContain(en.Projects.more_features);
        expect(en.Projects.list_archive_text).toContain(en.Projects.restore);
    });

    it('an archive view with no archived task says tasks, not data', () => {
        expect(read('views/Projects/ListView/ListView.vue')).not.toContain("$t('ProjectSlider.no_archived')");
        expect(en.EmptyState.no_archived_title).toBe('No archived tasks to show');
    });
});
