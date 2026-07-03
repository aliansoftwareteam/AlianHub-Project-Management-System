// AHE-3792 — AI Brain HTTP controller (Phase 1: the safe spine).
//
// Exposes the per-company autonomy settings, the action registry, the audit
// log, and the AI inbox (approve / decline). All endpoints are companyId-scoped
// (read from the `companyid` header, like the rest of the app); mutations are
// gated to Owner/Admin (roleType 1/2). Read-only where not gated.

const logger = require('../../Config/loggerConfig');
const mongoose = require('mongoose');
const { listActions, getAction } = require('./actionRegistry');
const { dispatch, runAction, getSettings, writeAudit } = require('./dispatcher');
const { buildProjectContext } = require('./perceive');
const { listSkills, getSkill } = require('./skills');
const store = require('./aiStore');
const handlers = require('./handlers');
const crypto = require('crypto');

const isAdmin = (roleType) => Number(roleType) === 1 || Number(roleType) === 2;

// Surface the actual error to the client (AI Brain is Owner/Admin-only, so this
// is safe) — a generic "failed" hides the real cause and makes issues hard to
// diagnose. Keeps a friendly `message` + adds the exact `error`.
const fail = (res, message, error) => res.status(500).json({
    status: false,
    message,
    error: error && error.message ? error.message : String(error),
});

// GET /api/v1/ai-brain/settings
exports.getSettings = async (req, res) => {
    try {
        const companyId = req.headers['companyid'];
        if (!companyId) return res.status(400).json({ status: false, message: 'companyId header required' });
        const settings = await getSettings(companyId);
        return res.status(200).json({ status: true, data: settings });
    } catch (error) {
        logger.error(`AIBrain getSettings error: ${error && error.message ? error.message : error}`);
        return fail(res, 'Failed to load AI Brain settings', error);
    }
};

// POST /api/v1/ai-brain/settings  (admin only)
exports.updateSettings = async (req, res) => {
    try {
        const companyId = req.headers['companyid'];
        if (!companyId) return res.status(400).json({ status: false, message: 'companyId header required' });
        const b = req.body || {};
        if (!isAdmin(b.callerRoleType)) return res.status(403).json({ status: false, message: 'Owner/Admin only' });

        const set = { key: 'default', updatedBy: String(b.callerUserId || '') };
        if (b.autonomyLevel !== undefined) set.autonomyLevel = Math.max(0, Math.min(4, Number(b.autonomyLevel) || 0));
        if (b.killSwitch !== undefined) set.killSwitch = !!b.killSwitch;
        if (b.spendCapUSD !== undefined) set.spendCapUSD = Number(b.spendCapUSD) || 0;
        if (b.dailyActionLimit !== undefined) set.dailyActionLimit = Number(b.dailyActionLimit) || 0;
        if (Array.isArray(b.allowedActions)) set.allowedActions = b.allowedActions.map(String);

        const updated = await store.upsertSettings(companyId, set);
        return res.status(200).json({ status: true, data: updated });
    } catch (error) {
        logger.error(`AIBrain updateSettings error: ${error && error.message ? error.message : error}`);
        return fail(res, 'Failed to update AI Brain settings', error);
    }
};

// GET /api/v1/ai-brain/repos — per-project repo bindings (the agent's "work locations")
exports.listRepos = async (req, res) => {
    try {
        const companyId = req.headers['companyid'];
        if (!companyId) return res.status(400).json({ status: false, message: 'companyId header required' });
        const doc = await store.getSettingsDoc(companyId);
        return res.status(200).json({ status: true, data: (doc && doc.repos) || {} });
    } catch (error) {
        logger.error(`AIBrain listRepos error: ${error && error.message ? error.message : error}`);
        return fail(res, 'Failed to load repo bindings', error);
    }
};

