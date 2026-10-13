const { SCHEMA_TYPE } = require('../../../Config/schemaType');
const { MongoDbCrudOpration } = require('../../../utils/mongo-handler/mongoQueries');
const logger = require('../../../Config/loggerConfig');

// What the agent already told you, so it stops telling you again.
//
// Keyed on factId — the stable id the deterministic audit produced — and never on
// the finding's title. The model re-words the same defect every run ("Shorten meta
// description to 160 characters", then "…to avoid truncation"), so title matching
// catches roughly a third of repeats and the board fills up regardless. Measured:
// a second run on the same task filed 6 more subtasks, only 2 of which were
// string-identical to the first.

const LOG_PREFIX = '[agent-memory]';
const OPEN = 'open';
const RESOLVED = 'resolved';
const WONTFIX = 'wontfix';

const load = async (companyId, taskId) => {
    try {
        const rows = await MongoDbCrudOpration(companyId, {
            type: SCHEMA_TYPE.AGENT_FINDINGS, data: [{ taskId: String(taskId) }],
        }, 'find');
        const byFact = new Map();
        (rows || []).forEach((r) => byFact.set(String(r.factId), r));
        return byFact;
    } catch (error) {
        // Memory is an optimisation. Losing it means duplicates, which is bad —
        // but failing the whole QA run because a lookup failed is worse.
        logger.error(`${LOG_PREFIX} could not load findings for ${taskId}: ${error.message}`);
        return new Map();
    }
};

/* Is the subtask we filed last time still open work?
 * A missing subtask (deleted) or a closed one means the finding is no longer
 * tracked — so if the defect is still present it deserves filing again. */
const subtaskStillTracking = async (companyId, subtaskId) => {
    if (!subtaskId) return false;
    try {
        const t = await MongoDbCrudOpration(companyId, {
            type: SCHEMA_TYPE.TASKS, data: [{ _id: subtaskId }],
        }, 'findOne');
        if (!t || !t._id) return false;
        if (t.deletedStatusKey === 1) return false;
        return t.statusType !== 'close';
    } catch { return false; }
};

/* The decision, per finding. Three outcomes worth distinguishing:
 *   file    — never seen, or previously closed and the defect came back
 *   skip    — already has an open subtask, or a human marked it wontfix
 *   refile  — regression: it was fixed and closed, and it is back */
async function decide(companyId, taskId, findings, memory) {
    const decisions = [];
    for (const f of findings) {
        const prior = memory.get(f.factId);
        if (!prior) { decisions.push({ finding: f, action: 'file', reason: 'new' }); continue; }
        if (prior.status === WONTFIX) {
            decisions.push({ finding: f, action: 'skip', reason: 'marked wontfix', prior });
            continue;
        }
        // eslint-disable-next-line no-await-in-loop
        const tracking = await subtaskStillTracking(companyId, prior.subtaskId);
        if (tracking) decisions.push({ finding: f, action: 'skip', reason: 'already filed and still open', prior });
        else decisions.push({ finding: f, action: 'refile', reason: 'previously closed — the defect is back', prior });
    }
    return decisions;
}

async function record(companyId, { projectId, taskId, factId, skill, subtaskId, title, severity, prior }) {
    const now = new Date();
    try {
        if (prior && prior._id) {
            await MongoDbCrudOpration(companyId, {
                type: SCHEMA_TYPE.AGENT_FINDINGS,
                data: [{ _id: prior._id }, { $set: { subtaskId: subtaskId || null, title, severity, status: OPEN, lastSeenAt: now }, $inc: { occurrences: 1 } }],
            }, 'updateOne');
            return;
        }
        await MongoDbCrudOpration(companyId, {
            type: SCHEMA_TYPE.AGENT_FINDINGS,
            data: { projectId: String(projectId || ''), taskId: String(taskId), factId: String(factId), skill: skill || null,
                    subtaskId: subtaskId || null, title, severity, status: OPEN, occurrences: 1, firstSeenAt: now, lastSeenAt: now },
        }, 'save');
    } catch (error) {
        // A duplicate-key here means a concurrent run beat us to it — the unique
        // index doing exactly its job. Not an error worth failing the run for.
        if (error && (error.code === 11000 || /duplicate key/i.test(error.message || ''))) return;
        logger.error(`${LOG_PREFIX} could not record ${factId}: ${error.message}`);
    }
}

/* Touch the timestamp on a finding we skipped, so "last seen" reflects reality —
 * a defect still present today should not look like it was last observed a month ago. */
async function touch(companyId, prior) {
    if (!prior || !prior._id) return;
    try {
        await MongoDbCrudOpration(companyId, {
            type: SCHEMA_TYPE.AGENT_FINDINGS,
            data: [{ _id: prior._id }, { $set: { lastSeenAt: new Date() }, $inc: { occurrences: 1 } }],
        }, 'updateOne');
    } catch { /* non-critical */ }
}

module.exports = { load, decide, record, touch, subtaskStillTracking, OPEN, RESOLVED, WONTFIX };
