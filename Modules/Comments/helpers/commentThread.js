'use strict';

const HEX_ID = /^[0-9a-fA-F]{24}$/;

function idString(value) {
    if (value == null || value === '') return '';
    if (typeof value === 'string') return value;
    if (typeof value.toHexString === 'function') return value.toHexString();
    if (Buffer.isBuffer(value)) return value.toString('hex');
    if (typeof value === 'object') {
        if (value.$oid) return String(value.$oid);
        if (typeof value.id === 'string' && HEX_ID.test(value.id)) return value.id;
        if (Buffer.isBuffer(value.id)) return value.id.toString('hex');
        if (value.buffer && Buffer.isBuffer(value.buffer)) return Buffer.from(value.buffer).toString('hex');
        if (value._id && value._id !== value) return idString(value._id);
    }
    const s = String(value);
    if (s === '[object Object]') return '';
    return s;
}

function commentRoomPrefix(data) {
    const projectId = idString(data && data.projectId);
    const sprintId = idString(data && data.sprintId);
    const taskId = idString(data && data.taskId);
    if (projectId && sprintId && taskId) {
        return {
            module: 'comments',
            prefix: `comments_${projectId}_${sprintId}_${taskId}`,
            projectId,
            sprintId,
            taskId,
        };
    }
    if (projectId) {
        return {
            module: 'comments_project',
            prefix: `comments_project_${projectId}`,
            projectId,
            sprintId: sprintId || '',
            taskId: taskId || '',
        };
    }
    return null;
}

function asPlain(doc) {
    if (!doc) return {};
    if (typeof doc.toJSON === 'function') {
        try {
            return doc.toJSON();
        } catch (_e) {
            // fall through
        }
    }
    if (typeof doc.toObject === 'function') {
        try {
            return doc.toObject();
        } catch (_err) {
            // fall through
        }
    }
    return doc;
}

function serializeCommentForSocket(doc, source) {
    const raw = asPlain(doc);
    let plain;
    try {
        plain = JSON.parse(JSON.stringify(raw));
    } catch (_e) {
        plain = { ...raw };
    }
    const fromSource = source ? serializeCommentForSocket(source) : {};
    const projectId = idString(plain.projectId || raw.projectId || fromSource.projectId);
    const sprintId = idString(plain.sprintId || raw.sprintId || fromSource.sprintId);
    const taskId = idString(plain.taskId || raw.taskId || fromSource.taskId);
    const _id = idString(plain._id || raw._id || plain.id || raw.id);
    if (_id) {
        plain._id = _id;
        plain.id = _id;
    }
    if (projectId) plain.projectId = projectId;
    if (sprintId) plain.sprintId = sprintId;
    if (taskId) plain.taskId = taskId;
    if (plain.userId != null) plain.userId = String(plain.userId);
    return plain;
}

function incomingCommentDoc(payload) {
    if (!payload || typeof payload !== 'object') return null;
    return payload.fullDocument || payload;
}

function acceptIncomingComment(doc) {
    if (!doc || typeof doc !== 'object') return false;
    return Boolean(idString(doc._id || doc.id) || doc.userId || doc.message);
}

module.exports = {
    idString,
    commentRoomPrefix,
    serializeCommentForSocket,
    incomingCommentDoc,
    acceptIncomingComment,
};
