const logger = require('../../Config/loggerConfig');
const { sessionTenantOf, TenantError } = require('../../Config/tenant');
const access = require('../Agents/access');
const revert = require('../Agents/revert');
const store = require('./store');
const flag = require('./flag');
const executors = require('./executors');
const queue = require('./queue');
const stepTypes = require('./stepTypes');

// The workflow API: start a run, read a run and its steps, and apply the four
// controls a person has over a step that went wrong.
//
// Authorisation is the agents' rule, because a workflow step spends the same
// money and makes the same changes an agent run does: managing takes an Owner or
// an Admin, every request is scoped to the company of its companyid header, and
// a reader who is neither sees only the runs they started or whose project they
// can open. Agents do not drive workflows at all.
//
// Everything here is behind WORKFLOW_ENGINE. With the flag off there is no
// engine to talk to, so the whole surface answers 503: the feature is not
// refused, it is not running.

const OBJECT_ID = /^[0-9a-fA-F]{24}$/;
const STEP_ID = /^[A-Za-z0-9_.-]{1,64}$/;
const MAX_STEPS = 50;
const IDEMPOTENCY_KEY_MAX = 200;
const REASON_MAX = 500;
// Beginning with "s", so a later step can read this one's output as "$sAgent.…".
const AGENT_STEP_ID = 'sAgent';

const UNAVAILABLE = 'The workflow engine is off. Set WORKFLOW_ENGINE=on to use workflows.';

const fail = (res, statusText, code) => res.status(code || 400).send({ status: false, statusText, message: statusText });
const ok = (res, statusText, data) => res.send({ status: true, statusText, data });
const invalid = (message) => Object.assign(new Error(message), { status: 400 });

const idempotencyKeyOf = (req) => {
    const raw = req.headers['idempotency-key'] || (req.body && req.body.idempotencyKey);
    if (raw === undefined || raw === null || raw === '') return null;
    if (typeof raw !== 'string' || raw.length > IDEMPOTENCY_KEY_MAX) throw invalid(`idempotencyKey must be a string of at most ${IDEMPOTENCY_KEY_MAX} characters`);
    return raw;
};

const reasonOf = (req) => String(((req.body || {}).reason) || '').slice(0, REASON_MAX);

/* Every handler starts here: the flag, the tenant and who is calling. */
const context = async (req, res) => {
    if (!flag.enabled()) { fail(res, UNAVAILABLE, 503); return null; }
    let companyId;
    try { companyId = sessionTenantOf(req); } catch (error) {
        fail(res, error instanceof TenantError ? error.message : 'A valid companyid header is required.', (error && error.statusCode) || 400);
        return null;
    }
    const caller = await access.callerOf(req, companyId);
    if (!caller.human) { fail(res, 'Agents cannot drive workflows — a person has to.', 403); return null; }
    return { companyId, caller };
};

const requireManager = (res, caller) => {
    if (access.canManageAgents(caller)) return true;
    fail(res, 'Only an Owner or an Admin can manage workflow runs.', 403);
    return false;
};

/* A run the caller may not see does not exist, for the same reason a run in
 * another company does not: the answer must not say which of the two it was. */
const readableRun = async (companyId, caller, runId) => {
    if (!OBJECT_ID.test(String(runId || ''))) return null;
    const run = await store.getRun(companyId, runId);
    if (!run) return null;
    if (caller.privileged) return run;
    if (String(run.startedBy || '') === String(caller.actor.userId)) return run;
    const visible = await access.visibleProjectIdsFor(companyId, caller);
    if (run.projectId && visible && visible.includes(String(run.projectId))) return run;
    return null;
};

const stepsOf = (companyId, run) => store.listSteps(companyId, run._id);

/* Shape first, then the step types' own rules.
 *
 * The shape — an id, a known type, a dependency that exists — is what the engine
 * needs to execute the graph at all; `stepTypes.validateSteps` is what each type
 * requires of its own configuration, and it answers with field-level errors so a
 * builder can mark the slot that is wrong. */
const validateSteps = (raw) => {
    if (!Array.isArray(raw) || !raw.length) throw invalid('steps must be a non-empty array');
    if (raw.length > MAX_STEPS) throw invalid(`a workflow may not have more than ${MAX_STEPS} steps`);
    const ids = new Set();
    const steps = raw.map((step, index) => {
        const id = String((step && step.id) || `s${index + 1}`);
        if (!STEP_ID.test(id)) throw invalid(`step id "${id}" must be 1-64 characters of letters, digits, dot, dash or underscore`);
        if (ids.has(id)) throw invalid(`step id "${id}" is used twice`);
        ids.add(id);
        const type = String((step && step.type) || '');
        if (!executors.has(type)) throw invalid(`no executor is registered for step type "${type}"`);
        return {
            id,
            type,
            action: step.action ? String(step.action) : null,
            dependsOn: (step.dependsOn || []).map(String),
            config: step.config && typeof step.config === 'object' ? step.config : {},
            ...(Number(step.maxAttempts) > 0 ? { maxAttempts: Number(step.maxAttempts) } : {}),
        };
    });
    for (const step of steps) {
        for (const dependency of step.dependsOn) {
            if (!ids.has(dependency)) throw invalid(`step "${step.id}" depends on "${dependency}", which is not a step of this workflow`);
        }
    }
    const checked = stepTypes.validateSteps(steps);
    if (!checked.valid) throw invalid(checked.errors.join('; '));
    return steps;
};

