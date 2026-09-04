const { SCHEMA_TYPE } = require('../../Config/schemaType');

const TRASHED = 1;
const MAX_ROWS = 200;
const SAMPLE_PROJECT_CODE = 'WELCOME';

const KINDS = {
    projects: {
        type: SCHEMA_TYPE.PROJECTS,
        fields: 'ProjectName ProjectCode updatedAt',
        row: (doc) => ({ title: doc.ProjectName, code: doc.ProjectCode, projectId: String(doc._id) })
    },
    lists: {
        type: SCHEMA_TYPE.SPRINTS,
        fields: 'name projectId updatedAt',
        row: (doc) => ({ title: doc.name, code: '', projectId: doc.projectId ? String(doc.projectId) : '' })
    },
    tasks: {
        type: SCHEMA_TYPE.TASKS,
        fields: 'TaskName TaskKey ProjectID sprintId updatedAt',
        row: (doc) => ({ title: doc.TaskName, code: doc.TaskKey, projectId: doc.ProjectID ? String(doc.ProjectID) : '' })
    },
    docs: {
        type: SCHEMA_TYPE.PAGES,
        fields: 'title ProjectID updatedAt',
        row: (doc) => ({ title: doc.title, code: '', projectId: doc.ProjectID ? String(doc.ProjectID) : '' })
    }
};

const isKind = (kind) => Object.prototype.hasOwnProperty.call(KINDS, kind);

const listQuery = (kind) => ({
    type: KINDS[kind].type,
    filter: { deletedStatusKey: TRASHED },
    fields: KINDS[kind].fields,
    options: { sort: { updatedAt: -1 }, limit: MAX_ROWS }
});

const toRow = (kind, doc) => ({
    _id: String(doc._id),
    kind,
    updatedAt: doc.updatedAt || null,
    ...KINDS[kind].row(doc)
});

/* Restoring a container brings back the tasks it took with it. A trashed
   project set its tasks to 1 and an archived one to 7; a trashed list set
   its tasks to 1 (the sprint write itself already restores the 4s). */
const childRestoreFilter = (kind, id, ObjectId) => {
    if (kind === 'projects') return { ProjectID: new ObjectId(id), deletedStatusKey: { $in: [TRASHED, 7] } };
    if (kind === 'lists') return { sprintId: new ObjectId(id), deletedStatusKey: TRASHED };
    return null;
};

module.exports = { TRASHED, MAX_ROWS, SAMPLE_PROJECT_CODE, KINDS: Object.keys(KINDS), isKind, listQuery, toRow, childRestoreFilter };
