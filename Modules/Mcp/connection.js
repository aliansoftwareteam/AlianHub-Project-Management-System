const { SCHEMA_TYPE } = require('../../Config/schemaType');
const { MongoDbCrudOpration } = require('../../utils/mongo-handler/mongoQueries');
const { isExpired } = require('../ApiTokens/helpers/apiTokenRules');
const grants = require('../OAuthServer/grants');
const mcpOAuth = require('../../Config/mcpOAuth');
const dataFlag = require('./dataFlag');
const manageFlag = require('./manageFlag');
const workFlag = require('./workFlag');
const logger = require('../../Config/loggerConfig');

const VIA = Object.freeze({ APP: 'app', TOKEN: 'token' });

const latestUse = (rows) => rows
    .map((row) => (row.lastUsedAt ? new Date(row.lastUsedAt) : null))
    .filter(Boolean)
    .sort((a, b) => b.getTime() - a.getTime())[0] || null;

/* Only a token made for an AI app counts: a personal token used by a script is not the person's AI. */
const tokenUse = async (companyId, userId, now) => {
    const rows = await MongoDbCrudOpration(companyId, {
        type: SCHEMA_TYPE.API_TOKENS,
        data: [{ userId, kind: 'agent' }, { active: 1, expiresAt: 1, lastUsedAt: 1 }],
    }, 'find');
    return latestUse((rows || []).filter((row) => row.active !== false && !isExpired(row, now)));
};

const appUse = async (companyId, userId, now) => latestUse(
    (await grants.liveGrantsOf(userId, now)).filter((row) => String(row.companyId) === String(companyId)),
);

const addressOf = () => {
    try { return mcpOAuth.resource(); } catch (error) { return ''; }
};

/* The caller's own connection in one workspace, read from the last-used stamps the two sign-in paths
 * already keep, and what this install lets an AI app do. Nothing here names a token or an app. */
const statusFor = async ({ companyId, userId, now = new Date() }) => {
    const apps = mcpOAuth.isOn();
    const tokens = mcpOAuth.mode() !== mcpOAuth.MODE.ONLY;
    const [byToken, byApp] = await Promise.all([
        tokens ? tokenUse(companyId, userId, now) : null,
        apps ? appUse(companyId, userId, now) : null,
    ]);
    const appIsLatest = Boolean(byApp) && (!byToken || byApp.getTime() >= byToken.getTime());
    const lastSeenAt = appIsLatest ? byApp : byToken;
    return {
        connected: Boolean(lastSeenAt),
        lastSeenAt,
        via: lastSeenAt ? (appIsLatest ? VIA.APP : VIA.TOKEN) : null,
        apps,
        tokens,
        address: apps ? addressOf() : '',
        tools: { data: dataFlag.enabled(), manage: manageFlag.enabled(), work: workFlag.enabled() },
    };
};

/* GET /api/v2/api-tokens/ai-connection */
const read = async (req, res) => {
    try {
        const companyId = String(req.headers.companyid || '');
        const userId = String(req.uid || '');
        if (req.apiToken || !companyId || !userId) {
            return res.status(403).send({ status: false, statusText: 'Only a signed-in person can see whether their AI is connected.' });
        }
        return res.send({ status: true, statusText: 'Connection fetched.', data: await statusFor({ companyId, userId }) });
    } catch (error) {
        logger.error(`ERROR in read ai connection: ${error.message}`);
        return res.status(500).send({ status: false, statusText: 'Something went wrong.' });
    }
};

module.exports = { statusFor, read };
