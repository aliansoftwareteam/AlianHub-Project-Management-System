import { apiRequest } from '@/services';
import * as env from '@/config/env';
import { treeCache } from '@/components/molecules/ProjectTree/projectTreeData';
import { refusalReason } from './folderActions';

function storeSprint(store, sprint) {
    store.commit('projectData/mutateSprints', { op: 'modified', data: sprint });
    const cached = treeCache[sprint.projectId]?.sprints;
    const at = cached ? cached.findIndex((item) => String(item._id) === String(sprint._id)) : -1;
    if (at !== -1) cached[at] = sprint;
}

async function patchSprint(sprintId, body, apply) {
    try {
        const { data: answer } = await apiRequest('patch', `${env.SPRINT}/${sprintId}`, body);
        if (!answer?.status || !answer.data) return { ok: false, message: answer?.statusText || '' };
        apply(answer.data);
        return { ok: true, data: answer.data };
    } catch (error) {
        return { ok: false, message: refusalReason(error) };
    }
}

/* `folder` is { id, name }, or null for the top level. The server moves the list's tasks with it; the
   relocate brings the tasks already loaded here along. */
export const moveSprint = (store, { companyId, project, sprint, folder, fromFolderName = '' }) => patchSprint(
    sprint.id,
    {
        type: 'updateSprint',
        companyId,
        projectId: project._id,
        folderId: sprint.folderId || null,
        updateObject: { $set: { folderId: folder ? folder.id : null, folderName: folder ? folder.name : '' } },
        sprintName: sprint.name,
        projectData: { id: project._id, ProjectName: project.ProjectName },
        folderName: fromFolderName,
        historyData: { type: 'moved' }
    },
    (moved) => {
        storeSprint(store, moved);
        store.commit('projectData/relocateSprint', { data: moved, oldFolderId: sprint.folderId || null });
    }
);

export const renameSprint = (store, { companyId, projectId, sprintId, sprintName }) => patchSprint(
    sprintId,
    { type: 'editSprintName', companyId, projectId, sprintName },
    (renamed) => storeSprint(store, renamed)
);

export const sprintChanged = (store, sprint) => storeSprint(store, { ...sprint, id: sprint._id });

async function postScrum(store, action, body) {
    try {
        const { data: answer } = await apiRequest('post', `/api/v2/sprints/${action}`, body);
        if (!answer?.status || !answer.data) return { ok: false, message: answer?.statusText || '' };
        sprintChanged(store, answer.data);
        return { ok: true, data: answer.data };
    } catch (error) {
        return { ok: false, message: refusalReason(error) };
    }
}

export const startSprint = (store, sprintId) => postScrum(store, 'start', { sprintId });

export const makePlainList = (store, sprintId) => postScrum(store, 'scrum', { sprintId, isScrum: false });

/* `status` is the list's deletedStatusKey: 0 restores, 1 moves to the trash, 2 archives. The server takes the list's tasks with it. */
export const setSprintStatus = (store, { companyId, project, sprint, status }) => patchSprint(
    sprint.id,
    {
        type: 'updateSprint',
        companyId,
        projectId: project._id,
        folderId: sprint.folderId || null,
        updateObject: { $set: { deletedStatusKey: status } },
        sprintName: sprint.name,
        projectData: { id: project._id, ProjectName: project.ProjectName },
        folderName: ''
    },
    (changed) => storeSprint(store, changed)
);

/* mutateSprints ignores an 'added' list it already holds, so each one read again is stored as a change. */
export async function refreshSprints(store, projectId) {
    try {
        const { data } = await apiRequest('get', `/api/v1/${env.GET_SPRINT_OR_PROJECT}/${projectId}?collection=sprints`);
        (Array.isArray(data) ? data : []).forEach((sprint) => sprintChanged(store, sprint));
    } catch (error) {
        console.error('ERROR in reading the lists again: ', error);
    }
}