// POST /api/v1/ai-brain/repos  (admin only) — bind a project to its code repo
exports.setRepo = async (req, res) => {
    try {
        const companyId = req.headers['companyid'];
        if (!companyId) return res.status(400).json({ status: false, message: 'companyId header required' });
        const b = req.body || {};
        if (!isAdmin(b.callerRoleType)) return res.status(403).json({ status: false, message: 'Owner/Admin only' });
        const projectId = String(b.projectId || '');
        if (!projectId || !mongoose.Types.ObjectId.isValid(projectId)) {
            return res.status(400).json({ status: false, message: 'valid projectId required' });
        }
        const repo = {
            gitUrl: String(b.gitUrl || '').trim(),
            branch: String(b.branch || '').trim() || 'main',
            localPath: String(b.localPath || '').trim(),
            updatedBy: String(b.callerUserId || ''),
        };
        if (!repo.gitUrl && !repo.localPath) {
            return res.status(400).json({ status: false, message: 'a gitUrl or localPath is required' });
        }
        const updated = await store.setProjectRepo(companyId, projectId, repo);
        return res.status(200).json({ status: true, data: (updated && updated.repos) || {} });
    } catch (error) {
        logger.error(`AIBrain setRepo error: ${error && error.message ? error.message : error}`);
        return fail(res, 'Failed to save repo binding', error);
    }
};

// GET /api/v1/ai-brain/actions  — the registry (handler-free view)
exports.listActions = async (req, res) => {
    try {
        return res.status(200).json({ status: true, data: listActions() });
    } catch (error) {
        logger.error(`AIBrain listActions error: ${error && error.message ? error.message : error}`);
        return fail(res, 'Failed to list actions', error);
    }
};

// POST /api/v1/ai-brain/audit  — recent audit entries (filterable)
exports.listAudit = async (req, res) => {
    try {
        const companyId = req.headers['companyid'];
        if (!companyId) return res.status(400).json({ status: false, message: 'companyId header required' });
        const b = req.body || {};
        const filter = { deletedStatusKey: { $in: [0, null] } };
        if (b.projectId) filter.projectId = String(b.projectId);
        if (b.status) filter.status = String(b.status);
        if (b.actionKey) filter.actionKey = String(b.actionKey);
        const limit = Math.min(Number(b.limit) || 50, 200);
        const skip = Math.max(Number(b.skip) || 0, 0);
        const rows = await store.listAudit(companyId, filter, limit, skip);
        return res.status(200).json({ status: true, data: rows || [] });
    } catch (error) {
        logger.error(`AIBrain listAudit error: ${error && error.message ? error.message : error}`);
        return fail(res, 'Failed to load audit log', error);
    }
};

// GET /api/v1/ai-brain/inbox?status=pending
exports.listInbox = async (req, res) => {
    try {
        const companyId = req.headers['companyid'];
        if (!companyId) return res.status(400).json({ status: false, message: 'companyId header required' });
        const status = req.query && req.query.status ? String(req.query.status) : 'pending';
        const filter = { deletedStatusKey: { $in: [0, null] } };
        if (status !== 'all') filter.status = status;
        const rows = await store.listInbox(companyId, filter, 100);
        return res.status(200).json({ status: true, data: rows || [] });
    } catch (error) {
        logger.error(`AIBrain listInbox error: ${error && error.message ? error.message : error}`);
        return fail(res, 'Failed to load AI inbox', error);
    }
};

