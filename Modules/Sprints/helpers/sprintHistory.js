const { default: mongoose } = require('mongoose');
const { SCHEMA_TYPE } = require('../../../Config/schemaType');
const { MongoDbCrudOpration } = require('../../../utils/mongo-handler/mongoQueries');
const { escapeText } = require('../../Tasks/helpers/taskWriteFields');
const { HISTORY, NOTICE, projectActor, send } = require('../../Project/helpers/projectHistory');

const OBJECT_ID = /^[0-9a-f]{24}$/i;

const nameOf = async (companyId, type, id, field) => {
    if (!OBJECT_ID.test(String(id || ''))) return '';
    const row = await MongoDbCrudOpration(companyId, { type, data: [{ _id: new mongoose.Types.ObjectId(String(id)) }, { [field]: 1 }] }, 'findOne').catch(() => null);
    return (row && row[field]) || '';
};

/* History and notices name the project, folder and sprint as stored; the names a request carries are only what the caller saw. */
const storedNames = async (companyId, { projectId, folderId, sprintId }) => {
    const [projectName, folderName, sprintName] = await Promise.all([
        nameOf(companyId, SCHEMA_TYPE.PROJECTS, projectId, 'ProjectName'),
        nameOf(companyId, SCHEMA_TYPE.FOLDERS, folderId, 'name'),
        sprintId === undefined ? null : nameOf(companyId, SCHEMA_TYPE.SPRINTS, sprintId, 'name'),
    ]);
    return sprintName === null ? { projectName, folderName } : { projectName, folderName, sprintName };
};

const notifyCreated = async ({ companyId, projectId, actorId, notice }) => {
    const [actor, { projectName }] = await Promise.all([projectActor(companyId, actorId), storedNames(companyId, { projectId })]);
    const P = escapeText(projectName);
    await send({ companyId, projectId, actor, entries: [notice(P)] });
};

const notifySprintCreated = ({ companyId, projectId, sprintName, actorId }) => notifyCreated({
    companyId,
    projectId,
    actorId,
    notice: (P) => {
        const S = escapeText(sprintName);
        return {
            notice: { key: NOTICE.SPRINT_CREATED, message: `<p>Created new <strong>Sprint</strong> named <strong>${S}</strong> in <strong>${P}</strong> project.</p>` },
            changeType: 'sprint_create',
            changeData: { ProjectName: P, sprintName: S },
        };
    },
});

const notifyFolderCreated = ({ companyId, projectId, folderName, actorId }) => notifyCreated({
    companyId,
    projectId,
    actorId,
    notice: (P) => {
        const F = escapeText(folderName);
        return {
            notice: { key: NOTICE.FOLDER_CREATED, message: `<p>Created new <strong>Folder</strong> named <strong>${F}</strong> in <strong>${P}</strong> project.</p>` },
            changeType: 'folder_create',
            changeData: { ProjectName: P, sprintFolderName: F },
        };
    },
});

const isFavouriteOf = (sprint, uid) => (sprint.favouriteTasks || []).some((entry) => entry && String(entry.userId) === String(uid));

/* Only a favourite the actor adds for themselves is recorded; the web app wrote the same sentence on removal too, which read wrongly. */
const recordSprintFavourite = async ({ companyId, previous, updateObject, key, actorId }) => {
    const favourite = updateObject && updateObject.favouriteTasks;
    if (key !== '$addToSet' || !previous || !favourite || String(favourite.userId) !== String(actorId) || isFavouriteOf(previous, actorId)) return;
    const [actor, { projectName }] = await Promise.all([projectActor(companyId, actorId), storedNames(companyId, { projectId: previous.projectId })]);
    await send({
        companyId,
        projectId: previous.projectId,
        actor,
        entries: [{ history: { key: HISTORY.SPRINT, message: `<b>${actor.Employee_Name}</b> has set <b>${escapeText(previous.name)}</b> sprint as favorite in <b>${escapeText(projectName)}</b> project.` } }],
    });
};

module.exports = { storedNames, notifySprintCreated, notifyFolderCreated, recordSprintFavourite };
