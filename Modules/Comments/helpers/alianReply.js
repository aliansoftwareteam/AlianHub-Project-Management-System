'use strict';

const { SCHEMA_TYPE } = require('../../../Config/schemaType');
const { MongoDbCrudOpration } = require('../../../utils/mongo-handler/mongoQueries');
const logger = require('../../../Config/loggerConfig');
const socketEmitter = require('../../../event/socketEventEmitter');
const { runWorkspaceAsk } = require('../../Pages/helpers/runWorkspaceAsk');
const {
    extractAlianQuestion,
    shouldReplyAsAlian,
    citationsForComment,
    buildAlianComment,
} = require('./alianMention');
const { serializeCommentForSocket, commentRoomPrefix, idString } = require('./commentThread');

const NO_QUESTION_TEXT = 'Ask a question after @Alian — I will look across pages and tasks you can open.';
const AI_MISSING_TEXT = 'Connect an LLM in your environment to ask Alian from comments.';

function asPlain(doc) {
    if (!doc) return doc;
    if (typeof doc.toObject === 'function') return doc.toObject();
    return doc;
}

function copyThreadId(data, saved, source, key) {
    const hex = idString(data[key]) || idString(saved && saved[key]) || idString(source && source[key]);
    if (hex) data[key] = hex;
    else delete data[key];
}

function emitCommentInsert(saved, source) {
    const data = serializeCommentForSocket(saved, source);
    copyThreadId(data, saved, source, 'projectId');
    copyThreadId(data, saved, source, 'sprintId');
    copyThreadId(data, saved, source, 'taskId');
    const _id = idString(data._id) || idString(data.id) || idString(saved && (saved._id || saved.id));
    if (_id) {
        data._id = _id;
        data.id = _id;
    }
    const thread = commentRoomPrefix(data);
    if (!thread || String(thread.prefix).includes('[object Object]')) return;
    socketEmitter.emit('insert', {
        type: 'insert',
        data,
        updatedFields: {},
        module: thread.module,
    });
}

async function saveAlianComment(companyId, source, message, citations) {
    const payload = buildAlianComment(asPlain(source), message, citations);
    if (!payload.projectId) {
        throw new Error('Alian reply is missing projectId.');
    }
    const saved = await MongoDbCrudOpration(companyId, {
        type: SCHEMA_TYPE.COMMENTS,
        data: payload,
    }, 'save');
    emitCommentInsert(saved, source);
    return saved;
}

async function maybeReplyAsAlian(companyId, comment, askerId) {
    if (!shouldReplyAsAlian(comment)) return null;
    const { mentioned, question } = extractAlianQuestion(comment.message);
    if (!mentioned) return null;

    if (!question) {
        return saveAlianComment(companyId, comment, NO_QUESTION_TEXT, []);
    }

    const result = await runWorkspaceAsk({
        companyId,
        uid: String(askerId || comment.userId || ''),
        question,
    });
    if (!result || !result.status) {
        const text = result && result.isNotAi ? AI_MISSING_TEXT : ((result && result.reason) || 'I could not answer that.');
        return saveAlianComment(companyId, comment, text, []);
    }
    const data = result.data || {};
    const markdown = String(data.markdown || data.previewText || '').trim() || 'I could not answer that.';
    return saveAlianComment(companyId, comment, markdown, citationsForComment(data.citations));
}

async function maybeReplyAsAlianSafe(companyId, comment, askerId) {
    try {
        return await maybeReplyAsAlian(companyId, comment, askerId);
    } catch (error) {
        logger.error(`[alian] follow-up failed: ${error.message}`);
        return null;
    }
}

module.exports = {
    NO_QUESTION_TEXT,
    AI_MISSING_TEXT,
    maybeReplyAsAlian,
    maybeReplyAsAlianSafe,
    emitCommentInsert,
    saveAlianComment,
};
