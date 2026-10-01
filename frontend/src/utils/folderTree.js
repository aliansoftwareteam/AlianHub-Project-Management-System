/* Folders nest one level. The store keeps them flat, keyed by id, each naming its parent; these
   read that flat map (or the list the API returns) the way a tree would. */

const DELETED = 1;
const PATH_SEPARATOR = ' / ';

export const folderIdOf = (folder) => String(folder?.folderId || folder?._id || folder?.id || '');
export const parentIdOf = (folder) => (folder?.parentFolderId ? String(folder.parentFolderId) : '');

const isLive = (item) => !Number(item?.deletedStatusKey || 0);
const listOf = (folders) => (Array.isArray(folders) ? folders : Object.values(folders || {})).filter(Boolean);
const find = (folders, id) => (id ? listOf(folders).find((folder) => folderIdOf(folder) === String(id)) || null : null);
const resolve = (folders, folderOrId) => (folderOrId && typeof folderOrId === 'object' ? folderOrId : find(folders, folderOrId));

export const parentFolderOf = (folders, folder) => find(folders, parentIdOf(folder));

/* The read keeps a subfolder whose parent was deleted; nothing can open it, so nothing lists it. */
export function isOrphanFolder(folders, folder) {
    if (!parentIdOf(folder)) return false;
    const parent = parentFolderOf(folders, folder);
    return !parent || Number(parent.deletedStatusKey) === DELETED;
}

export function isLiveFolder(folders, folder) {
    if (!folder || !isLive(folder)) return false;
    return !parentIdOf(folder) || isLive(parentFolderOf(folders, folder) || { deletedStatusKey: DELETED });
}

export const subfoldersOf = (folders, folderId) => listOf(folders).filter((folder) => folderId && parentIdOf(folder) === String(folderId));

export function folderTrail(folders, folderOrId) {
    const folder = resolve(folders, folderOrId);
    if (!folder) return [];
    const parent = parentFolderOf(folders, folder);
    return parent ? [parent, folder] : [folder];
}

export const folderPathLabel = (folders, folderOrId) => folderTrail(folders, folderOrId).map((folder) => folder.name || folder.folderName || '').filter(Boolean).join(PATH_SEPARATOR);

/* `folderName` on a list is what a task stores of its folder, so the path travels beside it. */
export const listLabel = (list) => [list?.folderPath || list?.folderName, list?.name].filter(Boolean).join(PATH_SEPARATOR);

export function nestedFolders(folders) {
    const live = listOf(folders).filter((folder) => isLiveFolder(folders, folder));
    const placed = (folder, depth) => ({ ...folder, depth, path: folderPathLabel(folders, folder) });
    return live
        .filter((folder) => !parentIdOf(folder))
        .flatMap((folder) => [placed(folder, 0), ...live.filter((sub) => parentIdOf(sub) === folderIdOf(folder)).map((sub) => placed(sub, 1))]);
}

export const canHoldSubfolders = (folders, folder) => Boolean(folder) && isLive(folder) && !parentIdOf(folder);

const holdsSubfolders = (folders, folder) => subfoldersOf(folders, folderIdOf(folder)).some((sub) => Number(sub.deletedStatusKey) !== DELETED);

export function folderMoveTargets(folders, folder) {
    if (!folder || holdsSubfolders(folders, folder)) return [];
    return listOf(folders).filter((target) => canHoldSubfolders(folders, target) && folderIdOf(target) !== folderIdOf(folder));
}
