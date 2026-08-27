'use strict';

const logger = require('../../../Config/loggerConfig');
const {
    AI_ACTIONS,
    isAiAction,
    markdownToEditorData,
    blocksToHtml,
    blocksToRawText,
} = require('./pageContent');

let providerFactory = null;
try {
    providerFactory = require('../../AIProjectGenerator/llmProvider');
} catch (_e) {
    providerFactory = null;
}

const {
    formatContextPack,
    buildWorkspaceAskPrompt,
    extractUsedHints,
    selectCitations,
    WORKSPACE_ASK_SYSTEM,
} = require('./pageWorkspaceAsk');
const { summarizeTranscript } = require('./pageTranscript');

const TITLE_CAP = 200;
const INTENT_CAP = 2000;
const BODY_CAP = 12000;
const REQUEST_TIMEOUT_MS = 120_000;

const SYSTEM_PROMPT = `You write workspace pages for a project-management product.

Return a single JSON object: { "markdown": "<markdown string>" }
No preamble, no code fences around the JSON.

Rules:
- Write in Markdown (headings, lists, short paragraphs). Do not invent HTML.
- Stay faithful to the title, the author's instruction, and any existing body.
- Prefer concrete, useful structure over filler.
- Do not mention that you are an AI.
- If the existing body is empty and the instruction is thin, still produce a useful first draft from the title.

Action meanings:
- draft: write a full first draft.
- expand: keep the existing body and add missing sections or detail.
- summarize: compress the existing body into a tight briefing.
- outline: produce a heading + bullet outline the author can fill in.
- rewrite: rewrite the existing body for clarity, same meaning.
- ask: answer the author's question about the current page. Do not rewrite or replace the page. Put the answer in markdown.
- transcript: turn a meeting transcript into a summary and action items. Do not rewrite or replace the page.`;

function clamp(value, cap) {
    if (typeof value !== 'string') return '';
    const trimmed = value.trim();
    return trimmed.length <= cap ? trimmed : `${trimmed.slice(0, cap)}…`;
}

function isAiConfigured() {
    return Boolean(providerFactory && typeof providerFactory.isAnyProviderConfigured === 'function'
        && providerFactory.isAnyProviderConfigured());
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

function parseMarkdownPayload(raw) {
    const parsed = parseJsonObject(raw);
    if (parsed) {
        if (typeof parsed.markdown === 'string') return parsed.markdown;
        if (typeof parsed.content === 'string') return parsed.content;
    }
    const text = String(raw || '').trim();
    if (!text) return '';
    if (text.startsWith('{')) {
        const match = text.match(/"markdown"\s*:\s*"([\s\S]*?)"\s*}\s*$/);
        if (match) {
            return match[1].replace(/\\n/g, '\n').replace(/\\"/g, '"');
        }
    }
    return text;
}

function buildUserPrompt({ action, title, instruction, currentText }) {
    const parts = [
        `Action: ${action}`,
        `Title: ${title || '(untitled)'}`,
    ];
    if (instruction) parts.push(`Author instruction:\n${instruction}`);
    if (currentText) parts.push(`Current page body:\n${currentText}`);
    else parts.push('Current page body: (empty)');
    return parts.join('\n\n');
}

async function chatMarkdown({ systemPrompt, userPrompt, temperature, maxTokens }) {
    let provider;
    try {
        provider = providerFactory.getProvider();
    } catch (error) {
        return { status: false, reason: (error && error.message) || 'No LLM provider is available.' };
    }

    const chatOpts = {
        messages: [{ role: 'user', content: userPrompt }],
        systemPrompt,
        jsonMode: true,
        temperature: temperature == null ? 0.6 : temperature,
    };
    if (maxTokens) chatOpts.maxTokens = maxTokens;

    let result;
    try {
        result = await Promise.race([
            provider.chat(chatOpts),
            new Promise((_, reject) => setTimeout(() => reject(new Error('AI request timed out.')), REQUEST_TIMEOUT_MS)),
        ]);
    } catch (error) {
        logger.error(`page AI failed: ${error && error.message ? error.message : error}`);
        return { status: false, reason: (error && error.message) || 'Could not complete the AI request.' };
    }

    const raw = result && result.content;
    const payload = parseJsonObject(raw);
    const markdown = parseMarkdownPayload(raw);
    if (!markdown.trim()) {
        return { status: false, reason: 'The model returned an empty answer.' };
    }
    return { status: true, markdown, raw, payload };
}

async function composePage({ action, title, instruction, currentText, pages, tasks }) {
    const resolvedAction = String(action || 'draft').toLowerCase();
    if (!isAiAction(resolvedAction)) {
        return { status: false, reason: `action must be one of: ${AI_ACTIONS.join(', ')}.` };
    }
    if (resolvedAction === 'ask' && !clamp(instruction, INTENT_CAP)) {
        return { status: false, reason: 'Ask needs a question.' };
    }
    if (resolvedAction === 'transcript') {
        return summarizeTranscript({
            title,
            transcript: instruction,
            currentText,
            pages,
            tasks,
            chatMarkdown,
            isAiConfigured,
        });
    }
    if (!isAiConfigured()) {
        return { status: false, reason: 'AI is not integrated in your system', isNotAi: true };
    }

    const userPrompt = buildUserPrompt({
        action: resolvedAction,
        title: clamp(title, TITLE_CAP),
        instruction: clamp(instruction, INTENT_CAP),
        currentText: clamp(currentText, BODY_CAP),
    });

    const chat = await chatMarkdown({
        systemPrompt: SYSTEM_PROMPT,
        userPrompt,
        temperature: 0.6,
    });
    if (!chat.status) return chat;

    const markdown = chat.markdown;
    if (resolvedAction === 'ask') {
        return {
            status: true,
            data: {
                action: resolvedAction,
                apply: false,
                markdown,
                previewText: markdown.slice(0, 400),
            },
        };
    }

    const editorData = markdownToEditorData(markdown);
    const html = blocksToHtml(editorData);
    return {
        status: true,
        data: {
            action: resolvedAction,
            markdown,
            html,
            blocks: editorData,
            previewText: blocksToRawText(editorData, 400),
        },
    };
}

async function answerWorkspaceQuestion({ question, pages, tasks }) {
    const asked = clamp(question, INTENT_CAP);
    if (!asked) {
        return { status: false, reason: 'Ask needs a question.' };
    }
    if (!isAiConfigured()) {
        return { status: false, reason: 'AI is not integrated in your system', isNotAi: true };
    }
    const pack = formatContextPack({ pages, tasks });
    const chat = await chatMarkdown({
        systemPrompt: WORKSPACE_ASK_SYSTEM,
        userPrompt: buildWorkspaceAskPrompt({ question: asked, pack }),
        temperature: 0.3,
    });
    if (!chat.status) return chat;
    const citations = selectCitations(pack.citations, extractUsedHints(chat.raw));
    return {
        status: true,
        data: {
            markdown: chat.markdown,
            previewText: chat.markdown.slice(0, 400),
            sources: { pages: pack.pageCount, tasks: pack.taskCount },
            citations,
        },
    };
}

module.exports = {
    composePage,
    answerWorkspaceQuestion,
    isAiConfigured,
    parseMarkdownPayload,
    buildUserPrompt,
};