// POST /api/v1/ai-brain/inbox/decide  (admin only) — approve or decline
exports.decideInbox = async (req, res) => {
    try {
        const companyId = req.headers['companyid'];
        if (!companyId) return res.status(400).json({ status: false, message: 'companyId header required' });
        const b = req.body || {};
        if (!isAdmin(b.callerRoleType)) return res.status(403).json({ status: false, message: 'Owner/Admin only' });

        const inboxId = b.inboxId;
        const decision = b.decision;
        if (!inboxId || !mongoose.Types.ObjectId.isValid(String(inboxId))) {
            return res.status(400).json({ status: false, message: 'valid inboxId required' });
        }
        if (!['approve', 'decline'].includes(decision)) {
            return res.status(400).json({ status: false, message: "decision must be 'approve' or 'decline'" });
        }

        const item = await store.findInboxItem(companyId, inboxId);
        if (!item) return res.status(404).json({ status: false, message: 'inbox item not found' });
        if (item.status !== 'pending') return res.status(409).json({ status: false, message: `already ${item.status}` });

        const decidedBy = String(b.callerUserId || '');
        const ctxBase = {
            actionKey: item.actionKey, params: item.params || {}, reason: item.reason,
            projectId: item.projectId, taskId: item.taskId, skill: item.skill,
            actorType: 'user', actorUserId: decidedBy, inboxId: String(item._id),
        };

        if (decision === 'decline') {
            const updated = await store.updateInboxItem(companyId, item._id, { status: 'declined', decidedBy, decidedAt: new Date() });
            await writeAudit(companyId, { ...ctxBase, status: 'declined' });
            return res.status(200).json({ status: true, data: updated });
        }

        // approve -> run the action (a human decided, so it bypasses the autonomy gate)
        const action = getAction(item.actionKey);
        if (!action) return res.status(400).json({ status: false, message: 'unknown action on inbox item' });
        // Actions that defer to the self-hosted runner (develop_task) don't run
        // inline — approving QUEUES a job the runner will pick up + report on.
        if (action.deferToRunner) {
            const queued = await store.updateInboxItem(companyId, item._id, { status: 'queued', decidedBy, decidedAt: new Date() });
            await writeAudit(companyId, { ...ctxBase, status: 'queued' });
            return res.status(200).json({ status: true, data: queued, outcome: { status: 'queued', reason: 'queued for the dev runner' } });
        }
        const outcome = await runAction(companyId, action, ctxBase);
        const updated = await store.updateInboxItem(companyId, item._id, {
            status: outcome.status === 'executed' ? 'executed' : 'failed',
            decidedBy, decidedAt: new Date(), result: outcome.result || {}, error: outcome.error || '',
        });
        return res.status(200).json({ status: true, data: updated, outcome });
    } catch (error) {
        logger.error(`AIBrain decideInbox error: ${error && error.message ? error.message : error}`);
        return fail(res, 'Failed to decide inbox item', error);
    }
};

// POST /api/v1/ai-brain/propose  — push an action through the gate. This is the
// single entry point the skills / brain (and manual testing) use; actorType
// defaults to 'ai'. Returns { status: executed | proposed | blocked | failed }.
exports.propose = async (req, res) => {
    try {
        const companyId = req.headers['companyid'];
        if (!companyId) return res.status(400).json({ status: false, message: 'companyId header required' });
        const b = req.body || {};
        if (!b.actionKey) return res.status(400).json({ status: false, message: 'actionKey required' });
        const outcome = await dispatch(companyId, {
            actionKey: String(b.actionKey),
            params: b.params || {},
            reason: String(b.reason || ''),
            projectId: String(b.projectId || ''),
            taskId: String(b.taskId || ''),
            skill: String(b.skill || ''),
            actorType: b.actorType === 'user' ? 'user' : 'ai',
            actorUserId: String(b.callerUserId || ''),
        });
        return res.status(200).json({ status: true, data: outcome });
    } catch (error) {
        logger.error(`AIBrain propose error: ${error && error.message ? error.message : error}`);
        return fail(res, 'Failed to dispatch action', error);
    }
};

// POST /api/v1/ai-brain/perceive  — the Brain's "eyes" (Perceive step).
// A READ-ONLY, companyId-scoped snapshot of one project the agent/skills reason
// over: task counts by status plus the actionable lists (overdue, stale,
// unassigned). Role-scoped: non-admins see only tasks assigned to them. This
// endpoint never writes anything — it's pure perception.
exports.getProjectContext = async (req, res) => {
    try {
        const companyId = req.headers['companyid'];
        if (!companyId) return res.status(400).json({ status: false, message: 'companyId header required' });
        const b = req.body || {};
        const projectId = String(b.projectId || '');
        if (!projectId || !mongoose.Types.ObjectId.isValid(projectId)) {
            return res.status(400).json({ status: false, message: 'valid projectId required' });
        }
        const restrictToSelf = !isAdmin(b.callerRoleType);
        const ctx = await buildProjectContext(companyId, {
            projectId, callerUserId: String(b.callerUserId || ''), restrictToSelf, staleDays: b.staleDays,
        });
        if (!ctx) return res.status(404).json({ status: false, message: 'project not found' });

        const slim = (t) => ({
            taskId: String(t._id), taskKey: t.TaskKey || '', taskName: t.TaskName || '',
            statusType: t.statusType || '', dueDate: t.DueDate || null,
            sprintId: (t.sprintArray && t.sprintArray.id) || '',
        });
        const cap = (arr) => arr.slice(0, 10).map(slim);
        return res.status(200).json({
            status: true,
            data: {
                project: { projectId, name: ctx.project.ProjectName || '', code: ctx.project.ProjectCode || '', statusType: ctx.project.statusType || '' },
                totals: { tasks: ctx.list.length, byStatus: ctx.byStatus, overdue: ctx.overdue.length, stale: ctx.stale.length, unassigned: ctx.unassigned.length },
                observations: { overdue: cap(ctx.overdue), stale: cap(ctx.stale), unassigned: cap(ctx.unassigned) },
                staleDays: ctx.staleDays,
                scope: restrictToSelf ? 'self' : 'all',
                truncated: ctx.truncated,
            },
        });
    } catch (error) {
        logger.error(`AIBrain getProjectContext error: ${error && error.message ? error.message : error}`);
        return fail(res, 'Failed to build project context', error);
    }
};

