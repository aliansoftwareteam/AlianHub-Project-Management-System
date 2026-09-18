const store = require('../../../Config/secrets');

/* The HMAC secret of a webhook: by handle in the store when SECRETS_STORE is on, on the row otherwise. */

async function storeSigningSecret({ companyId, name, secret, actor }) {
    if (!store.isOn()) return { secret };
    const made = await store.create({ companyId, name: `Webhook: ${name}`, kind: 'webhook', value: secret, actor });
    return { secretHandle: made.handle };
}

async function signingSecretOf(companyId, hook) {
    if (!hook.secretHandle) return hook.secret || null;
    return store.resolve({ companyId, handle: hook.secretHandle }).catch(() => null);
}

async function revokeSigningSecret({ companyId, hook, actor }) {
    if (!hook || !hook.secretHandle) return;
    await store.revoke({ companyId, handle: hook.secretHandle, actor }).catch((error) => {
        if (!['revoked', 'not_found', 'store_off'].includes(error.code)) throw error;
    });
}

module.exports = { storeSigningSecret, signingSecretOf, revokeSigningSecret };
