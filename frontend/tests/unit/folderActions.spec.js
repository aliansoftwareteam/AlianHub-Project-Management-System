import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createStore } from 'vuex';

const { apiRequest } = vi.hoisted(() => ({ apiRequest: vi.fn() }));
vi.mock('@/services', () => ({ apiRequest, apiRequestWithoutCompnay: vi.fn() }));
vi.mock('@/composable/index.js', () => ({ useCustomComposable: () => ({ checkPermission: () => true }) }));

import * as env from '@/config/env';
import { mutateFolders, mutateSearchedProjects, replaceFolders } from '@/store/ProjectData/mutations';
import { treeCache, resetProjectTreeCache } from '@/components/molecules/ProjectTree/projectTreeData';
import { applyFolderStatusResult, moveFolder, refreshFolders, renameFolder, restoreFolderFromTrash, setFolderStatus } from '@/views/Projects/folderActions';

const folder = (id, extra = {}) => ({ _id: id, name: id, projectId: 'p1', deletedStatusKey: 0, parentFolderId: null, ...extra });

const makeStore = (folders) => createStore({
    state: { folders: { p1: folders } },
    getters: { 'projectData/folders': (state) => JSON.parse(JSON.stringify(state.folders)) },
    mutations: { 'projectData/mutateFolders': mutateFolders, 'projectData/replaceFolders': replaceFolders }
});

const storedIn = (store, id) => store.state.folders.p1.find((item) => item._id === id);
const refusal = (statusText) => Object.assign(new Error('Request failed with status code 400'), { response: { status: 400, data: { status: false, statusText, message: statusText } } });

beforeEach(() => {
    apiRequest.mockReset();
    resetProjectTreeCache();
});

describe('moving a folder', () => {
    it('sends the move and puts the answered folder in the store', async () => {
        const store = makeStore([folder('design'), folder('icons')]);
        apiRequest.mockResolvedValue({ data: { status: true, data: folder('icons', { parentFolderId: 'design' }) } });

        const result = await moveFolder(store, { companyId: 'c1', projectId: 'p1', folderId: 'icons', parentFolderId: 'design' });

        expect(apiRequest).toHaveBeenCalledWith('patch', `${env.FOLDER}/icons`, { type: 'moveFolder', companyId: 'c1', projectId: 'p1', parentFolderId: 'design' });
        expect(result).toMatchObject({ ok: true });
        expect(storedIn(store, 'icons').parentFolderId).toBe('design');
        expect(storedIn(store, 'design').parentFolderId).toBeNull();
    });

    it('stores null for a folder moved to the top level, which the server answers without a parent', async () => {
        const store = makeStore([folder('design'), folder('icons', { parentFolderId: 'design' })]);
        const moved = folder('icons');
        delete moved.parentFolderId;
        apiRequest.mockResolvedValue({ data: { status: true, data: moved } });

        await moveFolder(store, { companyId: 'c1', projectId: 'p1', folderId: 'icons', parentFolderId: null });

        expect(apiRequest.mock.calls[0][2]).toMatchObject({ type: 'moveFolder', parentFolderId: null });
        expect(storedIn(store, 'icons').parentFolderId).toBeNull();
    });

    it('updates the tree\'s own copy of that project too', async () => {
        const store = makeStore([folder('design'), folder('icons')]);
        treeCache.p1 = { sprints: [], folders: [folder('design'), folder('icons')], loaded: true, loading: null };
        apiRequest.mockResolvedValue({ data: { status: true, data: folder('icons', { parentFolderId: 'design' }) } });

        await moveFolder(store, { companyId: 'c1', projectId: 'p1', folderId: 'icons', parentFolderId: 'design' });

        expect(treeCache.p1.folders.find((item) => item._id === 'icons').parentFolderId).toBe('design');
    });

    it('answers the server\'s reason for a refusal as it is and changes nothing', async () => {
        const store = makeStore([folder('design'), folder('icons')]);
        const reason = 'A folder that holds subfolders cannot become a subfolder: folders nest one level.';
        apiRequest.mockRejectedValue(refusal(reason));

        const result = await moveFolder(store, { companyId: 'c1', projectId: 'p1', folderId: 'design', parentFolderId: 'icons' });

        expect(result).toEqual({ ok: false, message: reason });
        expect(storedIn(store, 'design').parentFolderId).toBeNull();
    });

    it('answers the reason of a refusal that arrives with status false', async () => {
        const store = makeStore([folder('design')]);
        apiRequest.mockResolvedValue({ data: { status: false, statusText: 'Folder not found' } });
        expect(await moveFolder(store, { companyId: 'c1', projectId: 'p1', folderId: 'missing', parentFolderId: null })).toEqual({ ok: false, message: 'Folder not found' });
    });

    it('answers no reason when the request fails without one', async () => {
        const store = makeStore([folder('design')]);
        apiRequest.mockRejectedValue(new Error('Network Error'));
        expect(await moveFolder(store, { companyId: 'c1', projectId: 'p1', folderId: 'design', parentFolderId: null })).toEqual({ ok: false, message: '' });
    });
});

