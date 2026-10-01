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
