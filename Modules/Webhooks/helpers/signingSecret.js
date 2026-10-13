const store = require('../../../Config/secrets');
const logger = require('../../../Config/loggerConfig');

/* The HMAC secret of a webhook: by handle in the store when SECRETS_STORE is on, on the row otherwise, never both. */

const NEEDS_ATTENTION = 'signing_secret_unavailable';

async function storeSigningSecret({ companyId, name, secret, actor }) {
    const cfg = store.config();
    if (cfg.requested && !cfg.keyValid) throw new store.SecretsStoreError('key_invalid', cfg.error);
    if (!cfg.on) return { secret };
    const made = await store.create({ companyId, name: `Webhook: ${name}`, kind: 'webhook', value: secret, actor });
    return { secretHandle: made.handle };
}

async function signingSecretOf(companyId, hook) {
    if (!hook.secretHandle) return hook.secret || null;
    if (hook.secret) {
        logger.error(`[secrets] webhook ${hook._id} holds both a handle and a secret on its row, so it is not signed; delete it and add it again`);
        return null;
    }
    return store.resolve({ companyId, handle: hook.secretHandle }).catch(() => null);
}

async function revokeSigningSecret({ companyId, hook, actor }) {
    if (!hook || !hook.secretHandle) return;
    await store.retire({ companyId, handle: hook.secretHandle, actor });
}

module.exports = { NEEDS_ATTENTION, storeSigningSecret, signingSecretOf, revokeSigningSecret };
