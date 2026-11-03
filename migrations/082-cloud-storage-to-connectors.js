/* Retires the legacy per-person cloud-storage picker (Modules/CloudStorage) in favour of the connectors module
 * (076, FR-39). Each `cloud_storage_connections` row held that person's OWN OAuth app — the client id and, in the
 * clear, the client secret — plus their grant. Under the module the app is the instance's or company's, never a
 * person's, so those grants cannot be carried over: the person reconnects once on My connections (072). This
 * migration therefore deletes the stored client secrets (the unsealed `config`) and the tokens, and closes the
 * row. Linked attachments already on tasks keep working (they carry the file id, not a connection), and files
 * imported as copies are ordinary uploads, so nothing of the person's data is lost.
 *
 * Cutover gate, per provider (the 080 pattern): a row is cleared only once CONNECTORS serves the module provider
 * that replaces it — `google` for `google_drive`, `dropbox` for `dropbox`. Before then the old picker is still the
 * only one a person has, so clearing their credentials would stranded them with no picker; the migration holds and
 * records itself applied, to be re-run after the cutover.
 *
 * Idempotent: `status: 'migrated'` both marks a cleared row and excludes it from a second run, so running twice
 * clears nothing the second time. `down` restores no data — the secrets are gone and cannot be un-deleted — it only
 * clears the record so a later `up` re-evaluates the gate. */

const ID = '082-cloud-storage-to-connectors';
const PAIRS = Object.freeze([
    { source: 'google_drive', provider: 'google' },
    { source: 'dropbox', provider: 'dropbox' },
]);

const served = () => {
    const flag = require('../Modules/Agents/connectors/flag');
    const named = flag.named();
    return PAIRS.filter((pair) => named.includes(pair.provider));
};

async function clearCompany(ctx, companyId, pairs, counts) {
    const type = ctx.SCHEMA_TYPE.CLOUD_STORAGE_CONNECTIONS;
    for (const pair of pairs) {
        const filter = { provider: pair.source, status: { $ne: 'migrated' } };
        const change = { $set: { config: {}, accessToken: '', refreshToken: '', expiresAt: null, status: 'migrated', deletedStatusKey: 1 } };
        // eslint-disable-next-line no-await-in-loop
        const res = await ctx.company(companyId, { type, data: [filter, change] }, 'updateMany');
        counts[pair.source] = (counts[pair.source] || 0) + (res && (res.modifiedCount || res.nModified || 0));
    }
}

module.exports = {
    id: ID,
    scope: 'company',
    async up(ctx) {
        const pairs = served();
        if (!pairs.length) {
            ctx.logger.info(`[migrations] ${ID}: holding — CONNECTORS serves neither 'google' nor 'dropbox', so the module picker is not yet live; clearing the old per-person credentials would leave people with no picker. Re-run after the cutover: npm run migrate -- down ${ID} && npm run migrate -- up`);
            return;
        }
        await ctx.forEachCompany(async (companyId) => {
            const counts = {};
            await clearCompany(ctx, companyId, pairs, counts);
            ctx.logger.info(`[migrations] ${ID} ${companyId}: cleared ${JSON.stringify(counts)} (served: ${pairs.map((p) => p.provider).join(', ')})`);
            return counts;
        });
    },
    async down(ctx) {
        ctx.logger.info(`[migrations] ${ID}: down restores no data (deleted client secrets cannot be un-deleted); it clears the record so the next up re-evaluates the per-provider cutover gate.`);
    },
};