/* The shorthand the product actually starts: one agent, one task. Spelt out as a
 * step so the graph a one-node run executes is the graph a bigger one does. */
const stepsFor = (body) => {
    if (body.steps) return validateSteps(body.steps);
    if (!OBJECT_ID.test(String(body.agentId || ''))) throw invalid('a valid agentId, or a steps array, is required');
    if (!OBJECT_ID.test(String(body.taskId || ''))) throw invalid('a valid taskId is required to run an agent');
    return validateSteps([{
        id: AGENT_STEP_ID,
        type: stepTypes.AGENT_RUN,
        config: {
            agentId: String(body.agentId),
            taskId: String(body.taskId),
            skill: body.skill ? String(body.skill) : null,
            note: body.note ? String(body.note).slice(0, 2000) : '',
            ...(Number(body.spendCapUsd) > 0 ? { budgetUsd: Number(body.spendCapUsd) } : {}),
        },
    }]);
};

const MAX_RUN_DEADLINE_MS = 30 * 24 * 60 * 60 * 1000;

/* The deadline and the budget the whole run spends down. Both optional, and both
 * only ever a request: `hop.ceilingFor` takes the smaller of what was asked for
 * and what the workspace allows. */
const boundsOf = (body) => {
    const deadlineMs = body.deadlineMs === undefined || body.deadlineMs === null ? null : Number(body.deadlineMs);
    const budgetUsd = body.budgetUsd === undefined || body.budgetUsd === null ? null : Number(body.budgetUsd);
    if (deadlineMs !== null && (!Number.isFinite(deadlineMs) || deadlineMs <= 0 || deadlineMs > MAX_RUN_DEADLINE_MS)) {
        throw invalid(`deadlineMs must be a positive number of milliseconds, at most ${MAX_RUN_DEADLINE_MS}`);
    }
    if (budgetUsd !== null && (!Number.isFinite(budgetUsd) || budgetUsd <= 0)) throw invalid('budgetUsd must be a positive number of dollars');
    return { deadlineMs, budgetUsd };
};

/* POST /api/v2/workflows/runs
 * body: { workflowId?, name?, steps?, deadlineMs?, budgetUsd? } or { agentId, taskId, skill?, note?, … }
 * An Idempotency-Key header (or an idempotencyKey field) makes a repeated start
 * return the run the first request created rather than starting a second. */
exports.startRun = async (req, res) => {
    try {
        const ctx = await context(req, res);
        if (!ctx) return undefined;
        if (!requireManager(res, ctx.caller)) return undefined;
        const body = req.body || {};
        const key = idempotencyKeyOf(req);
        const steps = stepsFor(body);
        const dedupeKey = key ? `api:${ctx.caller.actor.userId}:${key}` : null;

        const run = await store.createRun(ctx.companyId, {
            workflowId: String(body.workflowId || `api:${steps[0].type}`),
            name: String(body.name || '').slice(0, 200),
            source: 'api',
            dedupeKey,
            startedBy: ctx.caller.actor.userId,
            agentId: body.agentId ? String(body.agentId) : null,
            taskId: body.taskId ? String(body.taskId) : null,
            projectId: body.projectId ? String(body.projectId) : null,
            steps,
            ...boundsOf(body),
        });
        if (!run) {
            const existing = dedupeKey ? await store.findRunByDedupeKey(ctx.companyId, dedupeKey) : null;
            if (!existing) return fail(res, 'The run could not be started.', 409);
            return ok(res, 'Run already started.', { run: existing, steps: await stepsOf(ctx.companyId, existing), deduplicated: true });
        }

        const dispatched = await queue.dispatch(ctx.companyId, run._id);
        const started = (await store.getRun(ctx.companyId, run._id)) || run;
        return ok(res, 'Run started.', { run: started, steps: await stepsOf(ctx.companyId, started), deduplicated: false, dispatched });
    } catch (error) {
        logger.error(`[workflow-api] startRun: ${error.message}`);
        return fail(res, error.message, error.status || 500);
    }
};

