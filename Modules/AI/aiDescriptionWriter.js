/**
 * AI "Write with AI" description generator.
 *
 * Provider-agnostic helper for the dedicated "Write with AI" popover on the
 * task/project description editor. Mirrors the AI time-estimator pattern
 * (Modules/EstimatedTime/aiTaskEstimator.js): it reuses the
 * AIProjectGenerator/llmProvider factory (Anthropic / OpenAI / DeepSeek),
 * loads a file-based system prompt once at module load, and parses a single
 * JSON object out of the model response.
 *
 * The one LLM call returns EITHER:
 *   { questions: ["...", ...] }   — 1-3 short clarifying questions, only when
 *                                   the input is too vague to write accurately
 *   { description: "<markdown>" } — the generated description
 *
 * When the caller supplies `answers` (the user already answered a previous
 * round of questions), the prompt forces the model to return a description,
 * so we never loop on questions forever.
 *
 * Unlike the estimator this does NOT persist anything — the frontend shows a
 * preview and only applies/saves the description after the user approves it.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const logger = require('../../Config/loggerConfig');

let providerFactory = null;
try {
    providerFactory = require('../AIProjectGenerator/llmProvider');
} catch (_e) {
    providerFactory = null;
}

// Same generous ceiling as the estimator so slow / thinking models have room.
const REQUEST_TIMEOUT_MS = 120_000;
// Caps on the bits of user-supplied text we forward to the model so a giant
// existing description / intent can't blow the prompt budget.
const TITLE_CHAR_CAP = 500;
const INTENT_CHAR_CAP = 2000;
const EXISTING_DESC_CHAR_CAP = 20000;
const ANSWER_CHAR_CAP = 1000;
const MAX_QUESTIONS = 3;

// Load the system prompt once at module load (require() caches this module),
// same approach as aiTaskEstimator. BOM stripped + CRLF normalized so the
// file produces identical bytes regardless of authoring OS.
const SYSTEM_PROMPT = (() => {
    const promptPath = path.join(__dirname, 'prompts', 'write-description.md');
    const raw = fs.readFileSync(promptPath, 'utf8');
    return raw.replace(/^\uFEFF/, '').replace(/\r\n/g, '\n').trim();
})();

function clampStr(value, cap) {
    if (typeof value !== 'string') return '';
    const trimmed = value.trim();
    if (trimmed.length <= cap) return trimmed;
    return `${trimmed.slice(0, cap)}…`;
}

/**
 * Normalize the optional answers array into clean {question, answer} pairs.
 * Anything malformed is dropped rather than forwarded to the model.
 */
function normalizeAnswers(answers) {
    if (!Array.isArray(answers)) return [];
    const out = [];
    for (const a of answers) {
        if (!a || typeof a !== 'object') continue;
        const question = clampStr(a.question, ANSWER_CHAR_CAP);
        const answer = clampStr(a.answer, ANSWER_CHAR_CAP);
        // An answer with no text adds nothing; skip blanks so the model
        // doesn't treat an empty string as a meaningful response.
        if (!answer) continue;
        out.push({ question, answer });
    }
    return out;
}

function buildUserMessage({ title, taskType, existingDescription, intent, answers, mode }) {
    const cleanTitle = clampStr(title, TITLE_CHAR_CAP) || '(no title provided)';
    const cleanType = clampStr(taskType, 100) || 'task';
    const cleanIntent = clampStr(intent, INTENT_CHAR_CAP);
    const cleanExisting = clampStr(existingDescription, EXISTING_DESC_CHAR_CAP);
    const cleanAnswers = normalizeAnswers(answers);

    // ADD mode: the author already has a description and wants to add to it.
    // The model returns the COMPLETE updated description — the existing content
    // kept verbatim, with the addition inserted wherever the author asked. The
    // frontend then replaces with it (the user reviews the full result in the
    // preview first). Only meaningful when an existing description is present.
    if (mode === 'add' && cleanExisting) {
        return [
            `Item type: ${cleanType}`,
            `Title: ${cleanTitle}`,
            '',
            'MODE: ADD — the author already has a description and wants to add to it.',
            "Return the COMPLETE updated description: keep ALL of the existing content EXACTLY as-is — every word, line, list item, heading and bit of formatting — and insert the author's addition at the location they describe. If they don't state a location, place it at the most sensible spot.",
            'Do NOT change, rephrase, reorder, summarize, translate, or remove ANY existing content — the only difference from the existing description must be the added text. Do NOT ask clarifying questions.',
            '',
            'What to add (and where, if stated):',
            cleanIntent || '(not specified — add a sensible, useful addition based on the title and the existing description)',
            '',
            'Existing description (reproduce it verbatim, with the addition inserted in the right place):',
            cleanExisting,
        ].join('\n');
    }

    const lines = [
        `Item type: ${cleanType}`,
        `Title: ${cleanTitle}`,
        '',
        'Author intent (what the description should cover):',
        cleanIntent || '(none provided — infer from the title and type)',
    ];

    if (cleanExisting) {
        lines.push('', 'Existing description (rewrite / improve toward the intent):', cleanExisting);
    }

    if (cleanAnswers.length) {
        lines.push('', 'Answers to your clarifying questions:');
        for (const { question, answer } of cleanAnswers) {
            lines.push(question ? `- Q: ${question}` : '- Q: (question)');
            lines.push(`  A: ${answer}`);
        }
        lines.push('', 'You have answers now — return a description (do NOT ask more questions).');
    } else {
        lines.push('', 'Write the description if you can do so accurately; only ask questions if the input is genuinely too vague.');
    }

    return lines.join('\n');
}

