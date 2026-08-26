'use strict';

const PAGE_SNIPPET = 280;
const PAGE_CAP = 16;
const TASK_CAP = 40;
const FALLBACK_PAGE_CITATIONS = 6;
const FALLBACK_TASK_CITATIONS = 6;

function pageReadableBy(page, uid) {
    if (!page) return false;
    if (String(page.visibility || '') === 'private' && String(page.createdBy || '') !== String(uid || '')) {
        return false;
    }
    return true;
}

function pageInVisibleProjects(page, projectIds, restrictProjects) {
    if (!restrictProjects) return true;
    const pid = page && page.ProjectID ? String(page.ProjectID) : '';
    if (!pid) return true;
    return (projectIds || []).some((id) => String(id) === pid);
}

function snippetOf(page) {
    const text = String((page && (page.rawText || page.title)) || '').replace(/\s+/g, ' ').trim();
    if (!text) return '';
    return text.length <= PAGE_SNIPPET ? text : `${text.slice(0, PAGE_SNIPPET)}…`;
}

function recordId(row) {
    if (!row) return '';
    return String(row._id || row.id || '').trim();
}

function citationFromPage(page) {
    const id = recordId(page);
    if (!id) return null;
    const title = String((page && page.title) || '').trim() || '(untitled)';
    const citation = { type: 'page', id, title };
    const projectId = page && page.ProjectID ? String(page.ProjectID) : '';
    if (projectId) citation.projectId = projectId;
    return citation;
}

function citationFromTask(task) {
    const id = recordId(task);
    if (!id) return null;
    const key = String((task && task.TaskKey) || '').trim();
    const name = String((task && task.TaskName) || '').trim() || '(untitled task)';
    const title = key ? `${key} ${name}` : name;
    const citation = { type: 'task', id, title };
    const projectId = task && task.ProjectID ? String(task.ProjectID) : '';
    if (projectId) citation.projectId = projectId;
    return citation;
}

function citationsFromPack({ pages, tasks }) {
    const out = [];
    for (const page of (pages || []).slice(0, PAGE_CAP)) {
        const citation = citationFromPage(page);
        if (citation) out.push(citation);
    }
    for (const task of (tasks || []).slice(0, TASK_CAP)) {
        const citation = citationFromTask(task);
        if (citation) out.push(citation);
    }
    return out;
}

function formatPageRow(page) {
    const title = String((page && page.title) || '(untitled)').trim();
    const snippet = snippetOf(page);
    const id = recordId(page);
    const head = id ? `[page:${id}] ${title}` : title;
    return snippet && snippet !== title ? `- ${head}: ${snippet}` : `- ${head}`;
}

function formatTaskRow(task) {
    const key = String((task && task.TaskKey) || '').trim();
    const name = String((task && task.TaskName) || '').trim() || '(untitled task)';
    const id = recordId(task);
    const label = key ? `${key} ${name}` : name;
    const head = id ? `[task:${id}] ${label}` : label;
    return `- ${head}`;
}

function formatContextPack({ pages, tasks }) {
    const pageList = (pages || []).slice(0, PAGE_CAP);
    const taskList = (tasks || []).slice(0, TASK_CAP);
    const pageRows = pageList.map(formatPageRow);
    const taskRows = taskList.map(formatTaskRow);
    return {
        pageText: pageRows.join('\n') || '(none)',
        taskText: taskRows.join('\n') || '(none)',
        pageCount: pageRows.length,
        taskCount: taskRows.length,
        citations: citationsFromPack({ pages: pageList, tasks: taskList }),
    };
}

function parseJsonObject(raw) {
    const text = String(raw || '').trim();
    if (!text) return null;
    try {
        const parsed = JSON.parse(text);
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed;
    } catch (_e) {
        const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
        if (fenced) {
            try {
                const parsed = JSON.parse(fenced[1]);
                if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed;
            } catch (_err) {
                return null;
            }
        }
    }
    return null;
}