// GET /api/v1/ai-brain/skills — the available skills (Think playbooks).
exports.listSkills = async (req, res) => {
    try {
        return res.status(200).json({ status: true, data: listSkills() });
    } catch (error) {
        logger.error(`AIBrain listSkills error: ${error && error.message ? error.message : error}`);
        return fail(res, 'Failed to list skills', error);
    }
};

// POST /api/v1/ai-brain/skills/run — run a skill against a project (Owner/Admin
// only). The skill perceives + proposes actions into the AI inbox; it never
// mutates tasks/projects directly.
exports.runSkill = async (req, res) => {
    try {
        const companyId = req.headers['companyid'];
        if (!companyId) return res.status(400).json({ status: false, message: 'companyId header required' });
        const b = req.body || {};
        if (!isAdmin(b.callerRoleType)) return res.status(403).json({ status: false, message: 'Owner/Admin only' });
        const skill = getSkill(String(b.skill || ''));
        if (!skill) return res.status(400).json({ status: false, message: 'unknown skill' });
        if (!b.projectId) return res.status(400).json({ status: false, message: 'projectId required' });
        const result = await skill.run(companyId, {
            projectId: String(b.projectId), actorUserId: String(b.callerUserId || ''), staleDays: b.staleDays,
        });
        return res.status(200).json({ status: true, data: result });
    } catch (error) {
        logger.error(`AIBrain runSkill error: ${error && error.message ? error.message : error}`);
        return fail(res, 'Failed to run skill', error);
    }
};

// ── Phase B: dev-job pipeline ─────────────────────────────────────────────

// The dev runner is a machine, not a logged-in user — it authenticates with a
// per-company runner token (x-airunner-token header). Returns companyId or null.
const runnerAuth = async (req) => {
    const companyId = req.headers['companyid'];
    const token = req.headers['x-airunner-token'];
    if (!companyId || !token) return null;
    const doc = await store.getSettingsDoc(companyId);
    if (!doc || !doc.runnerToken || String(doc.runnerToken) !== String(token)) return null;
    return companyId;
};

// POST /api/v1/ai-brain/runner-token  (admin) — (re)generate the runner token
exports.generateRunnerToken = async (req, res) => {
    try {
        const companyId = req.headers['companyid'];
        if (!companyId) return res.status(400).json({ status: false, message: 'companyId header required' });
        const b = req.body || {};
        if (!isAdmin(b.callerRoleType)) return res.status(403).json({ status: false, message: 'Owner/Admin only' });
        const token = crypto.randomBytes(24).toString('hex');
        await store.upsertSettings(companyId, { runnerToken: token, updatedBy: String(b.callerUserId || '') });
        return res.status(200).json({ status: true, data: { runnerToken: token } });
    } catch (error) {
        logger.error(`AIBrain generateRunnerToken error: ${error && error.message ? error.message : error}`);
        return fail(res, 'Failed to generate runner token', error);
    }
};

