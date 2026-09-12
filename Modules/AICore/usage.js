/**
 * Token accounting and cost estimation for every billed model call.
 *
 * Input and output tokens are priced very differently — output is typically
 * 5x input — so a single "total tokens" number cannot produce a cost. Every
 * provider already reports the split; this module keeps it intact, adds up
 * the calls that make one run, and prices the result.
 *
 * A WRONG cost is worse than no cost, and a silent $0 is the worst wrong cost:
 * budgets, run caps and alerts all read it as healthy spend. So a model with no
 * price on file is reported as `unpriced`, callers refuse to start billed work
 * on it, and recording tokens against it throws.
 */
'use strict';

const logger = require('../../Config/loggerConfig');

const UNPRICED_MODEL = 'unpriced_model';

/**
 * USD per 1,000,000 tokens, by model id. Vendor list prices as of 2026-09-10
 * (peak/standard tier where a vendor has several). Snapshot ids price like
 * their base model through the prefix match in priceFor.
 *
 * Prices change. Treat this as a default, not as the source of truth — the
 * LLM_PRICING override exists so a stale number can be corrected without a deploy.
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

    'gpt-6-astra': { input: 10, output: 50 },
    'gpt-5.6-sol': { input: 4, output: 20 },
    'gpt-5.6-terra': { input: 2, output: 12 },
    'gpt-5.6-luna': { input: 0.2, output: 1.2 },
    'gpt-5.5-pro': { input: 30, output: 180 },
    'gpt-5.5': { input: 5, output: 30 },
    'gpt-5.4-pro': { input: 30, output: 180 },
    'gpt-5.4-mini': { input: 0.75, output: 4.5 },
    'gpt-5.4-nano': { input: 0.2, output: 1.25 },
    'gpt-5.4': { input: 2.5, output: 15 },
    'gpt-5.2-pro': { input: 21, output: 168 },
    'gpt-5.2': { input: 1.75, output: 14 },
    'gpt-5.1': { input: 1.25, output: 10 },
    'gpt-5-pro': { input: 15, output: 120 },
    'gpt-5-mini': { input: 0.25, output: 2 },
    'gpt-5-nano': { input: 0.05, output: 0.4 },
    'gpt-5': { input: 1.25, output: 10 },
    'gpt-4.1-mini': { input: 0.4, output: 1.6 },
    'gpt-4.1-nano': { input: 0.1, output: 0.4 },
    'gpt-4.1': { input: 2, output: 8 },
    'gpt-4o-mini': { input: 0.15, output: 0.6 },
    'gpt-4o': { input: 2.5, output: 10 },
    'o3': { input: 2, output: 8 },
    'o4-mini': { input: 1.1, output: 4.4 },

    // deepseek-v4-flash is a retired alias served and billed as deepseek-flash;
    // deepseek-v4-pro keeps its own price until DeepSeek routes it to Flash too.
    'deepseek-flash': { input: 0.3, output: 1.2 },
    'deepseek-v4-flash': { input: 0.3, output: 1.2 },
    'deepseek-v4-pro': { input: 1.32, output: 3.96 },
    'deepseek-chat': { input: 0.27, output: 1.1 },
    'deepseek-reasoner': { input: 0.55, output: 2.19 },

    'gemini-3-pro': { input: 2, output: 12 },
    'gemini-3-flash': { input: 0.3, output: 2.5 },
    'gemini-3-flash-lite': { input: 0.1, output: 0.4 },
    'gemini-2.5-pro': { input: 1.25, output: 10 },
    'gemini-2.5-flash': { input: 0.3, output: 2.5 },
    'gemini-2.5-flash-lite': { input: 0.1, output: 0.4 },
};

/**
 * Operator-supplied prices, merged over the defaults. Read live because the
 * Instance console writes it into process.env without a restart.
 *
 * LLM_PRICING='{"gpt-4.1":{"input":2,"output":8},"my-local-llama":{"input":0,"output":0}}'
 *
 * An explicit zero is a price: it is how a self-hosted or free model is marked
 * as billed-at-nothing rather than unpriced.
 */
