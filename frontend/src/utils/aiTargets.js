import { folderPathLabel, isLiveFolder } from '@/utils/folderTree';
import { placedSprint } from '@/views/Projects/composables/taskPlacement';

export const userDataOf = (user, ownerId) => ({ id: user?.id, Employee_Name: user?.Employee_Name, companyOwnerId: ownerId });

export const projectDataOf = (project) => ({
    _id: project._id,
    CompanyId: project.CompanyId,
    lastTaskId: project.lastTaskId,
    ProjectName: project.ProjectName,
    ProjectCode: project.ProjectCode
});

export const sprintObjOf = placedSprint;

const live = (map) => Object.values(map || {}).filter((item) => item && !item.deletedStatusKey);

/* The project's lists, loose and inside folders, in the shape sprintObjOf takes. */
export function listsOfProject(project) {
    const lists = live(project?.sprintsObj).map((sprint) => ({ id: String(sprint._id || sprint.id || ""), name: sprint.name }));
    live(project?.sprintsfolders).filter((folder) => isLiveFolder(project.sprintsfolders, folder)).forEach((folder) => {
        live(folder.sprintsObj).forEach((sprint) => lists.push({
            id: String(sprint._id || sprint.id || ""),
            name: sprint.name,
            folderId: String(folder._id || folder.folderId || folder.id || ""),
            folderName: folder.name,
            folderPath: folderPathLabel(project.sprintsfolders, folder)
        }));
    });
    return lists.filter((list) => list.id);
}
