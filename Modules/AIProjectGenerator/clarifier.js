/**
 * The three LLM calls that run BEFORE plan generation:
 *
 *   scoreCoverage             — scores the brief against the five points
 *   generateClarifyingQuestions — asks only about the missing ones (≤ 3 per
 *                               round, ≤ 2 rounds, ≤ 6 in total)
 *   draftBrief                — rewrites description + upload + answers into
 *                               the five sections plus assumptions
 *
 * Each is a JSON-mode call with the same tolerant parse + one repair pass as
 * controller.js#callLlmForPlan, against its own Zod schema. If any of them
 * fails the controller reports it; the plan call is unaffected.
 */
'use strict';

const logger = require('../../Config/loggerConfig');
const { getProvider } = require('./llmProvider');
const { usageFromResult, addUsage, summarize } = require('./usage');
const { COVERAGE_POINTS, CoverageSchema, ClarifyQuestionsSchema, BriefDraftSchema, tryParseJson } = require('./schemaValidator');
const {
    COVERAGE_POINT_LABELS,
    buildCoverageSystemPrompt,
    buildCoverageUserMessage,
    buildClarifySystemPrompt,
    buildClarifyUserMessage,
    buildBriefSystemPrompt,
    buildBriefUserMessage,
    buildRepairPrompt,
} = require('./promptBuilder');

const MAX_QUESTIONS_PER_ROUND = 3;
const MAX_ROUNDS = 2;
const MAX_TOTAL_QUESTIONS = 6;

// When more points are missing than a round may ask about, the plan depends
// on these most, in this order; the rest become assumptions.
const ASK_PRIORITY = ['what_for_whom', 'done_when', 'constraints', 'existing', 'team'];

const COVERAGE_MAX_TOKENS = 1200;
// ~3 rich questions with named options and descriptions land around 2k
// tokens; the headroom covers a verbose model without inviting a 14-question
// answer.
const CLARIFY_MAX_TOKENS = 6000;
const BRIEF_MAX_TOKENS = 4000;

