/**
 * Clarifier — LLM call for generating clarifying questions.
 *
 * Runs BEFORE plan generation. Reads the brief (description, additional
 * requirements, uploaded brief text) and asks the model to return a small
 * structured list of clarifying questions it would ask a freelance client
 * to pin down the gaps.
 *
 * Architecturally a sibling to controller.js#callLlmForPlan but with:
 *   - smaller token budget (questions are short)
 *   - JSON mode + the same tolerant parse + one repair pass
 *   - a separate Zod schema (ClarifyQuestionsSchema) so the contract is
 *     strict
 *
 * The plan call is unaffected. If this call fails for any reason, the
 * controller catches and falls back to going straight to plan generation
 * without Q&A — so the existing flow never breaks.
 */
'use strict';

const logger = require('../../Config/loggerConfig');
const { getProvider } = require('./llmProvider');
const { ClarifyQuestionsSchema, tryParseJson } = require('./schemaValidator');
const {
    buildClarifySystemPrompt,
    buildClarifyUserMessage,
    buildRepairPrompt,
} = require('./promptBuilder');

// Smaller than the plan call but generous enough for tech-heavy briefs
// that fan out into per-stack-layer questions. ~14 rich questions with
// named-product options and descriptions land around 5–6k tokens, so
// 6000 is the safe default. Configurable via LLM_MAX_TOKENS_CLARIFY.
const DEFAULT_MAX_TOKENS = 6000;

/**
 * Run the clarify LLM call.
 *
 * @param {object} args
 * @param {string} args.description           - Project description (≥20 chars upstream)
 * @param {string} [args.additionalRequirements]
 * @param {string} [args.briefText]           - Extracted text from an uploaded brief
 * @returns {Promise<{ understanding: string, questions: Array, tokens: number, model: string }>}
 */
async function generateClarifyingQuestions({ description, additionalRequirements, briefText }) {
    const provider = getProvider();
    const systemPrompt = buildClarifySystemPrompt();
    const userMessage = buildClarifyUserMessage({ description, additionalRequirements, briefText });
    const maxTokens = DEFAULT_MAX_TOKENS;

    const firstAttempt = await provider.chat({
        systemPrompt,
        messages: [{ role: 'user', content: userMessage }],
        jsonMode: true,
        maxTokens,
        // Slightly warmer than plan (0.4) since "what to ask" benefits from
        // a touch more variety. Still well below creative-writing range.
        temperature: 0.5,
    });

    if (firstAttempt.truncated) {
        // Unlikely at 4k tokens for ≤8 questions, but guard anyway.
        const err = new Error(
            'The AI ran out of token budget while drafting clarifying questions. '
            + `Raise DEFAULT_MAX_TOKENS (currently ${maxTokens}) in your .env.`,
        );
        err.code = 'LLM_TRUNCATED';
        throw err;
    }

    const tryValidate = (raw) => {
        const parsed = tryParseJson(raw);
        if (!parsed.ok) return { ok: false, error: `JSON parse failed: ${parsed.error}` };
        const result = ClarifyQuestionsSchema.safeParse(parsed.value);
        if (!result.success) {
            const issues = result.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('\n');
            return { ok: false, error: issues };
        }
        return { ok: true, value: result.data };
    };

    let validated = tryValidate(firstAttempt.content);
    let usedTokens = firstAttempt.totalTokens || 0;

    if (!validated.ok) {
        logger.warn(`AIPG clarify first-pass validation failed: ${validated.error}`);
        const repairAttempt = await provider.chat({
            systemPrompt,
            messages: [
                { role: 'user', content: userMessage },
                { role: 'assistant', content: firstAttempt.content },
                { role: 'user', content: buildRepairPrompt(firstAttempt.content, validated.error) },
            ],
            jsonMode: true,
            maxTokens,
            temperature: 0.2,
        });
        usedTokens += repairAttempt.totalTokens || 0;

        if (repairAttempt.truncated) {
            const err = new Error('The AI ran out of token budget on the clarify repair attempt.');
            err.code = 'LLM_TRUNCATED';
            throw err;
        }

        validated = tryValidate(repairAttempt.content);
        if (!validated.ok) {
            const err = new Error(`Clarify output failed validation after repair: ${validated.error}`);
            err.code = 'LLM_INVALID_OUTPUT';
            err.details = validated.error;
            throw err;
        }
    }

    return {
        understanding: validated.value.understanding || '',
        questions: validated.value.questions || [],
        tokens: usedTokens,
        model: (provider && provider.name) || 'unknown',
    };
}

module.exports = {
    generateClarifyingQuestions,
};
