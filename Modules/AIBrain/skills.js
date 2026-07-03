// AHE-3792 — the Brain's "Think" step: skills.
//
// A skill perceives (buildProjectContext), decides what should happen, and
// routes each action through the dispatcher. At the default autonomy level
// those actions become AI-inbox PROPOSALS for a human to approve — so a skill
// run is safe by construction: it only ever writes to the Brain's own
// ai_inbox / ai_audit_log, never to tasks directly (the dispatcher does that,
// gated).
//
// Two skills ship today:
//   • project_health_check — DETERMINISTIC rules (no LLM): overdue → comment,
//     stale → nudge, unassigned → flag comment.
//   • ai_project_review — LLM-backed (see ./llmThink.js): the model reads the
//     project snapshot and writes prioritised, task-specific nudge comments.
// Both feed the SAME dispatchPlan() loop, so the gate / autonomy / audit
// behaviour is identical regardless of how the plan was produced.

const { buildProjectContext } = require('./perceive');
const { dispatch } = require('./dispatcher');
const { handledActionKeys } = require('./aiStore');
const { reviewProject } = require('./llmThink');

const dayStr = (d) => { try { return new Date(d).toISOString().slice(0, 10); } catch (e) { return '?'; } };

// Route a plan of proposals through the dispatcher, skipping any (task, action)
// the agent already surfaced recently (proposed / executed / declined) so
// re-scans don't spam duplicates. Counts each outcome honestly.
async function dispatchPlan(companyId, projectId, skillKey, actorUserId, plan) {
    const seen = await handledActionKeys(companyId, projectId);
    let proposed = 0, executed = 0, failed = 0, blocked = 0, skipped = 0;
    for (const p of plan) {
        if (seen.has(`${p.taskId}|${p.actionKey}`)) { skipped += 1; continue; }
        // eslint-disable-next-line no-await-in-loop
        const outcome = await dispatch(companyId, {
            actionKey: p.actionKey, params: p.params, reason: p.reason,
            projectId, taskId: p.taskId, skill: skillKey,
            actorType: 'ai', actorUserId,
        });
        if (outcome.status === 'proposed') proposed += 1;
        else if (outcome.status === 'executed') executed += 1;
        else if (outcome.status === 'failed') failed += 1;
        else blocked += 1;
    }
    return { proposed, executed, failed, blocked, skipped };
}

const SKILLS = {
    project_health_check: {
        label: 'Project health check (rules)',
        description: 'Scans a project and takes follow-ups: assigns unassigned tasks to the project lead, nudges stale tasks, and reminds on overdue ones. Deterministic — no LLM.',
        // Per-category cap so a big backlog can't flood the inbox in one run.
        cap: 5,
        run: async (companyId, opts = {}) => {
            const projectId = String(opts.projectId || '');
            const actorUserId = String(opts.actorUserId || '');
            const ctx = await buildProjectContext(companyId, { projectId, restrictToSelf: false, staleDays: opts.staleDays });
            if (!ctx) return { status: 'error', error: 'project not found' };

            const cap = SKILLS.project_health_check.cap;
            const plan = [];
            ctx.overdue.slice(0, cap).forEach((t) => plan.push({
                actionKey: 'post_task_comment', taskId: String(t._id),
                reason: `Task ${t.TaskKey || ''} is overdue (due ${dayStr(t.DueDate)}) — post a reminder to the assignee.`,
                params: { text: `Reminder: "${t.TaskName}" is past its due date (${dayStr(t.DueDate)}).` },
            }));
            ctx.stale.slice(0, cap).forEach((t) => plan.push({
                actionKey: 'nudge_stale_task', taskId: String(t._id),
                reason: `Task ${t.TaskKey || ''} hasn't moved in ${ctx.staleDays}+ days — nudge the owner for a status update.`,
                params: {},
            }));
            // Unassigned tasks: if the project has a lead, propose assigning the
            // task to them (the lead can re-delegate); otherwise fall back to a
            // flag comment. Still gated — proposes at L1, auto-assigns at L2+.
            const leadId = (Array.isArray(ctx.project.LeadUserId) && ctx.project.LeadUserId.length) ? String(ctx.project.LeadUserId[0]) : '';
            ctx.unassigned.slice(0, cap).forEach((t) => {
                if (leadId) {
                    plan.push({
                        actionKey: 'assign_task', taskId: String(t._id),
                        reason: `Task ${t.TaskKey || ''} is unassigned — assign it to the project lead to triage.`,
                        params: { assigneeUserId: leadId },
                    });
                } else {
                    plan.push({
                        actionKey: 'post_task_comment', taskId: String(t._id),
                        reason: `Task ${t.TaskKey || ''} is unassigned — flag it so an owner gets assigned.`,
                        params: { text: `This task has no assignee yet — could someone pick it up, or assign an owner?` },
                    });
                }
            });

            const counts = await dispatchPlan(companyId, projectId, 'project_health_check', actorUserId, plan);
            return {
                status: 'ok',
                project: { projectId, name: (ctx.project && ctx.project.ProjectName) || '' },
                found: { overdue: ctx.overdue.length, stale: ctx.stale.length, unassigned: ctx.unassigned.length },
                ...counts,
            };
        },
    },

    ai_project_review: {
        label: 'AI project review (LLM)',
        description: 'Uses the configured LLM to read the project and write specific, prioritised nudge comments for the tasks that most need attention. Proposals go to the AI inbox (or auto-run, per your autonomy level).',
        run: async (companyId, opts = {}) => {
            const projectId = String(opts.projectId || '');
            const actorUserId = String(opts.actorUserId || '');
            const ctx = await buildProjectContext(companyId, { projectId, restrictToSelf: false, staleDays: opts.staleDays });
            if (!ctx) return { status: 'error', error: 'project not found' };

            let review;
            try {
                review = await reviewProject(companyId, ctx);
            } catch (e) {
                // Surface the exact LLM error (not configured / rate-limited /
                // parse failure) as a clean result the UI can show.
                return { status: 'error', error: e && e.message ? e.message : String(e) };
            }

            const counts = await dispatchPlan(companyId, projectId, 'ai_project_review', actorUserId, review.plan);
            return {
                status: 'ok',
                project: { projectId, name: (ctx.project && ctx.project.ProjectName) || '' },
                found: { overdue: ctx.overdue.length, stale: ctx.stale.length, unassigned: ctx.unassigned.length },
                summary: review.summary,
                model: review.model,
                tokens: review.tokens,
                ...counts,
            };
        },
    },
};

const getSkill = (key) => SKILLS[key] || null;
const listSkills = () => Object.keys(SKILLS).map((key) => ({
    key, label: SKILLS[key].label, description: SKILLS[key].description,
}));

module.exports = { SKILLS, getSkill, listSkills };
