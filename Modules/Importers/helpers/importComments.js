const mongoose = require('mongoose');
const logger = require('../../../Config/loggerConfig');
const { SCHEMA_TYPE } = require('../../../Config/schemaType');
const { MongoDbCrudOpration } = require('../../../utils/mongo-handler/mongoQueries');
const { escapeCommentText } = require('../../Comments/helpers/plainText');

const MAX_COMMENT_LENGTH = 10000;
const MAX_KEY_LENGTH = 400;

const oid = (id) => new mongoose.Types.ObjectId(String(id));
const lower = (value) => String(value === undefined || value === null ? '' : value).trim().toLowerCase();

const instantOf = (value) => {
    const date = value ? new Date(value) : null;
    return date && !Number.isNaN(date.getTime()) ? date : null;
};

/* What tells a comment from the others of its task in the file: its time and its author, and its words when the file
 * gives it no time. */
const commentKeyOf = (comment) => {
    const at = instantOf(comment.at || comment.date);
    const author = lower(comment.email || comment.author);
    return (at ? `${at.toISOString()}|${author}` : `|${author}|${String(comment.text || '').trim()}`).slice(0, MAX_KEY_LENGTH);
};

/* A row the import created holds `createdTaskId`; a row whose task was already here holds `storedTask`, with the list
 * that task sits in. */
const taskOf = (row, sprint) => {
    if (row.createdTaskId) return { id: String(row.createdTaskId), sprintId: sprint.id, folderId: sprint.folderId };
    return row.storedTask ? { id: String(row.storedTask.id), sprintId: row.storedTask.sprintId || sprint.id, folderId: row.storedTask.folderId } : null;
};

const threadOf = (project, task) => ({
    projectId: oid(project._id),
    taskId: oid(task.id),
    sprintId: oid(task.sprintId),
    project: false,
    ...(task.folderId ? { folderId: oid(task.folderId) } : {}),
});

/* A comment is its author's only when the importer says who that is; otherwise it is kept under the importing person,
 * led by the author's name as the file gives it. */
const commentOf = (comment, { authorIdByEmail, actorId }) => {
    const authorId = authorIdByEmail.get(comment.email);
    const text = authorId || !comment.author ? comment.text : `${comment.author}: ${comment.text}`;
    const at = instantOf(comment.at || comment.date);
    return {
        message: escapeCommentText(String(text).slice(0, MAX_COMMENT_LENGTH)),
        userId: authorId || actorId,
        type: 'text',
        ...(at ? { createdAt: at } : {}),
    };
};

const commentsIn = (row) => (Array.isArray(row.comments) ? row.comments : []).filter((entry) => entry && entry.text);

/* The keys of the imported comments each task already holds, by task id. */
const storedCommentKeys = async (companyId, taskIds) => {
    const keys = new Map();
    if (!taskIds.length) return keys;
    const found = await MongoDbCrudOpration(companyId, {
        type: SCHEMA_TYPE.COMMENTS,
        data: [{ taskId: { $in: taskIds.map(oid) }, importKey: { $exists: true } }, { taskId: 1, importKey: 1 }],
    }, 'find');
    (found || []).forEach((comment) => {
        const id = String(comment.taskId);
        keys.set(id, (keys.get(id) || new Set()).add(comment.importKey));
    });
    return keys;
};

/* The comments of `row` that its task does not hold yet. */
const newComments = (row, knownKeys) => {
    const task = row.storedTask ? String(row.storedTask.id) : '';
    const known = knownKeys.get(task) || new Set();
    return commentsIn(row).filter((comment) => !known.has(commentKeyOf(comment)));
};

/* Imported comments are history, not news: each is saved without the socket event, the unread counts, the mention
 * notices and the agent starts a comment written in the app sets off, and is marked with the importer it came through,
 * the import job and its key in the file. A comment carries text alone, never a file. A comment its task already holds
 * is left out; one that cannot be saved is logged and never fails the import. Answers how many comments were saved. */
const saveImportedComments = async (companyId, { source, project, sprint, rows, actorId, jobId = null, authorIdByEmail = new Map(), knownKeys = new Map() }) => {
    let saved = 0;
    for (const row of rows) {
        const task = taskOf(row, sprint);
        if (!task) continue;
        const thread = threadOf(project, task);
        const mark = { importedFrom: source, ...(jobId ? { importJobId: oid(jobId) } : {}) };
        const save = (comment, importKey) => MongoDbCrudOpration(companyId, { type: SCHEMA_TYPE.COMMENTS, data: { ...comment, ...thread, ...mark, importKey } }, 'save')
            .then(() => true)
            .catch((error) => {
                logger.error(`[importers] comment on task ${task.id} not saved: ${(error && error.message) || error}`);
                return false;
            });
        for (const comment of newComments(row, knownKeys)) {
            if (await save(commentOf(comment, { authorIdByEmail, actorId }), commentKeyOf(comment))) saved += 1;
        }
    }
    return saved;
};

module.exports = { saveImportedComments, storedCommentKeys, newComments, commentKeyOf };
