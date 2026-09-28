const mongoose = require('mongoose');
const { SCHEMA_TYPE } = require('../../../Config/schemaType');
const { MongoDbCrudOpration } = require('../../../utils/mongo-handler/mongoQueries');
const { isAiOff } = require('../../AICore/aiSwitch');
const limits = require('./limits');
const fill = require('./fill');

const OBJECT_ID = /^[a-f0-9]{24}$/i;
const STALE_MS = 10 * 60 * 1000;

const STATUS = Object.freeze({ QUEUED: 'queued', RUNNING: 'running', DONE: 'done', STOPPED: 'stopped', FAILED: 'failed' });
const GATE_STOPS = Object.freeze([limits.STOP.AI_OFF, limits.STOP.NO_PROVIDER, limits.STOP.DAILY_LIMIT, limits.STOP.BUDGET]);

const plain = (doc) => (doc && typeof doc.toObject === 'function' ? doc.toObject() : doc);

const PUBLIC_FIELDS = ['_id', 'fieldId', 'status', 'total', 'processed', 'filled', 'skipped', 'failed', 'stopReason', 'startedAt', 'finishedAt', 'createdAt', 'updatedAt'];
const view = (row) => Object.fromEntries(PUBLIC_FIELDS.filter((key) => row[key] !== undefined).map((key) => [key, key === '_id' ? String(row[key]) : row[key]]));

const update = (companyId, jobId, set) => MongoDbCrudOpration(companyId, {
    type: SCHEMA_TYPE.AI_FIELD_JOBS,
    data: [{ _id: new mongoose.Types.ObjectId(String(jobId)) }, { $set: set }],
}, 'updateOne');

/* A model call per task, in order, one at a time: the chat interface has no batch endpoint, and a
 * sequential run lets every cap be read again before each call rather than once for the whole job. */
async function runJob(companyId, job, { definition, config }) {
    const counts = { processed: 0, filled: 0, skipped: 0, failed: 0 };
    const approved = new Map();
    (job.proposalIds || []).forEach((proposalId) => {
        const entry = fill.recall({ companyId, uid: job.userId, fieldId: definition._id, proposalId });
        if (entry) approved.set(entry.taskId, { proposalId, entry });
    });
    let stopReason = '';
    try {
        await update(companyId, job._id, { status: STATUS.RUNNING, startedAt: new Date() });
        for (const taskId of job.taskIds) {
            const previewed = approved.get(taskId);
            try {
                if (previewed) {
                    const outcome = await fill.applyProposal({ companyId, uid: job.userId, definition, config, entry: previewed.entry, trigger: fill.TRIGGER.BULK });
                    fill.forget(previewed.proposalId);
                    counts[outcome.reason ? 'skipped' : 'filled'] += 1;
                } else {
                    const outcome = await fill.fillTask({ companyId, uid: job.userId, definition, config, taskId, trigger: fill.TRIGGER.BULK });
                    counts[outcome.outcome === 'filled' ? 'filled' : 'skipped'] += 1;
                }
            } catch (error) {
                if (GATE_STOPS.includes(error && error.code)) { stopReason = error.code; break; }
                if (isAiOff(error)) { stopReason = limits.STOP.AI_OFF; break; }
                counts.failed += 1;
                fill.logFailure(`job ${job._id} task ${taskId}`)(error);
            }
            counts.processed += 1;
            await update(companyId, job._id, { ...counts });
        }
        await update(companyId, job._id, { ...counts, status: stopReason ? STATUS.STOPPED : STATUS.DONE, stopReason, finishedAt: new Date() });
    } catch (error) {
        fill.logFailure(`job ${job._id}`)(error);
        await update(companyId, job._id, { ...counts, status: STATUS.FAILED, stopReason: 'error', finishedAt: new Date() }).catch(fill.logFailure(`job ${job._id} status`));
    }
}

async function startJob({ companyId, uid, fieldId, taskIds, proposalIds = [] }) {
    const ids = Array.isArray(taskIds) ? [...new Set(taskIds.map(String).filter((id) => OBJECT_ID.test(id)))] : [];
    if (!ids.length) throw new fill.AiFieldError(400, 'Choose at least one task.');
    if (ids.length > limits.bulkMax()) throw new fill.AiFieldError(400, `One fill takes at most ${limits.bulkMax()} tasks.`, 'bulk_max');
    const loaded = await fill.loadDefinition(companyId, fieldId);
    const verdict = await limits.gate(companyId);
    if (!verdict.ok) {
        const status = verdict.code === limits.STOP.AI_OFF ? 403 : (verdict.code === limits.STOP.NO_PROVIDER ? 503 : 429);
        throw new fill.AiFieldError(status, verdict.reason, verdict.code);
    }
    const row = plain(await MongoDbCrudOpration(companyId, {
        type: SCHEMA_TYPE.AI_FIELD_JOBS,
        data: {
            userId: String(uid), fieldId: loaded.definition._id, taskIds: ids,
            proposalIds: (Array.isArray(proposalIds) ? proposalIds : []).map(String).slice(0, fill.PREVIEW_MAX),
            status: STATUS.QUEUED, total: ids.length, processed: 0, filled: 0, skipped: 0, failed: 0, stopReason: '',
        },
    }, 'save'));
    const job = view(row);
    const done = runJob(companyId, row, loaded);
    return { job, done };
}

/* Only the person who started a job sees it. A job whose process died mid-run reads as failed. */
async function readJob({ companyId, uid, jobId }) {
    if (!OBJECT_ID.test(String(jobId || ''))) return null;
    const row = plain(await MongoDbCrudOpration(companyId, {
        type: SCHEMA_TYPE.AI_FIELD_JOBS,
        data: [{ _id: new mongoose.Types.ObjectId(String(jobId)), userId: String(uid) }],
    }, 'findOne').catch(() => null));
    if (!row) return null;
    const stale = [STATUS.QUEUED, STATUS.RUNNING].includes(row.status) && row.updatedAt && Date.now() - new Date(row.updatedAt).getTime() > STALE_MS;
    return stale ? { ...view(row), status: STATUS.FAILED, stopReason: 'interrupted' } : view(row);
}

module.exports = { STATUS, startJob, readJob, runJob };
