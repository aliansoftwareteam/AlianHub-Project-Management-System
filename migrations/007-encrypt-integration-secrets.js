const R = require('../Modules/Integrations/helpers/integrationsRules');
const { isEncrypted, decrypt } = require('../utils/secretField');

/* Integration credentials (GitHub/GitLab tokens, Slack verification token, OAuth
 * client secrets, webhook URLs) were saved as plaintext. Seals every secret config
 * key of every connection, in every company database, and stamps secretsVersion
 * so a re-run only touches rows written before this. Rows with no secret field
 * are stamped too, so status reads as fully migrated. */

const REFUSAL = 'Rolling back writes every integration secret back to plaintext. Re-run with --confirm to do it.';

const forEachConnection = (ctx, fn) => ctx.forEachCompany(async (companyId) => {
    const rows = await ctx.company(companyId, { type: ctx.SCHEMA_TYPE.INTEGRATION_CONNECTIONS, data: [{}] }, 'find') || [];
    const counts = { encrypted: 0, stamped: 0, skipped: 0, decrypted: 0 };
    for (const row of rows) counts[await fn(companyId, row)] += 1;
    ctx.logger.info(`[migrations] 007 ${companyId}: ${JSON.stringify(counts)}`);
    return counts;
});

const write = (ctx, companyId, row, set) => ctx.company(companyId, {
    type: ctx.SCHEMA_TYPE.INTEGRATION_CONNECTIONS, data: [{ _id: row._id }, { $set: set }],
}, 'updateOne');

module.exports = {
    id: '007-encrypt-integration-secrets',
    scope: 'company',
    async up(ctx) {
        await forEachConnection(ctx, async (companyId, row) => {
            if (row.secretsVersion === R.SECRETS_VERSION) return 'skipped';
            const config = row.config || {};
            const pending = R.secretKeys(row.type).filter((k) => config[k] && !isEncrypted(config[k]));
            const set = { secretsVersion: R.SECRETS_VERSION };
            if (pending.length) set.config = R.sealConfig(row.type, config);
            await write(ctx, companyId, row, set);
            return pending.length ? 'encrypted' : 'stamped';
        });
    },
    async down(ctx, { confirmed } = {}) {
        if (confirmed !== true) throw new Error(REFUSAL);
        await forEachConnection(ctx, async (companyId, row) => {
            if (row.secretsVersion !== R.SECRETS_VERSION) return 'skipped';
            const config = { ...(row.config || {}) };
            for (const k of R.secretKeys(row.type)) {
                if (!isEncrypted(config[k])) continue;
                const plain = decrypt(config[k]);
                if (plain === null) throw new Error(`${row.type} ${row._id}: secret "${k}" does not decrypt with the current key`);
                config[k] = plain;
            }
            await write(ctx, companyId, row, { config, secretsVersion: 0 });
            return 'decrypted';
        });
    },
};
