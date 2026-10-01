import { apiRequest } from '@/services';
import * as env from '@/config/env';
import { treeCache } from '@/components/molecules/ProjectTree/projectTreeData';

export const FOLDERS_CHANGED_EVENT = 'foldersChanged';

const withParent = (folder) => ({ ...folder, parentFolderId: folder.parentFolderId || null });

/* This client's own write reaches the store, and the tree's copy of the project, from the answer,
   without waiting for the `foldersChanged` event that tells the other tabs to read again. */
function storeFolder(store, folder) {
    const data = withParent(folder);
    store.commit('projectData/mutateFolders', { op: 'modified', data });
    const cached = treeCache[data.projectId]?.folders;
    const at = cached ? cached.findIndex((item) => String(item._id) === String(data._id)) : -1;
    if (at !== -1) cached[at] = data;
}

/* A refusal answers its reason as HTTP 400, or as status false on a 200. */
export const refusalReason = (error) => error?.response?.data?.statusText || '';

const refused = (answer) => ({ ok: false, message: answer?.statusText || '' });

async function patchFolder(store, folderId, body, apply) {
    try {
        const { data: answer } = await apiRequest('patch', `${env.FOLDER}/${folderId}`, body);
        if (!answer?.status || !answer.data) return refused(answer);
        apply(answer);
        return { ok: true, data: answer.data };
    } catch (error) {
        return { ok: false, message: refusalReason(error) };
    }
}

export const moveFolder = (store, { companyId, projectId, folderId, parentFolderId }) => patchFolder(
    store,
    folderId,
    { type: 'moveFolder', companyId, projectId, parentFolderId: parentFolderId || null },
    (answer) => storeFolder(store, answer.data)
);

export const renameFolder = (store, { companyId, projectId, folderId, folderName }) => patchFolder(
    store,
    folderId,
    { type: 'editFolderName', companyId, projectId, folderName },
    (answer) => storeFolder(store, answer.data)
);

/* An archive, delete or restore answers the folder and, in `subfolders`, the ones the cascade changed. */
export function applyFolderStatusResult(store, answer) {
    if (!answer?.status || !answer.data) return;
    storeFolder(store, answer.data);
    const known = (store.getters['projectData/folders'] || {})[answer.data.projectId] || [];
    (answer.subfolders || []).forEach((changed) => {
        const subfolder = known.find((item) => String(item._id) === String(changed._id));
        if (subfolder) storeFolder(store, { ...subfolder, deletedStatusKey: changed.deletedStatusKey });
    });
}

/* `status` is the folder's deletedStatusKey: 0 restores, 1 moves to the trash, 2 archives. */
export const setFolderStatus = (store, { companyId, project, folder, status }) => patchFolder(
    store,
    folder.id,
    {
        type: 'updateFolder',
        companyId,
        projectId: project._id,
        folderName: folder.name,
        projectData: { id: project._id, ProjectName: project.ProjectName },
        updateObject: { $set: { deletedStatusKey: status } }
    },
    (answer) => applyFolderStatusResult(store, answer)
);

export async function refreshFolders(store, projectId) {
    try {
        const { data } = await apiRequest('get', `/api/v1/${env.GET_SPRINT_OR_PROJECT}/${projectId}?collection=folders`);
        if (!Array.isArray(data)) return;
        const folders = data.map(withParent);
        store.commit('projectData/replaceFolders', { projectId, folders });
        if (treeCache[projectId]) treeCache[projectId].folders = folders;
    } catch (error) {
        console.error('ERROR in reading the folders again: ', error);
    }
}

/* The trash restore brings back the subfolders and tasks a delete took, which the answer does not list. */
export async function restoreFolderFromTrash(store, { projectId, folderId }) {
    try {
        const { data: answer } = await apiRequest('put', `/api/v2/trash/folders/${folderId}/restore`, {});
        if (!answer?.status) return refused(answer);
        await refreshFolders(store, projectId);
        return { ok: true };
    } catch (error) {
        return { ok: false, message: refusalReason(error) };
    }
}
