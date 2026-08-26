'use strict';

const { idString } = require('./commentThread');

const ALIAN_MENTION_KEY = 'alian';
const ALIAN_DISPLAY_NAME = 'Alian';

const TOKEN_RE = /@\[[^\]]*\]\(alian\)/gi;
const BARE_RE = /@Alian\b/gi;

function decodeCommentEntities(text) {
    return String(text || '')
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&#039;/g, "'")
        .replace(/&#39;/g, "'");
}

function stripAlianMentions(text) {
    return String(text || '')
        .replace(TOKEN_RE, ' ')
        .replace(BARE_RE, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

function firstAlianMention(text) {
    const raw = String(text || '');
    TOKEN_RE.lastIndex = 0;
    BARE_RE.lastIndex = 0;
    const token = TOKEN_RE.exec(raw);
    const bare = BARE_RE.exec(raw);
    let match = null;
    if (token && bare) match = token.index <= bare.index ? token : bare;
    else match = token || bare;
    if (!match) return null;
    return { index: match.index, length: match[0].length };
}

function hasAlianMention(message) {
    return Boolean(firstAlianMention(decodeCommentEntities(message)));
}

function extractAlianQuestion(message) {
    const raw = decodeCommentEntities(message).trim();
    const hit = firstAlianMention(raw);
    if (!hit) {
        return { mentioned: false, question: '' };
    }
    const after = stripAlianMentions(raw.slice(hit.index + hit.length)).replace(/^[\s,.:;!?-]+/, '').trim();
    if (after) {
        return { mentioned: true, question: after };
    }
    return { mentioned: true, question: stripAlianMentions(raw) };
}

function isTaskComment(comment) {
    if (!comment || typeof comment !== 'object') return false;
    const taskId = comment.taskId;
    if (taskId === undefined || taskId === null || taskId === '') return false;
    return String(taskId) !== 'default';
}

function shouldReplyAsAlian(comment) {
    if (!comment || typeof comment !== 'object') return false;
    if (String(comment.userId || '') === ALIAN_MENTION_KEY) return false;
    if (!isTaskComment(comment)) return false;
    const type = String(comment.type || 'text');
    if (type !== 'text' && type !== 'link') return false;
    return hasAlianMention(comment.message);
}

function citationsForComment(citations) {
    if (!Array.isArray(citations)) return [];
    const out = [];
    const seen = new Set();
    for (const row of citations) {
        if (!row || typeof row !== 'object') continue;
        const type = row.type === 'task' ? 'task' : row.type === 'page' ? 'page' : '';
        const id = String(row.id || row._id || '').trim();
        if (!type || !id) continue;
        const key = `${type}:${id}`;
        if (seen.has(key)) continue;
        seen.add(key);
        const citation = {
            type,
            id,
            title: String(row.title || '').trim() || (type === 'task' ? '(untitled task)' : '(untitled)'),
        };
        const projectId = String(row.projectId || '').trim();
        if (projectId) citation.projectId = projectId;
        out.push(citation);
    }
    return out;
}

function escapeCommentHtml(text) {
    return String(text || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

function buildAlianComment(source, message, citations) {
    const src = source && typeof source === 'object' ? source : {};
    const payload = {
        userId: ALIAN_MENTION_KEY,
        type: 'text',
        message: escapeCommentHtml(message),
        citations: citationsForComment(citations),
        isDeleted: false,
        hasReply: true,
        project: src.project === true,
        projectId: idString(src.projectId) || src.projectId,
        mentionIds: [],
        pinnedMessage: false,
        reactions: [],
        mediaURL: '',
        mediaName: '',
        mediaOriginalName: '',
        mediaSize: 0,
        reply_id: idString(src._id || src.id) || String(src._id || src.id || ''),
        reply_userId: String(src.userId || ''),
        reply_type: String(src.type || 'text'),
        reply_message: String(src.message || ''),
        reply_mediaURL: '',
        reply_mediaName: '',
        reply_mediaOriginalName: '',
        reply_mediaSize: 0,
        reply_createdAt: src.createdAt || new Date(),
    };
    const sprintId = idString(src.sprintId);
    const taskId = idString(src.taskId);
    if (sprintId) payload.sprintId = sprintId;
    else if (src.sprintId) payload.sprintId = src.sprintId;
    if (taskId) payload.taskId = taskId;
    else if (src.taskId) payload.taskId = src.taskId;
    if (src.folderId) payload.folderId = src.folderId;
    return payload;
}

module.exports = {
    ALIAN_MENTION_KEY,
    ALIAN_DISPLAY_NAME,
    decodeCommentEntities,
    stripAlianMentions,
    hasAlianMention,
    extractAlianQuestion,
    isTaskComment,
    shouldReplyAsAlian,
    citationsForComment,
    escapeCommentHtml,
    buildAlianComment,
};
