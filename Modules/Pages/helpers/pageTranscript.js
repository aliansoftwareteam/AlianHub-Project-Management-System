'use strict';

const {
    formatContextPack,
    extractUsedHints,
    selectCitations,
} = require('./pageWorkspaceAsk');

const TRANSCRIPT_CAP = 20000;
const TITLE_CAP = 200;
const PAGE_CONTEXT_CAP = 4000;
const ACTION_ITEM_CAP = 24;
const TITLE_ITEM_CAP = 200;
const NOTES_CAP = 400;
const TRANSCRIPT_MAX_TOKENS = 4096;

const TRANSCRIPT_SYSTEM = `You turn a meeting transcript into a briefing for a project-management workspace.

Return a single JSON object:
{
  "markdown": "<short summary in markdown>",
  "actionItems": [
    { "title": "<imperative task title>", "notes": "<optional>", "owner": "<optional speaker name>", "due": "<optional date as said>", "relatedTaskId": "<optional pack id>", "relatedPageId": "<optional pack id>" }
  ],
  "used": [{ "type": "page"|"task", "id": "<id from the lists>" }]
}
No preamble, no code fences around the JSON.

Rules:
- Do not rewrite or replace any page. This is a briefing, not page content.
- Stay faithful to the transcript. Do not invent decisions, owners, dates, or ids.
- relatedTaskId, relatedPageId, and used ids MUST come from pack tags [task:<id>] or [page:<id>]. If none match, omit them.
- Title each action item as something a teammate can do.
- Prefer a tight summary, then concrete action items.
- Do not mention that you are an AI.`;

function clamp(value, cap) {
    if (typeof value !== 'string') return '';
    const trimmed = value.trim();
    return trimmed.length <= cap ? trimmed : `${trimmed.slice(0, cap)}…`;
}

function packIndex(packCitations) {
    const byId = new Map();
    for (const citation of packCitations || []) {
        if (!citation || !citation.id) continue;
        const type = citation.type === 'page' || citation.type === 'task' ? citation.type : '';
        if (!type) continue;
        byId.set(`${type}:${citation.id}`, citation);
    }
    return byId;
}

function relatedId(item, keys, type, byId) {
    if (!item || typeof item !== 'object') return '';
    for (const key of keys) {
        const id = String(item[key] || '').trim();
        if (id && byId.has(`${type}:${id}`)) return id;
    }
    return '';
}

function parseActionItems(rawItems, packCitations) {
    const byId = packIndex(packCitations);
    const source = Array.isArray(rawItems) ? rawItems : [];
    const items = [];
    for (const row of source) {
        if (items.length >= ACTION_ITEM_CAP) break;
        let title = '';
        let notes = '';
        let owner = '';
        let due = '';
        let relatedTaskId = '';
        let relatedPageId = '';
        if (typeof row === 'string') {
            title = clamp(row, TITLE_ITEM_CAP);
        } else if (row && typeof row === 'object') {
            title = clamp(row.title || row.task || row.text || '', TITLE_ITEM_CAP);
            notes = clamp(row.notes || row.detail || row.description || '', NOTES_CAP);
            owner = clamp(row.owner || row.assignee || '', 80);
            due = clamp(row.due || row.dueDate || '', 80);
            relatedTaskId = relatedId(row, ['relatedTaskId', 'taskId'], 'task', byId);
            relatedPageId = relatedId(row, ['relatedPageId', 'pageId'], 'page', byId);
        }
        if (!title) continue;
        const item = { title };
        if (notes) item.notes = notes;
        if (owner) item.owner = owner;
        if (due) item.due = due;
        if (relatedTaskId) item.relatedTaskId = relatedTaskId;
        if (relatedPageId) item.relatedPageId = relatedPageId;
        items.push(item);
    }
    return items;
}

function actionItemsFromMarkdown(markdown) {
    const text = String(markdown || '');
    const heading = text.match(/(?:^|\n)#{1,3}\s*action items?\s*\n([\s\S]*?)(?=\n#{1,3}\s|\s*$)/i);
    if (!heading) return [];
    const items = [];
    for (const line of heading[1].split('\n')) {
        const match = line.match(/^\s*(?:[-*]|\d+[.)])\s+(.+)$/);
        if (!match) continue;
        const title = clamp(match[1], TITLE_ITEM_CAP);
        if (title) items.push({ title });
        if (items.length >= ACTION_ITEM_CAP) break;
    }
    return items;
}

