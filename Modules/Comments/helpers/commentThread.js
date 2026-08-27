'use strict';

const mongoose = require('mongoose');
const HEX_ID = /^[0-9a-fA-F]{24}$/;
const OBJECT_OBJECT = '[object Object]';

function hexFromBytes(value) {
    if (!value) return '';
    if (Buffer.isBuffer(value)) {
        const hex = value.toString('hex');
        return HEX_ID.test(hex) ? hex : '';
    }
    if (value.type === 'Buffer' && Array.isArray(value.data)) {
        return hexFromBytes(Buffer.from(value.data));
    }
    if (ArrayBuffer.isView(value)) {
        return hexFromBytes(Buffer.from(value.buffer, value.byteOffset, value.byteLength));
    }
    if (Array.isArray(value) && value.length === 12 && value.every((n) => Number.isInteger(n))) {
        return hexFromBytes(Buffer.from(value));
    }
    return '';
}

function idString(value) {
    if (value == null || value === '') return '';
    if (typeof value === 'string') {
        const trimmed = value.trim();
        if (!trimmed || trimmed === OBJECT_OBJECT) return '';
        return trimmed;
    }
    if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'symbol') {
        return '';
    }
    if (typeof value.toHexString === 'function') {
        return idString(value.toHexString());
    }
    const fromSelf = hexFromBytes(value);
    if (fromSelf) return fromSelf;
    if (typeof value === 'object') {
        if (value.$oid) return idString(value.$oid);
        const nested = hexFromBytes(value.id) || hexFromBytes(value.buffer);
        if (nested) return nested;
        if (typeof value.id === 'string') return idString(value.id);
        if (value._id && value._id !== value) return idString(value._id);
    }
    try {
        const s = String(value);
        if (!s || s === OBJECT_OBJECT) return '';
        return s;
    } catch (_e) {
        return '';
    }
}

function commentRoomPrefix(data) {
    const projectId = idString(data && data.projectId);
    const sprintId = idString(data && data.sprintId);
    const taskId = idString(data && data.taskId);
    if (projectId && sprintId && taskId) {
        const prefix = `comments_${projectId}_${sprintId}_${taskId}`;
        if (prefix.includes(OBJECT_OBJECT)) return null;
        return {
            module: 'comments',
            prefix,
            projectId,
            sprintId,
            taskId,
        };
    }
    if (projectId) {
        const prefix = `comments_project_${projectId}`;
        if (prefix.includes(OBJECT_OBJECT)) return null;
        return {
            module: 'comments_project',
            prefix,
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

function firstId(...values) {
    for (const value of values) {
        const hex = idString(value);
        if (hex) return hex;
    }
    return '';
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
    const projectId = firstId(plain.projectId, raw.projectId, fromSource.projectId);
    const sprintId = firstId(plain.sprintId, raw.sprintId, fromSource.sprintId);
    const taskId = firstId(plain.taskId, raw.taskId, fromSource.taskId);
    const _id = firstId(plain._id, raw._id, plain.id, raw.id);
    if (_id) {
        plain._id = _id;
        plain.id = _id;
    }
    if (projectId) plain.projectId = projectId;
    else delete plain.projectId;
    if (sprintId) plain.sprintId = sprintId;
    else delete plain.sprintId;
    if (taskId) plain.taskId = taskId;
    else delete plain.taskId;
    if (plain.userId != null) plain.userId = String(plain.userId);
    return plain;
}

function incomingCommentDoc(payload) {
    if (!payload || typeof payload !== 'object') return null;
    return payload.fullDocument || payload;
}

function mongoIdIn(value) {
    const raw = idString(value);
    if (!raw) return null;
    if (raw === 'default') return raw;
    const ids = [raw];
    if (HEX_ID.test(raw)) {
        try {
            ids.push(new mongoose.Types.ObjectId(raw));
        } catch (_e) { /* keep the string form */ }
    }
    return { $in: ids };
}

function isTrueFlag(value) {
    return value === true || value === 'true';
}

function buildPaginatedCommentMatch(query = {}) {
    const projectMatch = mongoIdIn(query.projectId);
    const taskRaw = idString(query.taskId);

    if (!isTrueFlag(query.isDefault) && isTrueFlag(query.mainChat)) {
        if (!projectMatch) return { error: 'A valid projectId is required.' };
        return {
            and: [
                { projectId: projectMatch },
                { isDeleted: { $ne: true } },
                { taskId: 'default' },
            ],
        };
    }

    if (taskRaw && taskRaw !== 'default') {
        const taskMatch = mongoIdIn(taskRaw);
        if (!taskMatch) return { error: 'A valid taskId is required.' };
        const and = [
            { isDeleted: { $ne: true } },
            { taskId: taskMatch },
        ];
        if (projectMatch) and.push({ projectId: projectMatch });
        return { and };
    }

    if (!projectMatch) return { error: 'A valid projectId is required.' };
    if (taskRaw === 'default') {
        return {
            and: [
                { projectId: projectMatch },
                { isDeleted: { $ne: true } },
                { taskId: 'default' },
            ],
        };
    }
    const and = [
        { projectId: projectMatch },
        { isDeleted: { $ne: true } },
        { project: true },
    ];
    const sprintMatch = query.sprintId ? mongoIdIn(query.sprintId) : null;
    if (sprintMatch) and.push({ sprintId: sprintMatch });
    return { and };
}

function acceptIncomingComment(doc) {
    if (!doc || typeof doc !== 'object') return false;
    return Boolean(idString(doc._id || doc.id) || doc.userId || doc.message);
}

module.exports = {
    idString,
    mongoIdIn,
    buildPaginatedCommentMatch,
    commentRoomPrefix,
    serializeCommentForSocket,
    incomingCommentDoc,
    acceptIncomingComment,
};
