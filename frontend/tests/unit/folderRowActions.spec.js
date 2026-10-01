import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { config, flushPromises, mount } from '@vue/test-utils';
import { createStore } from 'vuex';

const { apiRequest, getters, toast } = vi.hoisted(() => ({
    apiRequest: vi.fn(),
    getters: {},
    toast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() }
}));

/* The real checkPermission runs here over a store this spec fills, and nothing provides `selectedProject`:
   an entry shows only if the menu reads the project it was handed. */
vi.mock('@/store/index', () => ({ default: { getters } }));
vi.mock('@/services', () => ({ apiRequest, apiRequestWithoutCompnay: vi.fn() }));
vi.mock('@/locales/main', () => ({ i18n: { global: { t: (key) => key } } }));
vi.mock('@/utils/storageQueryBuild', () => ({ storageQueryBuilder: vi.fn() }));
vi.mock('@/composable/commonFunction', () => ({ isBundledPriorityImage: vi.fn() }));
vi.mock('vue-toast-notification', () => ({ useToast: () => toast }));

import * as env from '@/config/env';
import en from '@/locales/en';
import FolderRowMenu from '@/components/molecules/ProjectTree/FolderRowMenu.vue';
import { dismissUndoToast, runUndo, undoToast } from '@/composable/useUndoToast';

const i18n = config.global.plugins[0];
i18n.global.setLocaleMessage('en', en);

const MEMBER = 3;
const KEYS = ['project_folder_create', 'project_folder_name_edit', 'folder_archive', 'folder_delete', 'folder_restore'];
const rulesGranting = (...granted) => ({
    project: Object.fromEntries(KEYS.map((key) => [key, { roles: [{ key: MEMBER, permission: granted.includes(key) || granted.includes('all') }] }]))
});

const doc = (id, name, extra = {}) => ({ _id: id, name, projectId: 'p1', deletedStatusKey: 0, parentFolderId: null, ...extra });
const FOLDERS = [doc('design', 'Design'), doc('icons', 'Icons', { parentFolderId: 'design' }), doc('ops', 'Ops'), doc('empty', 'Empty')];
const list = (id, folderId, tasks) => ({ _id: id, name: id, projectId: 'p1', folderId, deletedStatusKey: 0, ...(tasks === undefined ? {} : { tasks }) });
const SPRINTS = [list('d1', 'design', 4), list('i1', 'icons', 3), list('o1', 'ops'), list('root', undefined, 9)];
const project = (extra = {}) => ({ _id: 'p1', ProjectName: 'Alpha', isGlobalPermission: true, ...extra });

const commits = [];
const store = () => createStore({
    getters: { 'projectData/folders': () => ({ p1: FOLDERS }) },
    mutations: {
        'projectData/mutateFolders': (state, payload) => commits.push(payload),
        'projectData/replaceFolders': (state, payload) => commits.push(payload)
    }
});

const mounted = [];
const menu = (folderId, handed = project()) => {
    const folder = FOLDERS.find((item) => item._id === folderId);
    const wrapper = mount(FolderRowMenu, {
        props: { project: handed, folders: FOLDERS, sprints: SPRINTS, folder: { id: folderId, name: folder.name, parentFolderId: folder.parentFolderId || '' } },
        attachTo: document.body,
        global: { plugins: [store()], mocks: { $t: i18n.global.t } }
    });
    mounted.push(wrapper);
    return wrapper;
};
const entries = async (wrapper) => {
    if (!wrapper.find('.pt-row__more').exists()) return [];
    await wrapper.find('.pt-row__more').trigger('click');
    return wrapper.findAll('[role="menuitem"]').map((item) => item.text());
};
const choose = async (wrapper, label) => {
    await wrapper.find('.pt-row__more').trigger('click');
    await wrapper.findAll('[role="menuitem"]').find((item) => item.text() === label).trigger('click');
    await flushPromises();
};
const dialog = () => document.body.querySelector('[role="alertdialog"]');
const confirm = async () => {
    dialog().querySelector('[data-action="confirm"]').click();
    await flushPromises();
};
const patches = () => apiRequest.mock.calls.filter(([method]) => method === 'patch');
const refusal = (statusText) => Object.assign(new Error('Request failed with status code 400'), { response: { status: 400, data: { status: false, statusText, message: statusText } } });
const answer = (folderId, deletedStatusKey, subfolders = []) => ({ data: { status: true, data: { ...FOLDERS.find((item) => item._id === folderId), deletedStatusKey }, subfolders } });

