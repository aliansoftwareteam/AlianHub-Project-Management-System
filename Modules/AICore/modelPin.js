/**
 * A model pinned to an agent or a skill, checked when it is saved.
 *
 * A pin that names a model with no price, or a model belonging to a provider
 * this instance has not configured, is refused here — at save time, with a
 * message naming the model — rather than at run time, where it would surface
 * as a failed run hours later and against a caller who did not set it.
 */
'use strict';

const usage = require('./usage');
const catalogue = require('./llmProvider/catalogue');
const { PROVIDER_NAMES } = require('./llmProvider/registry');

const MAX_LENGTH = 120;

const CODES = Object.freeze({
    UNPRICED: usage.UNPRICED_MODEL,
    UNKNOWN_PROVIDER: 'unknown_provider',
    PROVIDER_NOT_CONFIGURED: 'provider_not_configured',
});

/**
 * @returns {{ok: boolean, model: string|null, provider?: string, code?: string, message?: string}}
 *          `model` null is the cleared pin, which is always allowed: it means
 *          "whatever the policy or the configured provider decides".
 */
function validatePin(value) {
    const model = String(value == null ? '' : value).trim().slice(0, MAX_LENGTH);
    if (!model) return { ok: true, model: null };

    const priced = usage.ensurePriced(model);
    if (!priced.ok) return { ok: false, model, code: CODES.UNPRICED, message: priced.message };

    const provider = catalogue.providerOf(model);
    if (!provider) {
        return { ok: false, model, code: CODES.UNKNOWN_PROVIDER, message: `"${model}" is not served by any known provider (${PROVIDER_NAMES.join(', ')}). Pick a model from the list.` };
    }

    const entry = catalogue.entryFor(model);
    if (!entry.configured) {
        return { ok: false, model, provider, code: CODES.PROVIDER_NOT_CONFIGURED, message: `"${model}" needs the ${provider} provider, which is not configured on this instance. Add its API key and model under instance settings first.` };
    }

    return { ok: true, model, provider, tier: entry.tier };
}

module.exports = { validatePin, allowlist: catalogue.allowlist, CODES, MAX_LENGTH };
