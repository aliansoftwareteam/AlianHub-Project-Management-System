const store = require('../Config/secrets');
const calendar = require('./080-connectors-google-calendar-to-google');
const cloud = require('./082-cloud-storage-to-connectors');

/* The old Google Calendar connector and the old per-person cloud-storage picker were removed (077), so nothing reads
 * their rows any more. 080 and 082 held while CONNECTORS still served the old paths, and recorded themselves applied,
 * so they can have left rows behind; this finishes both, with no gate.
 *
 * A Calendar row is reshaped onto the Google provider as 080 does, so its grant works as soon as CONNECTORS names
 * google. A row whose account the person had already connected on the module trips the unique index: it is a
 * duplicate, so its tokens are retired in the secrets store and it is reshaped closed. Google is not asked to revoke
 * it, because that would end the live connection's grant as well.
 *
 * Every cloud-storage row 082 did not clear loses its stored client secret and tokens, and is closed.
 *
 * Both halves select only rows they have not handled yet, so a second run changes nothing. No `down`: retired
 * tokens and deleted secrets cannot come back. */

const ID = '085-connectors-finish-legacy-cutover';
const ACTOR = Object.freeze({ id: 'system' });

const isDuplicateKey = (error) => !!error && (error.code === 11000 || /E11000|duplicate key/i.test(String(error.message || '')));

async function finishCalendar(ctx, companyId) {
    const type = ctx.SCHEMA_TYPE.CONNECTOR_CONNECTIONS;
    const rows = (await ctx.company(companyId, { type, data: [{ connector: calendar.LEGACY }] }, 'find')) || [];
    const counts = { calendarMoved: 0, calendarClosed: 0 };
    for (const row of rows) {
        const change = calendar.reshapeOf(companyId, row);
        try {
            // eslint-disable-next-line no-await-in-loop
            await ctx.company(companyId, { type, data: [{ _id: row._id }, change] }, 'updateOne');
            counts.calendarMoved += 1;
        } catch (error) {
            if (!isDuplicateKey(error)) throw error;
            for (const handle of Object.values(row.secretHandles || {}).filter(Boolean)) {
                // eslint-disable-next-line no-await-in-loop
                await store.retire({ companyId, handle, actor: ACTOR });
            }
            const closed = { ...change.$set, handles: {}, status: 'revoked', deletedStatusKey: 1, disconnectedAt: new Date(), disconnectedBy: ID };
            // eslint-disable-next-line no-await-in-loop
            await ctx.company(companyId, { type, data: [{ _id: row._id }, { $set: closed, $unset: change.$unset }] }, 'updateOne');
            counts.calendarClosed += 1;
        }
    }
    return counts;
}

async function finishCloudStorage(ctx, companyId) {
    const counts = {};
    await cloud.clearCompany(ctx, companyId, cloud.PAIRS, counts);
    return { cloudCleared: Object.values(counts).reduce((sum, n) => sum + n, 0) };
}

module.exports = {
    id: ID,
    scope: 'company',
    async up(ctx) {
        await ctx.forEachCompany(async (companyId) => {
            const done = { ...(await finishCalendar(ctx, companyId)), ...(await finishCloudStorage(ctx, companyId)) };
            if (done.calendarMoved || done.calendarClosed || done.cloudCleared) ctx.logger.info(`[migrations] ${ID} ${companyId}: ${JSON.stringify(done)}`);
            return done;
        });
    },
};