function normalizeUsedHint(item) {
    if (!item || typeof item !== 'object') return null;
    const typeRaw = String(item.type || '').toLowerCase();
    const type = typeRaw === 'task' || typeRaw === 'tasks' ? 'task'
        : typeRaw === 'page' || typeRaw === 'pages' ? 'page'
            : '';
    const id = String(item.id || item._id || '').trim();
    const title = String(item.title || item.TaskName || item.name || '').trim();
    if (!type && !id && !title) return null;
    const hint = {};
    if (type) hint.type = type;
    if (id) hint.id = id;
    if (title) hint.title = title;
    return hint;
}

function extractUsedHints(raw) {
    const parsed = parseJsonObject(raw);
    if (!parsed) return [];
    const list = parsed.used || parsed.citations;
    if (!Array.isArray(list)) return [];
    return list.map(normalizeUsedHint).filter(Boolean);
}

function fallbackCitations(packCitations) {
    const pages = [];
    const tasks = [];
    for (const citation of packCitations || []) {
        if (!citation || !citation.id) continue;
        if (citation.type === 'page' && pages.length < FALLBACK_PAGE_CITATIONS) pages.push(citation);
        else if (citation.type === 'task' && tasks.length < FALLBACK_TASK_CITATIONS) tasks.push(citation);
    }
    return pages.concat(tasks);
}

function selectCitations(packCitations, usedHints) {
    const pack = Array.isArray(packCitations) ? packCitations.filter((c) => c && c.id && (c.type === 'page' || c.type === 'task')) : [];
    if (!pack.length) return [];

    const byId = new Map();
    const byTitle = new Map();
    for (const citation of pack) {
        byId.set(`${citation.type}:${citation.id}`, citation);
        const titleKey = `${citation.type}:${String(citation.title || '').toLowerCase()}`;
        if (!byTitle.has(titleKey)) byTitle.set(titleKey, citation);
    }

    const picked = [];
    const seen = new Set();
    const take = (citation) => {
        if (!citation) return;
        const key = `${citation.type}:${citation.id}`;
        if (seen.has(key)) return;
        seen.add(key);
        picked.push(citation);
    };

    for (const hint of usedHints || []) {
        if (!hint || typeof hint !== 'object') continue;
        const type = hint.type === 'task' ? 'task' : hint.type === 'page' ? 'page' : '';
        const id = String(hint.id || '').trim();
        const title = String(hint.title || '').trim().toLowerCase();
        let match = null;
        if (type && id) match = byId.get(`${type}:${id}`);
        if (!match && id) match = byId.get(`page:${id}`) || byId.get(`task:${id}`);
        if (!match && type && title) match = byTitle.get(`${type}:${title}`);
        take(match);
    }

    if (picked.length) return picked;
    return fallbackCitations(pack);
}

const WORKSPACE_ASK_SYSTEM = `You answer a question about one company workspace.

Return a single JSON object: { "markdown": "<markdown string>", "used": [{ "type": "page"|"task", "id": "<id from the lists>" }] }
No preamble, no code fences around the JSON.

Rules:
- Use only the listed pages and task titles. Do not invent pages, tasks, people, or dates.
- Each listed item is tagged like [page:<id>] or [task:<id>]. Put the items you actually used in "used", copying type and id exactly.
- If you cannot tell which items you used, return "used": [].
- If the listed material does not contain the answer, say so in one short paragraph.
- Prefer a tight briefing: short paragraphs or bullets.
- Do not mention that you are an AI.
- Do not rewrite or replace any page.`;

function buildWorkspaceAskPrompt({ question, pack }) {
    const pages = pack && pack.pageText ? pack.pageText : '(none)';
    const tasks = pack && pack.taskText ? pack.taskText : '(none)';
    return [
        `Question:\n${question || '(empty)'}`,
        `Recent pages the author can open:\n${pages}`,
        `Recent task titles the author can open:\n${tasks}`,
    ].join('\n\n');
}

module.exports = {
    PAGE_SNIPPET,
    PAGE_CAP,
    TASK_CAP,
    FALLBACK_PAGE_CITATIONS,
    FALLBACK_TASK_CITATIONS,
    pageReadableBy,
    pageInVisibleProjects,
    citationFromPage,
    citationFromTask,
    citationsFromPack,
    formatContextPack,
    extractUsedHints,
    selectCitations,
    buildWorkspaceAskPrompt,
    WORKSPACE_ASK_SYSTEM,
};