/* GET /api/v2/workflows/runs?status=&source=&agentId=&limit= */
exports.listRuns = async (req, res) => {
    try {
        const ctx = await context(req, res);
        if (!ctx) return undefined;
        const rows = (await store.listRuns(ctx.companyId, req.query || {})) || [];
        if (ctx.caller.privileged) return ok(res, 'Runs fetched.', rows);
        const visible = await access.visibleProjectIdsFor(ctx.companyId, ctx.caller);
        const mine = rows.filter((run) => String(run.startedBy || '') === String(ctx.caller.actor.userId)
            || (run.projectId && visible && visible.includes(String(run.projectId))));
        return ok(res, 'Runs fetched.', mine);
    } catch (error) {
        logger.error(`[workflow-api] listRuns: ${error.message}`);
        return fail(res, error.message, 500);
    }
};

/* GET /api/v2/workflows/runs/:id — the run and every step of it */
exports.getRun = async (req, res) => {
    try {
        const ctx = await context(req, res);
        if (!ctx) return undefined;
        const run = await readableRun(ctx.companyId, ctx.caller, req.params.id);
        if (!run) return fail(res, 'Workflow run not found.', 404);
        return ok(res, 'Run fetched.', { run, steps: await stepsOf(ctx.companyId, run) });
    } catch (error) {
        logger.error(`[workflow-api] getRun: ${error.message}`);
        return fail(res, error.message, 500);
    }
};

const REFUSED_STATE = {
    retry: 'Only a failed or skipped step can be retried.',
    skip: 'Only a pending or failed step can be skipped.',
    resume: 'Only a failed step, or one holding a claim nobody is working, can be resumed.',
};

const APPLIED = { retry: 'Step retried.', skip: 'Step skipped.', resume: 'Step resumed.' };

/* retry, skip and resume are the same shape: mutate the one step, reopen the run
 * and put it back on the queue. Which of them it is, is the store write. */
const stepControl = (action, write) => async (req, res) => {
    try {
        const ctx = await context(req, res);
        if (!ctx) return undefined;
        if (!requireManager(res, ctx.caller)) return undefined;
        if (!STEP_ID.test(String(req.params.stepId || ''))) return fail(res, 'A valid step id is required.');
        const run = await readableRun(ctx.companyId, ctx.caller, req.params.id);
        if (!run) return fail(res, 'Workflow run not found.', 404);
        if (!(await store.getStep(ctx.companyId, run._id, req.params.stepId))) return fail(res, 'Step not found.', 404);

        const step = await write(ctx.companyId, run._id, req.params.stepId, { by: ctx.caller.actor.userId, reason: reasonOf(req) });
        if (!step) return fail(res, REFUSED_STATE[action], 409);

        await store.reopenRun(ctx.companyId, run._id);
        const dispatched = await queue.dispatch(ctx.companyId, run._id);
        const after = (await store.getRun(ctx.companyId, run._id)) || run;
        return ok(res, APPLIED[action], {
            run: after,
            steps: await stepsOf(ctx.companyId, after),
            dispatched,
        });
    } catch (error) {
        logger.error(`[workflow-api] ${action}Step: ${error.message}`);
        return fail(res, error.message, error.status || 500);
    }
};

exports.retryStep = stepControl('retry', store.retryStep);
exports.skipStep = stepControl('skip', store.operatorSkipStep);
exports.resumeStep = stepControl('resume', store.resumeStep);

/* POST /api/v2/workflows/runs/:id/steps/:stepId/compensate
 * Undoing what the step did, which for an agent-run step is the run revert the
 * agents module already performs: the same inverse, the same undo window, the
 * same audit trail. A step type with nothing to undo says so. */
exports.compensateStep = async (req, res) => {
    try {
        const ctx = await context(req, res);
        if (!ctx) return undefined;
        if (!requireManager(res, ctx.caller)) return undefined;
        const run = await readableRun(ctx.companyId, ctx.caller, req.params.id);
        if (!run) return fail(res, 'Workflow run not found.', 404);
        const step = await store.getStep(ctx.companyId, run._id, req.params.stepId);
        if (!step) return fail(res, 'Step not found.', 404);
        if (step.type !== stepTypes.AGENT_RUN) return fail(res, `A ${step.type} step has nothing to compensate.`, 409);
        const agentRunId = (step.output && step.output.agentRunId) || (step.config && step.config.agentRunId);
        if (!agentRunId) return fail(res, 'This step never started an agent run, so there is nothing to compensate.', 409);

        const out = await revert.revertRun(ctx.companyId, agentRunId, {
            actor: ctx.caller.actor, isPrivileged: ctx.caller.privileged, ip: req.ip || '',
        });
        if (out.error) return fail(res, out.error, out.status || 409);
        const compensated = await store.recordCompensation(ctx.companyId, run._id, step.stepId, {
            by: String(ctx.caller.actor.userId), agentRunId: String(agentRunId), reverted: out.reverted, failed: out.failed || [],
        });
        return ok(res, 'Step compensated.', { step: compensated, revert: out });
    } catch (error) {
        logger.error(`[workflow-api] compensateStep: ${error.message}`);
        return fail(res, error.message, error.status || 500);
    }
};

exports.UNAVAILABLE = UNAVAILABLE;
