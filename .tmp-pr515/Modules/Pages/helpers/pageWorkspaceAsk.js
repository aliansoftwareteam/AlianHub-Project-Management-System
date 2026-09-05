'use strict';

const PAGE_SNIPPET = 280;
const PAGE_CAP = 16;
const TASK_CAP = 40;

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

function formatContextPack({ pages, tasks }) {
    const pageRows = (pages || []).slice(0, PAGE_CAP).map((page) => {
        const title = String((page && page.title) || '(untitled)').trim();
        const snippet = snippetOf(page);
        return snippet && snippet !== title ? `- ${title}: ${snippet}` : `- ${title}`;
    });
    const taskRows = (tasks || []).slice(0, TASK_CAP).map((task) => {
        const key = String((task && task.TaskKey) || '').trim();
        const name = String((task && task.TaskName) || '').trim() || '(untitled task)';
        return key ? `- ${key} ${name}` : `- ${name}`;
    });
    return {
        pageText: pageRows.join('\n') || '(none)',
        taskText: taskRows.join('\n') || '(none)',
        pageCount: pageRows.length,
        taskCount: taskRows.length,
    };
}

const WORKSPACE_ASK_SYSTEM = `You answer a question about one company workspace.

Return a single JSON object: { "markdown": "<markdown string>" }
No preamble, no code fences around the JSON.

Rules:
- Use only the listed pages and task titles. Do not invent pages, tasks, people, or dates.
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
    pageReadableBy,
    pageInVisibleProjects,
    formatContextPack,
    buildWorkspaceAskPrompt,
    WORKSPACE_ASK_SYSTEM,
};
