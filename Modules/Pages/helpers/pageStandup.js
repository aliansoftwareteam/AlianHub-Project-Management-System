'use strict';

const {
    citationFromTask,
    extractUsedHints,
    selectCitations,
} = require('./pageWorkspaceAsk');

const DAY_MS = 24 * 60 * 60 * 1000;
const WINDOW_MS = { '24h': DAY_MS, '7d': 7 * DAY_MS };
const TITLE_CAP = 200;
const NOTES_CAP = 280;
const GROUP_ITEM_CAP = 24;
const STANDUP_MAX_TOKENS = 4096;

const STANDUP_GROUPS = [
    { key: 'completed', label: 'Completed' },
    { key: 'inProgress', label: 'In progress' },
    { key: 'blocked', label: 'Blocked' },
    { key: 'created', label: 'Newly created' },
    { key: 'comments', label: 'Comments' },
];

const STANDUP_SYSTEM = `You write a short standup / project-update briefing from real task activity.

Return a single JSON object:
{
  "markdown": "<short summary in markdown>",
  "used": [{ "type": "task", "id": "<id from the lists>" }]
}
No preamble, no code fences around the JSON.

Rules:
- Do not rewrite or replace any page. This is a briefing, not page content.
- Use only the listed tasks. Do not invent tasks, people, dates, or ids.
- Each listed item is tagged like [task:<id>]. Put the items you actually used in "used", copying type and id exactly.
- If you cannot tell which items you used, return "used": [].
- Prefer a tight narrative: what landed, what is moving, what is stuck.
- Do not mention that you are an AI.`;

function clamp(value, cap) {
    if (typeof value !== 'string') return '';
    const trimmed = value.trim();
    return trimmed.length <= cap ? trimmed : `${trimmed.slice(0, cap)}…`;
}

function recordId(row) {
    if (!row) return '';
    return String(row._id || row.id || '').trim();
}

