/* Moves each workspace's Google Calendar connections — the legacy `connector: 'google_calendar'` rows
 * the old Google Calendar connector wrote — onto the connectors module's Google provider (064/066):
 * `provider: 'google'` with Calendar ticked, the secret handles and account renamed to the module shape. The grant
 * is untouched (same refresh token under the same secrets-store handle), so a migrated connection resolves through
 * resolveConnection and refreshes without the person reconnecting (FR-35). The legacy grants were all minted by the
 * instance app (CONNECTOR_GOOGLE_*), so the row records `app.source: 'instance'`.
 *
 * Cutover gate: it reshapes a row only once CONNECTORS serves the new `google` provider and no longer names the legacy
 * `google_calendar` connector — the registry offers a provider only when CONNECTORS names its id, so this is the moment
 * the serving path has moved. Before then (legacy still named, or neither served on a default boot) the old
 * connector still read rows by `connector`/`secretHandles`, and reshaping would have made every live Calendar
 * connection look disconnected — so until the cutover this is a no-op that still records itself applied (the gate
 * pattern of 031-secrets-by-handle). The old connector is gone since 077, and 087 reshapes whatever this left.
 *
 * `down` reverses no data: once 066 is live a genuine new-flow Google connection is the same shape as a migrated one,
 * so no reverse could tell them apart. It only clears the record so a later `up` re-evaluates the gate.
 *
 * The reshape is idempotent: the `connector` field, which only legacy rows carry, both selects the rows and is unset
 * here, so a second run finds none. Slack's legacy rows (`connector: 'slack'`) are a different provider, left for 074. */

const ID = '081-connectors-google-calendar-to-google';
const LEGACY = 'google_calendar';
const PROVIDER = 'google';
const PRODUCTS = Object.freeze(['calendar']);

const cutOverReady = () => {
    const named = require('../Modules/Agents/connectors/flag').named();
    return named.includes(PROVIDER) && !named.includes(LEGACY);
};

const handlesOf = (secretHandles = {}) => {
    const handles = {};
    if (secretHandles.access_token) handles.access = secretHandles.access_token;
    if (secretHandles.refresh_token) handles.refresh = secretHandles.refresh_token;
    return handles;
};

const reshapeOf = (companyId, row) => {
    const set = {
        companyId: String(companyId),
        provider: PROVIDER,
        products: [...PRODUCTS],
        handles: handlesOf(row.secretHandles),
        app: { source: 'instance', appId: null },
    };
    if (row.account && row.account.sub) set.account = { id: String(row.account.sub), label: String(row.account.email || '') };
    if (row.brokenReason != null) set.lastError = String(row.brokenReason);
    return { $set: set, $unset: { connector: '', secretHandles: '', brokenReason: '' } };
};

async function migrateCompany(ctx, companyId, counts) {
    const type = ctx.SCHEMA_TYPE.CONNECTOR_CONNECTIONS;
    const rows = (await ctx.company(companyId, { type, data: [{ connector: LEGACY }] }, 'find')) || [];
    for (const row of rows) {
        try {
            // eslint-disable-next-line no-await-in-loop
            await ctx.company(companyId, { type, data: [{ _id: row._id }, reshapeOf(companyId, row)] }, 'updateOne');
            counts.migrated += 1;
        } catch (error) {
            // A live account already on the Google provider trips the unique index; that row keeps its grant and the rest go on.
            counts.conflicts += 1;
            ctx.logger.error(`[migrations] ${ID} ${companyId}: ${row._id} not migrated: ${(error && error.message) || error}`);
        }
    }
}

module.exports = {
    id: ID,
    scope: 'company',
    LEGACY,
    reshapeOf,
    async up(ctx) {
        if (!cutOverReady()) {
            ctx.logger.info(`[migrations] ${ID}: holding — the data moves only once CONNECTORS names '${PROVIDER}' and no longer names '${LEGACY}'; nothing migrated here, and 083 reshapes the rows this leaves.`);
            return;
        }
        await ctx.forEachCompany(async (companyId) => {
            const counts = { migrated: 0, conflicts: 0 };
            await migrateCompany(ctx, companyId, counts);
            ctx.logger.info(`[migrations] ${ID} ${companyId}: ${JSON.stringify(counts)}`);
            return counts;
        });
    },
    async down(ctx) {
        ctx.logger.info(`[migrations] ${ID}: down reverses no data (a reshaped row cannot be told from a new-flow connection); it clears the record so the next up re-evaluates the cutover gate.`);
    },
};
