const logger = require('../../Config/loggerConfig');
const { getProvider, isAnyProviderConfigured } = require('./llmProvider');
const { emptyUsage, usageFromResult, addUsage } = require('./usage');
const { estimateCall } = require('./estimate');
const { isProviderError } = require('./providerError');
const telemetry = require('../../Config/telemetry');

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
    let raw = null; let model = null; let degraded = null; let refused = null; let error = null;
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
            const attributes = {
                'gen_ai.operation.name': 'chat', 'gen_ai.system': provider.name || null, 'gen_ai.request.model': provider.model || null,
                'gen_ai.request.max_tokens': request.maxTokens, 'gen_ai.request.temperature': request.temperature,
            };
            const result = await telemetry.withSpan(`chat ${provider.model || ''}`.trim(), attributes, async (span) => {
                const answer = await provider.chat(request);
                const counted = usageFromResult(answer);
                span.setAttributes({ 'gen_ai.response.model': answer.model || null, 'gen_ai.usage.input_tokens': counted.inputTokens, 'gen_ai.usage.output_tokens': counted.outputTokens });
                return answer;
            });
            usage = addUsage(usage, usageFromResult(result));
            model = result.model || null;
            if (ticket) { const settled = ticket; ticket = null; await guard.reconcile(settled, usage, model); }
            const parsed = parseModelJson(result.content);
            if (parsed.ok) raw = parsed.value; else degraded = parsed.error;
        } catch (thrown) {
            degraded = `model call failed: ${thrown.message}`;
            if (isProviderError(thrown)) error = thrown;
            logger.error(`${LOG_PREFIX} ${degraded}${error ? ` [${error.groupKey()}]` : ''}`);
            if (ticket) await guard.release(ticket).catch((e) => logger.error(`${LOG_PREFIX} reservation not released: ${e.message}`));
        }
    } else {
        degraded = 'no LLM provider configured';
    }
    return { raw, model, degraded, refused, usage, error };
}

module.exports = { askModel, parseModelJson };
