const hostingMode = require('../../Config/hostingMode');
const logger = require('../../Config/loggerConfig');
const { STATE_IDS, readState, writeState } = require('../Platform/platformState');
const { canSendMail, unlimited } = require('./checks');
const { limits } = require('./entitlements');

const FLUSH_BATCH = 200;
const MAX_ATTEMPTS = 5;

const todayUtc = (now) => new Date(now).toISOString().slice(0, 10);
const nextUtcDay = (now) => {
    const at = new Date(now);
    return new Date(Date.UTC(at.getUTCFullYear(), at.getUTCMonth(), at.getUTCDate() + 1));
};

function countRecipients(to) {
    const list = Array.isArray(to) ? to : String(to || '').split(/[,;]/);
    return Math.max(1, list.map((entry) => String(entry || '').trim()).filter(Boolean).length);
}

function mongoQueue() {
    const run = (data, method) => {
        const { MongoDbCrudOpration } = require('../../utils/mongo-handler/mongoQueries');
        const { SCHEMA_TYPE } = require('../../Config/schemaType');
        return MongoDbCrudOpration(SCHEMA_TYPE.GOLBAL, { type: SCHEMA_TYPE.MAIL_QUEUE, data }, method);
    };
    return {
        add: (row) => run(row, 'save'),
        due: (now, limit) => run([{ sendAfter: { $lte: new Date(now) } }, null, { sort: { queuedAt: 1 }, limit }], 'find').then((rows) => rows || []),
        remove: (id) => run([{ _id: id }], 'deleteOne'),
        failed: (id, error) => run([{ _id: id }, { $inc: { attempts: 1 }, $set: { lastError: String(error).slice(0, 500) } }], 'updateOne'),
        count: () => run([{}], 'countDocuments'),
    };
}

let queue = mongoQueue();
let chain = Promise.resolve();

/* One process per stack: reading and writing the day's count one message at a time is enough to
 * keep two sends from both taking the last slot. */
const serially = (work) => {
    const run = chain.then(work, work);
    chain = run.catch(() => {});
    return run;
};

async function sentToday(now = Date.now()) {
    const doc = await readState(STATE_IDS.MAIL);
    return doc && doc.day === todayUtc(now) ? Number(doc.sent) || 0 : 0;
}

/* Takes the message's recipients off today's allowance. Account mail (password reset, activation,
 * verification, sign-in links) always goes, and still counts. Self-hosted: always goes, uncounted. */
function admit({ recipients = 1, exempt = false, now = Date.now() } = {}) {
    if (!hostingMode.isManaged()) return Promise.resolve({ send: true });
    return serially(async () => {
        const used = await sentToday(now);
        const limit = limits().emailsPerDay;
        const verdict = canSendMail({ sentToday: used + recipients - 1, limit });
        if (!exempt && !verdict.ok) return { send: false, used, limit };
        await writeState(STATE_IDS.MAIL, { day: todayUtc(now), sent: used + recipients });
        return { send: true, used: used + recipients, limit };
    });
}

/* true when the message was held for tomorrow (the caller reports it as accepted); false when it
 * should go now. A failure here never stops mail. */
async function holdForTomorrow(kind, message, { accountMail = false, fromQueue = false, now = Date.now() } = {}) {
    if (fromQueue || !hostingMode.isManaged()) return false;
    try {
        const recipients = countRecipients(message.to);
        const verdict = await admit({ recipients, exempt: accountMail, now });
        if (verdict.send) return false;
        await queue.add({ kind, ...message, recipients, queuedAt: new Date(now), sendAfter: nextUtcDay(now), attempts: 0 });
        logger.warn(`[entitlements] daily mail cap of ${verdict.limit} reached; a message to ${recipients} recipient(s) waits for tomorrow`);
        return true;
    } catch (error) {
        logger.error(`[entitlements] mail cap check failed, sending anyway: ${error && error.message ? error.message : error}`);
        return false;
    }
}

/* Cron, hosted only: sends what waited, oldest first, while today's allowance lasts. */
async function flushQueue({ deliver, now = Date.now() } = {}) {
    if (!hostingMode.isManaged()) return { sent: 0, left: 0 };
    const send = deliver || require('../service').deliverQueued;
    let sent = 0;
    const rows = await queue.due(now, FLUSH_BATCH);
    for (const row of rows) {
        const verdict = await admit({ recipients: Number(row.recipients) || 1, now });
        if (!verdict.send) break;
        try {
            await send(row);
            await queue.remove(row._id);
            sent += 1;
        } catch (error) {
            if ((Number(row.attempts) || 0) + 1 >= MAX_ATTEMPTS) {
                logger.error(`[entitlements] queued mail dropped after ${MAX_ATTEMPTS} attempts: ${error && error.message ? error.message : error}`);
                await queue.remove(row._id);
            } else {
                await queue.failed(row._id, error && error.message ? error.message : error);
            }
        }
    }
    return { sent, left: rows.length - sent };
}

async function mailState(now = Date.now()) {
    const limit = limits().emailsPerDay;
    const used = hostingMode.isManaged() ? await sentToday(now) : 0;
    const queued = hostingMode.isManaged() ? await queue.count().catch(() => 0) : 0;
    return { sentToday: used, limit, queued: Number(queued) || 0, capped: !unlimited(limit) && used >= Number(limit) };
}

module.exports = {
    todayUtc, nextUtcDay, countRecipients, sentToday, admit, holdForTomorrow, flushQueue, mailState,
    _useQueueForTests: (next) => { queue = next || mongoQueue(); chain = Promise.resolve(); },
};
