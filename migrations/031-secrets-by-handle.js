/* Moves the integration secrets sealed into integration_connections.config and the webhook signing secrets
 * on webhooks into the per-company secrets store, leaving a handle behind, when SECRETS_STORE is on at the
 * time it runs. With the flag off it moves nothing and records itself as applied; re-run it once the flag is
 * on with `npm run migrate -- down 031-secrets-by-handle --confirm && npm run migrate -- up`. */

const ID = '031-secrets-by-handle';
const REFUSAL = 'Rolling back moves every stored integration and webhook secret back onto its document. Re-run with --confirm to do it.';
const ACTOR = { id: `migration:${ID}` };

const deps = () => ({
    store: require('../Config/secrets'),
    R: require('../Modules/Integrations/helpers/integrationsRules'),
    secretName: require('../Modules/Integrations/helpers/secretHandles').secretName,
    secretField: require('../utils/secretField'),
});

const revokeQuietly = (store, companyId, handle) => store.revoke({ companyId, handle, actor: ACTOR }).catch((error) => {
    if (!['revoked', 'not_found', 'store_off'].includes(error.code)) throw error;
});

async function moveConnections(ctx, companyId, counts) {
    const { store, R, secretName, secretField } = deps();
    const type = ctx.SCHEMA_TYPE.INTEGRATION_CONNECTIONS;
    const rows = await ctx.company(companyId, { type, data: [{}] }, 'find') || [];
    for (const row of rows) {
        const item = R.byKey(row.type);
        if (row.deletedStatusKey === 1 || !item) { counts.skipped += 1; continue; }
        const config = { ...(row.config || {}) };
        const handles = { ...(row.secretHandles || {}) };
        let moved = 0;
        for (const field of (item.fields || []).filter((f) => f.secret)) {
            const stored = config[field.key];
            if (!stored || handles[field.key]) continue;
            const value = secretField.decrypt(stored);
            if (value === null || value === '') { counts.unreadable += 1; continue; }
            const made = await store.create({ companyId, name: secretName(item, field), kind: 'integration', value, actor: ACTOR });
            handles[field.key] = made.handle;
            delete config[field.key];
            moved += 1;
        }
        if (!moved) { counts.skipped += 1; continue; }
        await ctx.company(companyId, { type, data: [{ _id: row._id }, { $set: { config, secretHandles: handles } }] }, 'updateOne');
        counts.connections += 1;
    }
}

async function moveWebhooks(ctx, companyId, counts) {
    const { store } = deps();
    const type = ctx.SCHEMA_TYPE.WEBHOOKS;
    const hooks = await ctx.company(companyId, { type, data: [{ secretHandle: { $exists: false }, secret: { $type: 'string' } }] }, 'find') || [];
    for (const hook of hooks) {
        if (!hook.secret) { counts.skipped += 1; continue; }
        const made = await store.create({ companyId, name: `Webhook: ${hook.name}`, kind: 'webhook', value: hook.secret, actor: ACTOR });
        await ctx.company(companyId, { type, data: [{ _id: hook._id }, { $set: { secretHandle: made.handle }, $unset: { secret: '' } }] }, 'updateOne');
        counts.webhooks += 1;
    }
}

async function restoreConnections(ctx, companyId, counts) {
    const { store, R } = deps();
    const type = ctx.SCHEMA_TYPE.INTEGRATION_CONNECTIONS;
    const rows = await ctx.company(companyId, { type, data: [{ secretHandles: { $exists: true } }] }, 'find') || [];
    for (const row of rows) {
        const config = { ...(row.config || {}) };
        const handles = Object.entries(row.secretHandles || {});
        const values = await Promise.all(handles.map(([, handle]) => store.resolve({ companyId, handle })));
        if (values.some((value) => value === null)) { counts.unresolved += 1; continue; }
        handles.forEach(([key], i) => { config[key] = values[i]; });
        await ctx.company(companyId, { type, data: [{ _id: row._id }, { $set: { config: R.sealConfig(row.type, config), secretsVersion: R.SECRETS_VERSION }, $unset: { secretHandles: '' } }] }, 'updateOne');
        for (const [, handle] of handles) await revokeQuietly(store, companyId, handle);
        counts.connections += 1;
    }
}

async function restoreWebhooks(ctx, companyId, counts) {
    const { store } = deps();
    const type = ctx.SCHEMA_TYPE.WEBHOOKS;
    const hooks = await ctx.company(companyId, { type, data: [{ secretHandle: { $exists: true } }] }, 'find') || [];
    for (const hook of hooks) {
        const value = await store.resolve({ companyId, handle: hook.secretHandle });
        if (value === null) { counts.unresolved += 1; continue; }
        await ctx.company(companyId, { type, data: [{ _id: hook._id }, { $set: { secret: value }, $unset: { secretHandle: '' } }] }, 'updateOne');
        await revokeQuietly(store, companyId, hook.secretHandle);
        counts.webhooks += 1;
    }
}

module.exports = {
    id: ID,
    scope: 'company',
    async up(ctx) {
        const cfg = deps().store.config();
        if (!cfg.requested) {
            ctx.logger.info(`[migrations] 031: SECRETS_STORE is off, so nothing moved; to re-run once it is on: npm run migrate -- down ${ID} --confirm && npm run migrate -- up`);
            return;
        }
        if (!cfg.keyValid) {
            ctx.logger.error(`[migrations] 031: ${cfg.error}; nothing moved`);
            return;
        }
        await ctx.forEachCompany(async (companyId) => {
            await ctx.company(companyId, { type: ctx.SCHEMA_TYPE.SECRETS, data: [] }, 'createIndexes');
            const counts = { connections: 0, webhooks: 0, skipped: 0, unreadable: 0 };
            await moveConnections(ctx, companyId, counts);
            await moveWebhooks(ctx, companyId, counts);
            ctx.logger.info(`[migrations] 031 ${companyId}: ${JSON.stringify(counts)}`);
            return counts;
        });
    },
    async down(ctx, { confirmed } = {}) {
        if (confirmed !== true) throw new Error(REFUSAL);
        await ctx.forEachCompany(async (companyId) => {
            const counts = { connections: 0, webhooks: 0, unresolved: 0 };
            await restoreConnections(ctx, companyId, counts);
            await restoreWebhooks(ctx, companyId, counts);
            ctx.logger.info(`[migrations] 031 ${companyId} rolled back: ${JSON.stringify(counts)}`);
            return counts;
        });
    },
};