function snippetOf(value) {
    const text = String(value || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
    return clamp(text, NOTES_CAP);
}

function standupWindow(name, now = Date.now()) {
    const raw = String(name || '24h').toLowerCase().replace(/[\s_-]/g, '');
    const key = (raw === '7d' || raw === 'week' || raw === '7days' || raw === 'last7days') ? '7d' : '24h';
    const until = new Date(now);
    const since = new Date(until.getTime() - WINDOW_MS[key]);
    return { key, since, until };
}

function permissionScope({ projectId, visibleProjectIds, restrictProjects }) {
    const pid = String(projectId || '').trim();
    if (!pid) return { allowed: false, reason: 'A project is required.' };
    if (restrictProjects) {
        const ids = (visibleProjectIds || []).map((id) => String(id));
        if (!ids.includes(pid)) return { allowed: false, reason: 'A project is required.' };
    }
    return { allowed: true, projectId: pid };
}

function inRange(date, since, until) {
    const t = new Date(date).getTime();
    return Number.isFinite(t) && t >= since.getTime() && t <= until.getTime();
}

function statusText(task) {
    const status = task && task.status;
    if (status && typeof status === 'object') {
        return String(status.text || status.name || status.value || '');
    }
    return String(status || '');
}

function isCompletedTask(task) {
    const type = String((task && task.statusType) || '').toLowerCase();
    return type === 'close' || type === 'done';
}

function isBlockedTask(task) {
    const type = String((task && task.statusType) || '').toLowerCase();
    if (type === 'onhold') return true;
    if (/\bblock/.test(statusText(task).toLowerCase())) return true;
    return (task && Array.isArray(task.relations) ? task.relations : []).some((row) => row && row.type === 'blocked_by');
}

function isInProgressTask(task) {
    if (isCompletedTask(task) || isBlockedTask(task)) return false;
    const type = String((task && task.statusType) || '').toLowerCase();
    return type === 'active' || type === 'default_active' || type === 'inprogress' || type === 'open' || !type;
}

function sameProject(task, projectId) {
    const pid = String(projectId || '');
    if (!pid) return false;
    return String((task && (task.ProjectID || task.projectId)) || '') === pid;
}

function filterTasksForStandup(tasks, projectId) {
    return (tasks || []).filter((task) => (
        task
        && sameProject(task, projectId)
        && Number(task.deletedStatusKey) !== 1
    ));
}

function taskTitle(task) {
    const citation = citationFromTask(task);
    return citation ? citation.title : String((task && (task.TaskName || task.title)) || '').trim() || '(untitled task)';
}

function pushItem(bucket, item) {
    if (!item || !item.title || bucket.length >= GROUP_ITEM_CAP) return;
    bucket.push(item);
}

function groupStandupActivity({ tasks, comments, since, until, projectId }) {
    const visible = filterTasksForStandup(tasks, projectId);
    const byId = new Map();
    for (const task of visible) {
        const id = recordId(task);
        if (id) byId.set(id, task);
    }

    const completed = [];
    const inProgress = [];
    const blocked = [];
    const created = [];

    for (const task of visible) {
        const id = recordId(task);
        if (!id) continue;
        const title = taskTitle(task);
        const touched = inRange(task.updatedAt, since, until) || inRange(task.createdAt, since, until) || inRange(task.lastMessage, since, until);
        const item = { title, taskId: id };
        const notes = statusText(task);
        if (notes) item.notes = clamp(notes, 80);

        if (inRange(task.createdAt, since, until)) pushItem(created, { ...item });
        if (isCompletedTask(task) && touched) pushItem(completed, { ...item });
        if (isBlockedTask(task)) pushItem(blocked, { ...item });
        else if (isInProgressTask(task) && touched) pushItem(inProgress, { ...item });
    }

    const commentItems = [];
    for (const comment of comments || []) {
        if (commentItems.length >= GROUP_ITEM_CAP) break;
        if (!inRange(comment.createdAt, since, until)) continue;
        const taskId = String(comment.taskId || comment.TaskId || '').trim();
        if (!taskId || taskId === 'default' || !byId.has(taskId)) continue;
        const task = byId.get(taskId);
        const notes = snippetOf(comment.message);
        if (!notes) continue;
        commentItems.push({ title: taskTitle(task), taskId, notes });
    }

    const groups = STANDUP_GROUPS
        .map((meta) => {
            const items = meta.key === 'completed' ? completed
                : meta.key === 'inProgress' ? inProgress
                    : meta.key === 'blocked' ? blocked
                        : meta.key === 'created' ? created
                            : commentItems;
            return { key: meta.key, label: meta.label, items };
        })
        .filter((group) => group.items.length);

    const citations = [];
    const seen = new Set();
    for (const group of groups) {
        for (const item of group.items) {
            const key = `task:${item.taskId}`;
            if (seen.has(key)) continue;
            seen.add(key);
            const citation = citationFromTask(byId.get(item.taskId));
            if (citation) citations.push(citation);
        }
    }

    return {
        groups,
        citations,
        hasActivity: groups.length > 0,
        taskCount: visible.length,
    };
}

function windowLabel(key) {
    return key === '7d' ? 'last 7 days' : 'last 24 hours';
}

function briefingMarkdown({ title, window, groups }) {
    const heading = clamp(title, TITLE_CAP);
    const label = windowLabel(window && window.key);
    const lines = [];
    if (heading) lines.push(`# ${heading}`);
    lines.push(`Standup for the ${label}.`);
    if (!(groups || []).length) {
        lines.push('', 'No task activity in this window.');
        return lines.join('\n');
    }
    for (const group of groups) {
        lines.push('', `## ${group.label}`);
        for (const item of group.items) {
            let row = `- ${item.title}`;
            if (item.notes && item.notes !== item.title) row += `: ${item.notes}`;
            lines.push(row);
        }
    }
    return lines.join('\n');
}

function hintsFromGroups(groups) {
    const hints = [];
    const seen = new Set();
    for (const group of groups || []) {
        for (const item of group.items || []) {
            const id = String((item && item.taskId) || '').trim();
            if (!id || seen.has(id)) continue;
            seen.add(id);
            hints.push({ type: 'task', id });
        }
    }
    return hints;
}

function dropInventedTaskIds(items, packIndex) {
    return (items || []).map((item) => {
        if (!item || typeof item !== 'object') return item;
        const id = String(item.taskId || item.relatedTaskId || '').trim();
        if (!id) return item;
        if (packIndex.has(`task:${id}`)) return item;
        const next = { ...item };
        delete next.taskId;
        delete next.relatedTaskId;
        return next;
    });
}

function shapeStandupResult({ markdown, groups, packCitations, usedHints, window: windowKey }) {
    const packIndex = new Map();
    for (const citation of packCitations || []) {
        if (!citation || !citation.id || citation.type !== 'task') continue;
        packIndex.set(`task:${citation.id}`, citation);
    }
    const cleaned = (groups || []).map((group) => ({
        key: group.key,
        label: group.label,
        items: dropInventedTaskIds(group.items, packIndex).filter((item) => item && item.title),
    })).filter((group) => group.items.length);

    const citations = selectCitations(
        packCitations,
        [].concat(hintsFromGroups(cleaned), usedHints || []),
        { fallback: false },
    );
    const summary = String(markdown || '').trim();
    return {
        status: true,
        data: {
            action: 'standup',
            apply: false,
            window: windowKey === '7d' ? '7d' : '24h',
            markdown: summary,
            previewText: summary.slice(0, 400),
            groups: cleaned,
            citations,
        },
    };
}

function formatStandupPack({ groups }) {
    const lines = [];
    for (const group of groups || []) {
        lines.push(`${group.label}:`);
        for (const item of group.items || []) {
            const tag = item.taskId ? `[task:${item.taskId}] ` : '';
            let row = `- ${tag}${item.title}`;
            if (item.notes) row += ` — ${item.notes}`;
            lines.push(row);
        }
        lines.push('');
    }
    return lines.join('\n').trim() || '(none)';
}

function buildStandupPrompt({ title, window, packText }) {
    return [
        `Title: ${title || '(untitled)'}`,
        `Window: ${windowLabel(window && window.key)}`,
        `Task activity the author can open:\n${packText || '(none)'}`,
    ].join('\n\n');
}

async function summarizeStandup({
    title,
    window: windowName,
    projectId,
    tasks,
    comments,
    chatMarkdown,
    isAiConfigured,
    now,
}) {
    const scoped = permissionScope({ projectId, restrictProjects: false });
    if (!scoped.allowed) return { status: false, reason: scoped.reason };

    const window = standupWindow(windowName, now);
    const grouped = groupStandupActivity({
        tasks,
        comments,
        since: window.since,
        until: window.until,
        projectId: scoped.projectId,
    });
    const fallbackMarkdown = briefingMarkdown({ title, window, groups: grouped.groups });
    const shaped = () => shapeStandupResult({
        markdown: fallbackMarkdown,
        groups: grouped.groups,
        packCitations: grouped.citations,
        usedHints: [],
        window: window.key,
    });

    if (!grouped.hasActivity) return shaped();
    if (typeof isAiConfigured === 'function' ? !isAiConfigured() : true) return shaped();
    if (typeof chatMarkdown !== 'function') return shaped();

    const chat = await chatMarkdown({
        systemPrompt: STANDUP_SYSTEM,
        userPrompt: buildStandupPrompt({
            title: clamp(title, TITLE_CAP),
            window,
            packText: formatStandupPack({ groups: grouped.groups }),
        }),
        temperature: 0.3,
        maxTokens: STANDUP_MAX_TOKENS,
    });
    if (!chat.status) return shaped();

    return shapeStandupResult({
        markdown: chat.markdown || fallbackMarkdown,
        groups: grouped.groups,
        packCitations: grouped.citations,
        usedHints: extractUsedHints(chat.raw),
        window: window.key,
    });
}

module.exports = {
    DAY_MS,
    STANDUP_GROUPS,
    STANDUP_MAX_TOKENS,
    STANDUP_SYSTEM,
    standupWindow,
    permissionScope,
    isCompletedTask,
    isBlockedTask,
    isInProgressTask,
    filterTasksForStandup,
    groupStandupActivity,
    briefingMarkdown,
    shapeStandupResult,
    formatStandupPack,
    buildStandupPrompt,
    summarizeStandup,
};
