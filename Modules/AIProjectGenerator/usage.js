/**
 * Token accounting and cost estimation for the AI project generator.
 *
 * Input and output tokens are priced very differently — output is typically
 * 5x input — so a single "total tokens" number cannot produce a cost. Every
 * provider already reports the split; this module keeps it intact, adds up
 * the calls that make one wizard run, and prices the result.
 *
 * The golden rule here is that a WRONG cost is worse than no cost. A model
 * with no price on file reports `costUsd: null` and the UI shows tokens only,
 * rather than quietly billing the user against a guess.
 */
'use strict';

const logger = require('../../Config/loggerConfig');

/**
 * USD per 1,000,000 tokens, by model id. Accurate as of 2026-08-13.
 *
 * Anthropic's list is complete because it is published per model id. OpenAI
 * and DeepSeek are deliberately absent: their prices are not carried here
 * rather than guessed, so those providers report tokens with no cost until an
 * operator fills them in via LLM_PRICING (see below).
 *
 * Prices change. Treat this as a default, not as the source of truth — the env
 * override exists precisely so a stale number can be corrected without a deploy.
 */
const DEFAULT_PRICING = {
    'claude-fable-5': { input: 10, output: 50 },
    'claude-mythos-5': { input: 10, output: 50 },
    'claude-opus-5': { input: 5, output: 25 },
    'claude-opus-4-8': { input: 5, output: 25 },
    'claude-opus-4-7': { input: 5, output: 25 },
    'claude-opus-4-6': { input: 5, output: 25 },
    'claude-opus-4-5': { input: 5, output: 25 },
    'claude-sonnet-5': { input: 3, output: 15 },
    'claude-sonnet-4-6': { input: 3, output: 15 },
    'claude-sonnet-4-5': { input: 3, output: 15 },
    'claude-haiku-4-5': { input: 1, output: 5 },
};

/**
 * Operator-supplied prices, merged over the defaults.
 *
 * LLM_PRICING='{"gpt-4.1":{"input":2,"output":8},"deepseek-v4-flash":{"input":0.28,"output":0.42}}'
 *
 * Parsed once at module load. A malformed value is logged and ignored rather
 * than thrown — bad pricing config should cost you the cost display, not the
 * ability to generate a project.
 */
const ENV_PRICING = (() => {
    const raw = String(process.env.LLM_PRICING || '').trim();
    if (!raw) return {};
    try {
        const parsed = JSON.parse(raw);
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('not an object');
        const clean = {};
        Object.keys(parsed).forEach((key) => {
            const entry = parsed[key];
            const input = Number(entry && entry.input);
            const output = Number(entry && entry.output);
            // Both halves must be real numbers. A half-specified entry would
            // silently price one direction at zero.
            if (Number.isFinite(input) && Number.isFinite(output) && input >= 0 && output >= 0) {
                clean[String(key).toLowerCase()] = { input, output };
            } else {
                logger.error(`LLM_PRICING: ignoring "${key}" — input and output must both be non-negative numbers`);
            }
        });
        return clean;
    } catch (error) {
        logger.error(`LLM_PRICING is not valid JSON, ignoring it: ${error && error.message ? error.message : error}`);
        return {};
    }
})();

const PRICING = { ...DEFAULT_PRICING, ...ENV_PRICING };

/** An empty tally — the identity for addUsage. */
function emptyUsage() {
    return { inputTokens: 0, outputTokens: 0, totalTokens: 0 };
}

const int = (value) => {
    const n = Number(value);
    return Number.isFinite(n) && n > 0 ? Math.round(n) : 0;
};

/**
 * Pull the token split out of a provider's chat result.
 *
 * `totalTokens` is recomputed from the two halves rather than trusted: a
 * provider that reports a total but no split would otherwise contribute to the
 * total while leaving the cost at zero, which reads as "this call was free".
 */
function usageFromResult(result) {
    const inputTokens = int(result && result.inputTokens);
    const outputTokens = int(result && result.outputTokens);
    return {
        inputTokens,
        outputTokens,
        totalTokens: inputTokens + outputTokens || int(result && result.totalTokens),
    };
}

/** Add one call's usage to a running tally. */
function addUsage(tally, next) {
    const a = tally || emptyUsage();
    const b = next || emptyUsage();
    return {
        inputTokens: int(a.inputTokens) + int(b.inputTokens),
        outputTokens: int(a.outputTokens) + int(b.outputTokens),
        totalTokens: int(a.totalTokens) + int(b.totalTokens),
    };
}

/** The price sheet for a model id, or null when we have none. */
function priceFor(modelId) {
    const id = String(modelId || '').trim().toLowerCase();
    if (!id) return null;
    if (PRICING[id]) return PRICING[id];
    // Fall back to the longest key the id starts with, so a dated snapshot
    // (claude-sonnet-4-6-20260115) prices like its base model. Longest wins so
    // "claude-opus-4-8" beats a hypothetical shorter "claude-opus".
    const match = Object.keys(PRICING)
        .filter((key) => id.startsWith(key))
        .sort((a, b) => b.length - a.length)[0];
    return match ? PRICING[match] : null;
}

/**
 * Price a tally.
 *
 * @returns {{inputTokens:number, outputTokens:number, totalTokens:number,
 *            model:string, costUsd:number|null, priced:boolean}}
 *          `costUsd` is null and `priced` false when the model has no price on
 *          file — the caller should show tokens and omit the cost.
 */
function summarize(tally, modelId) {
    const added = addUsage(emptyUsage(), tally);
    // Re-derive the total from the split so a caller that passes only
    // { inputTokens, outputTokens } still reports a total instead of zero.
    // Falls back to a supplied total for providers that report no split.
    const usage = {
        ...added,
        totalTokens: added.inputTokens + added.outputTokens || added.totalTokens,
    };
    const price = priceFor(modelId);
    if (!price) {
        return { ...usage, model: String(modelId || ''), costUsd: null, priced: false };
    }
    const costUsd = (usage.inputTokens / 1e6) * price.input + (usage.outputTokens / 1e6) * price.output;
    return {
        ...usage,
        model: String(modelId || ''),
        // 4 decimals: a single plan lands in cents, and rounding to 2 would
        // report most runs as $0.00.
        costUsd: Math.round(costUsd * 10000) / 10000,
        priced: true,
    };
}

module.exports = { emptyUsage, usageFromResult, addUsage, summarize, priceFor };