describe('an archive, delete or restore answered by the server', () => {
    it('puts the folder and every subfolder the cascade changed in the store', () => {
        const store = makeStore([folder('design'), folder('icons', { parentFolderId: 'design' }), folder('fonts', { parentFolderId: 'design', deletedStatusKey: 2 }), folder('ops')]);

        applyFolderStatusResult(store, {
            status: true,
            data: folder('design', { deletedStatusKey: 2 }),
            subfolders: [{ _id: 'icons', deletedStatusKey: 6 }]
        });

        expect(storedIn(store, 'design').deletedStatusKey).toBe(2);
        expect(storedIn(store, 'icons')).toMatchObject({ deletedStatusKey: 6, parentFolderId: 'design', name: 'icons' });
        expect(storedIn(store, 'fonts').deletedStatusKey).toBe(2);
        expect(storedIn(store, 'ops').deletedStatusKey).toBe(0);
    });

    it('brings back the subfolders a restore names', () => {
        const store = makeStore([folder('design', { deletedStatusKey: 2 }), folder('icons', { parentFolderId: 'design', deletedStatusKey: 6 })]);
        applyFolderStatusResult(store, { status: true, data: folder('design'), subfolders: [{ _id: 'icons', deletedStatusKey: 0 }] });
        expect(storedIn(store, 'design').deletedStatusKey).toBe(0);
        expect(storedIn(store, 'icons').deletedStatusKey).toBe(0);
    });

    it('reads an answer from a server without subfolders', () => {
        const store = makeStore([folder('design')]);
        applyFolderStatusResult(store, { status: true, data: folder('design', { deletedStatusKey: 1 }) });
        expect(storedIn(store, 'design').deletedStatusKey).toBe(1);
    });

    it('leaves the store alone when the answer is a refusal', () => {
        const store = makeStore([folder('design')]);
        applyFolderStatusResult(store, { status: false, statusText: 'Folder not found' });
        expect(storedIn(store, 'design').deletedStatusKey).toBe(0);
    });
});

describe('renaming a folder', () => {
    it('sends the new name and puts the answered folder in the store', async () => {
        const store = makeStore([folder('design')]);
        apiRequest.mockResolvedValue({ data: { status: true, data: folder('design', { name: 'Brand' }) } });

        const result = await renameFolder(store, { companyId: 'c1', projectId: 'p1', folderId: 'design', folderName: 'Brand' });

        expect(apiRequest).toHaveBeenCalledWith('patch', `${env.FOLDER}/design`, { type: 'editFolderName', companyId: 'c1', projectId: 'p1', folderName: 'Brand' });
        expect(result).toMatchObject({ ok: true });
        expect(storedIn(store, 'design').name).toBe('Brand');
    });

    it('answers the reason of a refusal and changes nothing', async () => {
        const store = makeStore([folder('design')]);
        apiRequest.mockResolvedValue({ data: { status: false, statusText: 'Folder not found' } });
        expect(await renameFolder(store, { companyId: 'c1', projectId: 'p1', folderId: 'design', folderName: 'Brand' })).toEqual({ ok: false, message: 'Folder not found' });
        apiRequest.mockRejectedValue(refusal('You do not have permission to perform this action.'));
        expect(await renameFolder(store, { companyId: 'c1', projectId: 'p1', folderId: 'design', folderName: 'Brand' })).toEqual({ ok: false, message: 'You do not have permission to perform this action.' });
        expect(storedIn(store, 'design').name).toBe('design');
    });
});

