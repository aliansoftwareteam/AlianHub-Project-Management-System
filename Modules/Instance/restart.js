const logger = require('../../Config/loggerConfig');
const hostingMode = require('../../Config/hostingMode');
const { SCHEMA_TYPE } = require('../../Config/schemaType');
const { MongoDbCrudOpration } = require('../../utils/mongo-handler/mongoQueries');
const { recordAudit } = require('../Audit/recorder');
const { requestAddress } = require('../../utils/requestAddress');
const { DOC_ID } = require('../../Config/instanceSettings');

const RESTART_LIMIT = 3;
const WINDOW_MS = 60 * 60 * 1000;
const DRAIN_MS = 10000;
const ACTION = 'instance.restart';
const OBJECT_ID = /^[a-f0-9]{24}$/i;

let server = null;

const attach = (httpServer) => { server = httpServer; };

const defaultRun = (data, method) => MongoDbCrudOpration(SCHEMA_TYPE.GOLBAL, { type: SCHEMA_TYPE.INSTANCE_SETTINGS, data }, method);

/* Kept in the database: the restart this limits ends the process, so a count in memory would
 * start from zero every time. */
async function claimRestart({ run = defaultRun, now = new Date() } = {}) {
    const doc = await run([{ _id: DOC_ID }], 'findOne');
    const recent = ((doc && doc.restartsAt) || []).map((at) => new Date(at)).filter((at) => now - at < WINDOW_MS).sort((a, b) => a - b);
    if (recent.length >= RESTART_LIMIT) return { ok: false, retryAt: new Date(recent[0].getTime() + WINDOW_MS) };
    await run([{ _id: DOC_ID }, { $push: { restartsAt: { $each: [now], $slice: -RESTART_LIMIT } } }, { upsert: true }], 'findOneAndUpdate');
    return { ok: true };
}

/* Docker's restart policy (unless-stopped) or pm2 starts the process again; requests already
 * in flight get up to DRAIN_MS to finish. */
function exitGracefully({ exit = (code) => process.exit(code), drainMs = DRAIN_MS, httpServer = server } = {}) {
    const timer = setTimeout(() => exit(0), drainMs);
    if (!httpServer) return;
    httpServer.close(() => {
        clearTimeout(timer);
        exit(0);
    });
    if (typeof httpServer.closeIdleConnections === 'function') httpServer.closeIdleConnections();
}

function audit(req) {
    const companyId = String(req.body?.companyId || ''); // tenant-scoping: the instance owner names the workspace whose audit log records the restart
    logger.warn(`[instance] restart requested by ${req.instanceAdmin}${req.uid ? ` ${req.uid}` : ''}`);
    if (!OBJECT_ID.test(companyId)) return;
    recordAudit(companyId, {
        actorId: req.uid ? String(req.uid) : '', actorName: '', ip: requestAddress(req),
        action: ACTION, entityType: 'instance', entityId: hostingMode.platform().instanceId, entityName: '', meta: { via: req.instanceAdmin },
    });
}

/* Hosted only: a self-hosted operator restarts the process their own way. Express passes `next`
 * third, which carries neither option. */
async function restart(req, res, { run, exit } = {}) {
    if (!hostingMode.isManaged()) return res.status(404).send({ status: false, statusText: 'Not found.' });
    try {
        const claim = await claimRestart({ run });
        if (!claim.ok) {
            return res.status(429).send({ status: false, statusText: `The instance was restarted ${RESTART_LIMIT} times in the last hour. Try again later.`, data: { retryAt: claim.retryAt } });
        }
        audit(req);
        res.on('finish', () => exitGracefully({ exit }));
        return res.status(202).send({ status: true, statusText: 'Restarting.', data: { restarting: true } });
    } catch (error) {
        logger.error(`[instance] restart failed: ${error.message}`);
        return res.status(500).send({ status: false, statusText: error.message });
    }
}

module.exports = { RESTART_LIMIT, WINDOW_MS, DRAIN_MS, ACTION, attach, claimRestart, exitGracefully, restart };