beforeEach(() => {
    commits.length = 0;
    apiRequest.mockReset();
    Object.values(toast).forEach((spy) => spy.mockClear());
    dismissUndoToast();
    Object.assign(getters, {
        'settings/companyUserDetail': { roleType: MEMBER },
        'settings/rules': rulesGranting('all'),
        'settings/projectRules': rulesGranting()
    });
});
afterEach(() => {
    while (mounted.length) mounted.pop().unmount();
    document.body.innerHTML = '';
});

describe('which actions a folder row offers', () => {
    it('everything, to someone who holds every folder permission', async () => {
        expect(await entries(menu('ops'))).toEqual(['New subfolder', 'Rename', 'Move folder', 'Archive', 'Delete']);
        expect(await entries(menu('icons'))).toEqual(['Rename', 'Move folder', 'Archive', 'Delete']);
    });

    it.each([
        ['folder_archive', ['Archive']],
        ['folder_delete', ['Delete']],
        ['project_folder_name_edit', ['Rename', 'Move folder']],
    ])('only what %s allows', async (key, expected) => {
        getters['settings/rules'] = rulesGranting(key);
        expect(await entries(menu('ops'))).toEqual(expected);
    });

    it('reads each key from the rules of the project it is handed', async () => {
        getters['settings/projectRules'] = rulesGranting('folder_delete');
        expect(await entries(menu('ops', project({ isGlobalPermission: false })))).toEqual(['Delete']);
        getters['settings/rules'] = rulesGranting();
        expect(await entries(menu('ops', project({ isGlobalPermission: true })))).toEqual([]);
    });

    it('nothing in a closed project', async () => {
        expect(await entries(menu('ops', project({ status: 'close' })))).toEqual([]);
    });
});

describe('renaming', () => {
    it('asks the tree to edit the row in place', async () => {
        const wrapper = menu('ops');
        await choose(wrapper, 'Rename');
        expect(wrapper.emitted('rename')).toEqual([['ops']]);
        expect(apiRequest).not.toHaveBeenCalled();
    });
});

describe('archiving a folder', () => {
    it('asks first and says how many subfolders, lists and tasks go with it', async () => {
        const wrapper = menu('design');
        await choose(wrapper, 'Archive');
        expect(dialog().textContent).toContain('Archive Design?');
        expect(dialog().textContent).toContain('1 subfolder, 2 lists, 7 tasks will be archived with it.');
        expect(document.activeElement.textContent.trim()).toBe('Cancel');
        expect(patches()).toEqual([]);
    });

    it('says "their tasks" when a list does not carry its count, and that an empty folder is empty', async () => {
        await choose(menu('ops'), 'Archive');
        expect(dialog().textContent).toContain('1 list, their tasks will be archived with it.');
        document.body.innerHTML = '';
        await choose(menu('empty'), 'Archive');
        expect(dialog().textContent).toContain('The folder is empty.');
    });

    it('does nothing on Cancel', async () => {
        const wrapper = menu('design');
        await choose(wrapper, 'Archive');
        [...dialog().querySelectorAll('button')].find((button) => button.textContent.trim() === 'Cancel').click();
        await flushPromises();
        expect(dialog()).toBeNull();
        expect(patches()).toEqual([]);
        expect(wrapper.emitted('removed')).toBeUndefined();
    });

    it('archives on confirm, stores the folder and the subfolders that went with it, and tells the tree', async () => {
        apiRequest.mockResolvedValue(answer('design', 2, [{ _id: 'icons', deletedStatusKey: 6 }]));
        const wrapper = menu('design');
        await choose(wrapper, 'Archive');
        await confirm();

        expect(patches()).toEqual([['patch', `${env.FOLDER}/design`, {
            type: 'updateFolder',
            companyId: 'company-1',
            projectId: 'p1',
            folderName: 'Design',
            projectData: { id: 'p1', ProjectName: 'Alpha' },
            updateObject: { $set: { deletedStatusKey: 2 } }
        }]]);
        expect(commits.map((commit) => [commit.data._id, commit.data.deletedStatusKey])).toEqual([['design', 2], ['icons', 6]]);
        expect(wrapper.emitted('removed')).toEqual([['design']]);
        expect(dialog()).toBeNull();
    });

    it('offers an undo that restores the folder', async () => {
        apiRequest.mockResolvedValueOnce(answer('design', 2, [{ _id: 'icons', deletedStatusKey: 6 }]));
        await choose(menu('design'), 'Archive');
        await confirm();
        expect(undoToast.current.message).toBe('Design archived');

        apiRequest.mockResolvedValueOnce(answer('design', 0, [{ _id: 'icons', deletedStatusKey: 0 }]));
        await runUndo();

        expect(patches()[1][2]).toMatchObject({ type: 'updateFolder', updateObject: { $set: { deletedStatusKey: 0 } } });
        expect(commits.slice(2).map((commit) => [commit.data._id, commit.data.deletedStatusKey])).toEqual([['design', 0], ['icons', 0]]);
    });

    it('says it is archived, with no undo, to someone who may not restore folders', async () => {
        getters['settings/rules'] = rulesGranting('folder_archive');
        apiRequest.mockResolvedValue(answer('ops', 2));
        await choose(menu('ops'), 'Archive');
        await confirm();
        expect(undoToast.current).toBeNull();
        expect(toast.success).toHaveBeenCalledWith('Ops archived', { position: 'top-right' });
    });

    it('shows the server\'s reason when the archive is refused, and offers no undo', async () => {
        apiRequest.mockRejectedValue(refusal('You do not have permission to perform this action.'));
        const wrapper = menu('design');
        await choose(wrapper, 'Archive');
        await confirm();
        expect(toast.error).toHaveBeenCalledWith('You do not have permission to perform this action.', { position: 'top-right' });
        expect(undoToast.current).toBeNull();
        expect(wrapper.emitted('removed')).toBeUndefined();
        expect(commits).toEqual([]);
    });
});

