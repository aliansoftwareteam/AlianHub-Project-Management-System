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
// NOTE: real AlianHub mutations (comment / status / assign / create / deploy)
// are wired in a later increment with their exact schemas + socket emit +
// cache invalidation. Until then their handlers throw AI_ACTION_NOT_IMPLEMENTED
// so nothing runs half-wired. The gating / audit / inbox pipeline around them
// is fully functional now (see `log_note`, which works end to end).

const notImplemented = (key) => () => {
    const err = new Error(`AI action "${key}" is registered but its handler is not wired yet`);
    err.code = 'AI_ACTION_NOT_IMPLEMENTED';
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
        handler: notImplemented('post_task_comment'),
    },
    nudge_stale_task: {
        label: 'Nudge a stale task (reminder comment)',
        category: 'execute',
        riskLevel: 'low',
        minAutonomyToAutoRun: 2,
        requiredPermission: 'task.comment',
        handler: notImplemented('nudge_stale_task'),
    },
    set_task_status: {
        label: 'Change a task status',
        category: 'execute',
        riskLevel: 'medium',
        minAutonomyToAutoRun: 2,
        requiredPermission: 'task.update',
        handler: notImplemented('set_task_status'),
    },
    assign_task: {
        label: 'Assign a task to a user',
        category: 'execute',
        riskLevel: 'medium',
        minAutonomyToAutoRun: 2,
        requiredPermission: 'task.assign',
        handler: notImplemented('assign_task'),
    },

    // ── Plan-stage actions (medium risk) ──
    create_task: {
        label: 'Create a task',
        category: 'plan',
        riskLevel: 'medium',
        minAutonomyToAutoRun: 3,
        requiredPermission: 'task.create',
        handler: notImplemented('create_task'),
    },

    // ── Ship-stage (high risk) ──
    trigger_staging_deploy: {
        label: 'Trigger a staging deploy',
        category: 'ship',
        riskLevel: 'high',
        minAutonomyToAutoRun: 4,
        requiredPermission: 'deploy.staging',
        handler: notImplemented('trigger_staging_deploy'),
    },

    // ── Never-auto actions (critical) — always require a human, even at L4 ──
    trigger_production_deploy: {
        label: 'Trigger a PRODUCTION deploy',
        category: 'ship',
        riskLevel: 'critical',
        minAutonomyToAutoRun: 99,
        requiredPermission: 'deploy.production',
        handler: notImplemented('trigger_production_deploy'),
    },
    delete_entity: {
        label: 'Delete a task / project',
        category: 'destructive',
        riskLevel: 'critical',
        minAutonomyToAutoRun: 99,
        requiredPermission: 'entity.delete',
        handler: notImplemented('delete_entity'),
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
    };
});

module.exports = { ACTIONS, getAction, listActions };
