'use strict';

const {
    permissionGate,
    listEmptyTargets,
    sanitizeSuggestions,
    planAutofillWrites,
    stripHtml,
    clamp,
    recordId,
} = require('../../Tasks/helpers/taskAiAutofill');
const {
    hasAlianMention,
    isTaskComment,
    ALIAN_MENTION_KEY,
} = require('../../Comments/helpers/alianMention');
const {
    citationFromPage,
    citationFromTask,
    citationsFromPack,
    selectCitations,
} = require('../../Pages/helpers/pageWorkspaceAsk');

const WRITEBACK_EVENTS = ['task_status_changed', 'page_updated', 'comment_created'];
const BRIEFING_CAP = 800;
const EXCERPT_CAP = 180;

function isWritebackEnabled(project) {
    if (!project) return false;
    return project.aiWritebackEnabled !== false;
}

function isAlianAuthor(comment) {
    return String((comment && comment.userId) || '') === ALIAN_MENTION_KEY;
}

function eventGate(event) {
    if (!event || typeof event !== 'object') {
        return { allowed: false, reason: 'unknown-event' };
    }
    const type = String(event.type || '');
    if (!WRITEBACK_EVENTS.includes(type)) {
        return { allowed: false, reason: 'unknown-event' };
    }
    if (!String(event.companyId || '').trim()) {
        return { allowed: false, reason: 'companyId' };
    }
    if (event.aiWritebackEnabled === false) {
        return { allowed: false, reason: 'disabled' };
    }

    if (type !== 'page_updated' && event.permissions) {
        const gate = permissionGate(event.permissions);
        if (!gate.allowed) return { allowed: false, reason: 'permission' };
    }

    if (type === 'task_status_changed') {
        if (!String(event.taskId || '').trim()) return { allowed: false, reason: 'task-id' };
        return { allowed: true };
    }

    if (type === 'page_updated') {
        if (!String(event.pageId || '').trim()) return { allowed: false, reason: 'page-id' };
        if (event.briefingOnly) return { allowed: false, reason: 'briefing-only' };
        return { allowed: true };
    }

    if (isAlianAuthor(event.comment)) return { allowed: false, reason: 'alian-author' };
    if (!isTaskComment(event.comment)) return { allowed: false, reason: 'not-task-comment' };
    if (hasAlianMention(event.comment && event.comment.message)) {
        return { allowed: false, reason: 'alian-mention' };
    }
    return { allowed: true };
}

function chooseWrite({ event, emptyTargets, pageText } = {}) {
    const gate = eventGate(event);
    if (!gate.allowed) return { action: 'skip', reason: gate.reason };
    const type = event.type;
    if (type === 'page_updated') {
        if (!String(pageText || '').trim()) return { action: 'skip', reason: 'empty-page' };
        return { action: 'briefing' };
    }
    if (Array.isArray(emptyTargets) && emptyTargets.length) return { action: 'autofill' };
    return { action: 'activity' };
}

function shouldNotifyForWriteback({ taggedUserIds } = {}) {
    return Array.isArray(taggedUserIds) && taggedUserIds.map(String).filter(Boolean).length > 0;
}

function planTaskAutofill({ incoming, targets, people, task } = {}) {
    const sanitized = sanitizeSuggestions(incoming, { targets, people, task });
    return {
        suggestions: sanitized.suggestions,
        skipped: sanitized.skipped,
        writes: planAutofillWrites(sanitized.suggestions),
    };
}

function followupActivityMessage(input) {
    const note = followupCommentText(input);
    if (!note) return '<b>Alian</b> noted this change.';
    return `<b>Alian</b> ${note.charAt(0).toLowerCase()}${note.slice(1)}`;
}

function followupCommentText({ event, applied, statusText, commentExcerpt, taskTitle } = {}) {
    const names = (applied || [])
        .map((row) => String((row && (row.title || row.kind)) || '').trim())
        .filter(Boolean);
    const unique = [...new Set(names)];
    if (unique.length) {
        const list = unique.join(', ');
        if (event && event.type === 'task_status_changed') {
            return `Filled empty fields after this status change: ${list}.`;
        }
        return `Filled empty fields from this comment: ${list}.`;
    }
    const title = clamp(String(taskTitle || '').trim(), 80);
    if (event && event.type === 'task_status_changed') {
        const status = clamp(String(statusText || '').trim(), 40);
        if (status && title) return `Noted the status change to ${status} on ${title}.`;
        if (status) return `Noted the status change to ${status}.`;
        return title ? `Noted the status change on ${title}.` : 'Noted this status change.';
    }
    const excerpt = clamp(stripHtml(commentExcerpt), EXCERPT_CAP);
    if (title && excerpt) return `On ${title}: ${excerpt}`;
    if (excerpt) return excerpt;
    return title ? `Noted this comment on ${title}.` : 'Noted this comment.';
}

function linkedTaskCitations(linkedTasks) {
    return (linkedTasks || []).map((row) => citationFromTask(row)).filter(Boolean);
}

function heuristicPageBriefing({ title, rawText, linkedTasks } = {}) {
    const heading = clamp(String(title || '').trim(), 120) || 'Untitled';
    const text = clamp(stripHtml(rawText), BRIEFING_CAP);
    const lines = [`Briefing from “${heading}”.`];
    if (text) lines.push(text);
    const citations = linkedTaskCitations(linkedTasks);
    if (citations.length) {
        lines.push('Linked tasks:');
        for (const citation of citations) lines.push(`- ${citation.title}`);
    }
    return {
        markdown: lines.join('\n'),
        used: citations.map((citation) => ({ type: 'task', id: citation.id })),
    };
}

function shapePageBriefing({ markdown, packCitations, usedHints, page } = {}) {
    const pack = Array.isArray(packCitations) && packCitations.length
        ? packCitations
        : citationsFromPack({ pages: page ? [page] : [], tasks: [] });
    const citations = selectCitations(pack, usedHints || [], { fallback: false });
    const summary = clamp(String(markdown || '').trim(), BRIEFING_CAP);
    return {
        apply: false,
        contentUntouched: true,
        markdown: summary,
        citations,
    };
}

module.exports = {
    WRITEBACK_EVENTS,
    isWritebackEnabled,
    isAlianAuthor,
    eventGate,
    chooseWrite,
    shouldNotifyForWriteback,
    planTaskAutofill,
    followupCommentText,
    followupActivityMessage,
    heuristicPageBriefing,
    shapePageBriefing,
    linkedTaskCitations,
    permissionGate,
    listEmptyTargets,
    recordId,
    citationFromPage,
    citationFromTask,
};
