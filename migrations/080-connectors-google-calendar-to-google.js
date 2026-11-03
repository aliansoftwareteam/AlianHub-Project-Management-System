/* Moves each workspace's Google Calendar connections — the legacy `connector: 'google_calendar'` rows
 * Modules/Agents/connectors/googleConnection.js wrote — onto the connectors module's Google provider (064/066):
 * `provider: 'google'` with Calendar ticked, the secret handles and account renamed to the module shape. The grant
 * is untouched (same refresh token under the same secrets-store handle), so a migrated connection resolves through
 * resolveConnection and refreshes without the person reconnecting (FR-35). The legacy grants were all minted by the
 * instance app (CONNECTOR_GOOGLE_*), so the row records `app.source: 'instance'`.
 *
 * Cutover gate: it reshapes a row only once CONNECTORS no longer names the legacy `google_calendar` connector. While
 * that name is served the legacy googleController still reads rows by `connector`/`secretHandles`, and reshaping them
 * then would make every live Calendar connection look disconnected — so while it is named this is a no-op that still
 * records itself applied, to be re-run after the cutover (the gate pattern of 031-secrets-by-handle). That keeps 073
 * safe to ship on its own: the data moves only when the serving path has, never breaking a live grant.
 *
 * `down` reverses no data: once 066 is live a genuine new-flow Google connection is the same shape as a migrated one,
 * so no reverse could tell them apart. It only clears the record so a later `up` re-evaluates the gate — the
 * cutover (077) runs `npm run migrate -- down 080-connectors-google-calendar-to-google && npm run migrate -- up`.
 *
 * The reshape is idempotent: the `connector` field, which only legacy rows carry, both selects the rows and is unset
 * here, so a second run finds none. Slack's legacy rows (`connector: 'slack'`) are a different provider, left for 074. */

const ID = '080-connectors-google-calendar-to-google';
const LEGACY = 'google_calendar';
const PROVIDER = 'google';
const PRODUCTS = Object.freeze(['calendar']);

const legacyGoogleServed = () => require('../Modules/Agents/connectors/flag').requestedGoogle().length > 0;

const handlesOf = (secretHandles = {}) => {
    const handles = {};
    if (secretHandles.access_token) handles.access = secretHandles.access_token;
    if (secretHandles.refresh_token) handles.refresh = secretHandles.refresh_token;
    return handles;
};

async function migrateCompany(ctx, companyId, counts) {
    const type = ctx.SCHEMA_TYPE.CONNECTOR_CONNECTIONS;
    const rows = (await ctx.company(companyId, { type, data: [{ connector: LEGACY }] }, 'find')) || [];
    for (const row of rows) {
        const set = {
            companyId: String(companyId),
            provider: PROVIDER,
            products: [...PRODUCTS],
            handles: handlesOf(row.secretHandles),
            app: { source: 'instance', appId: null },
        };
        if (row.account && row.account.sub) set.account = { id: String(row.account.sub), label: String(row.account.email || '') };
        if (row.brokenReason != null) set.lastError = String(row.brokenReason);
        try {
            // eslint-disable-next-line no-await-in-loop
            await ctx.company(companyId, { type, data: [{ _id: row._id }, { $set: set, $unset: { connector: '', secretHandles: '', brokenReason: '' } }] }, 'updateOne');
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
    async up(ctx) {
        if (legacyGoogleServed()) {
            ctx.logger.info(`[migrations] ${ID}: CONNECTORS still names ${LEGACY}, so the legacy Google path is live; nothing migrated. After the cutover to 'google', re-run: npm run migrate -- down ${ID} && npm run migrate -- up`);
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