function parsePricing(raw) {
    const text = String(raw || '').trim();
    if (!text) return { prices: {}, errors: [] };
    let parsed;
    try {
        parsed = JSON.parse(text);
    } catch (error) {
        return { prices: {}, errors: [`not valid JSON: ${error && error.message ? error.message : error}`] };
    }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return { prices: {}, errors: ['must be an object of {"model": {"input": n, "output": n}}'] };
    const prices = {};
    const errors = [];
    Object.keys(parsed).forEach((key) => {
        const entry = parsed[key];
        const input = Number(entry && entry.input);
        const output = Number(entry && entry.output);
        if (Number.isFinite(input) && Number.isFinite(output) && input >= 0 && output >= 0) {
            prices[String(key).trim().toLowerCase()] = { input, output };
        } else {
            errors.push(`"${key}": input and output must both be non-negative numbers`);
        }
    });
    return { prices, errors };
}

let envCache = { raw: null, prices: {} };
function envPricing() {
    const raw = String(process.env.LLM_PRICING || '').trim();
    if (raw === envCache.raw) return envCache.prices;
    const { prices, errors } = parsePricing(raw);
    errors.forEach((message) => logger.error(`LLM_PRICING: ${message}`));
    envCache = { raw, prices };
    return prices;
}

const pricing = () => ({ ...DEFAULT_PRICING, ...envPricing() });

function emptyUsage() {
    return { inputTokens: 0, outputTokens: 0, totalTokens: 0 };
}

const int = (value) => {
    const n = Number(value);
    return Number.isFinite(n) && n > 0 ? Math.round(n) : 0;
};

/**
 * Pull the token split out of a provider's chat result. `totalTokens` is
 * recomputed from the two halves rather than trusted: a provider that reports
 * a total but no split would otherwise count tokens at zero cost.
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

function addUsage(tally, next) {
    const a = tally || emptyUsage();
    const b = next || emptyUsage();
    return {
        inputTokens: int(a.inputTokens) + int(b.inputTokens),
        outputTokens: int(a.outputTokens) + int(b.outputTokens),
        totalTokens: int(a.totalTokens) + int(b.totalTokens),
    };
}

const unpricedMessage = (model) => `No price on file for ${model || 'the configured model'}; add it under instance settings (LLM_PRICING) before running.`;

/**
 * The price sheet for a model id. Never a bare zero: a model we know nothing
 * about comes back `{ priced: false, reason: 'unpriced_model' }` so the caller
 * has to decide, not default to free.
 */
function priceFor(modelId) {
    const model = String(modelId || '').trim();
    const id = model.toLowerCase();
    const table = pricing();
    // Longest matching prefix so a dated snapshot (claude-sonnet-4-6-20260115)
    // prices like its base model and "gpt-5.4-mini" beats "gpt-5".
    const match = id && (table[id] ? id : Object.keys(table).filter((key) => id.startsWith(key)).sort((a, b) => b.length - a.length)[0]);
    if (!match) return { priced: false, model, reason: UNPRICED_MODEL, message: unpricedMessage(model) };
    return { priced: true, model, input: table[match].input, output: table[match].output };
}

/**
 * Price a tally.
 *
 * @returns {{inputTokens:number, outputTokens:number, totalTokens:number,
 *            model:string, costUsd:number|null, priced:boolean}}
 *          `costUsd` is null and `priced` false when the model has no price on
 *          file — the caller must not treat that as $0.
 */
function summarize(tally, modelId) {
    const added = addUsage(emptyUsage(), tally);
    const usage = {
        ...added,
        totalTokens: added.inputTokens + added.outputTokens || added.totalTokens,
    };
    const price = priceFor(modelId);
    if (!price.priced) {
        return { ...usage, model: String(modelId || ''), costUsd: null, priced: false, reason: UNPRICED_MODEL };
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

/** The model id the configured provider will send, or null when none is configured. */
function configuredModel() {
    try {
        const provider = require('./llmProvider').getProvider();
        return (provider && provider.model) || null;
    } catch (e) {
        return null;
    }
}

/**
 * Gate for anything about to spend tokens. A missing provider is not this
 * gate's problem (the call fails on its own with a clearer message); a
 * configured but unpriced model is refused here, before any token is bought.
 */
function checkConfiguredModelPriced() {
    const model = configuredModel();
    if (!model) return { ok: true, reason: '', model: null };
    const price = priceFor(model);
    if (price.priced) return { ok: true, reason: '', model };
    return { ok: false, reason: price.message, code: UNPRICED_MODEL, model };
}

module.exports = { emptyUsage, usageFromResult, addUsage, summarize, priceFor, parsePricing, configuredModel, checkConfiguredModelPriced, unpricedMessage, UNPRICED_MODEL, DEFAULT_PRICING };
