const { SCHEMA_TYPE } = require('../../Config/schemaType');
const { MongoDbCrudOpration } = require('../../utils/mongo-handler/mongoQueries');
const { oid } = require('../Automations/engine/tools');
const lists = require('./listSetup');

// The cards of a waiting folder and of a list waiting to become a sprint (frontend IntentPreview). A folder is the
// project's own: a viewer who cannot open the project has no card, and a list to move is named only when the viewer
// can open it in that project; the rest are a count. A sprint's card is the list's, so a viewer who cannot open the
// list has none.

const TEXT_MAX = 250;
const OBJECT_ID = /^[a-f0-9]{24}$/i;

const idOf = (value) => { const text = String(value === undefined || value === null ? '' : value); return OBJECT_ID.test(text) ? text : ''; };
const textOf = (value, max = TEXT_MAX) => (typeof value === 'string' ? value.trim().slice(0, max) : '');
const listOf = (value) => (Array.isArray(value) ? value : []);
const objectOf = (value) => (value && typeof value === 'object' && !Array.isArray(value) ? value : {});
const paramsOf = (change) => objectOf(change && change.params);

const folderLines = async (folder, open) => {
    const made = listOf(folder.lists).slice(0, lists.LISTS_MAX).map((name) => textOf(name)).filter(Boolean);
    const moved = listOf(folder.moveListIds).slice(0, lists.MOVES_MAX).map(idOf).filter(Boolean);
    const shown = [];
    for (const sprintId of moved) {
        const list = await open(sprintId);
        if (list && textOf(list.name)) shown.push(textOf(list.name));
    }
    return [made.length > 0 && { kind: 'newLists', names: made }, moved.length > 0 && { kind: 'movedLists', names: shown, others: moved.length - shown.length }];
};

const folderPreview = async (change, { named, companyId, uid }) => {
    const params = paramsOf(change);
    const projectId = idOf(params.projectId);
    const project = projectId ? named.project(projectId).name : null;
    const title = textOf(params.name, lists.NAME_MAX);
    if (!project || !title) return null;
    const parent = idOf(params.parentFolderId)
        ? await MongoDbCrudOpration(companyId, { type: SCHEMA_TYPE.FOLDERS, data: [{ _id: oid(params.parentFolderId), projectId: oid(projectId) }, { name: 1 }] }, 'findOne')
        : null;
    const open = (sprintId) => lists.listFor(companyId, uid, projectId, sprintId);
    const lines = [{ kind: 'place', project, list: '' }, parent && textOf(parent.name) && { kind: 'inFolder', name: textOf(parent.name) }, ...(await folderLines(params, open))];
    for (const subfolder of listOf(params.subfolders).slice(0, lists.SUBFOLDERS_MAX).map(objectOf)) {
        if (textOf(subfolder.name)) lines.push({ kind: 'subfolder', name: textOf(subfolder.name, lists.NAME_MAX) }, ...(await folderLines(subfolder, open)));
    }
    return { kind: 'folder', title, lines: lines.filter(Boolean) };
};

const sprintPreview = async (change, { named, companyId, uid }) => {
    const params = paramsOf(change);
    const projectId = idOf(params.projectId);
    const project = projectId ? named.project(projectId).name : null;
    const list = project && !lists.sprintProblem(params) ? await lists.listFor(companyId, uid, projectId, params.sprintId) : null;
    if (!list || !textOf(list.name)) return null;
    const dated = list.isScrum === true && list.startDate && list.endDate;
    return {
        kind: 'sprint',
        title: textOf(list.name),
        lines: [
            { kind: 'place', project, list: '' },
            { kind: 'sprintDays', from: params.startDate, to: params.endDate },
            dated && { kind: 'sprintDaysNow', from: new Date(list.startDate).toISOString(), to: new Date(list.endDate).toISOString() },
        ].filter(Boolean),
    };
};

module.exports = { BUILDERS: Object.freeze({ [lists.FOLDER]: folderPreview, [lists.SPRINT]: sprintPreview }) };
