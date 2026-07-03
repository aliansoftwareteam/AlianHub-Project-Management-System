// AHE-3792 — the AI Brain's "hands".
//
// A typed, allow-listed set of the ONLY actions the agent may ever perform.
// Every action is company-scoped (the caller passes companyId), permission-
// checked and autonomy-gated by the dispatcher. Registering an action here is
// the only way to give the Brain a new capability — nothing off this list can
// run, which is the core safety boundary of the whole system.
//
// Action shape:
//   {
//     label, category, riskLevel,        // metadata (shown in UI / audit)
//     minAutonomyToAutoRun,              // AI may auto-run only when the
//                                        //   company's autonomy level >= this
//     requiredPermission,                // AlianHub permission key (or null)
//     handler: async (companyId, params, ctx) => resultObject
//   }
//
// Autonomy levels: 0 Assist · 1 Suggest · 2 Act-in-bounds · 3 Scheduled ·
// 4 Lifecycle. A `minAutonomyToAutoRun` of 99 means "can NEVER auto-run" — it
// always routes to the AI inbox for a human decision (money / production /
// deletes), by design, forever.
//
// The comment / status / assign actions are WIRED to AlianHub's own write paths
// (see ./handlers.js) — they behave exactly like a human's edit: same
// collections, same Socket.io events, same history/notifications. Creating a
// task and deploys/deletes stay intentionally manual (see manualOnly).

const handlers = require('./handlers');

// Intentionally human-only actions stay registered (so they're visible +
// auditable) but refuse to auto-run: creating a task needs a target sprint/type
// the agent shouldn't invent, and deploys / deletes are gated to a human by
// design.
const manualOnly = (key, why) => () => {
    const err = new Error(`"${key}" is intentionally manual — ${why}`);
    err.code = 'AI_ACTION_MANUAL_ONLY';
    throw err;
};

const ACTIONS = {
    // Fully working, side-effect-free demo action. Proves the
    // propose -> (gate) -> execute/inbox -> audit pipeline end to end without
    // touching any real data.
    log_note: {
        label: 'Log a note',
        category: 'report',
        riskLevel: 'low',
        minAutonomyToAutoRun: 2,
        requiredPermission: null,
        handler: async (companyId, params) => ({ noted: true, note: String((params && params.note) || '') }),
    },

    // ── Execute-stage actions (low/medium risk) ──
    post_task_comment: {
        label: 'Post a comment on a task',
        category: 'execute',
        riskLevel: 'low',
        minAutonomyToAutoRun: 2,
        requiredPermission: 'task.comment',
        handler: handlers.postTaskComment,
    },
    nudge_stale_task: {
        label: 'Nudge a stale task (reminder comment)',
        category: 'execute',
        riskLevel: 'low',
        minAutonomyToAutoRun: 2,
        requiredPermission: 'task.comment',
        handler: handlers.nudgeStaleTask,
    },
    set_task_status: {
        label: 'Change a task status',
        category: 'execute',
        riskLevel: 'medium',
        minAutonomyToAutoRun: 2,
        requiredPermission: 'task.update',
        handler: handlers.setTaskStatus,
    },
    assign_task: {
        label: 'Assign a task to a user',
        category: 'execute',
        riskLevel: 'medium',
        minAutonomyToAutoRun: 2,
        requiredPermission: 'task.assign',
        handler: handlers.assignTask,
    },

    // ── Plan-stage actions (medium risk) ──
    create_task: {
        label: 'Create a task',
        category: 'plan',
        riskLevel: 'medium',
        minAutonomyToAutoRun: 3,
        requiredPermission: 'task.create',
        handler: manualOnly('create_task', 'creating a task needs a target sprint + type the agent should not invent — use the UI or a dedicated flow'),
    },

    // ── Autonomous development (Phase B) — handed to the self-hosted runner ──
    develop_task: {
        label: 'Develop a task (write code + open a PR)',
        category: 'develop',
        riskLevel: 'critical',
        minAutonomyToAutoRun: 99,   // NEVER auto — always human-approved, then queued for the runner
        requiredPermission: 'task.develop',
        deferToRunner: true,        // the self-hosted dev runner executes this, not the dispatcher
        handler: manualOnly('develop_task', 'handled by the self-hosted dev runner after approval — never runs inline'),
    },

    // ── Ship-stage (high risk) ──
    trigger_staging_deploy: {
        label: 'Trigger a staging deploy',
        category: 'ship',
        riskLevel: 'high',
        minAutonomyToAutoRun: 4,
        requiredPermission: 'deploy.staging',
        handler: manualOnly('trigger_staging_deploy', 'deploys run from CI, not the agent'),
    },

    // ── Never-auto actions (critical) — always require a human, even at L4 ──
    trigger_production_deploy: {
        label: 'Trigger a PRODUCTION deploy',
        category: 'ship',
        riskLevel: 'critical',
        minAutonomyToAutoRun: 99,
        requiredPermission: 'deploy.production',
        handler: manualOnly('trigger_production_deploy', 'production deploys are human-only by design'),
    },
    delete_entity: {
        label: 'Delete a task / project',
        category: 'destructive',
        riskLevel: 'critical',
        minAutonomyToAutoRun: 99,
        requiredPermission: 'entity.delete',
        handler: manualOnly('delete_entity', 'deletions are human-only by design'),
    },
};

const getAction = (key) => ACTIONS[key] || null;

// Public, handler-free view of the registry (for the UI / API).
const listActions = () => Object.keys(ACTIONS).map((key) => {
    const a = ACTIONS[key];
    return {
        key,
        label: a.label,
        category: a.category,
        riskLevel: a.riskLevel,
        minAutonomyToAutoRun: a.minAutonomyToAutoRun,
        requiredPermission: a.requiredPermission || null,
        neverAuto: a.minAutonomyToAutoRun >= 99,
        deferToRunner: !!a.deferToRunner,
    };
});

module.exports = { ACTIONS, getAction, listActions };
