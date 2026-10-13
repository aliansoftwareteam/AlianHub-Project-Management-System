import { folderTrail, isLiveFolder, parentIdOf } from "@/utils/folderTree";

const idOf = (item) => String(item?._id || item?.id || "");
const live = (item) => !Number(item?.deletedStatusKey || 0);
const countOf = (sprint) => Math.max(0, Number(sprint?.tasks) || 0);

/* The rule the server's hiddenSprintFilter applies: a private sprint belongs to the people
   and teams it is shared with, and owners and admins read past it. */
export function sprintVisible(sprint, { privileged = false, identities = new Set() } = {}) {
    if (privileged || sprint?.private !== true) return true;
    return (sprint.AssigneeUserId || []).map(String).some((id) => identities.has(id));
}

export function identitiesOf(userId, teams) {
    const uid = String(userId || "");
    const mine = (teams || []).filter((team) => (team?.assigneeUsersArray || []).map(String).includes(uid));
    return new Set([uid, ...mine.map((team) => `tId_${team._id}`)].filter(Boolean));
}

const sum = (nodes) => nodes.reduce((total, node) => total + node.count, 0);

export function projectBranch({ sprints = [], folders = [] }, access) {
    const liveFolders = folders
        .filter((folder) => isLiveFolder(folders, folder))
        .map((folder) => ({ id: idOf(folder), name: folder.name, parentFolderId: parentIdOf(folder), folders: [], sprints: [], count: 0 }));
    const byFolder = new Map(liveFolders.map((folder) => [folder.id, folder]));
    const rootSprints = [];
    sprints
        .filter((sprint) => live(sprint) && sprintVisible(sprint, access))
        .forEach((sprint) => {
            const node = { id: idOf(sprint), name: sprint.name, count: countOf(sprint), folderId: sprint.folderId ? String(sprint.folderId) : "" };
            if (!node.folderId) rootSprints.push(node);
            else if (byFolder.has(node.folderId)) byFolder.get(node.folderId).sprints.push(node);
        });
    const topFolders = liveFolders.filter((folder) => !folder.parentFolderId);
    liveFolders.filter((folder) => folder.parentFolderId).forEach((folder) => {
        folder.count = sum(folder.sprints);
        byFolder.get(folder.parentFolderId).folders.push(folder);
    });
    topFolders.forEach((folder) => { folder.count = sum(folder.sprints) + sum(folder.folders); });
    return { folders: topFolders, sprints: rootSprints, count: sum(topFolders) + sum(rootSprints) };
}

export function treeRoute(kind, { cid, projectId, folderId, id }) {
    if (kind === "project") return { name: "Project", params: { cid, id: projectId } };
    if (kind === "folder") return { name: "ProjectFolder", params: { cid, id: projectId, folderId: id } };
    return folderId
        ? { name: "ProjectFolderSprint", params: { cid, id: projectId, folderId, sprintId: id } }
        : { name: "ProjectSprint", params: { cid, id: projectId, sprintId: id } };
}

/* The rows a reader can reach, in order, with what a flat ARIA tree needs on each one. */
export function visibleRows(projects, { branchOf, expanded, cid }) {
    const rows = [];
    projects.forEach((project, index) => {
        const projectId = idOf(project);
        const branch = branchOf(projectId);
        const projectRow = {
            key: `project:${projectId}`, kind: "project", id: projectId, projectId, name: project.ProjectName,
            level: 1, setsize: projects.length, posinset: index + 1, count: branch ? branch.count : null,
            expandable: true, expanded: Boolean(expanded[`project:${projectId}`]),
            to: treeRoute("project", { cid, projectId })
        };
        rows.push(projectRow);
        if (!projectRow.expanded || !branch) return;

        const pushChildren = (parent, parentRow, folderId) => {
            const children = [
                ...parent.folders.map((folder) => ({ kind: "folder", node: folder })),
                ...parent.sprints.map((sprint) => ({ kind: "sprint", node: sprint }))
            ];
            children.forEach(({ kind, node }, at) => {
                const isFolder = kind === "folder";
                const row = {
                    key: `${kind}:${node.id}`, kind, id: node.id, projectId, name: node.name, count: node.count,
                    level: parentRow.level + 1, setsize: children.length, posinset: at + 1, parentKey: parentRow.key,
                    expandable: isFolder, expanded: isFolder && Boolean(expanded[`folder:${node.id}`]),
                    to: treeRoute(kind, { cid, projectId, folderId, id: node.id }),
                    ...(isFolder ? { parentFolderId: node.parentFolderId } : {}),
                    ...(!isFolder && folderId ? { folderId } : {})
                };
                rows.push(row);
                if (row.expanded) pushChildren(node, row, node.id);
            });
        };
        pushChildren(branch, projectRow, "");
    });
    return rows;
}

/* The rows above a folder in the tree, so a link straight to a subfolder can open the way to it. */
export const folderRowKeys = (folders, folderId) => folderTrail(folders || [], folderId).map((folder) => `folder:${idOf(folder)}`);