/**
 * Pull the single JSON object out of the model response and coerce it into
 * one of the two contract shapes. Robust to code fences and extra prose.
 * Returns { questions: [...] } or { description: "<md>" } or null on failure.
 */
function parseDescriptionResponse(content) {
    if (typeof content !== 'string') return null;
    let text = content.trim();
    if (!text) return null;

    // Strip a leading / trailing markdown code fence if the model added one.
    text = text
        .replace(/^```(?:json)?\s*/i, '')
        .replace(/```$/i, '')
        .trim();

    let parsed = null;
    try {
        parsed = JSON.parse(text);
    } catch (_e) {
        // Rescue: grab the first balanced-looking {...} span and retry.
        const first = text.indexOf('{');
        const last = text.lastIndexOf('}');
        if (first !== -1 && last !== -1 && last > first) {
            try {
                parsed = JSON.parse(text.slice(first, last + 1));
            } catch (_e2) {
                parsed = null;
            }
        }
    }
    if (!parsed || typeof parsed !== 'object') return null;

    // Questions branch — only honoured when answers weren't required.
    if (Array.isArray(parsed.questions)) {
        const questions = parsed.questions
            .filter((q) => typeof q === 'string' && q.trim())
            .map((q) => q.trim())
            .slice(0, MAX_QUESTIONS);
        if (questions.length) return { questions };
        // Empty questions array is meaningless — fall through to description.
    }

    if (typeof parsed.description === 'string' && parsed.description.trim()) {
        return { description: parsed.description.trim() };
    }

    // Some models nest the markdown under a different key — last-ditch rescue.
    if (typeof parsed.markdown === 'string' && parsed.markdown.trim()) {
        return { description: parsed.markdown.trim() };
    }

    return null;
}

async function callProvider(input) {
    if (!providerFactory || typeof providerFactory.getProvider !== 'function') return null;
    if (typeof providerFactory.isAnyProviderConfigured === 'function'
        && !providerFactory.isAnyProviderConfigured()) {
        return null;
    }
    let provider;
    try {
        provider = providerFactory.getProvider();
    } catch (_e) {
        return null;
    }
    const userMessage = buildUserMessage(input);
    const chatPromise = provider.chat({
        systemPrompt: SYSTEM_PROMPT,
        messages: [{ role: 'user', content: userMessage }],
        jsonMode: true,
        // Mid temperature: descriptions read better with a little variation
        // than a calibrated number would, but we still want it grounded.
        temperature: 0.5,
        // ADD mode reproduces the whole description plus the addition, so allow
        // room for a long description to come back in full.
        maxTokens: 8192,
    });
    const result = await Promise.race([
        chatPromise,
        new Promise((_, reject) => setTimeout(
            () => reject(new Error('AI description request timed out')),
            REQUEST_TIMEOUT_MS,
        )),
    ]);
    if (!result || typeof result.content !== 'string') return null;
    return parseDescriptionResponse(result.content);
}

/**
 * Generate a description (or clarifying questions) for a task/project.
 * Never throws; returns a contract object the controller can forward.
 *
 * @param {object} params
 * @param {string} [params.title]               Task/project title.
 * @param {string} [params.taskType]            Item type (task/bug/project…).
 * @param {string} [params.existingDescription] Current description text.
 * @param {string} [params.intent]              Free-text "what to cover".
 * @param {Array<{question:string,answer:string}>} [params.answers]
 * @returns {Promise<{status:boolean, data?:{questions?:string[], description?:string}, reason?:string}>}
 */
async function generateDescription(params = {}) {
    try {
        if (!providerFactory
            || typeof providerFactory.isAnyProviderConfigured !== 'function'
            || !providerFactory.isAnyProviderConfigured()) {
            return { status: false, reason: 'no LLM provider configured' };
        }
        // ADD mode reproduces the whole description with the addition inserted,
        // so refuse rather than silently truncate (and lose) a description that
        // exceeds the input cap. Rewrite and manual editing still work.
        if (params.mode === 'add'
            && typeof params.existingDescription === 'string'
            && params.existingDescription.length > EXISTING_DESC_CHAR_CAP) {
            return { status: false, reason: 'This description is too long for Add mode — use Rewrite, or add the text manually.' };
        }
        const result = await callProvider(params);
        if (!result) {
            return { status: false, reason: 'no description returned' };
        }
        return { status: true, data: result };
    } catch (error) {
        logger.error(`AI description writer failed: ${error && error.message ? error.message : error}`);
        return { status: false, reason: (error && error.message) || 'description error' };
    }
}

module.exports = {
    generateDescription,
    // Exposed for unit tests / debugging — not part of the runtime contract.
    _internal: {
        buildUserMessage,
        parseDescriptionResponse,
        normalizeAnswers,
        clampStr,
        MAX_QUESTIONS,
    },
};
