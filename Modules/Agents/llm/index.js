// Agents — model access.
//
// Deliberately NOT its own provider layer. This is a thin adapter over the shared
// AIProjectGenerator/llmProvider factory — the same one behind the project
// generator, Write with AI, the time estimator and the workload summary. The
// operator selects a provider once with LLM_PROVIDER and every AI feature,
// agents included, follows that choice.
//
// So there are no agent-specific provider or key settings. Configuration is
// exactly what the rest of the app already uses:
//
//   LLM_PROVIDER        openai | anthropic | deepseek
//   AI_API_KEY + AI_MODEL            (openai)
//   ANTHROPIC_API_KEY + ANTHROPIC_MODEL
//   DEEPSEEK_API_KEY + DEEPSEEK_MODEL
//
// Reached by the same lazy require the other consumers use, so a missing or
// broken provider layer degrades to "not configured" instead of preventing this
// module from loading at all.
const logger = require('../../../Config/loggerConfig');

let providerFactory = null;
try {
    providerFactory = require('../../AIProjectGenerator/llmProvider');
} catch (e) {
    providerFactory = null;
}

const LOG_PREFIX = '[agents:llm]';

// The shared providers set generous SDK timeouts (Anthropic defaults to ten
// minutes) because a project plan legitimately takes that long. An agent writing
// a two-sentence comment does not, and Test is a button someone is waiting on, so
// this caps the wait independently rather than raising anyone else's ceiling.
//
// 60s was too tight in practice. A reasoning model — deepseek-reasoner, the v4
// "thinking" variants, the o-series — spends most of its time before emitting any
// output, and observed runs were being killed at 60s mid-thought and logged as
// failures when the model was working normally. 180s leaves room for that while
// still failing fast enough to be worth waiting for.
const REQUEST_TIMEOUT_MS = Number(process.env.AGENT_LLM_TIMEOUT_MS) || 180_000;

// Which model will actually be used — for display, so the settings page can name
// it. Read from the same place each provider reads it: openai and deepseek go
// through Config/config (a snapshot taken at boot), anthropic reads process.env
// live. Mirroring them means the page never shows a model the provider would not
// use.
const modelOf = (name) => {
    if (name === 'anthropic') return String(process.env.ANTHROPIC_MODEL || '').trim();
    let config = null;
    try {
        config = require('../../../Config/config');
    } catch (e) {
        config = null;
    }
    if (name === 'openai') return String((config && config.AI_MODEL) || '').trim();
    if (name === 'deepseek') return String((config && config.DEEPSEEK_MODEL) || '').trim();
    return '';
};

/**
 * Resolve the configured provider, or explain why there isn't one.
 *
 * Returns { provider } or { reason }. The reason is the provider layer's own
 * message wherever possible — it already distinguishes "LLM_PROVIDER names a
 * provider you haven't given a key to" from "nothing is configured at all", and
 * those need different fixes.
 */
const resolve = () => {
    if (!providerFactory || typeof providerFactory.getProvider !== 'function') {
        return { reason: 'The AI provider layer is unavailable, so agents cannot reach a model.' };
    }
    if (typeof providerFactory.isAnyProviderConfigured === 'function' && !providerFactory.isAnyProviderConfigured()) {
        return { reason: 'No AI provider is configured. Set LLM_PROVIDER and the matching API key and model in your environment.' };
    }
    try {
        return { provider: providerFactory.getProvider() };
    } catch (e) {
        return { reason: (e && e.message) || 'The configured AI provider could not be loaded.' };
    }
};

/** Is a model reachable at all? The UI asks so it can say so before a run fails. */
const status = () => {
    const { provider, reason } = resolve();
    if (!provider) return { ready: false, provider: String(process.env.LLM_PROVIDER || '').trim(), reason };
    return { ready: true, provider: provider.name, model: modelOf(provider.name) };
};

/**
 * One completion. Resolves { ok, text, tokensIn, tokensOut } or { ok:false, error }.
 *
 * Never throws and never rejects: a model outage must surface as a failed run with
 * a readable reason, not as an exception climbing out of the runner and into the
 * process-level unhandledRejection handler.
 */
const complete = async ({ system, prompt, maxTokens = 1200 }) => {
    const { provider, reason } = resolve();
    if (!provider) return { ok: false, error: reason, tokensIn: 0, tokensOut: 0 };

    try {
        const result = await Promise.race([
            provider.chat({
                systemPrompt: system,
                messages: [{ role: 'user', content: prompt }],
                // Low: an agent's job is to be accurate about what it just read,
                // not inventive. Not zero — a triage note reads better with a
                // little variation than a template would.
                temperature: 0.3,
                maxTokens,
            }),
            new Promise((_, reject) => setTimeout(
                () => reject(new Error(`The model did not respond within ${Math.round(REQUEST_TIMEOUT_MS / 1000)} seconds.`)),
                REQUEST_TIMEOUT_MS,
            )),
        ]);

        const text = String((result && result.content) || '').trim();
        const tokensIn = Number(result && result.inputTokens) || 0;
        const tokensOut = Number(result && result.outputTokens) || 0;

        if (!text) return { ok: false, error: 'The model returned an empty response.', tokensIn, tokensOut };

        // Shouldn't happen for a comment-length reply, but if the cap did bite,
        // say so rather than posting a sentence that stops mid-word.
        if (result && result.truncated) {
            logger.error(`${LOG_PREFIX} ${provider.name} hit the output cap at ${maxTokens} tokens`);
        }

        return { ok: true, text, tokensIn, tokensOut };
    } catch (e) {
        // The shared providers already map rate limits, exhausted credit and bad
        // keys to readable messages, so pass theirs through unchanged — a generic
        // "request failed" makes a wrong key indistinguishable from a rate limit.
        const detail = (e && e.message) || 'The model request failed.';
        logger.error(`${LOG_PREFIX} ${provider.name}${e && e.code ? ` [${e.code}]` : ''}: ${detail}`);
        return { ok: false, error: detail, tokensIn: 0, tokensOut: 0 };
    }
};

module.exports = { status, complete };
