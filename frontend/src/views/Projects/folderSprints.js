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
