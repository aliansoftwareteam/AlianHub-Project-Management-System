const store = require('../Config/secrets');
const { Notification_key: { CONNECTOR_SLACK_BOT_RETIRED } } = require('../Config/notificationKey');
const { recordAudit } = require('../Modules/Audit/recorder');

/* Slack moved to each person's own connection (task 074, decision 8 of 056). In every workspace that had the
 * workspace bot this retires its bot token and signing secret in the secrets store, closes the bot's row, ends
 * every Inbox proposal still waiting to post through it as declined (nothing is sent), and tells owners and admins once in the
 * bell. The bot's row is the one without a `provider`; a person's own Slack connection is never touched.
 * A closed row is not found again, so a second run changes nothing. */

const ID = '080-retire-slack-bot';
const ACTOR = Object.freeze({ id: 'system' });
const POST = 'slack.message.post';
const RETIRED = 'The Slack workspace bot was retired. Connect Slack on My connections and ask again.';
const NOTICE = 'The Slack workspace bot was retired. Each person now connects their own Slack on My connections.';
const NOTICE_SCOPE = 'connectors';

const botRows = (ctx, companyId) => ctx.company(companyId, {
    type: ctx.SCHEMA_TYPE.CONNECTOR_CONNECTIONS, data: [{ connector: 'slack', provider: { $exists: false }, deletedStatusKey: { $ne: 1 } }],
}, 'find').then((rows) => rows || []);

/* A bot post was filed with the bot's own params: a channelId and no connectionId. */
const pendingBotPosts = (ctx, companyId) => ctx.company(companyId, {
    type: ctx.SCHEMA_TYPE.AGENT_PROPOSALS,
    data: [{ status: 'pending', changes: { $elemMatch: { action: POST, 'params.connectionId': { $exists: false } } } }, { _id: 1 }],
}, 'find').then((rows) => rows || []);

async function retireCompany(ctx, companyId) {
    const rows = await botRows(ctx, companyId);
    if (!rows.length) return { retired: 0, expired: 0, told: 0 };
    let secrets = 0;
    for (const row of rows) {
        for (const handle of Object.values(row.secretHandles || {}).filter(Boolean)) {
            // eslint-disable-next-line no-await-in-loop
            await store.retire({ companyId, handle, actor: ACTOR });
            secrets += 1;
        }
        // eslint-disable-next-line no-await-in-loop
        await ctx.company(companyId, {
            type: ctx.SCHEMA_TYPE.CONNECTOR_CONNECTIONS,
            data: [{ _id: row._id }, { $set: { secretHandles: {}, channels: [], allowedChannels: [], status: 'retired', deletedStatusKey: 1, retiredAt: new Date(), retiredBy: ID } }],
        }, 'updateOne');
    }
    const waiting = await pendingBotPosts(ctx, companyId);
    if (waiting.length) {
        await ctx.company(companyId, {
            type: ctx.SCHEMA_TYPE.AGENT_PROPOSALS,
            data: [{ _id: { $in: waiting.map((p) => p._id) }, status: 'pending' }, { $set: { status: 'declined', declineReason: RETIRED, decidedAt: new Date(), decidedBy: ACTOR.id } }],
        }, 'updateMany');
    }
    recordAudit(companyId, { actorId: ACTOR.id, action: 'connector.revoke', entityType: 'connector', entityId: 'slack', entityName: 'Slack', meta: { by: ID, secrets, expired: waiting.length } });
    const { ownersAndAdmins, sendNotice } = require('../Modules/Inbox/helpers/workspaceNotice');
    const admins = await ownersAndAdmins(companyId);
    await sendNotice(companyId, admins, { key: CONNECTOR_SLACK_BOT_RETIRED, type: NOTICE_SCOPE, scope: NOTICE_SCOPE, message: NOTICE, changeData: { provider: 'slack' }, label: ID });
    return { retired: rows.length, expired: waiting.length, told: admins.length };
}

module.exports = {
    id: ID,
    scope: 'company',
    retireCompany,
    async up(ctx) {
        await ctx.forEachCompany(async (companyId) => {
            const done = await retireCompany(ctx, companyId);
            if (done.retired) ctx.logger.info(`[migrations] 080 ${companyId}: Slack bot retired, ${done.expired} waiting posts ended, ${done.told} owners and admins told`);
            return done;
        });
    },
};
