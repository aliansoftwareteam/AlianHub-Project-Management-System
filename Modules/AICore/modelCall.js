const logger = require('../../Config/loggerConfig');
const { getProvider, isAnyProviderConfigured } = require('./llmProvider');
const { emptyUsage, usageFromResult, addUsage } = require('./usage');

const LOG_PREFIX = '[agent]';

/* Strip markdown fences some models wrap JSON in, then parse. A parse failure is
 * a failed run, never a silent empty result — silence would read as "clean page". */
function parseModelJson(raw) {
    const text = String(raw || '').trim().replace(/^```(?:json)?\s*/i, '').replace(/```$/, '').trim();
    try { return { ok: true, value: JSON.parse(text) }; }
    catch (e) { return { ok: false, error: `model did not return valid JSON: ${e.message}` }; }
}

/* The one model call. `raw` stays null when the provider is missing, fails or
 * answers with something that is not JSON; `degraded` says which. */
async function askModel(skill, { prompt, budget }) {
    let usage = emptyUsage();
    let raw = null; let model = null; let degraded = null;
    if (isAnyProviderConfigured() && budget.allowModel !== false) {
        try {
            const provider = getProvider();
            const result = await provider.chat({
                systemPrompt: skill.systemPrompt,
                messages: [{ role: 'user', content: prompt }],
                maxTokens: Math.min(skill.maxTokens, budget.maxTokens || skill.maxTokens),
                temperature: 0.2,
                jsonMode: true,
            });
            usage = addUsage(usage, usageFromResult(result));
            model = result.model || null;
            const parsed = parseModelJson(result.content);
            if (parsed.ok) raw = parsed.value; else degraded = parsed.error;
        } catch (error) {
            degraded = `model call failed: ${error.message}`;
            logger.error(`${LOG_PREFIX} ${degraded}`);
        }
    } else {
        degraded = 'no LLM provider configured';
    }
    return { raw, model, degraded, usage };
}

module.exports = { askModel, parseModelJson };