function hintsFromItems(items) {
    const hints = [];
    for (const item of items || []) {
        if (item.relatedTaskId) hints.push({ type: 'task', id: item.relatedTaskId });
        if (item.relatedPageId) hints.push({ type: 'page', id: item.relatedPageId });
    }
    return hints;
}

function actionItemsToRequirements({ title, markdown, actionItems }) {
    const parts = [];
    const heading = clamp(title, TITLE_CAP);
    if (heading) parts.push(heading);
    const summary = String(markdown || '').trim();
    if (summary) parts.push(summary);
    const items = Array.isArray(actionItems) ? actionItems : [];
    if (items.length) {
        const lines = ['Action items:'];
        items.forEach((item, index) => {
            if (!item || !item.title) return;
            let line = `${index + 1}. ${item.title}`;
            if (item.owner) line += ` (owner: ${item.owner})`;
            if (item.due) line += ` (due: ${item.due})`;
            lines.push(line);
            if (item.notes) lines.push(`   ${item.notes}`);
        });
        parts.push(lines.join('\n'));
    }
    return parts.join('\n\n');
}

function shapeTranscriptResult({ title, markdown, actionItems, packCitations, usedHints }) {
    const summary = String(markdown || '').trim();
    let items = parseActionItems(actionItems, packCitations);
    if (!items.length) items = actionItemsFromMarkdown(summary);
    const citations = selectCitations(
        packCitations,
        [].concat(usedHints || [], hintsFromItems(items)),
        { fallback: false },
    );
    return {
        status: true,
        data: {
            action: 'transcript',
            apply: false,
            markdown: summary,
            previewText: summary.slice(0, 400),
            actionItems: items,
            citations,
            requirementsText: actionItemsToRequirements({ title, markdown: summary, actionItems: items }),
        },
    };
}

function buildTranscriptPrompt({ title, transcript, currentText, pack }) {
    const parts = [
        `Title: ${title || '(untitled)'}`,
        `Meeting transcript:\n${transcript || '(empty)'}`,
    ];
    if (currentText) parts.push(`Current page body (do not replace):\n${currentText}`);
    const pages = pack && pack.pageText ? pack.pageText : '(none)';
    const tasks = pack && pack.taskText ? pack.taskText : '(none)';
    parts.push(`Pages the author can open:\n${pages}`);
    parts.push(`Tasks the author can open:\n${tasks}`);
    return parts.join('\n\n');
}

async function summarizeTranscript({ title, transcript, currentText, pages, tasks, chatMarkdown, isAiConfigured }) {
    const text = clamp(transcript, TRANSCRIPT_CAP);
    if (!text) {
        return { status: false, reason: 'Transcript is needed.' };
    }
    if (typeof isAiConfigured === 'function' ? !isAiConfigured() : true) {
        return { status: false, reason: 'AI is not integrated in your system', isNotAi: true };
    }
    const pack = formatContextPack({ pages, tasks });
    const userPrompt = buildTranscriptPrompt({
        title: clamp(title, TITLE_CAP),
        transcript: text,
        currentText: clamp(currentText, PAGE_CONTEXT_CAP),
        pack,
    });
    const chat = await chatMarkdown({
        systemPrompt: TRANSCRIPT_SYSTEM,
        userPrompt,
        temperature: 0.3,
        maxTokens: TRANSCRIPT_MAX_TOKENS,
    });
    if (!chat.status) return chat;
    return shapeTranscriptResult({
        title,
        markdown: chat.markdown,
        actionItems: chat.payload && chat.payload.actionItems,
        packCitations: pack.citations,
        usedHints: extractUsedHints(chat.raw),
    });
}

module.exports = {
    TRANSCRIPT_CAP,
    TRANSCRIPT_MAX_TOKENS,
    TRANSCRIPT_SYSTEM,
    parseActionItems,
    actionItemsFromMarkdown,
    actionItemsToRequirements,
    shapeTranscriptResult,
    buildTranscriptPrompt,
    summarizeTranscript,
};
