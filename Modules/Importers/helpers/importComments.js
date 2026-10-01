const mongoose = require('mongoose');
const logger = require('../../../Config/loggerConfig');
const { SCHEMA_TYPE } = require('../../../Config/schemaType');
const { MongoDbCrudOpration } = require('../../../utils/mongo-handler/mongoQueries');
const { escapeCommentText } = require('../../Comments/helpers/plainText');

const MAX_COMMENT_LENGTH = 10000;

const oid = (id) => new mongoose.Types.ObjectId(String(id));

const instantOf = (value) => {
    const date = value ? new Date(value) : null;
    return date && !Number.isNaN(date.getTime()) ? date : null;
};

const threadOf = (project, sprint, row) => ({
    projectId: oid(project._id),
    taskId: oid(row.createdTaskId),
    sprintId: oid(sprint.id),
    project: false,
    ...(sprint.folderId ? { folderId: oid(sprint.folderId) } : {}),
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

/* Imported comments are history, not news: each is saved without the socket event, the unread counts, the mention
 * notices and the agent starts a comment written in the app sets off, and is marked with the importer it came through.
 * A comment carries text alone, never a file. Each row was stamped with `createdTaskId` by the create path; a comment
 * that cannot be saved is logged and never fails the import. `extraFor` adds comments the importer writes itself,
 * which are not counted. Answers how many of the file's comments were saved. */
const saveImportedComments = async (companyId, { source, project, sprint, rows, actorId, authorIdByEmail = new Map(), extraFor = () => [] }) => {
    let saved = 0;
    for (const row of rows) {
        if (!row.createdTaskId) continue;
        const thread = threadOf(project, sprint, row);
        const save = (comment) => MongoDbCrudOpration(companyId, { type: SCHEMA_TYPE.COMMENTS, data: { ...comment, ...thread, importedFrom: source } }, 'save')
            .then(() => true)
            .catch((error) => {
                logger.error(`[importers] comment on task ${row.createdTaskId} not saved: ${(error && error.message) || error}`);
                return false;
            });
        for (const comment of (Array.isArray(row.comments) ? row.comments : []).filter((entry) => entry && entry.text)) {
            if (await save(commentOf(comment, { authorIdByEmail, actorId }))) saved += 1;
        }
        for (const comment of extraFor(row)) await save(comment);
    }
    return saved;
};

module.exports = { MAX_COMMENT_LENGTH, saveImportedComments };
