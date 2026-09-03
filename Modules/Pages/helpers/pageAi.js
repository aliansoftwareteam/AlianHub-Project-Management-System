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
- ask: answer the author's question using the page. Return the answer as markdown. Do not rewrite or replace the page.`;

function clamp(value, cap) {
    if (typeof value !== 'string') return '';
    const trimmed = value.trim();
    return trimmed.length <= cap ? trimmed : `${trimmed.slice(0, cap)}…`;
}

function isAiConfigured() {
    return Boolean(providerFactory && typeof providerFactory.isAnyProviderConfigured === 'function'
        && providerFactory.isAnyProviderConfigured());
}

function parseMarkdownPayload(raw) {
    const text = String(raw || '').trim();
    if (!text) return '';
    try {
        const parsed = JSON.parse(text);
        if (parsed && typeof parsed.markdown === 'string') return parsed.markdown;
        if (parsed && typeof parsed.content === 'string') return parsed.content;
    } catch (_e) {
        const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
        if (fenced) {
            try {
                const parsed = JSON.parse(fenced[1]);
                if (parsed && typeof parsed.markdown === 'string') return parsed.markdown;
            } catch (_err) {
                return fenced[1].trim();
            }
        }
        if (text.startsWith('{')) {
            const match = text.match(/"markdown"\s*:\s*"([\s\S]*?)"\s*}\s*$/);
            if (match) {
                return match[1].replace(/\\n/g, '\n').replace(/\\"/g, '"');
            }
        }
        return text;
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

async function composePage({ action, title, instruction, currentText }) {
    const resolvedAction = String(action || 'draft').toLowerCase();
    if (!isAiAction(resolvedAction)) {
        return { status: false, reason: `action must be one of: ${AI_ACTIONS.join(', ')}.` };
    }
    if (!isAiConfigured()) {
        return { status: false, reason: 'AI is not integrated in your system', isNotAi: true };
    }

    let provider;
    try {
        provider = providerFactory.getProvider();
    } catch (error) {
        return { status: false, reason: (error && error.message) || 'No LLM provider is available.' };
    }

    const userPrompt = buildUserPrompt({
        action: resolvedAction,
        title: clamp(title, TITLE_CAP),
        instruction: clamp(instruction, INTENT_CAP),
        currentText: clamp(currentText, BODY_CAP),
    });

    let result;
    try {
        result = await Promise.race([
            provider.chat({
                messages: [{ role: 'user', content: userPrompt }],
                systemPrompt: SYSTEM_PROMPT,
                jsonMode: true,
                temperature: 0.6,
            }),
            new Promise((_, reject) => setTimeout(() => reject(new Error('AI request timed out.')), REQUEST_TIMEOUT_MS)),
        ]);
    } catch (error) {
        logger.error(`page AI compose failed: ${error && error.message ? error.message : error}`);
        return { status: false, reason: (error && error.message) || 'Could not compose page content.' };
    }

    const markdown = parseMarkdownPayload(result && result.content);
    if (!markdown.trim()) {
        return { status: false, reason: 'The model returned empty page content.' };
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

module.exports = {
    composePage,
    isAiConfigured,
    parseMarkdownPayload,
    buildUserPrompt,
};
