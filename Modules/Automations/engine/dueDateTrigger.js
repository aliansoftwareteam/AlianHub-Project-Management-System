const mongoose = require('mongoose');
const { SCHEMA_TYPE } = require('../../../Config/schemaType');
const { dbCollections } = require('../../../Config/collections');
const { MongoDbCrudOpration } = require('../../../utils/mongo-handler/mongoQueries');
const logger = require('../../../Config/loggerConfig');
const domainEventBus = require('../../../event/domainEventBus');
const { CLOSED_STATUS_TYPES } = require('../../Tasks/helpers/taskSignals');
const matcher = require('./matcher');

// Publishes task.due_date_passed, hung on the engine's recurring queue so one
// process runs it. A due date is the instant the picker stored, already in the
// person's own time zone, so it is compared with now the way a reminder's time
// is and no zone is applied here.
//
// Each tick reads the open tasks whose due date passed inside the look-back
// window and claims each with a conditional write of the due date it fires for:
// a second tick, a second process or a restart finds it claimed, and a changed
// due date is a new value to claim. A claim is taken before the event is
// published, so a crash between the two loses that event rather than repeating it.

const EVENT = 'task.due_date_passed';
const JOB_NAME = 'automation.due-date-passed';
const LOG_PREFIX = '[automation-due-date]';
const DEFAULT_INTERVAL_SECONDS = 300;
const MIN_INTERVAL_SECONDS = 60;
const LOOKBACK_MS = 24 * 60 * 60 * 1000;
const BATCH = 200;
const SYSTEM = Object.freeze({ kind: 'system', userId: null });

const oid = (id) => { try { return new mongoose.Types.ObjectId(String(id)); } catch (e) { return null; } };

const intervalMs = () => {
    const seconds = Number(process.env.AUTOMATION_DUE_DATE_TICK_SECONDS || DEFAULT_INTERVAL_SECONDS);
    return (Number.isFinite(seconds) && seconds >= MIN_INTERVAL_SECONDS ? seconds : DEFAULT_INTERVAL_SECONDS) * 1000;
};

const timeOf = (value) => (value ? new Date(value).getTime() : NaN);

/* A rule hears only due dates that pass after it was created, so saving one does
 * not fire for everything that went overdue the day before. */
const floorFor = (rules, now) => {
    const created = rules.map((rule) => timeOf(rule.createdAt)).filter(Number.isFinite);
    const oldest = created.length === rules.length ? Math.min(...created) : 0;
    return new Date(Math.max(now.getTime() - LOOKBACK_MS, oldest));
};

const openAndDue = (from, now) => ({
    DueDate: { $gt: from, $lte: now },
    statusType: { $nin: CLOSED_STATUS_TYPES },
    deletedStatusKey: 0,
    mainChat: { $ne: true },
    $expr: { $ne: ['$DueDate', '$dueDatePassedFor'] },
});

/* The mark is bookkeeping, not an edit: no socket emit, which would publish task.updated for a field
 * no person changed, and no updatedAt, which auto-archive and the digests read as someone's work. */
const claim = (companyId, task) => MongoDbCrudOpration(companyId, {
    type: SCHEMA_TYPE.TASKS,
    data: [
        { _id: oid(task._id), DueDate: task.DueDate, dueDatePassedFor: { $ne: task.DueDate }, statusType: { $nin: CLOSED_STATUS_TYPES }, deletedStatusKey: 0 },
        { $set: { dueDatePassedFor: task.DueDate } },
        { returnDocument: 'after', timestamps: false },
    ],
}, 'findOneAndUpdate');

/* One company's newly overdue tasks, oldest first, at most BATCH a run; the rest wait for the next run. */
const tickCompany = async (companyId, { now = new Date() } = {}) => {
    const rules = await matcher.rulesFor(companyId, EVENT);
    if (!rules.length) return { scanned: 0, fired: 0 };

    const due = await MongoDbCrudOpration(companyId, {
        type: SCHEMA_TYPE.TASKS,
        data: [openAndDue(floorFor(rules, now), now), { DueDate: 1 }, { sort: { DueDate: 1 }, limit: BATCH }],
    }, 'find');

    let fired = 0;
    for (const task of due || []) {
        // eslint-disable-next-line no-await-in-loop
        const claimed = await claim(companyId, task).catch((error) => {
            logger.error(`${LOG_PREFIX} ${companyId} task ${task._id}: ${error.message}`);
            return null;
        });
        if (!claimed) continue;
        domainEventBus.publishTaskEvent({ companyId, type: EVENT, doc: claimed, actor: SYSTEM, depth: 0, narrowing: null });
        fired += 1;
    }
    return { scanned: (due || []).length, fired };
};

const tickAll = async ({ now = new Date() } = {}) => {
    const companies = await MongoDbCrudOpration(dbCollections.GLOBAL, { type: dbCollections.COMPANIES, data: [{}, '_id'] }, 'find').catch(() => []);
    let fired = 0;
    for (const company of companies || []) {
        // eslint-disable-next-line no-await-in-loop
        const out = await tickCompany(String(company._id), { now }).catch((error) => {
            logger.error(`${LOG_PREFIX} ${company._id}: ${error.message}`);
            return { fired: 0 };
        });
        fired += out.fired;
    }
    if (fired) logger.info(`${LOG_PREFIX} published ${fired} due date event(s)`);
    return { fired };
};

module.exports = { EVENT, JOB_NAME, LOOKBACK_MS, BATCH, intervalMs, floorFor, tickCompany, tickAll };
