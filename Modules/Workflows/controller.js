const logger = require('../../Config/loggerConfig');
const { sessionTenantOf, TenantError } = require('../../Config/tenant');
const { getRoleType } = require('../../Config/permissionGuard');
const access = require('../Agents/access');
const revert = require('../Agents/revert');
const { SCHEMA_TYPE } = require('../../Config/schemaType');
const { MongoDbCrudOpration } = require('../../utils/mongo-handler/mongoQueries');
const store = require('./store');
const approvals = require('./approvals');
const people = require('./people');
const flag = require('./flag');
const executors = require('./executors');
const queue = require('./queue');
const stepTypes = require('./stepTypes');
const definitions = require('./definitions');
const dryRun = require('./dryRun');

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
        // A saved workflow only runs once somebody has turned it on, which is
        // what saving disabled is for.
        let saved = null;
        if (body.definitionId !== undefined && body.definitionId !== null && body.definitionId !== '') {
            if (!OBJECT_ID.test(String(body.definitionId))) return fail(res, 'Workflow not found.', 404);
            saved = await definitions.get(ctx.companyId, body.definitionId);
            if (!saved) return fail(res, 'Workflow not found.', 404);
            if (!saved.enabled) return fail(res, 'This workflow is turned off. Turn it on before starting a run.', 409);
        }
        const steps = saved ? validateSteps(saved.steps) : stepsFor(body);
        const dedupeKey = key ? `api:${ctx.caller.actor.userId}:${key}` : null;

        const run = await store.createRun(ctx.companyId, {
            workflowId: String(body.workflowId || (saved && saved._id) || `api:${steps[0].type}`),
            name: String(body.name || (saved && saved.name) || '').slice(0, 200),
            source: 'api',
            dedupeKey,
            startedBy: ctx.caller.actor.userId,
            agentId: body.agentId ? String(body.agentId) : null,
            taskId: body.taskId ? String(body.taskId) : null,
            projectId: body.projectId ? String(body.projectId) : null,
            steps,
            ...boundsOf({
                deadlineMs: body.deadlineMs === undefined && saved ? saved.deadlineMs : body.deadlineMs,
                budgetUsd: body.budgetUsd === undefined && saved ? saved.budgetUsd : body.budgetUsd,
            }),
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

/* GET /api/v2/workflows/step-types
 * The manifest the builder draws its forms from — the same data `validateSteps`
 * reads its rules from, so a step type the server does not know cannot be
 * composed and a rule the server enforces cannot be missing from the form. */
exports.getStepTypes = async (req, res) => {
    try {
        const ctx = await context(req, res);
        if (!ctx) return undefined;
        return ok(res, 'Step types fetched.', stepTypes.manifest());
    } catch (error) {
        logger.error(`[workflow-api] getStepTypes: ${error.message}`);
        return fail(res, error.message, 500);
    }
};

const failFields = (res, errors) => res.status(400).send({ status: false, statusText: errors[0], message: errors[0], errors });

/* The shape of a saved workflow. The errors come back as a list rather than one
 * sentence so the builder can mark the slot that is wrong. */
const definitionFrom = (body) => {
    const errors = [];
    const name = String(body.name || '').trim();
    if (!name) errors.push('name: required');
    let steps = [];
    try {
        steps = validateSteps(body.steps);
    } catch (error) {
        const checked = stepTypes.validateSteps(Array.isArray(body.steps) ? body.steps : []);
        errors.push(...(checked.valid ? [error.message] : checked.errors));
    }
    try {
        boundsOf(body);
    } catch (error) {
        errors.push(error.message);
    }
    return { errors, value: { name, description: body.description || '', steps, deadlineMs: body.deadlineMs, budgetUsd: body.budgetUsd } };
};

exports.listDefinitions = async (req, res) => {
    try {
        const ctx = await context(req, res);
        if (!ctx) return undefined;
        if (!requireManager(res, ctx.caller)) return undefined;
        return ok(res, 'Workflows fetched.', await definitions.list(ctx.companyId));
    } catch (error) {
        logger.error(`[workflow-api] listDefinitions: ${error.message}`);
        return fail(res, error.message, 500);
    }
};

/* The approval half of the API.
 *
 * An approval step waits on a row in `workflow_approvals`; these three routes
 * are how a person sees that row, answers it and hands it on. Deciding is the
 * approvals helper's own compare-and-set, so the wake of the step and the
 * "somebody else got there first" answer are the ones it already had.
 *
 * Who may answer is not the manage rule on its own: an approval names an owner,
 * and the owner of the step answers it whatever their role. An Owner or an Admin
 * may answer any of them, because they can already retry, skip and compensate
 * the step the approval is holding. A past owner may not: a request handed on is
 * not theirs any more. */
const ownsApproval = (caller, request) => Boolean(request.ownerUserId)
    && String(request.ownerUserId) === String(caller.actor.userId);

const mayDecide = (caller, request) => caller.privileged || ownsApproval(caller, request);

const approvalRow = (request, run, step, names) => {
    const owners = (request.owners || []).map(String);
    return {
        _id: String(request._id),
        runId: String(request.runId),
        stepId: String(request.stepId),
        workflowId: request.workflowId || null,
        title: request.title || '',
        prompt: request.prompt || '',
        status: request.status,
        ownerUserId: request.ownerUserId ? String(request.ownerUserId) : null,
        ownerName: names[String(request.ownerUserId)] || null,
        ownerRole: request.ownerRole || null,
        owners,
        ownerNames: owners.map((id) => names[id] || null),
        escalateToUserId: request.escalateToUserId ? String(request.escalateToUserId) : null,
        escalateToName: names[String(request.escalateToUserId)] || null,
        escalateAt: request.escalateAt || null,
        escalatedAt: request.escalatedAt || null,
        deadlineAt: request.deadlineAt || null,
        onDeadline: request.onDeadline || 'fail',
        decidedBy: request.decidedBy ? String(request.decidedBy) : null,
        decidedByName: names[String(request.decidedBy)] || null,
        decidedAt: request.decidedAt || null,
        comment: request.comment || '',
        reassignedBy: request.reassignedBy ? String(request.reassignedBy) : null,
        reassignedAt: request.reassignedAt || null,
        reassignments: (request.reassignments || []).map((move) => ({
            ...move,
            fromName: names[String(move.from)] || null,
            toName: names[String(move.to)] || null,
            byName: names[String(move.by)] || null,
        })),
        createdAt: request.createdAt || null,
        context: request.context || {},
        run: run ? { _id: String(run._id), name: run.name || '', workflowId: run.workflowId, status: run.status, startedBy: run.startedBy || null } : null,
        step: step ? { stepId: step.stepId, type: step.type, status: step.status, waitUntil: step.waitUntil || null } : null,
    };
};

const namesForApprovals = (rows) => people.namesOf(rows.flatMap((row) => [
    row.ownerUserId, row.escalateToUserId, row.decidedBy, row.reassignedBy,
    ...(row.owners || []), ...(row.reassignments || []).flatMap((move) => [move.from, move.to, move.by]),
]));

/* GET /api/v2/workflows/approvals?status=pending
 * What a person is being asked to decide. A reader who is neither an Owner nor
 * an Admin sees the ones they own and the ones on a run they may already read —
 * the same visibility `readableRun` gives, so an approval never reveals a run
 * the caller could not open for themselves. */
exports.listApprovals = async (req, res) => {
    try {
        const ctx = await context(req, res);
        if (!ctx) return undefined;
        const status = String((req.query || {}).status || approvals.STATUS.PENDING);
        const rows = (await approvals.listByStatus(ctx.companyId, status)) || [];
        const names = await namesForApprovals(rows);
        const out = [];
        for (const request of rows) {
            const run = await readableRun(ctx.companyId, ctx.caller, request.runId);
            if (!run && !ownsApproval(ctx.caller, request)) continue;
            const step = await store.getStep(ctx.companyId, request.runId, request.stepId);
            out.push({ ...approvalRow(request, run, step, names), canDecide: mayDecide(ctx.caller, request) });
        }
        return ok(res, 'Approvals fetched.', out);
    } catch (error) {
        logger.error(`[workflow-api] listApprovals: ${error.message}`);
        return fail(res, error.message, 500);
    }
};

/* POST /api/v2/workflows/definitions
 * Saved disabled, whatever the body says: enabling is `PATCH …/enabled`, a
 * separate act by a person who has read the workflow back. */
exports.createDefinition = async (req, res) => {
    try {
        const ctx = await context(req, res);
        if (!ctx) return undefined;
        if (!requireManager(res, ctx.caller)) return undefined;
        const { errors, value } = definitionFrom(req.body || {});
        if (errors.length) return failFields(res, errors);
        const saved = await definitions.create(ctx.companyId, { ...value, by: ctx.caller.actor.userId });
        return ok(res, 'Workflow saved.', saved);
    } catch (error) {
        logger.error(`[workflow-api] createDefinition: ${error.message}`);
        return fail(res, error.message, error.status || 500);
    }
};

exports.updateDefinition = async (req, res) => {
    try {
        const ctx = await context(req, res);
        if (!ctx) return undefined;
        if (!requireManager(res, ctx.caller)) return undefined;
        if (!OBJECT_ID.test(String(req.params.id || ''))) return fail(res, 'Workflow not found.', 404);
        const { errors, value } = definitionFrom(req.body || {});
        if (errors.length) return failFields(res, errors);
        const updated = await definitions.update(ctx.companyId, req.params.id, { ...value, by: ctx.caller.actor.userId });
        if (!updated) return fail(res, 'Workflow not found.', 404);
        return ok(res, 'Workflow saved.', updated);
    } catch (error) {
        logger.error(`[workflow-api] updateDefinition: ${error.message}`);
        return fail(res, error.message, error.status || 500);
    }
};

/* PATCH /api/v2/workflows/definitions/:id/enabled
 * A workflow whose definition no longer validates cannot be turned on: the
 * moment enabling means anything is the moment it has to be runnable. */
exports.setDefinitionEnabled = async (req, res) => {
    try {
        const ctx = await context(req, res);
        if (!ctx) return undefined;
        if (!requireManager(res, ctx.caller)) return undefined;
        if (!OBJECT_ID.test(String(req.params.id || ''))) return fail(res, 'Workflow not found.', 404);
        const existing = await definitions.get(ctx.companyId, req.params.id);
        if (!existing) return fail(res, 'Workflow not found.', 404);
        const enabled = (req.body || {}).enabled === true;
        if (enabled) {
            const checked = stepTypes.validateSteps(existing.steps || []);
            if (!checked.valid) return failFields(res, checked.errors);
        }
        const updated = await definitions.setEnabled(ctx.companyId, req.params.id, enabled, ctx.caller.actor.userId);
        return ok(res, enabled ? 'Workflow enabled.' : 'Workflow disabled.', updated);
    } catch (error) {
        logger.error(`[workflow-api] setDefinitionEnabled: ${error.message}`);
        return fail(res, error.message, error.status || 500);
    }
};

exports.deleteDefinition = async (req, res) => {
    try {
        const ctx = await context(req, res);
        if (!ctx) return undefined;
        if (!requireManager(res, ctx.caller)) return undefined;
        if (!OBJECT_ID.test(String(req.params.id || ''))) return fail(res, 'Workflow not found.', 404);
        const removed = await definitions.remove(ctx.companyId, req.params.id);
        if (!removed) return fail(res, 'Workflow not found.', 404);
        return ok(res, 'Workflow removed.', { _id: removed._id });
    } catch (error) {
        logger.error(`[workflow-api] deleteDefinition: ${error.message}`);
        return fail(res, error.message, error.status || 500);
    }
};

/* The approval a route is about, with the caller's standing on it settled. */
const approvalContext = async (req, res) => {
    const ctx = await context(req, res);
    if (!ctx) return null;
    if (!STEP_ID.test(String(req.params.stepId || ''))) { fail(res, 'A valid step id is required.'); return null; }
    if (!OBJECT_ID.test(String(req.params.id || ''))) { fail(res, 'Approval not found.', 404); return null; }
    const request = await approvals.get(ctx.companyId, req.params.id, req.params.stepId);
    if (!request) { fail(res, 'Approval not found.', 404); return null; }
    if (!mayDecide(ctx.caller, request)) {
        fail(res, 'Only the owner of this approval, an Owner or an Admin can act on it.', 403);
        return null;
    }
    return { ...ctx, request };
};

/* A decision reopens the run and puts it back on the queue, for the same reason
 * a step control does: there is one way a run is moved forward. */
const wake = async (companyId, runId) => {
    await store.reopenRun(companyId, runId);
    return queue.dispatch(companyId, runId);
};

const approvalAnswer = async (companyId, request, caller, statusText, res, extra = {}) => {
    const names = await namesForApprovals([request]);
    const run = await store.getRun(companyId, request.runId);
    const step = await store.getStep(companyId, request.runId, request.stepId);
    return ok(res, statusText, {
        approval: { ...approvalRow(request, run, step, names), canDecide: mayDecide(caller, request) },
        ...extra,
    });
};

/* POST /api/v2/workflows/runs/:id/steps/:stepId/decide
 * body: { decision: 'approved' | 'rejected', comment? } */
exports.decideApproval = async (req, res) => {
    try {
        const ctx = await approvalContext(req, res);
        if (!ctx) return undefined;
        const decision = String((req.body || {}).decision || '');
        if (!approvals.DECISIONS.includes(decision)) return fail(res, `decision must be one of ${approvals.DECISIONS.join(', ')}.`);
        const decided = await approvals.decide(ctx.companyId, {
            runId: req.params.id,
            stepId: req.params.stepId,
            decision,
            decidedBy: ctx.caller.actor.userId,
            comment: String((req.body || {}).comment || '').slice(0, REASON_MAX),
        });
        if (!decided) return fail(res, 'This approval has already been decided.', 409);
        const dispatched = await wake(ctx.companyId, req.params.id);
        const statusText = decision === approvals.STATUS.APPROVED ? 'Approved.' : 'Rejected.';
        return approvalAnswer(ctx.companyId, decided, ctx.caller, statusText, res, { dispatched });
    } catch (error) {
        logger.error(`[workflow-api] decideApproval: ${error.message}`);
        return fail(res, error.message, error.status || 500);
    }
};

/* The real thing the author wants to try the workflow against, read rather than
 * touched. A task that is not there is an answer, not an error: the plan comes
 * back saying the input was not found. */
const inputFor = async (companyId, body) => {
    if (OBJECT_ID.test(String(body.taskId || ''))) {
        const task = await MongoDbCrudOpration(companyId, {
            type: SCHEMA_TYPE.TASKS, data: [{ _id: String(body.taskId) }, { TaskName: 1, ProjectID: 1 }],
        }, 'findOne');
        if (!task) return { kind: 'task', id: String(body.taskId), found: false };
        return { kind: 'task', id: String(task._id), name: task.TaskName || '', projectId: task.ProjectID ? String(task.ProjectID) : null, found: true };
    }
    if (OBJECT_ID.test(String(body.projectId || ''))) {
        const project = await MongoDbCrudOpration(companyId, {
            type: SCHEMA_TYPE.PROJECTS, data: [{ _id: String(body.projectId) }, { ProjectName: 1 }],
        }, 'findOne');
        if (!project) return { kind: 'project', id: String(body.projectId), found: false };
        return { kind: 'project', id: String(project._id), name: project.ProjectName || '', found: true };
    }
    return { kind: 'none', found: false };
};

/* POST /api/v2/workflows/dry-run
 * body: { steps, deadlineMs?, budgetUsd?, taskId? | projectId? }
 *
 * What the workflow would do against a real input, and nothing else: the same
 * validation and the same ready-set scheduling a start would reach, over step
 * rows held in memory. No run is created, no queue job is booked and no step
 * executor is called, so an author can try a workflow on the task they actually
 * care about without it happening to that task.
 *
 * An invalid definition is a 200 whose plan says so, with the field named. The
 * dry run did its job — it told you the workflow is wrong. */
exports.dryRun = async (req, res) => {
    try {
        const ctx = await context(req, res);
        if (!ctx) return undefined;
        if (!requireManager(res, ctx.caller)) return undefined;
        const body = req.body || {};
        const steps = Array.isArray(body.steps) ? body.steps : [];
        if (!steps.length) return fail(res, 'steps must be a non-empty array');
        if (steps.length > MAX_STEPS) return fail(res, `a workflow may not have more than ${MAX_STEPS} steps`);
        const input = await inputFor(ctx.companyId, body);
        return ok(res, 'Dry run planned.', dryRun.plan({ steps, deadlineMs: body.deadlineMs, budgetUsd: body.budgetUsd, input }));
    } catch (error) {
        logger.error(`[workflow-api] dryRun: ${error.message}`);
        return fail(res, error.message, error.status || 500);
    }
};

/* POST /api/v2/workflows/runs/:id/steps/:stepId/reassign
 * body: { toUserId, reason? }
 * The handover is recorded rather than merely applied: who moved it, from whom,
 * to whom and when, so a request that has travelled can say where it has been. */
exports.reassignApproval = async (req, res) => {
    try {
        const ctx = await approvalContext(req, res);
        if (!ctx) return undefined;
        const toUserId = String((req.body || {}).toUserId || '');
        if (!OBJECT_ID.test(toUserId)) return fail(res, 'A valid toUserId is required.');
        if (toUserId === String(ctx.request.ownerUserId || '')) return fail(res, 'This approval is already theirs.', 409);
        if ((await getRoleType(ctx.companyId, toUserId)) === null) return fail(res, 'That person is not a member of this company.');
        const moved = await approvals.reassign(ctx.companyId, {
            runId: req.params.id,
            stepId: req.params.stepId,
            toUserId,
            by: ctx.caller.actor.userId,
            reason: reasonOf(req),
        });
        if (!moved) return fail(res, 'This approval has already been decided or handed on.', 409);
        return approvalAnswer(ctx.companyId, moved, ctx.caller, 'Approval reassigned.', res);
    } catch (error) {
        logger.error(`[workflow-api] reassignApproval: ${error.message}`);
        return fail(res, error.message, error.status || 500);
    }
};

exports.UNAVAILABLE = UNAVAILABLE;
