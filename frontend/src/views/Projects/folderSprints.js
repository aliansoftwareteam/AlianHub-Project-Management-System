import { folderIdOf, folderTrail, isLiveFolder, isOrphanFolder, subfoldersOf } from '@/utils/folderTree';

const ARCHIVED = 2;
const ARCHIVED_WITH_PARENT = 6;

const sprintsOf = (folder) => Object.values(folder?.sprintsObj || {});
const isLiveSprint = (sprint) => !Number(sprint?.deletedStatusKey || 0);

/* The folder, when it is live and neither it nor a live subfolder of it holds a live list. */
export function folderWithoutLists(folders, folderId) {
    const folder = folderId ? folders?.[folderId] : null;
    if (!folder || !isLiveFolder(folders, folder)) return null;
    const inside = [folder, ...subfoldersOf(folders, folderIdOf(folder)).filter((sub) => isLiveFolder(folders, sub))];
    return inside.flatMap(sprintsOf).some(isLiveSprint) ? null : folder;
}

/* What the project header names after the project: the folder in view with its parent and, when one list is shown, that list. */
export function headerLocation({ folders, sprints, folderId }) {
    const sprint = sprints?.length === 1 && !sprints[0]?.isFolder ? sprints[0] : null;
    return {
        sprint,
        folders: folderTrail(folders, folderId || sprint?.folderId).map((folder) => ({ id: folderIdOf(folder), name: folder.name }))
    };
}

/* An archived folder is one row; the sprints of the subfolders archived with it come back with it, so they sit in it. */
const archivedFolderRow = (folders, folder) => ({
    name: folder.name,
    id: folder.folderId,
    isExpanded: false,
    archivedSprintList: Object.assign(
        {},
        folder.sprintsObj || {},
        ...subfoldersOf(folders, folder.folderId).filter((sub) => sub.deletedStatusKey === ARCHIVED_WITH_PARENT).map((sub) => sub.sprintsObj || {})
    ),
    items: [],
    deletedStatusKey: ARCHIVED,
    isFolder: true,
});

export function folderSprintList({ folders, folderId, sprintId, showArchived, includeSprint = () => true }) {
    const folder = folders?.[folderId];
    if (!folder || isOrphanFolder(folders, folder) || folder.deletedStatusKey === ARCHIVED_WITH_PARENT) return [];

    if (sprintId && !folder.deletedStatusKey) {
        const sprint = sprintsOf(folder).find((x) => x.id === sprintId);
        return sprint ? [sprint] : [];
    }

    if (folder.deletedStatusKey === ARCHIVED) return showArchived ? [archivedFolderRow(folders, folder)] : [];

    const liveSubfolders = subfoldersOf(folders, folderId).filter((sub) => isLiveFolder(folders, sub));
    return [folder, ...liveSubfolders].flatMap(sprintsOf).filter(includeSprint);
}

export function projectSprintList({ project, showArchived, includeSprint = () => true }) {
    const folders = project?.sprintsfolders || {};
    const list = Object.values(project?.sprintsObj || {}).filter(includeSprint);
    Object.values(folders).forEach((folder) => {
        if (!folder || isOrphanFolder(folders, folder)) return;
        if (folder.deletedStatusKey === ARCHIVED) {
            if (showArchived) list.push(archivedFolderRow(folders, folder));
        } else if (isLiveFolder(folders, folder)) {
            list.push(...sprintsOf(folder).filter(includeSprint));
        }
    });
    return list;
}

const LIST_ROUTE = /^Project(Folder)?Sprint(Task)?$/;

/* The id of the folder a list sits in, '' at the top level of the project, null when the project does not hold it. */
function folderOfList(project, sprintId) {
    const holds = (holder) => sprintsOf(holder).some((sprint) => sprint.id === sprintId);
    if (holds(project)) return '';
    const folder = Object.values(project?.sprintsfolders || {}).find(holds);
    return folder ? folderIdOf(folder) : null;
}

/* A list keeps its id when it moves between folders, so an address made before the move names a place that no
   longer holds it. The address of where it is now, or null when the address is right or the list is nowhere. */
export function movedListRoute({ route, project }) {
    const { cid, id, sprintId, taskId, folderId = '' } = route?.params || {};
    if (!sprintId || !LIST_ROUTE.test(route.name)) return null;
    const home = folderOfList(project, sprintId);
    if (home === null || home === folderId) return null;
    const task = taskId ? 'Task' : '';
    return {
        name: home ? `ProjectFolderSprint${task}` : `ProjectSprint${task}`,
        params: { cid, id, ...(home ? { folderId: home } : {}), sprintId, ...(taskId ? { taskId } : {}) },
        query: route.query,
        hash: route.hash,
    };
}
