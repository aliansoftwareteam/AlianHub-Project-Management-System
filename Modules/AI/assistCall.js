'use strict';

const providerFactory = require('../AICore/llmProvider');
const { parseModelJson } = require('../AICore/modelCall');
const untrusted = require('../AICore/untrusted');
const { isAiOff } = require('../AICore/aiSwitch');
const logger = require('../../Config/loggerConfig');

/* One JSON answer for the task and editor assists. The workspace text goes in as data, never as
 * instructions, and the spend meter behind chat() books the call, holds the budget and refuses
 * while AI is off. */
async function askJson({ system, data, maxTokens, spend, temperature = 0.3 }) {
    if (!providerFactory.isAnyProviderConfigured()) return { ok: false, code: 'unconfigured', reason: 'No model is configured.' };
    try {
        const result = await providerFactory.getProvider().chat({
            systemPrompt: untrusted.withNotice(system),
            messages: [{ role: 'user', content: untrusted.wrap(data) }],
            jsonMode: true,
            temperature,
            maxTokens,
            spend,
        });
        const parsed = parseModelJson(result && result.content);
        return parsed.ok ? { ok: true, value: parsed.value || {} } : { ok: false, code: 'bad_answer', reason: parsed.error };
    } catch (error) {
        if (isAiOff(error)) return { ok: false, code: 'ai_off', reason: error.message };
        logger.error(`ai assist (${spend && spend.feature}): ${error.message}`);
        return { ok: false, code: 'model_failed', reason: error.message };
    }
}

/* Trimmed, de-duplicated (case-insensitively) and capped lines from a model's list. */
const cleanLines = (list, { max, maxLength }) => {
    const seen = new Set();
    const out = [];
    (Array.isArray(list) ? list : []).forEach((item) => {
        const line = String(typeof item === 'string' ? item : (item && (item.title || item.text)) || '').replace(/\s+/g, ' ').trim().slice(0, maxLength);
        const key = line.toLowerCase();
        if (!line || seen.has(key) || out.length >= max) return;
        seen.add(key);
        out.push(line);
    });
    return out;
};

const failure = (outcome) => ({ status: false, code: outcome.code, reason: outcome.reason });

module.exports = { askJson, cleanLines, failure };
