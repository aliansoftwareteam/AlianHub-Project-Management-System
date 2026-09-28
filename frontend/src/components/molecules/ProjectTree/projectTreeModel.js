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

export function projectBranch({ sprints = [], folders = [] }, access) {
    const liveFolders = folders.filter(live).map((folder) => ({ id: idOf(folder), name: folder.name, sprints: [], count: 0 }));
    const byFolder = new Map(liveFolders.map((folder) => [folder.id, folder]));
    const rootSprints = [];
    sprints
        .filter((sprint) => live(sprint) && sprintVisible(sprint, access))
        .forEach((sprint) => {
            const node = { id: idOf(sprint), name: sprint.name, count: countOf(sprint), folderId: sprint.folderId ? String(sprint.folderId) : "" };
            if (!node.folderId) rootSprints.push(node);
            else if (byFolder.has(node.folderId)) byFolder.get(node.folderId).sprints.push(node);
        });
    liveFolders.forEach((folder) => { folder.count = folder.sprints.reduce((sum, sprint) => sum + sprint.count, 0); });
    const count = liveFolders.reduce((sum, folder) => sum + folder.count, 0) + rootSprints.reduce((sum, sprint) => sum + sprint.count, 0);
    return { folders: liveFolders, sprints: rootSprints, count };
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

        const children = [
            ...branch.folders.map((folder) => ({ kind: "folder", node: folder })),
            ...branch.sprints.map((sprint) => ({ kind: "sprint", node: sprint }))
        ];
        children.forEach(({ kind, node }, at) => {
            const row = {
                key: `${kind}:${node.id}`, kind, id: node.id, projectId, name: node.name, count: node.count,
                level: 2, setsize: children.length, posinset: at + 1, parentKey: projectRow.key,
                expandable: kind === "folder", expanded: kind === "folder" && Boolean(expanded[`folder:${node.id}`]),
                to: treeRoute(kind, { cid, projectId, id: node.id })
            };
            rows.push(row);
            if (!row.expanded) return;
            node.sprints.forEach((sprint, place) => rows.push({
                key: `sprint:${sprint.id}`, kind: "sprint", id: sprint.id, projectId, folderId: node.id, name: sprint.name, count: sprint.count,
                level: 3, setsize: node.sprints.length, posinset: place + 1, parentKey: row.key,
                expandable: false, expanded: false,
                to: treeRoute("sprint", { cid, projectId, folderId: node.id, id: sprint.id })
            }));
        });
    });
    return rows;
}