// Phrases that read as instructions to the model rather than facts about the
// project. Deliberately short and generic: the prompt does the real work,
// this only guarantees the user always sees a note when one slipped in.
const INSTRUCTION_PATTERNS = [
    /ignore (?:all |any |the |every )?(?:previous|prior|above|earlier|preceding) (?:instructions?|rules?|prompts?|guidance)/i,
    /disregard (?:all |any |the |every )?(?:previous|prior|above|earlier|preceding) (?:instructions?|rules?|prompts?)/i,
    /(?:do not|don't|never) follow (?:the |your |any )?(?:rules|instructions|system prompt)/i,
    /\bsystem prompt\b/i,
    /\byou are now\b/i,
    /\bfrom now on,? (?:you|act|respond|answer)\b/i,
    /reveal (?:your|the) (?:instructions|prompt|rules)/i,
];

async function callJson({ label, systemPrompt, userMessage, schema, check, maxTokens, temperature, truncatedMessage }) {
    const provider = getProvider();

    const tryValidate = (raw) => {
        const parsed = tryParseJson(raw);
        if (!parsed.ok) return { ok: false, error: `JSON parse failed: ${parsed.error}` };
        const result = schema.safeParse(parsed.value);
        if (!result.success) {
            const issues = result.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('\n');
            return { ok: false, error: issues };
        }
        const extra = check ? check(result.data) : null;
        if (extra) return { ok: false, error: extra, value: result.data };
        return { ok: true, value: result.data };
    };

    const truncatedError = () => {
        const err = new Error(truncatedMessage || `The AI ran out of token budget while ${label}.`);
        err.code = 'LLM_TRUNCATED';
        return err;
    };

    const firstAttempt = await provider.chat({
        systemPrompt,
        messages: [{ role: 'user', content: userMessage }],
        jsonMode: true,
        maxTokens,
        temperature,
    });
    if (firstAttempt.truncated) throw truncatedError();

    let validated = tryValidate(firstAttempt.content);
    // Split kept, not collapsed — output tokens cost several times what input
    // tokens do, so a bare total cannot be priced.
    let usage = usageFromResult(firstAttempt);
    let repairAttempt = null;

    if (!validated.ok) {
        logger.warn(`AIPG ${label} first-pass validation failed: ${validated.error}`);
        repairAttempt = await provider.chat({
            systemPrompt,
            messages: [
                { role: 'user', content: userMessage },
                { role: 'assistant', content: firstAttempt.content },
                { role: 'user', content: buildRepairPrompt(firstAttempt.content, validated.error) },
            ],
            jsonMode: true,
            maxTokens,
            temperature: 0.0,
        });
        // Counted before the guards below: a failed repair still burned tokens.
        usage = addUsage(usage, usageFromResult(repairAttempt));
        if (repairAttempt.truncated) throw truncatedError();

        const repaired = tryValidate(repairAttempt.content);
        if (!repaired.ok && !repaired.value) {
            const err = new Error(`${label} output failed validation after repair: ${repaired.error}`);
            err.code = 'LLM_INVALID_OUTPUT';
            err.details = repaired.error;
            throw err;
        }
        // A shape-valid answer that still fails the semantic check is kept:
        // the caller fills the gap deterministically rather than failing the
        // whole step on a third try.
        validated = { ok: true, value: repaired.value, incomplete: !repaired.ok ? repaired.error : null };
    }

    const modelId = (repairAttempt && repairAttempt.model) || firstAttempt.model || '';
    return {
        value: validated.value,
        incomplete: validated.incomplete || null,
        usage,
        model: modelId || (provider && provider.name) || 'unknown',
        provider: (provider && provider.name) || 'unknown',
    };
}

/**
 * Score the brief (and any answers so far) against the five points.
 *
 * @returns {Promise<{ coverage: object, notes: object, usage: object, model: string, provider: string }>}
 */
async function scoreCoverage({ description, additionalRequirements, briefText, previousAnswers }) {
    const result = await callJson({
        label: 'coverage',
        systemPrompt: buildCoverageSystemPrompt(),
        userMessage: buildCoverageUserMessage({ description, additionalRequirements, briefText, previousAnswers }),
        schema: CoverageSchema,
        maxTokens: COVERAGE_MAX_TOKENS,
        temperature: 0.0,
        truncatedMessage: 'The AI ran out of token budget while scoring the brief.',
    });
    return {
        coverage: result.value.coverage,
        notes: result.value.notes || {},
        usage: result.usage,
        model: result.model,
        provider: result.provider,
    };
}

function missingPoints(coverage) {
    return COVERAGE_POINTS.filter((p) => !coverage || coverage[p] !== 'met');
}

function gaveUp(answer) {
    return !!(answer && (answer.skipped || answer.unknown));
}

/**
 * Decide what a round may ask, from the coverage verdict and the earlier
 * answers. Pure, so the rules are testable without a provider.
 *
 * @returns {{ round: number, askPoints: string[], maxQuestions: number }}
 */
function planRound({ coverage, previousAnswers, round }) {
    const answers = Array.isArray(previousAnswers) ? previousAnswers : [];
    const thisRound = Number(round) || (answers.length ? 2 : 1);
    const gaveUpPoints = new Set(answers.filter(gaveUp).map((a) => a.point).filter(Boolean));

    const askPoints = ASK_PRIORITY
        .filter((p) => missingPoints(coverage).includes(p))
        .filter((p) => !gaveUpPoints.has(p));

    const remaining = Math.max(0, MAX_TOTAL_QUESTIONS - answers.length);
    const maxQuestions = thisRound > MAX_ROUNDS ? 0 : Math.min(MAX_QUESTIONS_PER_ROUND, remaining, askPoints.length);

    return { round: thisRound, askPoints: askPoints.slice(0, maxQuestions), maxQuestions };
}

/**
 * Run coverage scoring, then ask only about the missing points.
 *
 * @param {object} args
 * @param {string} args.description
 * @param {string} [args.additionalRequirements]
 * @param {string} [args.briefText]
 * @param {Array}  [args.previousAnswers] - [{ id, point, question, answer, skipped, unknown }]
 * @param {number} [args.round]
 */
async function generateClarifyingQuestions({ description, additionalRequirements, briefText, previousAnswers, round }) {
    const scored = await scoreCoverage({ description, additionalRequirements, briefText, previousAnswers });
    const plan = planRound({ coverage: scored.coverage, previousAnswers, round });
    const base = {
        coverage: scored.coverage,
        notes: scored.notes,
        round: plan.round,
        maxRounds: MAX_ROUNDS,
        provider: scored.provider,
        model: scored.model,
    };

    if (!plan.askPoints.length) {
        return { ...base, understanding: '', questions: [], usage: summarize(scored.usage, scored.model) };
    }

    const asked = await callJson({
        label: 'clarify',
        systemPrompt: buildClarifySystemPrompt(),
        userMessage: buildClarifyUserMessage({
            description,
            additionalRequirements,
            briefText,
            coverage: scored.coverage,
            notes: scored.notes,
            previousAnswers,
            askPoints: plan.askPoints,
            round: plan.round,
            maxQuestions: plan.maxQuestions,
        }),
        schema: ClarifyQuestionsSchema,
        maxTokens: CLARIFY_MAX_TOKENS,
        // Slightly warmer than plan (0.4) since "what to ask" benefits from a
        // touch more variety. Still well below creative-writing range.
        temperature: 0.5,
        truncatedMessage: 'The AI ran out of token budget while drafting clarifying questions.',
    });

    const allowed = new Set(plan.askPoints);
    const seenPoints = new Set();
    const questions = [];
    for (const q of asked.value.questions || []) {
        if (!allowed.has(q.point) || seenPoints.has(q.point)) continue;
        seenPoints.add(q.point);
        questions.push({ ...q, required: false, allowUnknown: true });
        if (questions.length >= plan.maxQuestions) break;
    }

    const modelId = asked.model || scored.model;
    return {
        ...base,
        understanding: asked.value.understanding || '',
        questions,
        usage: summarize(addUsage(scored.usage, asked.usage), modelId),
        model: modelId,
    };
}

function excerpt(text, pattern) {
    const match = pattern.exec(String(text || ''));
    if (!match) return null;
    const start = Math.max(0, match.index - 20);
    return String(text).slice(start, match.index + match[0].length + 40).replace(/\s+/g, ' ').trim();
}

/**
 * Instruction-shaped text in the brief that the model was told to ignore.
 * Returned as assumption lines so the user sees it whatever the model did.
 */
function detectIgnoredInstructions(...texts) {
    const found = [];
    for (const text of texts) {
        if (!text) continue;
        for (const pattern of INSTRUCTION_PATTERNS) {
            const hit = excerpt(text, pattern);
            if (hit) {
                found.push(hit);
                break;
            }
        }
    }
    return found.map((hit) => ({
        point: 'other',
        text: `The brief contained an instruction addressed to the AI ("${hit.slice(0, 80)}"); it was ignored.`,
    }));
}

function requiredAssumptionsFor({ answers, coverage, notes }) {
    const required = [];
    const coveredPoints = new Set();
    for (const a of Array.isArray(answers) ? answers : []) {
        if (!gaveUp(a)) continue;
        required.push({
            questionId: a.id,
            point: a.point || 'other',
            question: a.question,
            reason: a.unknown
                ? `the owner does not know yet: "${a.question}"`
                : `the owner skipped: "${a.question}"`,
        });
        if (a.point) coveredPoints.add(a.point);
    }
    for (const point of missingPoints(coverage)) {
        if (coveredPoints.has(point)) continue;
        const note = notes && notes[point] ? String(notes[point]).trim() : 'nothing was stated';
        required.push({ point, reason: `still missing after the questions — ${note}` });
    }
    return required;
}

// Each assumption may satisfy one requirement: by question id first, else by
// point for an entry the model left unkeyed.
function coversRequired(assumptions, required) {
    const claimed = new Set();
    const claim = (pick) => {
        const index = assumptions.findIndex((a, i) => !claimed.has(i) && pick(a));
        if (index < 0) return false;
        claimed.add(index);
        return true;
    };
    const missing = [];
    for (const r of required) {
        const byId = r.questionId && claim((a) => a.questionId === r.questionId);
        const byPoint = !byId && claim((a) => !a.questionId && a.point === r.point);
        if (!byId && !byPoint) missing.push(r);
    }
    return missing;
}

function fallbackAssumption(r) {
    const label = COVERAGE_POINT_LABELS[r.point] || 'this point';
    if (r.questionId) {
        return { point: r.point, questionId: r.questionId, text: `No answer to "${r.question}"; the plan will use a sensible default for ${label.toLowerCase()}.` };
    }
    return { point: r.point, text: `No ${label.toLowerCase()} given; the plan will use a sensible default.` };
}

function renderBriefMarkdown(sections, assumptions) {
    const lines = [];
    for (const point of COVERAGE_POINTS) {
        lines.push(`## ${COVERAGE_POINT_LABELS[point]}`);
        lines.push(String((sections && sections[point]) || '').trim() || '_Not stated._');
        lines.push('');
    }
    lines.push('## Assumptions');
    if (Array.isArray(assumptions) && assumptions.length) {
        for (const a of assumptions) lines.push(`- ${String(a.text || '').trim()}`);
    } else {
        lines.push('- None.');
    }
    return lines.join('\n').trim() + '\n';
}

/**
 * Rewrite description + upload + answers into the five sections plus one
 * assumption per skipped/unknown answer and per point still missing.
 */
async function draftBrief({ description, additionalRequirements, briefText, answers }) {
    const scored = await scoreCoverage({ description, additionalRequirements, briefText, previousAnswers: answers });
    const required = requiredAssumptionsFor({ answers, coverage: scored.coverage, notes: scored.notes });

    const drafted = await callJson({
        label: 'brief',
        systemPrompt: buildBriefSystemPrompt(),
        userMessage: buildBriefUserMessage({
            description,
            additionalRequirements,
            briefText,
            answers,
            coverage: scored.coverage,
            notes: scored.notes,
            requiredAssumptions: required,
        }),
        schema: BriefDraftSchema,
        check: (value) => {
            const missing = coversRequired(value.assumptions, required);
            if (!missing.length) return null;
            return 'assumptions: missing required entries for '
                + missing.map((r) => (r.questionId ? `questionId "${r.questionId}"` : `point "${r.point}"`)).join(', ');
        },
        maxTokens: BRIEF_MAX_TOKENS,
        temperature: 0.3,
        truncatedMessage: 'The AI ran out of token budget while drafting the brief.',
    });

    const assumptions = [...drafted.value.assumptions];
    for (const r of coversRequired(assumptions, required)) assumptions.push(fallbackAssumption(r));
    for (const note of detectIgnoredInstructions(description, additionalRequirements, briefText)) {
        const already = assumptions.some((a) => a.point === 'other' && /ignored/i.test(a.text));
        if (!already) assumptions.push(note);
    }

    const sections = drafted.value.sections;
    const modelId = drafted.model || scored.model;
    return {
        brief: { sections, assumptions, markdown: renderBriefMarkdown(sections, assumptions) },
        coverage: scored.coverage,
        notes: scored.notes,
        usage: summarize(addUsage(scored.usage, drafted.usage), modelId),
        model: modelId,
        provider: drafted.provider || scored.provider,
    };
}

module.exports = {
    MAX_QUESTIONS_PER_ROUND,
    MAX_ROUNDS,
    MAX_TOTAL_QUESTIONS,
    scoreCoverage,
    planRound,
    generateClarifyingQuestions,
    draftBrief,
    renderBriefMarkdown,
    detectIgnoredInstructions,
};
