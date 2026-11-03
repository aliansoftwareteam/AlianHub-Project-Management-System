const store = require('../Config/secrets');
const { Notification_key: { CONNECTOR_SLACK_BOT_RETIRED } } = require('../Config/notificationKey');
const { recordAudit } = require('../Modules/Audit/recorder');
const providerApi = require('../Modules/Connectors/providerApi');
const slack = require('../Modules/Connectors/providers/slack');

/* Slack moved to each person's own connection (task 074, decision 8 of 056). In every workspace that had the
 * workspace bot this asks Slack to revoke the bot token, retires the bot token and signing secret in the secrets
 * store, closes the bot's row, declines every Inbox proposal still waiting to post through it (nothing is sent), and
 * tells owners and admins once in the bell. Slack being unreachable, or the workspace's egress list leaving it out,
 * does not stop the retirement: AlianHub never uses the token again, and the notice and setup doc say to uninstall
 * the bot app in Slack. The bot's row is the one without a `provider`; a person's own Slack connection is never touched.
 * A closed row is not found again, so a second run changes nothing. */

const ID = '080-retire-slack-bot';
const ACTOR = Object.freeze({ id: 'system' });
const POST = 'slack.message.post';
const RETIRED = 'The Slack workspace bot was retired. Connect Slack on My connections and ask again.';
const NOTICE = 'The Slack workspace bot was retired. Each person now connects their own Slack on My connections. Uninstall the old bot app in Slack.';
const NOTICE_SCOPE = 'connectors';

const botRows = (ctx, companyId) => ctx.company(companyId, {
    type: ctx.SCHEMA_TYPE.CONNECTOR_CONNECTIONS, data: [{ connector: 'slack', provider: { $exists: false }, deletedStatusKey: { $ne: 1 } }],
}, 'find').then((rows) => rows || []);

/* A bot post was filed with the bot's own params: a channelId and no connectionId. */
const pendingBotPosts = (ctx, companyId) => ctx.company(companyId, {
    type: ctx.SCHEMA_TYPE.AGENT_PROPOSALS,
    data: [{ status: 'pending', changes: { $elemMatch: { action: POST, 'params.connectionId': { $exists: false } } } }, { _id: 1 }],
}, 'find').then((rows) => rows || []);

/* auth.revoke takes the token itself; the signing secret has no revoke at Slack. */
const revokeAtSlack = async (companyId, handle) => {
    if (!handle) return 'none';
    const token = await store.resolve({ companyId, handle }).catch(() => null);
    if (!token) return 'unreadable';
    const out = await providerApi.revoke({ definition: slack, companyId, actor: ACTOR.id, token }).catch(() => ({ ok: false }));
    return out.ok ? 'revoked' : 'failed';
};

async function retireCompany(ctx, companyId) {
    const rows = await botRows(ctx, companyId);
    if (!rows.length) return { retired: 0, expired: 0, told: 0 };
    let secrets = 0;
    const atSlack = [];
    for (const row of rows) {
        // eslint-disable-next-line no-await-in-loop
        atSlack.push(await revokeAtSlack(companyId, (row.secretHandles || {}).bot_token));
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
    recordAudit(companyId, { actorId: ACTOR.id, action: 'connector.revoke', entityType: 'connector', entityId: 'slack', entityName: 'Slack', meta: { by: ID, secrets, expired: waiting.length, atSlack } });
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
