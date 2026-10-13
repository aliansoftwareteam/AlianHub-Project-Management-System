const mongoose = require('mongoose');
const { SCHEMA_TYPE } = require('../../../Config/schemaType');
const { MongoDbCrudOpration } = require('../../../utils/mongo-handler/mongoQueries');
const { replaceObjectKey } = require('../../Auth/helper');
const { threadOf } = require('./threadWriteAccess');
const { CHANNEL_THREAD } = require('./conversation');

/* The thread each comment route reads or writes, as its handler takes it, for the guard in front of the handler. */

const OBJECT_ID = /^[a-f0-9]{24}$/i;
const isId = (value) => OBJECT_ID.test(String(value || ''));
const plain = (value) => (value && typeof value === 'object' && !Array.isArray(value) ? value : {});

const ofComment = async (companyId, id) => {
    if (!isId(id)) return null;
    const comment = await MongoDbCrudOpration(companyId, { type: SCHEMA_TYPE.COMMENTS, data: [{ _id: new mongoose.Types.ObjectId(String(id)) }, { projectId: 1, sprintId: 1, taskId: 1 }] }, 'findOne');
    return comment ? threadOf(comment) : null;
};

/* A reply lives in its parent's thread, whatever thread it names. */
const posted = (req, companyId) => {
    const data = plain(replaceObjectKey(plain(req.body).data, ['objId']));
    return isId(data.parentId) ? ofComment(companyId, data.parentId) : threadOf(data);
};

/* The page of messages reads the channel thread whenever `mainChat` is sent without `isDefault`, whatever task is named. */
const paged = (req) => {
    const { projectId, sprintId, taskId, isDefault, mainChat } = plain(req.query);
    const channel = !isDefault && Boolean(mainChat);
    return { projectId, sprintId, taskId: channel ? CHANNEL_THREAD : taskId, acrossLists: channel };
};

const searched = (req) => {
    const { projectId, sprintId, taskId } = plain(req.query);
    return { projectId, sprintId, taskId: taskId || CHANNEL_THREAD };
};

const queried = (req) => {
    const { projectId, sprintId, taskId } = plain(req.query);
    return { projectId, sprintId, taskId };
};

const ofBodyId = (req, companyId) => ofComment(companyId, plain(req.body).id);
const ofParent = (req, companyId) => ofComment(companyId, plain(req.query).parentId);

/* A reaction lands on a comment, or on a task row, which a direct message is too. */
const reactedTo = (req, companyId) => {
    const { targetType, targetId } = plain(req.body);
    return targetType === 'task' ? { taskId: targetId } : ofComment(companyId, targetId);
};

module.exports = { posted, paged, searched, queried, ofBodyId, ofParent, reactedTo };
