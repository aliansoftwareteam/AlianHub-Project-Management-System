import { apiRequest } from '@/services';
import * as env from '@/config/env';
import { treeCache } from '@/components/molecules/ProjectTree/projectTreeData';

/* Folder writes send no socket event, so this client's own write reaches the store, and the
   tree's copy of the project, from the answer. */
function storeFolder(store, folder) {
    const data = { ...folder, parentFolderId: folder.parentFolderId || null };
    store.commit('projectData/mutateFolders', { op: 'modified', data });
    const cached = treeCache[data.projectId]?.folders;
    const at = cached ? cached.findIndex((item) => String(item._id) === String(data._id)) : -1;
    if (at !== -1) cached[at] = data;
}

/* A refusal answers its reason as HTTP 400, or as status false on a 200. */
export const refusalReason = (error) => error?.response?.data?.statusText || '';

export async function moveFolder(store, { companyId, projectId, folderId, parentFolderId }) {
    try {
        const { data: answer } = await apiRequest('patch', `${env.FOLDER}/${folderId}`, { type: 'moveFolder', companyId, projectId, parentFolderId: parentFolderId || null });
        if (!answer?.status || !answer.data) return { ok: false, message: answer?.statusText || '' };
        storeFolder(store, answer.data);
        return { ok: true, data: answer.data };
    } catch (error) {
        return { ok: false, message: refusalReason(error) };
    }
}

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
