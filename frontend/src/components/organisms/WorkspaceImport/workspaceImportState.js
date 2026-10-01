import { reactive } from "vue";
import { folderPathLabel, isLiveFolder } from "@/utils/folderTree";

export const IMPORT_SOURCES = [
    { key: "clickup", mark: "C", tint: "#7b68ee" },
    { key: "csv", mark: "CSV", tint: "#2f9e7e" },
    { key: "jira", mark: "J", tint: "#0052cc" },
    { key: "trello", mark: "T", tint: "#0079bf" },
    { key: "asana", mark: "A", tint: "#f06a6a" },
    { key: "monday", mark: "M", tint: "#6161ff" }
];

export const workspaceImport = reactive({ open: false });

export const openWorkspaceImport = () => { workspaceImport.open = true; };
export const closeWorkspaceImport = () => { workspaceImport.open = false; };

export function sprintOptionsOf(project) {
    const options = [];
    Object.values(project?.sprintsObj || {}).forEach((sprint) => {
        if (sprint?.id) options.push({ ...sprint, _id: sprint.id, name: sprint.name || "" });
    });
    Object.values(project?.sprintsfolders || {}).forEach((folder) => {
        Object.values(folder?.sprintsObj || {}).forEach((sprint) => {
            if (sprint?.id) options.push({ ...sprint, _id: sprint.id, name: sprint.name || "", folderId: folder.folderId, folderName: folder.folderName || "", folderPath: folderPathLabel(project.sprintsfolders, folder) });
        });
    });
    return options;
}

const DELETED = 1;

export function listsOfTree({ sprints = [], folders = [] }) {
    const sprintsfolders = {};
    folders.filter((folder) => folder?._id && isLiveFolder(folders, folder)).forEach((folder) => {
        sprintsfolders[folder._id] = { folderId: folder._id, id: folder._id, _id: folder._id, name: folder.name, parentFolderId: folder.parentFolderId || null, deletedStatusKey: folder.deletedStatusKey, sprintsObj: {} };
    });
    const sprintsObj = {};
    sprints.filter((sprint) => sprint?._id && Number(sprint.deletedStatusKey || 0) !== DELETED).forEach((sprint) => {
        const list = { ...sprint, id: sprint._id };
        if (!sprint.folderId) sprintsObj[sprint._id] = list;
        else if (sprintsfolders[sprint.folderId]) sprintsfolders[sprint.folderId].sprintsObj[sprint._id] = list;
    });
    return { sprintsObj, sprintsfolders };
}
