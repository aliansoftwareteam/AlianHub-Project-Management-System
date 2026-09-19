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
    H: require('../Modules/Integrations/helpers/secretHandles'),
    secretField: require('../utils/secretField'),
});

/* A sealed value beside a handle was saved after the handle (a write by handle always removes the sealed copy),
 * so it is the current one: up moves it onto that handle, down keeps it. */
async function moveConnections(ctx, companyId, counts) {
    const { R, H, secretField } = deps();
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
            if (!stored) continue;
            const value = secretField.decrypt(stored);
            if (value === null || value === '') { counts.unreadable += 1; continue; }
            handles[field.key] = await H.keep({ companyId, handle: handles[field.key], name: H.secretName(item, field), value, actor: ACTOR });
            delete config[field.key];
            moved += 1;
        }
        if (!moved) { counts.skipped += 1; continue; }
        await ctx.company(companyId, { type, data: [{ _id: row._id }, { $set: { config, secretHandles: handles } }] }, 'updateOne');
        counts.connections += 1;
    }
}

async function moveWebhooks(ctx, companyId, counts) {
    const { H } = deps();
    const type = ctx.SCHEMA_TYPE.WEBHOOKS;
    const hooks = await ctx.company(companyId, { type, data: [{ secret: { $type: 'string' } }] }, 'find') || [];
    for (const hook of hooks) {
        if (!hook.secret) { counts.skipped += 1; continue; }
        const secretHandle = await H.keep({ companyId, handle: hook.secretHandle, name: `Webhook: ${hook.name}`, kind: 'webhook', value: hook.secret, actor: ACTOR });
        await ctx.company(companyId, { type, data: [{ _id: hook._id }, { $set: { secretHandle }, $unset: { secret: '' } }] }, 'updateOne');
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
        const missing = handles.filter(([key]) => !config[key]);
        const values = await Promise.all(missing.map(([, handle]) => store.resolve({ companyId, handle })));
        if (values.some((value) => value === null)) { counts.unresolved += 1; continue; }
        missing.forEach(([key], i) => { config[key] = values[i]; });
        await ctx.company(companyId, { type, data: [{ _id: row._id }, { $set: { config: R.sealConfig(row.type, config), secretsVersion: R.SECRETS_VERSION }, $unset: { secretHandles: '' } }] }, 'updateOne');
        for (const [, handle] of handles) await store.retire({ companyId, handle, actor: ACTOR });
        counts.connections += 1;
    }
}

async function restoreWebhooks(ctx, companyId, counts) {
    const { store } = deps();
    const type = ctx.SCHEMA_TYPE.WEBHOOKS;
    const hooks = await ctx.company(companyId, { type, data: [{ secretHandle: { $exists: true } }] }, 'find') || [];
    for (const hook of hooks) {
        const value = hook.secret || await store.resolve({ companyId, handle: hook.secretHandle });
        if (value === null) { counts.unresolved += 1; continue; }
        await ctx.company(companyId, { type, data: [{ _id: hook._id }, { $set: { secret: value }, $unset: { secretHandle: '' } }] }, 'updateOne');
        await store.retire({ companyId, handle: hook.secretHandle, actor: ACTOR });
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
            const counts = { connections: 0, webhooks: 0, skipped: 0, unreadable: 0, orphansRevoked: 0 };
            counts.orphansRevoked = await deps().store.revokeOrphans({ companyId, actor: ACTOR });
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
