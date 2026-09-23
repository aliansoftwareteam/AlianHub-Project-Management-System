const mongoose = require('mongoose');
const { SCHEMA_TYPE } = require('../../../Config/schemaType');
const { MongoDbCrudOpration } = require('../../../utils/mongo-handler/mongoQueries');
const { commentThreadAccess } = require('./threadAccess');

const OBJECT_ID = /^[a-f0-9]{24}$/i;
const isId = (value) => OBJECT_ID.test(String(value || ''));
const asText = (value) => (value === undefined || value === null ? '' : String(value));

const NOT_FOUND = { allowed: false, statusCode: 404 };

const THREAD_FIELDS = ['projectId', 'sprintId', 'taskId'];

const threadOf = (comment) => Object.fromEntries(THREAD_FIELDS.map((key) => [key, asText(comment && comment[key])]));

/* The read rule does not tie a sprint to the project it is named under; a new comment is stamped
 * with both ids, so a write also requires the sprint to sit in that project. */
const canPostToThread = async (companyId, uid, thread) => {
    const access = await commentThreadAccess(companyId, uid, thread);
    if (!access.allowed || !isId(thread.sprintId)) return access;
    const sprint = await MongoDbCrudOpration(companyId, {
        type: SCHEMA_TYPE.SPRINTS,
        data: [{ _id: new mongoose.Types.ObjectId(thread.sprintId) }, { projectId: 1 }],
    }, 'findOne');
    return sprint && String(sprint.projectId) === thread.projectId ? access : NOT_FOUND;
};

const canChangeComment = (companyId, uid, comment) => commentThreadAccess(companyId, uid, threadOf(comment));

/* An edit may resend the thread ids and author it already has, but never different ones. */
const IMMUTABLE_FIELDS = [...THREAD_FIELDS, 'userId'];
const changesThreadOrAuthor = (comment, data) => IMMUTABLE_FIELDS.some((key) => (
    Object.prototype.hasOwnProperty.call(data || {}, key) && asText(data[key]) !== asText(comment[key])
));

module.exports = { threadOf, canPostToThread, canChangeComment, changesThreadOrAuthor };