// GET /api/v1/ai-brain/dev-jobs  (runner token) — queued/running jobs, enriched
// with the repo binding + task spec the runner needs to do the work.
exports.listDevJobs = async (req, res) => {
    try {
        const companyId = await runnerAuth(req);
        if (!companyId) return res.status(401).json({ status: false, message: 'invalid or missing runner token' });
        const jobs = await store.listDevJobs(companyId, ['queued', 'running']);
        const settings = await store.getSettingsDoc(companyId);
        const repos = (settings && settings.repos) || {};
        const out = [];
        for (const j of jobs) {
            // eslint-disable-next-line no-await-in-loop
            const task = await store.getTaskSpec(companyId, j.taskId);
            out.push({
                jobId: String(j._id),
                status: j.status,
                projectId: String(j.projectId || ''),
                taskId: String(j.taskId || ''),
                reason: j.reason || '',
                params: j.params || {},
                repo: repos[String(j.projectId)] || null,
                task: task ? { taskKey: task.TaskKey || '', taskName: task.TaskName || '', description: task.description || task.rawDescription || '' } : null,
                createdAt: j.createdAt,
            });
        }
        return res.status(200).json({ status: true, data: out });
    } catch (error) {
        logger.error(`AIBrain listDevJobs error: ${error && error.message ? error.message : error}`);
        return fail(res, 'Failed to list dev jobs', error);
    }
};

// POST /api/v1/ai-brain/dev-jobs/:id/claim  (runner token) — mark a job running
exports.claimDevJob = async (req, res) => {
    try {
        const companyId = await runnerAuth(req);
        if (!companyId) return res.status(401).json({ status: false, message: 'invalid or missing runner token' });
        const jobId = req.params.id;
        if (!jobId || !mongoose.Types.ObjectId.isValid(String(jobId))) return res.status(400).json({ status: false, message: 'valid job id required' });
        const job = await store.findInboxItem(companyId, jobId);
        if (!job || job.actionKey !== 'develop_task') return res.status(404).json({ status: false, message: 'dev job not found' });
        if (job.status !== 'queued') return res.status(409).json({ status: false, message: `job is ${job.status}` });
        const updated = await store.updateInboxItem(companyId, job._id, { status: 'running' });
        await writeAudit(companyId, { actionKey: 'develop_task', taskId: job.taskId, projectId: job.projectId, status: 'running', reason: 'runner claimed the job', actorType: 'runner', inboxId: String(job._id) });
        return res.status(200).json({ status: true, data: updated });
    } catch (error) {
        logger.error(`AIBrain claimDevJob error: ${error && error.message ? error.message : error}`);
        return fail(res, 'Failed to claim dev job', error);
    }
};

// POST /api/v1/ai-brain/dev-jobs/:id/result  (runner token) — report done/failed
exports.completeDevJob = async (req, res) => {
    try {
        const companyId = await runnerAuth(req);
        if (!companyId) return res.status(401).json({ status: false, message: 'invalid or missing runner token' });
        const jobId = req.params.id;
        if (!jobId || !mongoose.Types.ObjectId.isValid(String(jobId))) return res.status(400).json({ status: false, message: 'valid job id required' });
        const b = req.body || {};
        const job = await store.findInboxItem(companyId, jobId);
        if (!job || job.actionKey !== 'develop_task') return res.status(404).json({ status: false, message: 'dev job not found' });
        const ok = String(b.status || '') === 'done';
        const result = { prUrl: String(b.prUrl || ''), branch: String(b.branch || ''), summary: String(b.summary || '') };
        const updated = await store.updateInboxItem(companyId, job._id, { status: ok ? 'done' : 'failed', result, error: String(b.error || '') });
        await writeAudit(companyId, {
            actionKey: 'develop_task', taskId: job.taskId, projectId: job.projectId,
            status: ok ? 'executed' : 'failed',
            reason: ok ? `opened PR: ${result.prUrl}` : `dev failed: ${b.error || ''}`,
            result, error: String(b.error || ''), actorType: 'runner', inboxId: String(job._id),
        });
        // Report the outcome as a comment on the task (best-effort).
        try {
            const text = ok
                ? `Finished this task — opened a PR${result.branch ? ` (branch \`${result.branch}\`)` : ''}: ${result.prUrl}${result.summary ? `\n\n${result.summary}` : ''}`
                : `Couldn't finish this task automatically: ${b.error || 'unknown error'}`;
            await handlers.postTaskComment(companyId, { text }, { taskId: String(job.taskId), actorUserId: String(job.decidedBy || '') });
        } catch (e) {
            logger.error(`AIBrain completeDevJob comment error: ${e && e.message ? e.message : e}`);
        }
        return res.status(200).json({ status: true, data: updated });
    } catch (error) {
        logger.error(`AIBrain completeDevJob error: ${error && error.message ? error.message : error}`);
        return fail(res, 'Failed to complete dev job', error);
    }
};