describe('deleting a folder', () => {
    it('asks first, says what goes to the Trash with it and that it can come back', async () => {
        await choose(menu('design'), 'Delete');
        expect(dialog().textContent).toContain('Delete Design?');
        expect(dialog().textContent).toContain('1 subfolder, 2 lists, 7 tasks will go to the Trash with it.');
        expect(dialog().textContent).toContain('You can restore the folder from the Trash.');
        expect(patches()).toEqual([]);
    });

    it('deletes on confirm and tells the tree', async () => {
        apiRequest.mockResolvedValue(answer('design', 1, [{ _id: 'icons', deletedStatusKey: 1 }]));
        const wrapper = menu('design');
        await choose(wrapper, 'Delete');
        await confirm();
        expect(patches()[0][2]).toMatchObject({ type: 'updateFolder', updateObject: { $set: { deletedStatusKey: 1 } } });
        expect(commits.map((commit) => [commit.data._id, commit.data.deletedStatusKey])).toEqual([['design', 1], ['icons', 1]]);
        expect(wrapper.emitted('removed')).toEqual([['design']]);
    });

    it('offers an undo that restores it from the Trash and reads the folders again', async () => {
        apiRequest.mockResolvedValueOnce(answer('design', 1, [{ _id: 'icons', deletedStatusKey: 1 }]));
        await choose(menu('design'), 'Delete');
        await confirm();
        expect(undoToast.current.message).toBe('Design moved to the Trash');

        apiRequest.mockImplementation((method) => Promise.resolve(method === 'put' ? { data: { status: true } } : { data: FOLDERS }));
        await runUndo();
        await flushPromises();

        const [put, get] = apiRequest.mock.calls.slice(1);
        expect(put.slice(0, 2)).toEqual(['put', '/api/v2/trash/folders/design/restore']);
        expect(get).toEqual(['get', `/api/v1/${env.GET_SPRINT_OR_PROJECT}/p1?collection=folders`]);
        expect(commits[commits.length - 1]).toEqual({ projectId: 'p1', folders: FOLDERS });
    });

    it('shows the reason when the undo is refused', async () => {
        apiRequest.mockResolvedValueOnce(answer('ops', 1));
        await choose(menu('ops'), 'Delete');
        await confirm();
        apiRequest.mockRejectedValue(refusal('The parent folder is archived or deleted. Restore the parent folder first.'));
        await runUndo();
        await flushPromises();
        expect(toast.error).toHaveBeenCalledWith('The parent folder is archived or deleted. Restore the parent folder first.', { position: 'top-right' });
    });
});
