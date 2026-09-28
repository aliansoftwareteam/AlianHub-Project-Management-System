import { reactive } from "vue";

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
            if (sprint?.id) options.push({ ...sprint, _id: sprint.id, name: sprint.name || "", folderId: folder.folderId, folderName: folder.folderName || "" });
        });
    });
    return options;
}