describe('archiving, deleting and restoring a folder', () => {
    const project = { _id: 'p1', ProjectName: 'Alpha' };

    it('sends the status the way the folder route reads it and stores the folder with the subfolders the answer names', async () => {
        const store = makeStore([folder('design'), folder('icons', { parentFolderId: 'design' })]);
        apiRequest.mockResolvedValue({ data: { status: true, data: folder('design', { deletedStatusKey: 2 }), subfolders: [{ _id: 'icons', deletedStatusKey: 6 }] } });

        const result = await setFolderStatus(store, { companyId: 'c1', project, folder: { id: 'design', name: 'Design' }, status: 2 });

        expect(apiRequest).toHaveBeenCalledWith('patch', `${env.FOLDER}/design`, {
            type: 'updateFolder',
            companyId: 'c1',
            projectId: 'p1',
            folderName: 'Design',
            projectData: { id: 'p1', ProjectName: 'Alpha' },
            updateObject: { $set: { deletedStatusKey: 2 } }
        });
        expect(result).toMatchObject({ ok: true });
        expect(storedIn(store, 'design').deletedStatusKey).toBe(2);
        expect(storedIn(store, 'icons').deletedStatusKey).toBe(6);
    });

    it('answers the server\'s reason for a refusal', async () => {
        const store = makeStore([folder('icons', { parentFolderId: 'design', deletedStatusKey: 2 })]);
        const reason = 'The parent folder is archived or deleted. Restore the parent folder first.';
        apiRequest.mockRejectedValue(refusal(reason));
        expect(await setFolderStatus(store, { companyId: 'c1', project, folder: { id: 'icons', name: 'Icons' }, status: 0 })).toEqual({ ok: false, message: reason });
        expect(storedIn(store, 'icons').deletedStatusKey).toBe(2);
    });

    it('restores a deleted folder through the trash, then reads the project\'s folders again', async () => {
        const store = makeStore([folder('design', { deletedStatusKey: 1 }), folder('icons', { parentFolderId: 'design', deletedStatusKey: 1 })]);
        apiRequest.mockImplementation((method) => Promise.resolve(method === 'put'
            ? { data: { status: true, data: { kind: 'folders', id: 'design' } } }
            : { data: [folder('design'), folder('icons', { parentFolderId: 'design' })] }));

        const result = await restoreFolderFromTrash(store, { projectId: 'p1', folderId: 'design' });

        expect(apiRequest.mock.calls[0].slice(0, 2)).toEqual(['put', '/api/v2/trash/folders/design/restore']);
        expect(apiRequest.mock.calls[1]).toEqual(['get', `/api/v1/${env.GET_SPRINT_OR_PROJECT}/p1?collection=folders`]);
        expect(result).toEqual({ ok: true });
        expect(storedIn(store, 'design').deletedStatusKey).toBe(0);
        expect(storedIn(store, 'icons').deletedStatusKey).toBe(0);
    });

    it('answers the reason when the trash refuses', async () => {
        const store = makeStore([folder('design', { deletedStatusKey: 1 })]);
        apiRequest.mockRejectedValue(refusal('That folder is not in the trash.'));
        expect(await restoreFolderFromTrash(store, { projectId: 'p1', folderId: 'design' })).toEqual({ ok: false, message: 'That folder is not in the trash.' });
        expect(apiRequest).toHaveBeenCalledTimes(1);
    });
});

describe('reading a project\'s folders again', () => {
    it('replaces what the store holds for that project and leaves other projects alone', async () => {
        const store = makeStore([folder('design'), folder('gone')]);
        store.state.folders.p2 = [folder('theirs', { projectId: 'p2' })];
        apiRequest.mockResolvedValue({ data: [folder('design', { name: 'Brand' }), folder('new', { parentFolderId: 'design' })] });

        await refreshFolders(store, 'p1');

        expect(apiRequest).toHaveBeenCalledWith('get', `/api/v1/${env.GET_SPRINT_OR_PROJECT}/p1?collection=folders`);
        expect(store.state.folders.p1.map((item) => [item._id, item.name, item.parentFolderId])).toEqual([['design', 'Brand', null], ['new', 'new', 'design']]);
        expect(store.state.folders.p2).toHaveLength(1);
    });

    it('updates the tree\'s own copy of that project too', async () => {
        const store = makeStore([folder('design')]);
        treeCache.p1 = { sprints: [], folders: [folder('design')], loaded: true, loading: null };
        apiRequest.mockResolvedValue({ data: [folder('design', { name: 'Brand' })] });
        await refreshFolders(store, 'p1');
        expect(treeCache.p1.folders.map((item) => item.name)).toEqual(['Brand']);
    });

    it('keeps what it had when the read fails or answers no list', async () => {
        const store = makeStore([folder('design')]);
        apiRequest.mockRejectedValue(new Error('Network Error'));
        await refreshFolders(store, 'p1');
        apiRequest.mockResolvedValue({ data: { status: false } });
        await refreshFolders(store, 'p1');
        expect(store.state.folders.p1).toHaveLength(1);
    });
});

describe('folding search results into projects', () => {
    it('carries each folder\'s parent onto the flat map', () => {
        const state = { allProjects: { data: [{ _id: 'p1', ProjectName: 'Alpha' }] }, searchedProjects: [] };
        mutateSearchedProjects(state, {
            searchType: 'folder',
            data: [{
                _id: 'p1',
                sprints: [{ _id: 's1', name: 'Nested', projectId: 'p1', folderId: 'icons' }],
                folders: [folder('design'), folder('icons', { parentFolderId: 'design' })]
            }]
        });
        const [found] = state.searchedProjects;
        expect(found.sprintsfolders.design.parentFolderId).toBeNull();
        expect(found.sprintsfolders.icons.parentFolderId).toBe('design');
        expect(found.sprintsfolders.icons.sprintsObj.s1.folderName).toBe('icons');
    });
});
