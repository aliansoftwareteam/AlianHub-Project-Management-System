const logger = require('../../Config/loggerConfig');
const agentAudit = require('../Agents/agentAudit');
const store = require('./store');

// Action-level idempotency, carried on the audit row.
//
// A step's claim stops two workers running it at the same time. This stops the
// same step running twice at different times — a redelivered job, a resumed
// run, a worker that mutated a task and then died before it could say so.
//
// The key is the run and the step, not the attempt: every attempt of one step
// opens the same row. The row's own state answers the question:
//
//   applied → the effect already happened; do not run it again
//   pending → a previous attempt opened the row and did not finish; run it
//   failed  → the previous attempt threw before changing anything; run it
//
// `pending` is the honest case of a worker that died mid-action. Re-running is
// the right call for the actions that exist today, all of which set a value
// rather than accumulating one, and the row is there for a person to read.

const LOG_PREFIX = '[workflow-idempotency]';

const keyFor = ({ runId, stepId, action }) => ['wf', String(runId), String(stepId), ...(action ? [String(action)] : [])].join(':');

const isDuplicate = (error) => store.isDuplicateKey(error) || /duplicate key/i.test(String((error && error.message) || ''));

const openRow = async (companyId, actor, entry) => {
    try {
        return { auditId: await agentAudit.openAction(companyId, actor, entry), applied: false };
    } catch (error) {
        if (!isDuplicate(error)) throw error;
        const existing = await agentAudit.findByIdempotencyKey(companyId, entry.idempotencyKey);
        if (!existing) throw error;
        return { auditId: String(existing._id), applied: (existing.meta || {}).state === agentAudit.STATE.APPLIED };
    }
};

/* Runs `fn` at most once for `key`, ever. Returns what happened so the step row
 * can record `replayed` rather than pretending it did the work. */
const once = async (companyId, { key, actor, entry }, fn) => {
    const existing = await agentAudit.findByIdempotencyKey(companyId, key);
    if (existing && (existing.meta || {}).state === agentAudit.STATE.APPLIED) {
        logger.info(`${LOG_PREFIX} ${key}: already applied as audit row ${existing._id} — the step was not run again`);
        return { replayed: true, auditId: String(existing._id), output: null };
    }

    const opened = existing
        ? { auditId: String(existing._id), applied: false }
        : await openRow(companyId, actor, { ...entry, idempotencyKey: key });
    if (opened.applied) {
        logger.info(`${LOG_PREFIX} ${key}: already applied as audit row ${opened.auditId} — the step was not run again`);
        return { replayed: true, auditId: opened.auditId, output: null };
    }

    try {
        const output = await fn();
        await agentAudit.applyAction(companyId, opened.auditId, {});
        return { replayed: false, auditId: opened.auditId, output };
    } catch (error) {
        await agentAudit.failAction(companyId, opened.auditId, error.message);
        throw error;
    }
};

module.exports = { keyFor, once, isDuplicate };
