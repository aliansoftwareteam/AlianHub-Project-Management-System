const logger = require('../../Config/loggerConfig');
const { getProvider, isAnyProviderConfigured } = require('./llmProvider');
const { emptyUsage, usageFromResult, addUsage } = require('./usage');
const { estimateCall } = require('./estimate');

const LOG_PREFIX = '[agent]';

/* Strip markdown fences some models wrap JSON in, then parse. A parse failure is
 * a failed run, never a silent empty result — silence would read as "clean page". */
function parseModelJson(raw) {
    const text = String(raw || '').trim().replace(/^```(?:json)?\s*/i, '').replace(/```$/, '').trim();
    try { return { ok: true, value: JSON.parse(text) }; }
    catch (e) { return { ok: false, error: `model did not return valid JSON: ${e.message}` }; }
}

/* The one model call. `raw` stays null when the provider is missing, fails or
 * answers with something that is not JSON; `degraded` says which.
 *
 * `budget.guard` ({ reserve, reconcile, release }) sees the estimated cost
 * before the vendor request: a refusal comes back as `refused` and nothing is
 * bought; a reservation is settled to the real cost after the call, or
 * released when the call throws. `spend` ({ feature, companyId, runId, userId,
 * account }) is the ledger context the core meter books the actual row under. */
async function askModel(skill, { prompt, budget, spend }) {
    let usage = emptyUsage();
    let raw = null; let model = null; let degraded = null; let refused = null;
    if (isAnyProviderConfigured() && budget.allowModel !== false) {
        const guard = budget.guard || null;
        let ticket = null;
        try {
            const provider = getProvider();
            const request = {
                systemPrompt: skill.systemPrompt,
                messages: [{ role: 'user', content: prompt }],
                maxTokens: Math.min(skill.maxTokens, budget.maxTokens || skill.maxTokens),
                temperature: 0.2,
                jsonMode: true,
                spend,
            };
            if (guard) {
                ticket = await guard.reserve(estimateCall({ ...request, model: provider.model }));
                if (!ticket.ok) return { raw, model: provider.model || null, degraded: ticket.reason, refused: ticket, usage };
            }
            const result = await provider.chat(request);
            usage = addUsage(usage, usageFromResult(result));
            model = result.model || null;
            if (ticket) { const settled = ticket; ticket = null; await guard.reconcile(settled, usage, model); }
            const parsed = parseModelJson(result.content);
            if (parsed.ok) raw = parsed.value; else degraded = parsed.error;
        } catch (error) {
            degraded = `model call failed: ${error.message}`;
            logger.error(`${LOG_PREFIX} ${degraded}`);
            if (ticket) await guard.release(ticket).catch((e) => logger.error(`${LOG_PREFIX} reservation not released: ${e.message}`));
        }
    } else {
        degraded = 'no LLM provider configured';
    }
    return { raw, model, degraded, refused, usage };
}

module.exports = { askModel, parseModelJson };
