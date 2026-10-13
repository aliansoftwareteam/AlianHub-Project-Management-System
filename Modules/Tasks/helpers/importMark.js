/* What only an importer writes on a task: the import job that created it and the id its source gave it. Every new task
 * document loses both unless the importer hands them over beside the task, so a body, a copy and a template carry neither. */
const IMPORT_MARK_FIELDS = Object.freeze(['importJobId', 'importSourceId']);
const MAX_SOURCE_ID = 200;

const withoutImportMark = (task) => {
    IMPORT_MARK_FIELDS.forEach((field) => { delete task[field]; });
    return task;
};

const importMarkOf = (importMark, row) => {
    if (!importMark || !importMark.jobId) return null;
    const sourceId = row && row.importSourceId ? String(row.importSourceId).slice(0, MAX_SOURCE_ID) : '';
    return { importJobId: String(importMark.jobId), ...(sourceId ? { importSourceId: sourceId } : {}) };
};

/* Who a task event of an import is from: the automations and the assignment rules answer no event that carries it. */
const importActorOf = (userData) => ({ kind: 'import', userId: String((userData && userData.id) || '') });

module.exports = { IMPORT_MARK_FIELDS, withoutImportMark, importMarkOf, importActorOf };
