const mongoose = require('mongoose');
const { SCHEMA_TYPE } = require('../../../Config/schemaType');
const { dbCollections } = require('../../../Config/collections');
const { MongoDbCrudOpration } = require('../../../utils/mongo-handler/mongoQueries');
const logger = require('../../../Config/loggerConfig');
const runs = require('../runs');
const slots = require('./slots');
const { runReport } = require('./reportRun');

// The agent schedule tick, hung on the automation engine's recurring queue so
// one process runs it. Each tick looks only at schedules whose nextRunAt has
// come, takes the latest slot they name, and claims it with a conditional write
// on lastSlotAt: a second tick, or a second process, finds it claimed. The run's
// idempotency key (agent:schedule:slot) is the second lock. A slot more than an
// hour old is recorded as missed rather than run late.

const JOB_NAME = 'agent.schedules';
const DEFAULT_INTERVAL_SECONDS = 60;
const CATCH_UP_MS = 60 * 60 * 1000;
const LOG_PREFIX = '[agent-schedule]';
const BATCH = 200;

const oid = (id) => { try { return new mongoose.Types.ObjectId(String(id)); } catch (e) { return null; } };

const intervalMs = () => {
    const seconds = Number(process.env.AGENT_SCHEDULE_TICK_SECONDS || DEFAULT_INTERVAL_SECONDS);
    return (Number.isFinite(seconds) && seconds >= 15 ? seconds : DEFAULT_INTERVAL_SECONDS) * 1000;
};

const update = (companyId, id, set) => MongoDbCrudOpration(companyId, {
    type: SCHEMA_TYPE.AGENT_SCHEDULES, data: [{ _id: oid(id) }, { $set: set }],
}, 'updateOne');

/* Takes the slot for this tick; false when another tick already has it. */
const claim = async (companyId, schedule, slot, next) => {
    const taken = await MongoDbCrudOpration(companyId, {
        type: SCHEMA_TYPE.AGENT_SCHEDULES,
        data: [
            { _id: oid(schedule._id), enabled: true, deletedStatusKey: { $ne: 1 }, $or: [{ lastSlotAt: null }, { lastSlotAt: { $lt: slot } }] },
            { $set: { lastSlotAt: slot, nextRunAt: next } },
            { returnDocument: 'after' },
        ],
    }, 'findOneAndUpdate');
    return Boolean(taken);
};

const fire = async (companyId, schedule, now) => {
    const slot = slots.latestSlot(schedule, now);
    const next = slots.nextSlot(schedule, now);
    if (!slot) {
        await update(companyId, schedule._id, { enabled: false, nextRunAt: null, lastResult: { status: 'skipped', reason: 'invalid schedule', at: now } });
        return 'skipped';
    }
    const floor = Math.max(schedule.lastSlotAt ? new Date(schedule.lastSlotAt).getTime() : 0, schedule.since ? new Date(schedule.since).getTime() : 0);
    if (slot.getTime() <= floor) {
        await update(companyId, schedule._id, { nextRunAt: next });
        return 'idle';
    }
    if (!(await claim(companyId, schedule, slot, next))) return 'claimed';
    if (now.getTime() - slot.getTime() > CATCH_UP_MS) {
        await update(companyId, schedule._id, { lastResult: { status: 'missed', reason: 'The slot was missed by more than an hour.', slot, at: now } });
        return 'missed';
    }
    const agent = await runs.getAgent(companyId, schedule.agentId);
    const result = agent
        ? await runReport(companyId, { agent, schedule, slot, now })
        : { status: 'skipped', reason: 'Agent not found.' };
    const lastResult = { ...result, slot, at: new Date() };
    await update(companyId, schedule._id, { lastResult, ...(result.runId ? { lastRunId: result.runId } : {}) });
    return result.status;
};

/* One company's due schedules. Never throws: one bad schedule leaves the rest to run. */
const tickCompany = async (companyId, { now = new Date() } = {}) => {
    const due = await MongoDbCrudOpration(companyId, {
        type: SCHEMA_TYPE.AGENT_SCHEDULES,
        data: [{ enabled: true, deletedStatusKey: { $ne: 1 }, nextRunAt: { $lte: now } }, {}, { sort: { nextRunAt: 1 }, limit: BATCH }],
    }, 'find').catch((e) => { logger.error(`${LOG_PREFIX} ${companyId}: ${e.message}`); return []; });
    const outcomes = {};
    for (const schedule of due || []) {
        // eslint-disable-next-line no-await-in-loop
        const outcome = await fire(companyId, schedule, now).catch((e) => {
            logger.error(`${LOG_PREFIX} ${companyId} schedule ${schedule._id}: ${e.message}`);
            return 'failed';
        });
        outcomes[outcome] = (outcomes[outcome] || 0) + 1;
    }
    return outcomes;
};

const tickAll = async ({ now = new Date() } = {}) => {
    const companies = await MongoDbCrudOpration(dbCollections.GLOBAL, { type: dbCollections.COMPANIES, data: [{}, '_id'] }, 'find').catch(() => []);
    for (const c of companies || []) {
        // eslint-disable-next-line no-await-in-loop
        await tickCompany(String(c._id), { now });
    }
};

module.exports = { JOB_NAME, CATCH_UP_MS, intervalMs, tickCompany, tickAll };
