/* What a move, a copy or a conversion sends as the place a task lands in.
 * CommonJS so the jest suite builds its fixture bodies with the functions the components send them with. */

/* A picker holds the stored list with its members, counts and its own open and picked flags, and the server
 * keeps what it is sent on the task as sprintArray. These are the values that are read back from there. */
const placedSprint = (sprint) => {
    if (!sprint) return null;
    const placed = { id: sprint.id || sprint._id, name: sprint.name };
    if (sprint.folderId) {
        placed.folderId = sprint.folderId;
        placed.folderName = sprint.folderName;
    }
    return placed;
};

const placedFolder = (folder) => (folder && folder.folderId ? { folderId: folder.folderId, name: folder.name } : null);

const projectRef = (project) => ({ id: project._id, ProjectCode: project.ProjectCode, ProjectName: project.ProjectName });
const conversionRules = (project) => ({ id: project._id, taskTypeCounts: project.taskTypeCounts, taskStatusData: project.taskStatusData });
const listNames = (task) => ({ folderId: task.folderObjId || null, name: task.sprintArray?.name, folderName: task.sprintArray?.folderName || '' });

const moveTaskRequest = ({ companyId, destination, sprint, task, source, isSubTask, assignee, watcher, userData }) => ({
    companyId,
    projectData: projectRef(destination),
    sprintObj: placedSprint(sprint),
    moveTaskId: task._id,
    oldSprintObj: { id: task.sprintId, ...listNames(task) },
    oldProject: { ...conversionRules(source), ProjectName: source.ProjectName },
    isSubTask,
    assignee,
    watcher,
    userData
});

const duplicateTaskRequest = ({ companyId, destination, sprint, task, source, isSubTask, duplicateData, assignee, watcher, taskName, userData }) => ({
    companyId,
    projectData: projectRef(destination),
    sprintObj: placedSprint(sprint),
    selectedTaskId: task._id,
    oldProject: { ...conversionRules(source), ProjectName: source.ProjectName },
    userData,
    isSubTask,
    duplicateData,
    assignee,
    watcher,
    taskName,
    oldSprintObj: listNames(task)
});

const convertToTaskRequest = ({ companyId, destination, sprint, task, oldSprint, source }) => ({
    companyId,
    projectData: { id: destination._id },
    taskId: task._id,
    parentTaskId: task.ParentTaskId,
    sprintObj: placedSprint(sprint),
    oldSprintObj: oldSprint,
    oldProject: conversionRules(source)
});

const convertToListRequest = ({ companyId, project, task, folder, isSubTask, userData }) => ({
    companyId,
    projectData: { id: project._id, ProjectName: project.ProjectName },
    taskId: task._id,
    userData,
    folderData: placedFolder(folder),
    sprintObj: { id: task.sprintId, folderId: task.folderObjId || null },
    isSubTask
});

module.exports = { placedSprint, placedFolder, moveTaskRequest, duplicateTaskRequest, convertToTaskRequest, convertToListRequest };
