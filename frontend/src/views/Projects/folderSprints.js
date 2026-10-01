import { isLiveFolder, isOrphanFolder, subfoldersOf } from '@/utils/folderTree';

const ARCHIVED = 2;
const ARCHIVED_WITH_PARENT = 6;

const sprintsOf = (folder) => Object.values(folder?.sprintsObj || {});

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
