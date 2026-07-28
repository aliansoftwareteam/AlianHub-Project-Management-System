const { SCHEMA_TYPE } = require('../../Config/schemaType');
const { MongoDbCrudOpration } = require('../../utils/mongo-handler/mongoQueries');
const logger = require('../../Config/loggerConfig');
const { evaluatePermission } = require('../../Config/permissionGuard');
// Reuse Portfolio's "overdue" rule (past its due date and not finished).
const { isOverdue } = require('../Portfolio/helpers/portfolioRules');

// "Completed" on this dashboard means a CLOSED task specifically — statusType
// 'close' only. A 'done' status is NOT counted as completed.
const isClosed = (statusType) => String(statusType || '').toLowerCase() === 'close';

const companyOf = (req) => req.headers['companyid'] || (req.body && req.body.companyId) || (req.query && req.query.companyId);

// GET /api/v1/project-dashboard/:projectId
// The project metric cards + a per-person breakdown. Role-scoped, server-authoritative:
//   • Owner / Admin  → whole-project metrics (all tasks)
//   • other roles     → the SAME dynamic permission the Workload view uses
//                       (sheet_settings.workload_timesheet: 2 = Everyone, 1 = Own)
// Identity (req.uid) and role come from the authenticated session, never the body.
exports.getProjectDashboard = async (req, res) => {
    try {
        const companyId = companyOf(req);
        if (!companyId) return res.status(400).json({ status: false, statusText: 'companyId is required.' });
        const projectId = String(req.params.projectId || '');
        if (!projectId) return res.status(400).json({ status: false, statusText: 'projectId is required.' });

        // Owner/Admin always see the whole project; other roles follow the same
        // dynamic permission the Workload view uses. evaluatePermission returns
        // `true` for Owner/Admin. Fails closed to own-tasks scope.
        let seeAll = false;
        try {
            const perm = await evaluatePermission(companyId, req.uid, 'sheet_settings.workload_timesheet');
            seeAll = perm === true || perm === 2;
        } catch (e) { seeAll = false; }

        // Count tasks AND subtasks — only LIVE ones (deletedStatusKey 0 or unset;
        // DELETED (1) and ARCHIVED (2) excluded). Hours, however, are summed only
        // from TOP-LEVEL tasks in the loop below: their totalEstimatedTime /
        // remainingHours already roll up their subtasks, so counting subtask hours
        // again would double-count. Callers without "Everyone" access see only their own tasks.
        const filter = {
            ProjectID: projectId,
            deletedStatusKey: { $in: [0, undefined] },
        };
        if (!seeAll) filter.AssigneeUserId = String(req.uid);

        const tasks = await MongoDbCrudOpration(companyId, {
            type: SCHEMA_TYPE.TASKS,
            data: [filter, '_id statusType totalEstimatedTime remainingHours AssigneeUserId DueDate isParentTask sprintId folderObjId'],
        }, 'find') || [];

        // A task counts only when BOTH its folder AND its sprint are active.
        // Archiving/closing/deleting a folder or sprint does NOT reliably cascade
        // onto the tasks' own deletedStatusKey (legacy / un-cascaded tasks stay
        // "live"), so we check the folder's and the sprint's own state
        // (deletedStatusKey 0/unset = active) and skip tasks in an inactive one.
        const inactiveFolders = new Set();
        const activeSprints = new Set();
        let sprintFilterReady = false; // only positively-filter by sprint once we've read the sprints
        {
            const seenF = new Set(); const folderOids = [];
            const seenS = new Set(); const sprintOids = [];
            for (const t of tasks) {
                if (t.folderObjId) { const k = String(t.folderObjId); if (!seenF.has(k)) { seenF.add(k); folderOids.push(t.folderObjId); } }
                if (t.sprintId) { const k = String(t.sprintId); if (!seenS.has(k)) { seenS.add(k); sprintOids.push(t.sprintId); } }
            }
            const isInactive = (dsk) => dsk !== 0 && dsk !== undefined && dsk !== null;
            if (folderOids.length) {
                try {
                    const folders = await MongoDbCrudOpration(companyId, {
                        type: SCHEMA_TYPE.FOLDERS,
                        data: [{ _id: { $in: folderOids } }, '_id deletedStatusKey'],
                    }, 'find') || [];
                    folders.forEach((f) => { if (f && isInactive(f.deletedStatusKey)) inactiveFolders.add(String(f._id)); });
                } catch (e) { /* best-effort: don't over-exclude if the lookup fails */ }
            }
            if (sprintOids.length) {
                try {
                    const sprints = await MongoDbCrudOpration(companyId, {
                        type: SCHEMA_TYPE.SPRINTS,
                        data: [{ _id: { $in: sprintOids } }, '_id deletedStatusKey'],
                    }, 'find') || [];
                    // Positive filter: a task counts only if its sprint EXISTS and is
                    // active. This also drops orphans whose sprint was hard-deleted.
                    sprints.forEach((s) => { if (s && !isInactive(s.deletedStatusKey)) activeSprints.add(String(s._id)); });
                    sprintFilterReady = true;
                } catch (e) { sprintFilterReady = false; } // lookup failed → don't zero everything
            }
        }

        const now = Date.now();
        let total = 0;
        let completed = 0;
        let overdue = 0;
        let totalEstimate = 0;  // minutes (rollup incl. subtasks)
        let totalRemaining = 0; // minutes

        // Per-person accumulator. A task with N assignees counts toward each of
        // them (so a person's row reflects every task they're on); the unassigned
        // bucket uses userId ''.
        const people = new Map();
        const bump = (uid, done, over, est, rem, log) => {
            let p = people.get(uid);
            if (!p) { p = { userId: uid, tasks: 0, completed: 0, overdue: 0, est: 0, rem: 0, log: 0 }; people.set(uid, p); }
            p.tasks++;
            if (done) p.completed++;
            if (over) p.overdue++;
            p.est += est; p.rem += rem; p.log += log;
        };

        for (const t of tasks) {
            // Skip tasks whose folder is archived/deleted, or whose sprint is not an
            // active (existing, non-archived/closed/deleted) sprint.
            if (t.folderObjId && inactiveFolders.has(String(t.folderObjId))) continue;
            if (sprintFilterReady && !activeSprints.has(String(t.sprintId))) continue;
            total++;
            const done = isClosed(t.statusType); // completed = CLOSED only
            const over = isOverdue(t, now); // past DueDate and not finished
            // Hours come ONLY from top-level tasks (their rollup already includes
            // subtasks); subtasks add to the counts but not to the hours.
            let est = 0, rem = 0, log = 0;
            if (t.isParentTask === true) {
                est = Number(t.totalEstimatedTime) || 0;
                const remRaw = Number(t.remainingHours);
                // remainingHours is server-maintained (estimate − all-users-logged);
                // when not yet populated, nothing is logged → remaining = full estimate.
                rem = Number.isFinite(remRaw) ? remRaw : est;
                if (rem < 0) rem = 0;
                if (rem > est) rem = est;
                log = Math.max(est - rem, 0);
            }

            if (done) completed++;
            if (over) overdue++;
            totalEstimate += est;
            totalRemaining += rem;

            const assignees = Array.isArray(t.AssigneeUserId)
                ? t.AssigneeUserId.filter(Boolean).map(String)
                : (t.AssigneeUserId ? [String(t.AssigneeUserId)] : []);
            if (assignees.length === 0) bump('', done, over, est, rem, log);
            else assignees.forEach((a) => bump(a, done, over, est, rem, log));
        }

        const remainingTasks = total - completed;
        const logged = Math.max(totalEstimate - totalRemaining, 0);
        const pct = (num, den) => (den > 0 ? Math.round((num / den) * 100) : 0);
        const hours = (min) => Math.round((min / 60) * 10) / 10;

        // Per-person rows, richest first (most tasks, then most estimated effort).
        const byPerson = Array.from(people.values()).map((p) => ({
            userId: p.userId,
            tasks: p.tasks,
            completed: p.completed,
            completionPct: pct(p.completed, p.tasks),
            overdue: p.overdue,
            estimateHours: hours(p.est),
            loggedHours: hours(p.log),
            remainingHours: hours(p.rem),
        })).sort((a, b) => b.tasks - a.tasks || b.estimateHours - a.estimateHours);

        return res.json({
            status: true,
            data: {
                // 'own' → the UI hides the person breakdown (the viewer only sees self).
                scope: seeAll ? 'project' : 'own',
                // 1 & 2 — counts
                totalTasks: total,
                completedTasks: completed,
                remainingTasks,
                overdueTasks: overdue,
                // 3 — completion vs remaining, by task COUNT
                taskCompletionPct: pct(completed, total),
                taskRemainingPct: total ? pct(remainingTasks, total) : 0,
                // 4 — overall completion by EFFORT (logged ÷ estimate)
                overallCompletionPct: pct(logged, totalEstimate),
                // 5 & 6 — the stored fields are minutes; expose both minutes + hours
                totalEstimateMinutes: totalEstimate,
                remainingEstimateMinutes: totalRemaining,
                loggedMinutes: logged,
                totalEstimateHours: hours(totalEstimate),
                remainingEstimateHours: hours(totalRemaining),
                // per-person breakdown (empty for own-scope callers besides themselves)
                byPerson,
            },
        });
    } catch (e) {
        logger.error(`getProjectDashboard: ${e.message}`);
        return res.status(500).json({ status: false, statusText: e.message });
    }
};
