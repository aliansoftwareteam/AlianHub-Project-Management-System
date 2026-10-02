const mongoose = require('mongoose');
const { SCHEMA_TYPE } = require('../../../Config/schemaType');
const { MongoDbCrudOpration } = require('../../../utils/mongo-handler/mongoQueries');
const { ListWriteError } = require('./listWriteError');

const OBJECT_ID = /^[a-f0-9]{24}$/i;
const LIVE = 0;
const DELETED = 1;
const ARCHIVED = 2;
const ARCHIVED_WITH_FOLDER = 6;
const FOLDER_FIELDS = { name: 1, projectId: 1, deletedStatusKey: 1, parentFolderId: 1 };

/*
 * What an archive, delete or restore of a folder writes on the rows under it, tasks and subfolders
 * alike. A row archived or deleted by itself matches no `from`, so a restore brings back only what
 * the archive took.
 */
const FOLDER_CASCADE = {
    [LIVE]: { from: ARCHIVED_WITH_FOLDER, to: LIVE },
    [DELETED]: { from: LIVE, to: DELETED },
    [ARCHIVED]: { from: LIVE, to: ARCHIVED_WITH_FOLDER },
};

/* A delete leaves no mark of its own, so a restore from the trash brings back every trashed row under
   the folder, as a list's restore from the trash does for its tasks. */
const TRASH_RESTORE = { from: { $in: [ARCHIVED_WITH_FOLDER, DELETED] }, to: LIVE };

const folderCascade = (status, fromTrash = false) => (fromTrash && status === LIVE ? TRASH_RESTORE : FOLDER_CASCADE[status]);

const oid = (id) => new mongoose.Types.ObjectId(String(id));
const read = (companyId, method, type, filter, fields) => MongoDbCrudOpration(companyId, { type, data: [filter, fields] }, method);

const requestedParent = (parentFolderId) => {
    if (parentFolderId === null || parentFolderId === undefined || parentFolderId === '') return null;
    if (typeof parentFolderId !== 'string' || !OBJECT_ID.test(parentFolderId)) throw new ListWriteError('A valid parent folder id is required.');
    return parentFolderId;
};

/* Chat categories share the folders collection; their container is a chat space, not a project. */
const refuseChatSpace = async (companyId, containerId) => {
    if (await read(companyId, 'findOne', SCHEMA_TYPE.MAIN_CHATS, { _id: oid(containerId) }, { _id: 1 })) {
        throw new ListWriteError('Chat categories cannot be nested.');
    }
};

/* A parent is always a top-level folder, so the only cycle left to refuse is a folder naming itself. */
const parentIn = async (companyId, projectId, parentFolderId) => {
    const parent = await read(companyId, 'findOne', SCHEMA_TYPE.FOLDERS, { _id: oid(parentFolderId), projectId: oid(projectId) }, FOLDER_FIELDS);
    if (!parent) throw new ListWriteError('That parent folder is not in this project.');
    if (parent.deletedStatusKey === DELETED) throw new ListWriteError('A deleted folder cannot hold subfolders.');
    if (parent.parentFolderId) throw new ListWriteError('A subfolder cannot hold folders: folders nest one level.');
    return parent;
};

const parentForNewFolder = async (companyId, projectId, parentFolderId) => {
    const wanted = requestedParent(parentFolderId);
    if (!wanted) return null;
    if (!OBJECT_ID.test(String(projectId || ''))) throw new ListWriteError('A valid project id is required.');
    await refuseChatSpace(companyId, projectId);
    return parentIn(companyId, projectId, wanted);
};

/* A list goes only where people can open it: a live folder of its own project, under a live parent. */
const folderForList = async (companyId, projectId, folderId) => {
    if (!OBJECT_ID.test(String(folderId || '')) || !OBJECT_ID.test(String(projectId || ''))) throw new ListWriteError('A valid folder id is required.');
    const folder = await read(companyId, 'findOne', SCHEMA_TYPE.FOLDERS, { _id: oid(folderId), projectId: oid(projectId) }, FOLDER_FIELDS);
    if (!folder) throw new ListWriteError('That folder is not in this project.');
    const parent = folder.parentFolderId
        ? await read(companyId, 'findOne', SCHEMA_TYPE.FOLDERS, { _id: folder.parentFolderId, projectId: folder.projectId }, FOLDER_FIELDS)
        : null;
    if (folder.deletedStatusKey || (folder.parentFolderId && (!parent || parent.deletedStatusKey))) {
        throw new ListWriteError('An archived or deleted folder cannot take a list.');
    }
    return folder;
};

const prepareFolderMove = async (companyId, folderId, parentFolderId) => {
    if (!OBJECT_ID.test(String(folderId || ''))) throw new ListWriteError('A valid folder id is required.');
    if (parentFolderId === undefined) throw new ListWriteError('A move names the parent folder, or null for the top level.');
    const wanted = requestedParent(parentFolderId);
    const folder = await read(companyId, 'findOne', SCHEMA_TYPE.FOLDERS, { _id: oid(folderId) }, FOLDER_FIELDS);
    if (!folder) return null;
    await refuseChatSpace(companyId, folder.projectId);
    if (folder.deletedStatusKey === ARCHIVED_WITH_FOLDER) throw new ListWriteError('This folder is archived with its parent folder. Restore the parent folder first.');
    const previousParentId = folder.parentFolderId ? String(folder.parentFolderId) : '';
    if (!wanted) return { folder, parent: null, previousParentId, update: { $unset: { parentFolderId: '' } } };
    if (wanted === String(folder._id)) throw new ListWriteError('A folder cannot be moved into itself.');
    const parent = await parentIn(companyId, folder.projectId, wanted);
    const subfolder = await read(companyId, 'findOne', SCHEMA_TYPE.FOLDERS, { parentFolderId: folder._id, projectId: folder.projectId, deletedStatusKey: { $ne: DELETED } }, { _id: 1 });
    if (subfolder) throw new ListWriteError('A folder that holds subfolders cannot become a subfolder: folders nest one level.');
    return { folder, parent, previousParentId, update: { $set: { parentFolderId: parent._id } } };
};

/* Restored under an archived or deleted parent, a subfolder's tasks would be live inside a folder nobody can open. */
const refuseRestoreUnderHiddenParent = async (companyId, folder) => {
    if (!folder.parentFolderId) return;
    const parent = await read(companyId, 'findOne', SCHEMA_TYPE.FOLDERS, { _id: folder.parentFolderId, projectId: folder.projectId }, FOLDER_FIELDS);
    if (!parent || parent.deletedStatusKey || parent.parentFolderId) throw new ListWriteError('The parent folder is archived or deleted. Restore the parent folder first.');
};

const subfoldersFollowing = async (companyId, folder, { from }) => {
    const rows = await read(companyId, 'find', SCHEMA_TYPE.FOLDERS, { parentFolderId: folder._id, projectId: folder.projectId, deletedStatusKey: from }, { _id: 1 });
    return (rows || []).map((row) => String(row._id));
};

module.exports = { folderCascade, folderForList, parentForNewFolder, prepareFolderMove, refuseRestoreUnderHiddenParent, subfoldersFollowing };
