const { myCache } = require("../../Config/config");
const { SCHEMA_TYPE } = require("../../Config/schemaType");
const { MongoDbCrudOpration } = require("../../utils/mongo-handler/mongoQueries");
const axios = require("axios");
const mongoose = require("mongoose");
const logger = require("../../Config/loggerConfig");
const dashboardTemplate = require("../../utils/dashboardTemplate.json");
const cardComponent = require("../../utils/cardComponent.json");
const { getUsdRates, toUsd } = require("../../utils/currencyRates");
const {
    getDayOrRangeBounds,
    buildUserTeamMap,
    getLoggedAndTasksInRange,
    getUserNameMap,
    getSprintTypeMap,
    applyTaskMatch,
} = require("./helpers/resourceHelpers");

// Parse a client-built advanced-filter match from the request body.
function bodyTaskMatch(body) {
    return (body && body.taskMatch && typeof body.taskMatch === "object") ? body.taskMatch : null;
}

// Resolve a project's current status to its display name + colour from the
// project's own status palette (projectStatusData: [{ value, name,
// textColor, … }]) — per-project, since projects created from different
// templates carry different status sets. Used by the drill-down modals.
function projectStatusMeta(p) {
    const meta = (Array.isArray(p.projectStatusData) ? p.projectStatusData : [])
        .find((s) => s && String(s.value || "").toLowerCase() === String(p.status || "").toLowerCase()) || {};
    return { statusName: meta.name || "", statusColor: meta.textColor || "" };
}

// Shared role-visibility resolver for the resource cards. Mirrors
// getEmployeeWorkloadReport: roleType 1/2 → all users (null = no
// restriction); everyone else → only themselves.
function resolveVisibleUserIds(payload = {}) {
    const roleType = Number(payload.callerRoleType || 3);
    if (roleType === 1 || roleType === 2) return null;
    const self = String(payload.callerUserId || "");
    return self ? [self] : [];
}

// SECURITY: resolve the caller's real role for this company from the DB, never
// from the request body. These routes are JWT-protected (req.uid is the
// verified user; the companyid header is checked against the token audience),
// but roleType isn't in the token — so look it up in company_users. Fails
// closed to the most-restricted role (3) when absent, so a forged
// callerRoleType in the body can never widen the visibility scope.
async function resolveCallerRoleType(companyId, uid) {
    if (!uid) return 3;
    try {
        const row = await MongoDbCrudOpration(companyId, {
            type: SCHEMA_TYPE.COMPANY_USERS,
            data: [{ userId: String(uid), isDelete: { $ne: true } }, { roleType: 1 }],
        }, "findOne");
        const rt = Number(row && row.roleType);
        return Number.isFinite(rt) && rt > 0 ? rt : 3;
    } catch (e) {
        logger.error(`resolveCallerRoleType error (company=${companyId}, uid=${uid}): ${e.message || e}`);
        return 3;
    }
}

/**
 * This endpoint is used to get user user dashboard template
 * @param {*} req 
 * @param {*} res 
 * @returns 
 */

exports.getDashboard = async (req, res) => {
    try {
        const { id } = req.params;
        if (!id) {
            return res.status(400).json({ status: false, message: "'id' parameter is required." });
        }

        const cacheKey = `dashboard_${id}`;
        const cachedDashboard = myCache.get(cacheKey);

        if (cachedDashboard) {
            res.set({
                'FromCache': 'true',
                'cacheExpireTime': myCache.getTtl(cacheKey)
            });
            return res.status(200).json(cachedDashboard);
        }

        const params = { type: SCHEMA_TYPE.USERDASHBOARD, data: [{ userId: id }] };
        const response = await MongoDbCrudOpration(req.headers['companyid'], params, 'find');

        if (response?.length) {
            myCache.set(cacheKey, response, 86400);
            return res.status(200).json(response);
        }

        try {
            const lanData = dashboardTemplate;
            // Role-based default: admins/managers (roleType 1/2) get the
            // "management" template, everyone else the "member" template. Falls
            // back to the isDefault template when no audience match exists.
            const ownerRoleType = await resolveCallerRoleType(req.headers['companyid'], id);
            const wantedAudience = (ownerRoleType === 1 || ownerRoleType === 2) ? 'management' : 'member';
            const defaultDashboard =
                lanData.find(e => !e.isDeleted && e.audience === wantedAudience)
                || lanData.find(e => e.isDefault && !e.isDeleted);

            if (!defaultDashboard) {
                return res.status(404).json({ status: false, message: "Default dashboard not found." });
            }

            const { _id, ...dashboardWithoutId } = defaultDashboard;
            const dashboardData = { ...dashboardWithoutId, templateId: _id, userId: id };

            const dataSaveRes = await MongoDbCrudOpration(req.headers['companyid'], { type: SCHEMA_TYPE.USERDASHBOARD, data: dashboardData }, 'save');
            
            if (!dataSaveRes) {
                return res.status(400).json({ status: false, message: "Error while saving default dashboard." });
            }

            myCache.set(cacheKey, [dataSaveRes], 86400);
            return res.status(200).json([dataSaveRes]);
        } catch (apiError) {
            logger.error(`Error fetching default dashboard: ${apiError}`);
            return res.status(400).json({ status: false, message: "Error fetching default dashboard.", error: apiError });
        }
    } catch (error) {
        logger.error(`An error occurred while fetching the user dashboard: ${error}`);
        return res.status(400).json({ status: false, message: "An error occurred while fetching the user dashboard.", error });
    }
};
exports.getCardComponent = async (req, res) => {
    try {
        const cacheKey = `dashboard_card_component`;
        const cachedDashboard = myCache.get(cacheKey);

        if (cachedDashboard) {
            res.set({
                'FromCache': 'true',
                'cacheExpireTime': myCache.getTtl(cacheKey)
            });
            return res.status(200).json(cachedDashboard);
        }

        try {
            const dataSaveRes = cardComponent;
            
            if (!dataSaveRes) {
                return res.status(400).json({ status: false, message: "Error while saving default dashboard." });
            }

            myCache.set(cacheKey, dataSaveRes, 86400);
            return res.status(200).json(dataSaveRes);
        } catch (apiError) {
            logger.error(`Error fetching default dashboard: ${apiError}`);
            return res.status(400).json({ status: false, message: "Error fetching default dashboard.", error: apiError });
        }
    } catch (error) {
        logger.error(`An error occurred while fetching the user dashboard: ${error}`);
        return res.status(400).json({ status: false, message: "An error occurred while fetching the user dashboard.", error });
    }
};


exports.updateDashboard = async (req, res) => {
    try {
        const { queryObject, method, userId } = req.body;

        if (!queryObject || !method) {
            return res.status(400).json({
                status: false, 
                message: "'queryObject' and 'method' parameters are required." 
            });
        }

        let updateQuery = {
            type: SCHEMA_TYPE.USERDASHBOARD,
            data: queryObject
        };

        MongoDbCrudOpration(req.headers['companyid'], updateQuery, method)
            .then((result) => {
                if (result) {
                    if(userId) {
                        const cacheKey = `dashboard_${userId}`;
                        myCache.del(cacheKey);
                    }
                    return res.status(200).json({
                        status: true,
                        message: "Dashboard updated successfully.", 
                        data: result 
                    });
                } else {
                    return res.status(404).json({ status: false, message: "Dashboard not found." });
                }
            })
            .catch((error) => {
                logger.error(`Error while updating the user dashboard: ${error}`);
                return res.status(400).json({ 
                    status: false, 
                    message: "Error while updating dashboard.", 
                    error: error 
                });
            });

    } catch (error) {
        logger.error(`Error while updating the user dashboard: ${error}`);
        return res.status(400).json({
            status: false,
            message: "An error occurred while updating the user dashboard.",
            error
        });
    }
};

/**
 * Employee Workload & Activity Report — the data endpoint behind the
 * new EmployeeWorkloadReportCard widget.
 *
 * Pure filter-in / data-out. Every threshold (active / idle /
 * overloaded) is read from the caller's payload — there are NO
 * hardcoded thresholds in this handler. The user's saved card config
 * is the single source of truth for those numbers.
 *
 * Role-based visibility is enforced server-side, matching the
 * app-wide convention (workloadTimeSheet / userTimeSheet / etc.):
 *   - Admin / Owner / Manager (roleType 1 or 2) → all company employees
 *                                                  the filter selects
 *   - Everyone else (non-admin)                 → only themselves
 *
 * Returns:
 *   {
 *     status: true,
 *     data: {
 *       employees: [{ _id, name, avatar, isOnline,
 *                     trackedMinutes, estimatedMinutes,
 *                     assignedTaskCount, overdueCount,
 *                     activityStatus: 'active'|'idle'|'overloaded'|'normal',
 *                     tasks: [...] }],
 *       teamAggregate: {
 *         workloadByEmployee: [{ employeeId, name, trackedMinutes }],
 *         taskTypeBreakdown: { learning, actual, unknown }
 *       },
 *       config: <echo of the thresholds the report used>
 *     }
 *   }
 */
exports.getEmployeeWorkloadReport = async (req, res) => {
    try {
        const companyId = req.headers["companyid"];
        if (!companyId) {
            return res.status(400).json({ status: false, message: "companyId header required" });
        }

        const payload = req.body || {};
        // SECURITY (CodeRabbit): derive caller identity + role from the
        // authenticated session, never the request body. req.uid is the verified
        // JWT user; the role is resolved server-side. A forged
        // callerUserId/callerRoleType in the body can no longer widen scope.
        payload.callerUserId = String(req.uid || "");
        payload.callerRoleType = await resolveCallerRoleType(companyId, req.uid);
        // All thresholds come from the caller's card config — no
        // fallback constants here. If they're missing we just skip
        // the badge calculation and return 'normal' for everyone.
        // Accept payload values either as the convention names from
        // cardComponent.json (AssigneeUserId, projectId, statusKey,
        // timerange, isParentTask) or as the early-draft names
        // (employeeIds, projectIds, statusKeys). The widget sends both
        // shapes harmlessly.
        // Keep only valid Mongo ObjectId strings. The "Show Assignees"
        // picker can include team selections (resolved to user ids on the
        // frontend) — but an empty team leaves an unresolved `tId_*`
        // string behind. Dropping non-ObjectId values here prevents a
        // `new mongoose.Types.ObjectId("tId_…")` crash downstream.
        const rawEmployeeIds = Array.isArray(payload.employeeIds) ? payload.employeeIds
            : Array.isArray(payload.AssigneeUserId) ? payload.AssigneeUserId : [];
        const cfg = {
            employeeIds: rawEmployeeIds.filter((id) => mongoose.Types.ObjectId.isValid(String(id))),
            projectIds: Array.isArray(payload.projectIds) ? payload.projectIds
                : Array.isArray(payload.projectId) ? payload.projectId : [],
            dateFrom: payload.dateFrom ? new Date(payload.dateFrom) : null,
            dateTo: payload.dateTo ? new Date(payload.dateTo) : null,
            statusKeys: Array.isArray(payload.statusKeys) ? payload.statusKeys
                : Array.isArray(payload.statusKey) ? payload.statusKey : [],
            taskType: payload.taskType || "all",
            includeSubtasks: payload.isParentTask === undefined ? true : !!payload.isParentTask,
            // "Current" mode — restrict the report to employees with a
            // running tracker right now (who is working on what live).
            currentOnly: payload.currentOnly === true,
            // Advanced "Add filter" builder → Mongo match on task fields
            // (buildFilterQuery on the client). Merged into the task query.
            taskMatch: (payload.taskMatch && typeof payload.taskMatch === "object") ? payload.taskMatch : null,
            activeWithinMinutes: Number(payload.activeWithinMinutes) || null,
            idleAfterMinutes: Number(payload.idleAfterMinutes) || null,
            overloadCapacityMinutesPerDay: Number(payload.overloadCapacityMinutesPerDay) || null,
            // No per-employee task limit — return all relevant tasks.
            callerUserId: String(payload.callerUserId || ""),
            callerRoleType: Number(payload.callerRoleType || 3),
        };

        // ─── Role-based visibility — narrow the employee pool first ──
        // Mirror the convention used everywhere else in the app
        // (workloadTimeSheet / userTimeSheet / projectTimeSheet /
        // getProjectList): roleType 1 AND 2 are the privileged tier and
        // see every company employee the filter selects. Only genuine
        // non-admins (roleType not in [1, 2]) are restricted to
        // themselves. null = no restriction.
        let visibleUserIds = null;
        if (cfg.callerRoleType === 1 || cfg.callerRoleType === 2) {
            // Admin / Owner / Manager tier — no user-level restriction.
            visibleUserIds = null;
        } else {
            // Regular member — only themselves.
            visibleUserIds = cfg.callerUserId ? [cfg.callerUserId] : [];
        }

        // Apply the user's `employeeIds` filter on top of visibility.
        let employeeIdFilter = visibleUserIds;
        if (cfg.employeeIds.length) {
            if (visibleUserIds === null) {
                employeeIdFilter = cfg.employeeIds;
            } else {
                const visibleSet = new Set(visibleUserIds.map(String));
                employeeIdFilter = cfg.employeeIds.filter((id) => visibleSet.has(String(id)));
            }
        }

        // ─── Fetch the candidate employees ────────────────────────
        const userQuery = {
            isActive: true,
            AssignCompany: companyId,
        };
        if (employeeIdFilter !== null) {
            if (!employeeIdFilter.length) {
                return res.status(200).json({
                    status: true,
                    data: { employees: [], teamAggregate: { workloadByEmployee: [], taskTypeBreakdown: { learning: 0, actual: 0, unknown: 0 } }, config: cfg },
                });
            }
            userQuery._id = { $in: employeeIdFilter.map((id) => new mongoose.Types.ObjectId(String(id))) };
        }
        const employees = await MongoDbCrudOpration(SCHEMA_TYPE.GOLBAL, {
            type: SCHEMA_TYPE.USERS,
            data: [
                userQuery,
                { Employee_Name: 1, Employee_FName: 1, Employee_LName: 1, Employee_profileImage: 1, isOnline: 1 },
            ],
        }, "find").catch(() => []);

        if (!employees || !employees.length) {
            return res.status(200).json({
                status: true,
                data: { employees: [], teamAggregate: { workloadByEmployee: [], taskTypeBreakdown: { learning: 0, actual: 0, unknown: 0 } }, config: cfg },
            });
        }
        const employeeIdStrs = employees.map((e) => String(e._id));

        // ─── Period pivots on PLANNED date + LOGGED date ──────────
        // The report mirrors the Workload Timesheet model: each
        // employee allocates planned hours PER DAY (estimated_time.Date)
        // and logs time PER DAY (timesheets). So "Today" = what each
        // employee planned for today + logged today — NOT the task's
        // due date. Due date is used only for the overdue flag.
        const dateFromSec = cfg.dateFrom ? Math.floor(cfg.dateFrom.getTime() / 1000) : null;
        const dateToSec = cfg.dateTo ? Math.floor(cfg.dateTo.getTime() / 1000) : null;

        // 1. Planned hours in range (per user, per task) from estimated_time.
        const plannedByUserTask = {};  // `${uid}|${tid}` → planned minutes in range
        {
            const estFilter = { UserId: { $in: employeeIdStrs } };
            if (cfg.dateFrom || cfg.dateTo) {
                estFilter.Date = {};
                if (cfg.dateFrom) estFilter.Date.$gte = cfg.dateFrom;
                if (cfg.dateTo) estFilter.Date.$lte = cfg.dateTo;
            }
            const ests = await MongoDbCrudOpration(companyId, {
                type: SCHEMA_TYPE.ESTIMATES_TIME,
                data: [estFilter, { UserId: 1, TaskId: 1, EstimatedTime: 1 }],
            }, "find").catch(() => []);
            (ests || []).forEach((e) => {
                const key = `${e.UserId}|${e.TaskId}`;
                plannedByUserTask[key] = (plannedByUserTask[key] || 0) + (Number(e.EstimatedTime) || 0);
            });
        }

        // 2. Logged hours in range (per user, per task) from timesheets.
        const loggedByUserTask = {};   // `${uid}|${tid}` → logged minutes in range
        const lastLogByUserTask = {};  // `${uid}|${tid}` → { desc, start } latest work comment
        {
            const tsFilter = { Loggeduser: { $in: employeeIdStrs } };
            if (dateFromSec != null || dateToSec != null) {
                tsFilter.LogStartTime = {};
                if (dateFromSec != null) tsFilter.LogStartTime.$gte = dateFromSec;
                if (dateToSec != null) tsFilter.LogStartTime.$lte = dateToSec;
            }
            const tlogs = await MongoDbCrudOpration(companyId, {
                type: SCHEMA_TYPE.TIMESHEET,
                data: [tsFilter, { Loggeduser: 1, TicketID: 1, LogTimeDuration: 1, LogDescription: 1, LogStartTime: 1 }],
            }, "find").catch(() => []);
            (tlogs || []).forEach((ts) => {
                if (!ts.TicketID) return;
                const key = `${ts.Loggeduser}|${ts.TicketID}`;
                loggedByUserTask[key] = (loggedByUserTask[key] || 0) + (Number(ts.LogTimeDuration) || 0);
                // Keep the most recent non-empty work comment for this user+task.
                const desc = (ts.LogDescription || "").trim();
                if (desc) {
                    const start = Number(ts.LogStartTime) || 0;
                    if (!lastLogByUserTask[key] || start >= lastLogByUserTask[key].start) {
                        lastLogByUserTask[key] = { desc, start };
                    }
                }
            });
        }

        // 2b. Currently-active trackers (per user, per task). Independent of
        // the date filter — a tracker started yesterday and still running is
        // an "active" tracker now. Used purely to flag tasks with a
        // "Running" badge in the UI; doesn't affect minute tallies.
        //
        // How the tracker actually works (Modules/LogTime/controllerV2):
        //   - START sets `startTimeTracker` to the current Unix-seconds ts.
        //   - Each screenshot CAPTURE while running REFRESHES both
        //     `startTimeTracker` and `LogEndTime` to "now" and bumps
        //     `LogTimeDuration` to the elapsed minutes (so duration is NOT
        //     zero once a tracker has run for a bit — the earlier
        //     `LogTimeDuration: 0` check was wrong).
        //   - STOP `$unset`s `startTimeTracker`.
        //
        // A bare `{ $exists: true }` is too loose: abandoned/crashed
        // sessions and legacy rows keep a stale `startTimeTracker`, which
        // is why every task lit up. Because a LIVE tracker refreshes
        // `startTimeTracker` to "now" on every capture, a genuinely running
        // entry always has a RECENT value. We therefore mirror the app's
        // own "is running" rule (frontend ViewTimelogDetail.vue): the
        // tracker counts as running only if `startTimeTracker` is within
        // the last 10 minutes.
        const RUNNING_WINDOW_SEC = 10 * 60; // matches frontend's 10-min rule
        const nowSec = Math.floor(Date.now() / 1000);
        const activeTrackerPairs = new Set();
        const activeTrackerDesc = {}; // `${uid}|${tid}` → running entry's work comment
        {
            const activeFilter = {
                Loggeduser: { $in: employeeIdStrs },
                startTimeTracker: { $gte: nowSec - RUNNING_WINDOW_SEC },
            };
            const activeLogs = await MongoDbCrudOpration(companyId, {
                type: SCHEMA_TYPE.TIMESHEET,
                data: [activeFilter, { Loggeduser: 1, TicketID: 1, LogDescription: 1 }],
            }, "find").catch(() => []);
            (activeLogs || []).forEach((ts) => {
                if (!ts.Loggeduser || !ts.TicketID) return;
                const key = `${ts.Loggeduser}|${ts.TicketID}`;
                activeTrackerPairs.add(key);
                const desc = (ts.LogDescription || "").trim();
                if (desc) activeTrackerDesc[key] = desc;
            });
        }

        // 3. Union of tasks that were either planned or logged in range.
        const unionTaskIds = new Set();
        const userTaskPairs = new Set(); // `${uid}|${tid}` the employee touched in range
        Object.keys(plannedByUserTask).forEach((k) => {
            userTaskPairs.add(k);
            unionTaskIds.add(k.split("|")[1]);
        });
        Object.keys(loggedByUserTask).forEach((k) => {
            userTaskPairs.add(k);
            unionTaskIds.add(k.split("|")[1]);
        });
        // In "Current" mode also fold in the active-tracker pairs so a
        // tracker that started before the (today) range — e.g. running
        // across midnight — still surfaces its task.
        if (cfg.currentOnly) {
            activeTrackerPairs.forEach((k) => {
                userTaskPairs.add(k);
                unionTaskIds.add(k.split("|")[1]);
            });
        }

        // 4. Fetch those tasks and apply the task-level filters
        //    (project / status / subtask / taskType). Tasks that don't
        //    pass the filters are dropped from the union.
        const taskMap = {};
        if (unionTaskIds.size) {
            const validIds = Array.from(unionTaskIds)
                .filter((id) => mongoose.Types.ObjectId.isValid(id))
                .map((id) => new mongoose.Types.ObjectId(id));
            const taskFilter = { _id: { $in: validIds }, deletedStatusKey: 0 };
            if (cfg.projectIds.length) {
                taskFilter.ProjectID = { $in: cfg.projectIds.map((id) => new mongoose.Types.ObjectId(String(id))) };
            }
            if (cfg.statusKeys.length) {
                taskFilter.statusKey = { $in: cfg.statusKeys.map(Number) };
            }
            if (cfg.includeSubtasks === false) {
                taskFilter.isParentTask = true;
            }
            if (cfg.taskType && cfg.taskType !== "all") {
                taskFilter.$or = [
                    { aiTaskCategoryManual: cfg.taskType },
                    { aiTaskCategoryManual: { $exists: false }, aiTaskCategory: cfg.taskType },
                ];
            }
            // Merge the advanced filter match. Fold into $and so it can't
            // clobber the taskType $or above (buildFilterQuery may also emit $or).
            if (cfg.taskMatch) {
                const extra = cfg.taskMatch;
                const andParts = [];
                if (taskFilter.$or) { andParts.push({ $or: taskFilter.$or }); delete taskFilter.$or; }
                if (Array.isArray(extra.$and)) andParts.push(...extra.$and);
                if (Array.isArray(extra.$or)) andParts.push({ $or: extra.$or });
                Object.keys(extra).forEach((k) => {
                    if (k !== "$and" && k !== "$or") taskFilter[k] = extra[k];
                });
                if (andParts.length) taskFilter.$and = (taskFilter.$and || []).concat(andParts);
            }
            const tasks = await MongoDbCrudOpration(companyId, {
                type: SCHEMA_TYPE.TASKS,
                data: [
                    taskFilter,
                    {
                        TaskName: 1, TaskKey: 1, AssigneeUserId: 1, ProjectID: 1,
                        status: 1, statusKey: 1, statusType: 1, DueDate: 1,
                        Task_Priority: 1, TaskType: 1, totalEstimatedTime: 1,
                        aiTaskCategory: 1, aiTaskCategoryManual: 1, sprintArray: 1,
                        isParentTask: 1,
                    },
                ],
            }, "find").catch(() => []);
            (tasks || []).forEach((t) => { taskMap[String(t._id)] = t; });
        }

        // 5. Join project names for the surviving tasks.
        const projectIdSet = new Set(Object.values(taskMap).map((t) => String(t.ProjectID)));
        const projectsMap = {};
        if (projectIdSet.size) {
            const projects = await MongoDbCrudOpration(companyId, {
                type: SCHEMA_TYPE.PROJECTS,
                data: [
                    { _id: { $in: Array.from(projectIdSet).map((id) => new mongoose.Types.ObjectId(id)) } },
                    { ProjectName: 1, ProjectCode: 1, projectIcon: 1 },
                ],
            }, "find").catch(() => []);
            (projects || []).forEach((p) => { projectsMap[String(p._id)] = p; });
        }

        // 6. Group the in-range (user, task) pairs by employee, keeping
        //    only pairs whose task survived the filters. In "Current" mode
        //    also drop any pair that isn't an active tracker right now, so
        //    the report shows only who is working live and on what.
        const pairsByUser = {}; // uid → Set of tid
        userTaskPairs.forEach((key) => {
            const [uid, tid] = key.split("|");
            if (!taskMap[tid]) return; // task filtered out
            if (cfg.currentOnly && !activeTrackerPairs.has(key)) return; // not live
            if (!pairsByUser[uid]) pairsByUser[uid] = new Set();
            pairsByUser[uid].add(tid);
        });

        // ─── Approved/pending PTO overlapping the window (cards #7/#10) ──
        // Approved PTO is what actually removes capacity ("free today" and
        // on-leave); pending is surfaced for display only. Overlap rule:
        // entry.startDate <= rangeEnd AND entry.endDate >= rangeStart.
        const ptoByUser = {}; // uid → { approved:bool, pending:bool, type }
        if (cfg.dateFrom && cfg.dateTo) {
            const ptoRows = await MongoDbCrudOpration(companyId, {
                type: SCHEMA_TYPE.PTO_ENTRIES,
                data: [
                    {
                        deletedStatusKey: 0,
                        userId: { $in: employeeIdStrs },
                        status: { $in: ["approved", "pending"] },
                        startDate: { $lte: cfg.dateTo },
                        endDate: { $gte: cfg.dateFrom },
                    },
                    { userId: 1, status: 1, type: 1 },
                ],
            }, "find").catch(() => []);
            (ptoRows || []).forEach((p) => {
                const uid = String(p.userId);
                if (!ptoByUser[uid]) ptoByUser[uid] = { approved: false, pending: false, type: null };
                if (p.status === "approved") ptoByUser[uid].approved = true;
                if (p.status === "pending") ptoByUser[uid].pending = true;
                if (!ptoByUser[uid].type) ptoByUser[uid].type = p.type || null;
            });
        }

        // Full-range logged time per user across ALL their filtered tasks —
        // computed independently of the currentOnly live-task restriction so a
        // live-work view can show each person's total logged for the day, not
        // just the task they're tracking right now.
        const rangeLoggedByUser = {};
        Object.keys(loggedByUserTask).forEach((key) => {
            const [uid, tid] = key.split("|");
            if (!taskMap[tid]) return; // only tasks that passed the filters
            rangeLoggedByUser[uid] = (rangeLoggedByUser[uid] || 0) + loggedByUserTask[key];
        });

        // ─── Build per-employee rows ──────────────────────────────
        const teamLearning = { learning: 0, actual: 0, unknown: 0 };
        const workloadByEmployee = [];
        const employeeRows = employees.map((u) => {
            const uidStr = String(u._id);
            const tidSet = pairsByUser[uidStr] || new Set();
            const tids = Array.from(tidSet);

            // Three distinct hour types per the spec:
            //   loggedMinutes        → actual time tracked (timesheets)
            //   plannedMinutes       → per-employee per-day plan (estimated_time)
            //   commonEstimateMinutes→ the task's shared estimate (totalEstimatedTime)
            let loggedMinutes = 0;
            let plannedMinutes = 0;
            let commonEstimateMinutes = 0;
            let overdueCount = 0;
            const projectIdsForUser = new Set();

            const buildTaskDetail = (tid) => {
                const t = taskMap[tid];
                const projectInfo = projectsMap[String(t.ProjectID)] || {};
                const planned = plannedByUserTask[`${uidStr}|${tid}`] || 0;
                const logged = loggedByUserTask[`${uidStr}|${tid}`] || 0;
                const commonEstimate = Number(t.totalEstimatedTime) || 0;
                const isOverdue = t.DueDate && new Date(t.DueDate).getTime() < Date.now() && t.statusType !== "done";
                const category = t.aiTaskCategoryManual || t.aiTaskCategory || "unknown";
                return {
                    _id: tid,
                    TaskName: t.TaskName,
                    TaskKey: t.TaskKey,
                    ProjectID: String(t.ProjectID),
                    ProjectName: projectInfo.ProjectName || "",
                    ProjectCode: projectInfo.ProjectCode || "",
                    projectIcon: projectInfo.projectIcon || null,
                    // sprintId is needed by the task-detail sidebar; the
                    // embedded sprintArray carries it.
                    sprintId: (t.sprintArray && t.sprintArray.id) || "",
                    status: t.status,
                    statusKey: t.statusKey,
                    statusType: t.statusType,
                    DueDate: t.DueDate || null,
                    Task_Priority: t.Task_Priority,
                    loggedMinutes: logged,
                    plannedMinutes: planned || null,
                    commonEstimateMinutes: commonEstimate || null,
                    aiTaskCategory: category,
                    overdue: !!isOverdue,
                    isSubTask: t.isParentTask === false,
                    // Currently-running tracker flag — drives the "Running"
                    // badge in the UI.
                    isTracking: activeTrackerPairs.has(`${uidStr}|${tid}`),
                    // Work comment from the timesheet: prefer the running entry's
                    // note, else the latest logged note for this user+task.
                    logDescription: activeTrackerDesc[`${uidStr}|${tid}`]
                        || (lastLogByUserTask[`${uidStr}|${tid}`] && lastLogByUserTask[`${uidStr}|${tid}`].desc)
                        || "",
                };
            };

            // Tally across all of the employee's in-range tasks.
            tids.forEach((tid) => {
                const t = taskMap[tid];
                plannedMinutes += plannedByUserTask[`${uidStr}|${tid}`] || 0;
                loggedMinutes += loggedByUserTask[`${uidStr}|${tid}`] || 0;
                commonEstimateMinutes += Number(t.totalEstimatedTime) || 0;
                projectIdsForUser.add(String(t.ProjectID));
                if (t.DueDate && new Date(t.DueDate).getTime() < Date.now() && t.statusType !== "done") {
                    overdueCount += 1;
                }
                const cat = t.aiTaskCategoryManual || t.aiTaskCategory || "unknown";
                if (cat === "learning") teamLearning.learning += 1;
                else if (cat === "actual") teamLearning.actual += 1;
                else teamLearning.unknown += 1;
            });

            // Sort the employee's tasks by logged desc for a useful default order.
            tids.sort((a, b) =>
                (loggedByUserTask[`${uidStr}|${b}`] || 0) - (loggedByUserTask[`${uidStr}|${a}`] || 0));
            const taskDetails = tids.map(buildTaskDetail);

            const row = {
                _id: uidStr,
                name: u.Employee_Name || `${u.Employee_FName || ""} ${u.Employee_LName || ""}`.trim(),
                avatar: u.Employee_profileImage || "",
                isOnline: !!u.isOnline,
                loggedMinutes,
                plannedMinutes,
                commonEstimateMinutes,
                assignedTaskCount: tids.length,
                projectCount: projectIdsForUser.size,
                overdueCount,
                // Total logged for the whole window (all filtered tasks), even
                // when currentOnly narrows `tasks` to the live one(s).
                dayLoggedMinutes: rangeLoggedByUser[uidStr] || 0,
                // PTO status for the window — drives FreeResources/OnLeave cards.
                onLeave: ptoByUser[uidStr] || { approved: false, pending: false, type: null },
                tasks: taskDetails,
            };
            workloadByEmployee.push({ employeeId: uidStr, name: row.name, loggedMinutes: row.loggedMinutes });
            return row;
        });

        const reportData = {
            employees: employeeRows,
            teamAggregate: {
                workloadByEmployee,
                taskTypeBreakdown: teamLearning,
            },
            config: {
                dateFrom: cfg.dateFrom,
                dateTo: cfg.dateTo,
            },
        };

        return res.status(200).json({
            status: true,
            data: reportData,
        });
    } catch (error) {
        logger.error(`getEmployeeWorkloadReport error: ${error && error.message ? error.message : error}`);
        return res.status(500).json({
            status: false,
            message: "An error occurred while building the workload report.",
            error: error && error.message ? error.message : String(error),
        });
    }
};

/**
 * Project Utilization Summary — backs the ProjectPulseCard (screenshot
 * metrics #1-#3):
 *   1. Active Projects   — projects whose statusType is not 'close'
 *   2. Working Projects  — distinct projects with a timesheet in the window
 *                          (defaults to today; respects dateFrom/dateTo)
 *   3. Type mix          — active projects grouped by ProjectType
 *                          (In House / Fixed / Hourly / …)
 *
 * Company-scoped and read-only. Not user-specific, so no role gate is
 * needed — an admin/management widget over company-wide project state.
 */
exports.getProjectUtilizationSummary = async (req, res) => {
    try {
        const companyId = req.headers["companyid"];
        if (!companyId) {
            return res.status(400).json({ status: false, message: "companyId header required" });
        }

        const { fromSec, toSec } = getDayOrRangeBounds(req.body || {});
        // Drill-down mode — the card's count/bar was clicked and the modal
        // needs the per-project rows behind each number, not just totals.
        const includeProjects = req.body && req.body.includeProjects === true;

        // 1 + 3 — active projects and their ProjectType mix. Drill-down also
        // needs each project's status + its per-project status palette
        // (projectStatusData) so the modal can render the status in colour.
        const activeProjects = await MongoDbCrudOpration(companyId, {
            type: SCHEMA_TYPE.PROJECTS,
            data: [
                { statusType: { $nin: ["close"] }, deletedStatusKey: 0 },
                includeProjects
                    ? { ProjectType: 1, ProjectName: 1, status: 1, statusType: 1, projectStatusData: 1 }
                    : { ProjectType: 1, ProjectName: 1 },
            ],
        }, "find").catch(() => []);

        // "In House" is not a ProjectType — it's a naming convention: the
        // project name is prefixed with "IH" (e.g. "IH - Foo", "IH Foo",
        // "IH_Foo"). The negative lookahead (?![A-Za-z]) accepts any
        // separator/space/digit/end after "IH" but rejects real words like
        // "IHelp".
        const IH_PREFIX = /^\s*IH(?![A-Za-z])/i;
        const typeOf = (p) => (IH_PREFIX.test(p.ProjectName || "")
            ? "In House"
            : (p.ProjectType || "Unspecified"));
        const typeCounts = {};
        (activeProjects || []).forEach((p) => {
            const key = typeOf(p);
            typeCounts[key] = (typeCounts[key] || 0) + 1;
        });
        const typeMix = Object.keys(typeCounts).map((type) => ({ type, count: typeCounts[type] }));

        // 2 — distinct projects worked (a timesheet logged) in the window.
        const timelogs = await MongoDbCrudOpration(companyId, {
            type: SCHEMA_TYPE.TIMESHEET,
            data: [
                { LogStartTime: { $gte: fromSec, $lte: toSec } },
                { ProjectId: 1 },
            ],
        }, "find").catch(() => []);

        const workingProjectIds = new Set();
        (timelogs || []).forEach((ts) => {
            if (ts.ProjectId) workingProjectIds.add(String(ts.ProjectId));
        });

        const data = {
            activeProjects: (activeProjects || []).length,
            workingProjects: workingProjectIds.size,
            typeMix,
        };
        if (includeProjects) {
            data.projects = (activeProjects || []).map((p) => ({
                _id: String(p._id),
                name: p.ProjectName || "—",
                type: typeOf(p),
                status: p.status || "",
                statusType: p.statusType || "",
                ...projectStatusMeta(p),
                isWorking: workingProjectIds.has(String(p._id)),
            })).sort((a, b) => a.name.localeCompare(b.name));
        }

        return res.status(200).json({ status: true, data });
    } catch (error) {
        logger.error(`getProjectUtilizationSummary error: ${error && error.message ? error.message : error}`);
        return res.status(500).json({
            status: false,
            message: "An error occurred while building the project utilization summary.",
            error: error && error.message ? error.message : String(error),
        });
    }
};

/**
 * Milestone Report Card — company-wide billing-milestone summary for the
 * management dashboard. Owner/Admin (roleType 1/2) ONLY; any other caller
 * gets an empty, "restricted" payload. The client also hides the card from
 * non-management users — this server gate is defense-in-depth so the
 * company-wide financial figures can never leak via a forged request.
 *
 * Milestones are billing milestones attached to projects (Fix/Hourly). They
 * carry an `amount` but no currency of their own — currency comes from the
 * parent project (ProjectCurrency). Every figure is consolidated to USD using
 * live FX rates (utils/currencyRates). Read-only, companyId-scoped.
 *
 * Body: { dateFrom?, dateTo? (ISO — the "due" window, default this month),
 *         status? (drill the recent list), limit? }
 *
 * Returns:
 *   { status: true, data: {
 *       currency: "USD",
 *       due:      { receivableUsd, receivedUsd, outstandingUsd,
 *                   receivableCount, receivedCount },   // milestones DUE in range
 *       allTime:  { totalUsd, count },                  // every milestone, USD
 *       byStatus: [{ status, count }],                  // all-time; drives selector
 *       recent:   [{ projectId, projectName, milestoneName,
 *                    amountUsd, status, date }],
 *       totalCount: <number>, period: { from, to }, ratesLive: <bool>
 *   }}
 */
exports.getMilestoneSummary = async (req, res) => {
    try {
        const companyId = req.headers["companyid"];
        if (!companyId) {
            return res.status(400).json({ status: false, message: "companyId header required" });
        }

        const emptyData = {
            currency: "USD",
            due: { receivableUsd: 0, receivedUsd: 0, outstandingUsd: 0, receivableCount: 0, receivedCount: 0 },
            allTime: { totalUsd: 0, count: 0 },
            byStatus: [], recent: [], totalCount: 0, period: null, ratesLive: true,
        };

        // Owner/Admin only — resolve the caller's real role from the DB
        // (never from the body). Non-management callers get an empty payload.
        const callerRoleType = await resolveCallerRoleType(companyId, req.uid);
        if (!(callerRoleType === 1 || callerRoleType === 2)) {
            return res.status(200).json({ status: true, data: { ...emptyData, restricted: true } });
        }

        const RECENT_LIMIT = Number(req.body && req.body.limit) > 0
            ? Math.min(Number(req.body.limit), 20) : 6;

        // Time-range window for the "due milestones" panel. The card sends ISO
        // dateFrom/dateTo from the shared card-header period dropdown; milestone
        // dueDate is stored as epoch ms (0 = unset). Default to the current
        // calendar month when the window is missing/invalid.
        const toMs = (v) => { const t = v ? new Date(v).getTime() : NaN; return Number.isFinite(t) ? t : NaN; };
        let fromMs = toMs(req.body && req.body.dateFrom);
        let untilMs = toMs(req.body && req.body.dateTo);
        if (!Number.isFinite(fromMs) || !Number.isFinite(untilMs)) {
            const now = new Date();
            fromMs = new Date(now.getFullYear(), now.getMonth(), 1).getTime();
            untilMs = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999).getTime();
        }
        const period = { from: fromMs, to: untilMs };

        // All billing milestones in the company (DB-scoped collection).
        const milestones = await MongoDbCrudOpration(companyId, {
            type: SCHEMA_TYPE.MILESTONE,
            data: [
                {},
                { milestoneName: 1, amount: 1, projectId: 1, dueDate: 1, statusDate: 1, statusId: 1, billingPeriod: 1, updatedAt: 1, createdAt: 1 },
            ],
        }, "find").catch(() => []);

        if (!milestones || !milestones.length) {
            return res.status(200).json({ status: true, data: { ...emptyData, period } });
        }

        // Parent-project name + currency lookup.
        const projectIds = [...new Set(milestones.map((m) => String(m.projectId)).filter(Boolean))]
            .filter((id) => mongoose.Types.ObjectId.isValid(id))
            .map((id) => new mongoose.Types.ObjectId(id));
        const projectsMap = {};
        if (projectIds.length) {
            const projects = await MongoDbCrudOpration(companyId, {
                type: SCHEMA_TYPE.PROJECTS,
                data: [
                    { _id: { $in: projectIds } },
                    { ProjectName: 1, ProjectCurrency: 1 },
                ],
            }, "find").catch(() => []);
            (projects || []).forEach((p) => {
                projectsMap[String(p._id)] = { name: p.ProjectName || "", currency: p.ProjectCurrency || "" };
            });
        }

        // ProjectCurrency is stored as a currency OBJECT ({ symbol, code, name,
        // … }); we need its ISO code to convert the amount to USD. A legacy
        // plain 3-letter string is accepted too; anything else → unknown.
        const currencyCode = (pc) => {
            if (!pc) return "";
            if (typeof pc === "string") return pc.length === 3 ? pc.toUpperCase() : "";
            return String(pc.code || "").toUpperCase();
        };

        // Live USD rates (cached; static fallback when offline). usdOf() converts
        // a milestone's amount into USD via its project's currency.
        const { rates, live: ratesLive } = await getUsdRates();
        const usdOf = (m) => {
            const proj = projectsMap[String(m.projectId)] || {};
            return toUsd(m.amount, currencyCode(proj.currency), rates);
        };

        // Status drill-down: the recent list + totalCount also reflect a
        // selected status. byStatus is the full per-status breakdown for the
        // period — it drives the card's status selector. The receivable /
        // received figures compute their own status split, so they ignore it.
        const statusFilter = (req.body && req.body.status) ? String(req.body.status) : "";
        const matchStatus = (m) => !statusFilter || String(m.statusId || "No Status") === statusFilter;

        // Milestone billing lifecycle: NOT_FUNDED → FUNDED → RELEASE_REQUEST_SENT
        // → RELEASED (money actually released to us). CANCELLED / REFUNDED aren't
        // real receivables.
        const NON_RECEIVABLE = new Set(["CANCELLED", "REFUNDED"]);
        const RECEIVED_STATUS = "RELEASED";

        // The whole card is scoped to the selected period: a milestone is "in
        // the period" when its dueDate (epoch ms; 0 = unset) falls in the
        // window. Only the all-time footer total spans every milestone.
        const inRange = (m) => {
            const d = Number(m.dueDate) || 0;
            return d > 0 && d >= fromMs && d <= untilMs;
        };

        const statusAgg = {};        // status → { count }  (period-scoped; drives selector)
        let allTimeUsd = 0;          // consolidated USD across every milestone (footer)
        const due = { receivableUsd: 0, receivedUsd: 0, outstandingUsd: 0, receivableCount: 0, receivedCount: 0 };

        milestones.forEach((m) => {
            const usd = usdOf(m);
            allTimeUsd += usd;        // all-time total spans every milestone
            if (!inRange(m)) return;  // status bars, receivable & recent are period-scoped

            const status = m.statusId || "No Status";
            if (!statusAgg[status]) statusAgg[status] = { count: 0 };
            statusAgg[status].count += 1;

            if (!NON_RECEIVABLE.has(status)) {
                due.receivableUsd += usd;
                due.receivableCount += 1;
                if (status === RECEIVED_STATUS) {
                    due.receivedUsd += usd;
                    due.receivedCount += 1;
                }
            }
        });
        due.outstandingUsd = Math.max(0, due.receivableUsd - due.receivedUsd);

        // statusDate (epoch ms) is the milestone's own activity timestamp; fall
        // back to the document timestamps. Kept for the legacy `date` field.
        const dateOf = (m) => Number(m.statusDate)
            || (m.updatedAt ? new Date(m.updatedAt).getTime() : 0)
            || (m.createdAt ? new Date(m.createdAt).getTime() : 0);

        // The list is a due-date TIMELINE (past → present → future) within the
        // selected range. All in-range items have a dueDate > 0 (see inRange).
        // To show both sides of "now" we window around the present: take the
        // nearest upcoming milestones and the nearest recent-past ones, then
        // order the picked set ascending by dueDate so the card reads
        // past → today → upcoming rather than always truncating the future away.
        const nowMs = Date.now();
        const dueOf = (m) => Number(m.dueDate) || 0;
        const inScope = milestones.filter((m) => inRange(m) && matchStatus(m));
        const future = inScope.filter((m) => dueOf(m) > nowMs).sort((a, b) => dueOf(a) - dueOf(b));   // nearest upcoming first
        const pastNow = inScope.filter((m) => dueOf(m) <= nowMs).sort((a, b) => dueOf(b) - dueOf(a)); // nearest recent-past first
        let futurePick = future.slice(0, Math.ceil(RECENT_LIMIT / 2));
        let pastPick = pastNow.slice(0, RECENT_LIMIT - futurePick.length);
        if (pastPick.length + futurePick.length < RECENT_LIMIT) {
            futurePick = future.slice(0, RECENT_LIMIT - pastPick.length); // backfill when past is short
        }
        const recent = [...pastPick, ...futurePick]
            .sort((a, b) => dueOf(a) - dueOf(b)) // timeline order
            .map((m) => {
                const proj = projectsMap[String(m.projectId)] || {};
                return {
                    projectId: String(m.projectId || ""),
                    projectName: proj.name || "",
                    milestoneName: m.milestoneName || "",
                    amountUsd: usdOf(m),
                    status: m.statusId || "",
                    date: dateOf(m) || null,
                    dueDate: dueOf(m) || null,
                };
            });

        const data = {
            currency: "USD",
            due,
            allTime: { totalUsd: allTimeUsd, count: milestones.length },
            byStatus: Object.keys(statusAgg)
                .map((status) => ({ status, count: statusAgg[status].count }))
                .sort((a, b) => b.count - a.count),
            recent,
            totalCount: milestones.filter((m) => inRange(m) && matchStatus(m)).length,
            period,
            ratesLive,
        };

        return res.status(200).json({ status: true, data });
    } catch (error) {
        logger.error(`getMilestoneSummary error: ${error && error.message ? error.message : error}`);
        return res.status(500).json({
            status: false,
            message: "An error occurred while building the milestone summary.",
            error: error && error.message ? error.message : String(error),
        });
    }
};

/**
 * Team Effort Breakdown (screenshot metric #5, generalized). Sums logged
 * minutes and rolls users into their teams (teams_management; a user in
 * multiple teams counts under each, none → "Unassigned"), bucketed by a
 * selectable DIMENSION:
 *   - "type"          → task type (Task / Design / Bid …)   [default]
 *   - "effort_nature" → Rework (Bug/Revision) / Backlog (backlog sprint) /
 *                       New (created in range, from the task _id timestamp) /
 *                       In-flight
 *   - "work_category" → Actual / Learning / Uncategorized (aiTaskCategory)
 *   - "billable"      → Billable / Non-billable (timesheet.billable)
 *
 * Response:
 *   { dimension, teams: [{ teamId, name, color, totalMinutes,
 *       buckets: [{ label, minutes, users: [{ userId, name, minutes }] }] }] }
 */
exports.getTeamTaskTypeBreakdown = async (req, res) => {
    try {
        const companyId = req.headers["companyid"];
        if (!companyId) {
            return res.status(400).json({ status: false, message: "companyId header required" });
        }
        const payload = req.body || {};
        // SECURITY (CodeRabbit): derive caller identity + role from the
        // authenticated session, never the request body. req.uid is the verified
        // JWT user; the role is resolved server-side. A forged
        // callerUserId/callerRoleType in the body can no longer widen scope.
        payload.callerUserId = String(req.uid || "");
        payload.callerRoleType = await resolveCallerRoleType(companyId, req.uid);
        const dimension = ["type", "effort_nature", "work_category", "billable"].includes(payload.dimension)
            ? payload.dimension : "type";
        const { fromSec, toSec, dateFrom, dateTo } = getDayOrRangeBounds(payload);
        const visibleUserIds = resolveVisibleUserIds(payload);
        if (Array.isArray(visibleUserIds) && !visibleUserIds.length) {
            return res.status(200).json({ status: true, data: { dimension, teams: [] } });
        }
        const projectIds = Array.isArray(payload.projectIds) ? payload.projectIds
            : Array.isArray(payload.projectId) ? payload.projectId : [];
        const statusKeys = Array.isArray(payload.statusKeys) ? payload.statusKeys
            : Array.isArray(payload.statusKey) ? payload.statusKey : [];
        const taskMatch = (payload.taskMatch && typeof payload.taskMatch === "object") ? payload.taskMatch : null;

        const { map: userTeamMap } = await buildUserTeamMap(companyId);
        const UNASSIGNED = { teamId: "unassigned", name: "Unassigned", color: null };
        const agg = {};       // teamId → bucketLabel → uid → minutes
        const teamMeta = {};
        const userIdsInvolved = new Set();
        const addLogged = (uid, bucket, minutes) => {
            if (!minutes) return;
            userIdsInvolved.add(uid);
            const teams = (userTeamMap[uid] && userTeamMap[uid].length) ? userTeamMap[uid] : [UNASSIGNED];
            teams.forEach((team) => {
                teamMeta[team.teamId] = { name: team.name, color: team.color };
                if (!agg[team.teamId]) agg[team.teamId] = {};
                if (!agg[team.teamId][bucket]) agg[team.teamId][bucket] = {};
                agg[team.teamId][bucket][uid] = (agg[team.teamId][bucket][uid] || 0) + minutes;
            });
        };

        if (dimension === "billable") {
            // Timesheet-level split (billable lives on the timesheet, not the
            // task). Applies project + user filters; status/advanced filters
            // don't apply here (no task join).
            const tsFilter = { LogStartTime: { $gte: fromSec, $lte: toSec } };
            if (Array.isArray(visibleUserIds)) tsFilter.Loggeduser = { $in: visibleUserIds.map(String) };
            if (projectIds.length) tsFilter.ProjectId = { $in: projectIds.map(String) };
            const tlogs = await MongoDbCrudOpration(companyId, {
                type: SCHEMA_TYPE.TIMESHEET,
                data: [tsFilter, { Loggeduser: 1, LogTimeDuration: 1, billable: 1 }],
            }, "find").catch(() => []);
            (tlogs || []).forEach((ts) => {
                if (!ts.Loggeduser) return;
                const bucket = ts.billable === false ? "Non-billable" : "Billable";
                addLogged(String(ts.Loggeduser), bucket, Number(ts.LogTimeDuration) || 0);
            });
        } else {
            const { loggedByUserTask, taskMap } = await getLoggedAndTasksInRange(companyId, {
                fromSec, toSec, projectIds, statusKeys, visibleUserIds, taskMatch,
            });

            let sprintTypeMap = {};
            if (dimension === "effort_nature") {
                sprintTypeMap = await getSprintTypeMap(
                    companyId,
                    Object.values(taskMap).map((t) => t.sprintId).filter(Boolean),
                );
            }
            const REWORK = /bug|revision|rework|defect/i;
            const bucketFor = (task, tid) => {
                if (dimension === "work_category") {
                    const c = String(task.aiTaskCategoryManual || task.aiTaskCategory || "").toLowerCase();
                    if (c === "actual") return "Actual";
                    if (c === "learning") return "Learning";
                    return "Uncategorized";
                }
                if (dimension === "effort_nature") {
                    if (REWORK.test(task.TaskType || "")) return "Rework";
                    if ((sprintTypeMap[String(task.sprintId)] || "").includes("backlog")) return "Backlog";
                    let createdMs = 0;
                    try { createdMs = new mongoose.Types.ObjectId(tid).getTimestamp().getTime(); } catch (e) { createdMs = 0; }
                    if (createdMs && dateFrom && dateTo && createdMs >= dateFrom.getTime() && createdMs <= dateTo.getTime()) return "New";
                    return "In-flight";
                }
                return task.TaskType || "Unspecified"; // dimension === "type"
            };

            Object.keys(loggedByUserTask).forEach((key) => {
                const [uid, tid] = key.split("|");
                const task = taskMap[tid];
                if (!task) return;
                addLogged(uid, bucketFor(task, tid), loggedByUserTask[key]);
            });
        }

        const nameMap = await getUserNameMap(Array.from(userIdsInvolved));

        const teams = Object.keys(agg).map((teamId) => {
            let teamTotal = 0;
            const buckets = Object.keys(agg[teamId]).map((label) => {
                const usersObj = agg[teamId][label];
                const users = Object.keys(usersObj).map((uid) => ({
                    userId: uid, name: nameMap[uid] || "—", minutes: usersObj[uid],
                })).sort((a, b) => b.minutes - a.minutes);
                const minutes = users.reduce((s, u) => s + u.minutes, 0);
                teamTotal += minutes;
                return { label, minutes, users };
            }).sort((a, b) => b.minutes - a.minutes);
            return {
                teamId,
                name: teamMeta[teamId] ? teamMeta[teamId].name : teamId,
                color: teamMeta[teamId] ? teamMeta[teamId].color : null,
                totalMinutes: teamTotal,
                buckets,
            };
        }).sort((a, b) => b.totalMinutes - a.totalMinutes);

        return res.status(200).json({ status: true, data: { dimension, teams } });
    } catch (error) {
        logger.error(`getTeamTaskTypeBreakdown error: ${error && error.message ? error.message : error}`);
        return res.status(500).json({
            status: false,
            message: "An error occurred while building the team effort breakdown.",
            error: error && error.message ? error.message : String(error),
        });
    }
};

/**
 * Team-wise Time Logged vs ETA (screenshot metric #6), as a drill-down:
 *   Team → User → Task, each level carrying loggedMinutes + etaMinutes.
 *     - task.etaMinutes  = the task's totalEstimatedTime (shared estimate)
 *     - task.loggedMinutes = that user's logged time on the task in the window
 *     - user totals       = Σ of their tasks
 *     - team totals        = Σ member logged; ETA deduped across the team so a
 *                            task worked by two members isn't counted twice.
 *
 * Response: { teams: [{ teamId, name, color, loggedMinutes, etaMinutes,
 *                        users: [{ userId, name, loggedMinutes, etaMinutes,
 *                                  tasks: [{ taskId, taskName, taskKey,
 *                                            projectName, loggedMinutes,
 *                                            etaMinutes }] }] }] }
 */
exports.getTeamLoggedVsEta = async (req, res) => {
    try {
        const companyId = req.headers["companyid"];
        if (!companyId) {
            return res.status(400).json({ status: false, message: "companyId header required" });
        }
        const payload = req.body || {};
        // SECURITY (CodeRabbit): derive caller identity + role from the
        // authenticated session, never the request body. req.uid is the verified
        // JWT user; the role is resolved server-side. A forged
        // callerUserId/callerRoleType in the body can no longer widen scope.
        payload.callerUserId = String(req.uid || "");
        payload.callerRoleType = await resolveCallerRoleType(companyId, req.uid);
        const { fromSec, toSec } = getDayOrRangeBounds(payload);
        const visibleUserIds = resolveVisibleUserIds(payload);
        if (Array.isArray(visibleUserIds) && !visibleUserIds.length) {
            return res.status(200).json({ status: true, data: { teams: [] } });
        }

        const { loggedByUserTask, taskMap, userIds } = await getLoggedAndTasksInRange(companyId, {
            fromSec, toSec,
            projectIds: Array.isArray(payload.projectIds) ? payload.projectIds
                : Array.isArray(payload.projectId) ? payload.projectId : [],
            statusKeys: Array.isArray(payload.statusKeys) ? payload.statusKeys
                : Array.isArray(payload.statusKey) ? payload.statusKey : [],
            visibleUserIds,
            taskMatch: (payload.taskMatch && typeof payload.taskMatch === "object") ? payload.taskMatch : null,
        });

        const [{ map: userTeamMap }, nameMap] = await Promise.all([
            buildUserTeamMap(companyId),
            getUserNameMap(Array.from(userIds)),
        ]);

        // Project-name lookup for the task rows.
        const projectIdSet = new Set(Object.values(taskMap).map((t) => String(t.ProjectID)));
        const projectsMap = {};
        if (projectIdSet.size) {
            const projects = await MongoDbCrudOpration(companyId, {
                type: SCHEMA_TYPE.PROJECTS,
                data: [
                    { _id: { $in: Array.from(projectIdSet).filter((id) => mongoose.Types.ObjectId.isValid(id)).map((id) => new mongoose.Types.ObjectId(id)) } },
                    { ProjectName: 1 },
                ],
            }, "find").catch(() => []);
            (projects || []).forEach((p) => { projectsMap[String(p._id)] = p.ProjectName || ""; });
        }

        const UNASSIGNED = { teamId: "unassigned", name: "Unassigned", color: null };
        // teamId → { meta, users: { uid → { tasks: { tid → row } } } }
        const agg = {};
        const teamMeta = {};

        Object.keys(loggedByUserTask).forEach((key) => {
            const [uid, tid] = key.split("|");
            const task = taskMap[tid];
            if (!task) return;
            const logged = loggedByUserTask[key];
            const eta = Number(task.totalEstimatedTime) || 0;
            const teams = (userTeamMap[uid] && userTeamMap[uid].length) ? userTeamMap[uid] : [UNASSIGNED];
            teams.forEach((team) => {
                teamMeta[team.teamId] = { name: team.name, color: team.color };
                if (!agg[team.teamId]) agg[team.teamId] = {};
                if (!agg[team.teamId][uid]) agg[team.teamId][uid] = {};
                agg[team.teamId][uid][tid] = {
                    taskId: tid,
                    taskName: task.TaskName || "",
                    taskKey: task.TaskKey || "",
                    projectName: projectsMap[String(task.ProjectID)] || "",
                    loggedMinutes: logged,
                    etaMinutes: eta,
                };
            });
        });

        const teams = Object.keys(agg).map((teamId) => {
            const users = Object.keys(agg[teamId]).map((uid) => {
                const tasks = Object.values(agg[teamId][uid]).sort((a, b) => b.loggedMinutes - a.loggedMinutes);
                const loggedMinutes = tasks.reduce((s, t) => s + t.loggedMinutes, 0);
                const etaMinutes = tasks.reduce((s, t) => s + t.etaMinutes, 0);
                return { userId: uid, name: nameMap[uid] || "—", loggedMinutes, etaMinutes, tasks };
            }).sort((a, b) => b.loggedMinutes - a.loggedMinutes);

            const loggedMinutes = users.reduce((s, u) => s + u.loggedMinutes, 0);
            // Dedupe ETA across the team (a task worked by 2 members counts once).
            const seenTasks = new Set();
            let etaMinutes = 0;
            users.forEach((u) => u.tasks.forEach((t) => {
                if (!seenTasks.has(t.taskId)) { seenTasks.add(t.taskId); etaMinutes += t.etaMinutes; }
            }));

            return {
                teamId,
                name: teamMeta[teamId] ? teamMeta[teamId].name : teamId,
                color: teamMeta[teamId] ? teamMeta[teamId].color : null,
                loggedMinutes,
                etaMinutes,
                users,
            };
        }).sort((a, b) => b.loggedMinutes - a.loggedMinutes);

        return res.status(200).json({ status: true, data: { teams } });
    } catch (error) {
        logger.error(`getTeamLoggedVsEta error: ${error && error.message ? error.message : error}`);
        return res.status(500).json({
            status: false,
            message: "An error occurred while building the team logged-vs-ETA report.",
            error: error && error.message ? error.message : String(error),
        });
    }
};

/**
 * AHE-3789 — Project-progress & resource dashboard cards.
 *
 * One read-only, companyId-scoped endpoint serving the project-progress
 * metrics. It is purely additive (a new route + handler) and reads the same
 * collections the Employee Workload report already reads, so it cannot affect
 * any existing dashboard data path.
 *
 *   metric: 'active_projects'   → count of active projects (company-wide)
 *   metric: 'projects_by_type'  → active projects grouped by ProjectType
 *   metric: 'running_projects'  → count of active projects that had logged
 *                                 time within the date range
 *   metric: 'live_work'         → users with a tracker running RIGHT NOW
 *                                 (startTimeTracker within the last 10 min) +
 *                                 the task/project and the tracker memo
 *                                 (LogDescription) of what they're working on
 *   metric: 'users_by_category' → per user, the COUNT of distinct tasks they
 *                                 logged time on in the window, bucketed into a
 *                                 caller-supplied category→task-type template
 *                                 (via the task's TaskType); unmapped types are
 *                                 ignored (no "uncategorized" bucket)
 *
 * Role visibility mirrors getEmployeeWorkloadReport: roleType 1/2
 * (Owner/Admin/Manager) see everyone; everyone else sees only themselves.
 */
exports.getProjectProgressMetric = async (req, res) => {
    try {
        const companyId = req.headers["companyid"];
        if (!companyId) {
            return res.status(400).json({ status: false, message: "companyId header required" });
        }

        const payload = req.body || {};
        // SECURITY (CodeRabbit): derive caller identity + role from the
        // authenticated session, never the request body. req.uid is the verified
        // JWT user; the role is resolved server-side. A forged
        // callerUserId/callerRoleType in the body can no longer widen scope.
        payload.callerUserId = String(req.uid || "");
        payload.callerRoleType = await resolveCallerRoleType(companyId, req.uid);
        const metric = String(payload.metric || "");
        const dateFrom = payload.dateFrom ? new Date(payload.dateFrom) : null;
        const dateTo = payload.dateTo ? new Date(payload.dateTo) : null;
        const dateFromSec = dateFrom ? Math.floor(dateFrom.getTime() / 1000) : null;
        const dateToSec = dateTo ? Math.floor(dateTo.getTime() / 1000) : null;

        // Role-based visibility — non-admins are scoped to their own logs.
        const callerUserId = String(payload.callerUserId || "");
        const callerRoleType = Number(payload.callerRoleType || 3);
        const restrictToSelf = !(callerRoleType === 1 || callerRoleType === 2);
        const userScope = () => (restrictToSelf && callerUserId ? { Loggeduser: callerUserId } : {});
        const objIds = (arr) => [...new Set((arr || []).filter(Boolean).map(String))]
            .filter((id) => mongoose.Types.ObjectId.isValid(id))
            .map((id) => new mongoose.Types.ObjectId(id));

        const rangeTsFilter = () => {
            const f = { ...userScope() };
            if (dateFromSec != null || dateToSec != null) {
                f.LogStartTime = {};
                if (dateFromSec != null) f.LogStartTime.$gte = dateFromSec;
                if (dateToSec != null) f.LogStartTime.$lte = dateToSec;
            }
            return f;
        };

        // Active project criteria — matches the app's "active" definition:
        // not closed, not deleted. Counted COMPANY-WIDE (no viewer scope).
        const activeProjectFilter = {
            statusType: { $ne: "close" },
            deletedStatusKey: { $in: [0, null] },
        };

        // Drill-down mode — clicking a count/bar opens a modal listing the
        // projects behind the number, so the project rows come back too.
        const includeProjects = payload.includeProjects === true;
        // "In House" derivation — same naming convention as the utilization
        // summary: an active project whose name starts with the "IH" marker.
        const IH_PREFIX = /^\s*IH(?![A-Za-z])/i;
        const projectRow = (p) => ({
            _id: String(p._id),
            name: p.ProjectName || "—",
            type: IH_PREFIX.test(p.ProjectName || "") ? "In House" : (p.ProjectType || "Unspecified"),
            status: p.status || "",
            statusType: p.statusType || "",
            ...projectStatusMeta(p),
        });
        const PROJECT_LIST_FIELDS = { ProjectName: 1, ProjectType: 1, status: 1, statusType: 1, projectStatusData: 1 };

        // ── metric: active projects (company-wide count) ──
        if (metric === "active_projects") {
            const projects = await MongoDbCrudOpration(companyId, {
                type: SCHEMA_TYPE.PROJECTS,
                data: [activeProjectFilter, includeProjects ? PROJECT_LIST_FIELDS : { _id: 1 }],
            }, "find").catch(() => []);
            const data = { count: (projects || []).length };
            if (includeProjects) {
                data.projects = (projects || []).map(projectRow).sort((a, b) => a.name.localeCompare(b.name));
            }
            return res.status(200).json({ status: true, data });
        }

        // ── metric: active projects grouped by type (company-wide) ──
        if (metric === "projects_by_type") {
            const projects = await MongoDbCrudOpration(companyId, {
                type: SCHEMA_TYPE.PROJECTS,
                data: [activeProjectFilter, includeProjects ? PROJECT_LIST_FIELDS : { ProjectType: 1 }],
            }, "find").catch(() => []);
            const counts = {};
            (projects || []).forEach((p) => {
                const raw = (p.ProjectType && String(p.ProjectType).trim()) || "unspecified";
                counts[raw] = (counts[raw] || 0) + 1;
            });
            const rows = Object.entries(counts).map(([key, value]) => ({ key, value })).sort((a, b) => b.value - a.value);
            const data = { rows };
            if (includeProjects) {
                // Keep the raw ProjectType as the modal's filter key so it
                // matches the bar rows (no In-House derivation here).
                data.projects = (projects || []).map((p) => ({
                    ...projectRow(p),
                    type: (p.ProjectType && String(p.ProjectType).trim()) || "unspecified",
                })).sort((a, b) => a.name.localeCompare(b.name));
            }
            return res.status(200).json({ status: true, data });
        }

        // ── metric 1: running/working projects (active + logged in range) ──
        if (metric === "running_projects") {
            const tlogs = await MongoDbCrudOpration(companyId, {
                type: SCHEMA_TYPE.TIMESHEET, data: [rangeTsFilter(), { TicketID: 1 }],
            }, "find").catch(() => []);
            const taskIds = objIds((tlogs || []).map((t) => t.TicketID));
            let running = [];
            if (taskIds.length) {
                const tasks = await MongoDbCrudOpration(companyId, {
                    type: SCHEMA_TYPE.TASKS, data: [{ _id: { $in: taskIds }, deletedStatusKey: 0 }, { ProjectID: 1 }],
                }, "find").catch(() => []);
                const pids = objIds((tasks || []).map((t) => t.ProjectID));
                if (pids.length) {
                    const projects = await MongoDbCrudOpration(companyId, {
                        type: SCHEMA_TYPE.PROJECTS,
                        data: [{ _id: { $in: pids } }, { ...PROJECT_LIST_FIELDS, deletedStatusKey: 1 }],
                    }, "find").catch(() => []);
                    running = (projects || []).filter((p) => p.statusType !== "close" && !p.deletedStatusKey);
                }
            }
            const data = { count: running.length };
            if (includeProjects) {
                data.projects = running.map(projectRow).sort((a, b) => a.name.localeCompare(b.name));
            }
            return res.status(200).json({ status: true, data });
        }

        // ── metric: live work — who is tracking right now, on what, and the
        // tracker memo (LogDescription) they entered describing the work. ──
        if (metric === "live_work") {
            const RUNNING_WINDOW_SEC = 10 * 60; // matches the app's 10-min "is running" rule
            const nowSec = Math.floor(Date.now() / 1000);
            const activeLogs = await MongoDbCrudOpration(companyId, {
                type: SCHEMA_TYPE.TIMESHEET,
                data: [{ ...userScope(), startTimeTracker: { $gte: nowSec - RUNNING_WINDOW_SEC } }, { Loggeduser: 1, TicketID: 1, startTimeTracker: 1, LogDescription: 1 }],
            }, "find").catch(() => []);
            // Dedup by user|task, keeping the latest tracker (and its memo).
            const pairMap = {};
            (activeLogs || []).forEach((ts) => {
                if (!ts.Loggeduser || !ts.TicketID) return;
                const key = `${ts.Loggeduser}|${ts.TicketID}`;
                if (!pairMap[key] || (ts.startTimeTracker || 0) > pairMap[key].startTimeTracker) {
                    pairMap[key] = {
                        userId: String(ts.Loggeduser),
                        taskId: String(ts.TicketID),
                        startTimeTracker: ts.startTimeTracker || 0,
                        memo: (ts.LogDescription && String(ts.LogDescription).trim()) || "",
                    };
                }
            });
            const pairs = Object.values(pairMap);

            // Logged minutes TODAY — per user|task ("this task") and per user
            // (day total), mirroring the Active Work table's columns. Sums the
            // recorded LogTimeDuration; the currently running tracker adds up
            // once it is stopped/synced (same convention as employee-workload).
            const loggedByUserTask = {};
            const loggedByUser = {};
            if (pairs.length) {
                const dayStart = new Date();
                dayStart.setHours(0, 0, 0, 0);
                const todaysLogs = await MongoDbCrudOpration(companyId, {
                    type: SCHEMA_TYPE.TIMESHEET,
                    data: [
                        {
                            Loggeduser: { $in: [...new Set(pairs.map((p) => p.userId))] },
                            LogStartTime: { $gte: Math.floor(dayStart.getTime() / 1000), $lte: nowSec },
                        },
                        { Loggeduser: 1, TicketID: 1, LogTimeDuration: 1 },
                    ],
                }, "find").catch(() => []);
                (todaysLogs || []).forEach((ts) => {
                    if (!ts.Loggeduser) return;
                    const uid = String(ts.Loggeduser);
                    const mins = Number(ts.LogTimeDuration) || 0;
                    loggedByUser[uid] = (loggedByUser[uid] || 0) + mins;
                    if (ts.TicketID) {
                        const key = `${uid}|${ts.TicketID}`;
                        loggedByUserTask[key] = (loggedByUserTask[key] || 0) + mins;
                    }
                });
            }

            const taskMap = {}, projMap = {}, userMap = {};
            const taskIds = objIds(pairs.map((p) => p.taskId));
            if (taskIds.length) {
                const tasks = await MongoDbCrudOpration(companyId, {
                    type: SCHEMA_TYPE.TASKS, data: [{ _id: { $in: taskIds } }, { TaskName: 1, TaskKey: 1, ProjectID: 1, sprintArray: 1 }],
                }, "find").catch(() => []);
                (tasks || []).forEach((t) => { taskMap[String(t._id)] = t; });
                const pids = objIds(Object.values(taskMap).map((t) => t.ProjectID));
                if (pids.length) {
                    const projects = await MongoDbCrudOpration(companyId, {
                        type: SCHEMA_TYPE.PROJECTS, data: [{ _id: { $in: pids } }, { ProjectName: 1, ProjectCode: 1 }],
                    }, "find").catch(() => []);
                    (projects || []).forEach((p) => { projMap[String(p._id)] = p; });
                }
            }
            const userIds = objIds(pairs.map((p) => p.userId));
            if (userIds.length) {
                const users = await MongoDbCrudOpration(SCHEMA_TYPE.GOLBAL, {
                    type: SCHEMA_TYPE.USERS, data: [{ _id: { $in: userIds } }, { Employee_Name: 1, Employee_FName: 1, Employee_LName: 1, Employee_profileImage: 1 }],
                }, "find").catch(() => []);
                (users || []).forEach((u) => { userMap[String(u._id)] = u; });
            }
            const rows = pairs.map((p) => {
                const t = taskMap[p.taskId] || {};
                const u = userMap[p.userId] || {};
                const proj = projMap[String(t.ProjectID)] || {};
                return {
                    userId: p.userId,
                    userName: u.Employee_Name || `${u.Employee_FName || ""} ${u.Employee_LName || ""}`.trim() || "—",
                    avatar: u.Employee_profileImage || "",
                    taskId: p.taskId,
                    taskName: t.TaskName || "—",
                    taskKey: t.TaskKey || "",
                    projectId: t.ProjectID ? String(t.ProjectID) : "",
                    sprintId: (t.sprintArray && t.sprintArray.id) || "",
                    projectName: proj.ProjectName || "",
                    memo: p.memo,
                    startTimeTracker: p.startTimeTracker,
                    taskLoggedMinutes: loggedByUserTask[`${p.userId}|${p.taskId}`] || 0,
                    dayLoggedMinutes: loggedByUser[p.userId] || 0,
                };
            }).sort((a, b) => (b.startTimeTracker || 0) - (a.startTimeTracker || 0));
            return res.status(200).json({ status: true, data: { rows, count: rows.length } });
        }

        // ── metric: users' task count grouped by work category ──
        // The caller supplies a category→task-type template
        // (categoryMap: { "Development": ["Bug","Task"], "QA": [...] }). For each
        // user we count the DISTINCT tasks they logged time on in the window and
        // bucket them by category via the task's TaskType. Types not mapped to
        // any category are ignored (no "uncategorized" bucket).
        if (metric === "users_by_category") {
            const rawMap = (payload.categoryMap && typeof payload.categoryMap === "object" && !Array.isArray(payload.categoryMap))
                ? payload.categoryMap : {};
            // Column order follows the template's key order, but only
            // categories that actually have ≥1 task type mapped become columns.
            const categories = Object.keys(rawMap)
                .filter((c) => c && String(c).trim() && Array.isArray(rawMap[c]) && rawMap[c].length);
            // Reverse lookup: normalized task-type name → category. A type maps
            // to at most one category (last assignment wins).
            const typeToCat = {};
            categories.forEach((cat) => {
                (rawMap[cat] || []).forEach((tp) => {
                    const norm = String(tp || "").trim().toLowerCase();
                    if (norm) typeToCat[norm] = cat;
                });
            });

            const includeSubtasks = payload.includeSubtasks === undefined ? true : !!payload.includeSubtasks;
            const projectIds = objIds(payload.projectIds);
            // User filter is a plain string-id match on Loggeduser (mirrors the
            // workload report). Non-admins are already pinned to themselves by
            // userScope(), so this explicit filter only applies for admins.
            const userIdStrs = [...new Set((payload.userIds || []).filter(Boolean).map(String))]
                .filter((id) => mongoose.Types.ObjectId.isValid(id));

            const tsFilter = rangeTsFilter();
            if (!restrictToSelf && userIdStrs.length) {
                tsFilter.Loggeduser = { $in: userIdStrs };
            }
            const tlogs = await MongoDbCrudOpration(companyId, {
                type: SCHEMA_TYPE.TIMESHEET,
                data: [tsFilter, { Loggeduser: 1, TicketID: 1 }],
            }, "find").catch(() => []);

            // Distinct (user, task) pairs the user logged time on in the window.
            const userTaskPairs = new Set(); // `${uid}|${tid}`
            const taskIdSet = new Set();
            (tlogs || []).forEach((ts) => {
                if (!ts.Loggeduser || !ts.TicketID) return;
                userTaskPairs.add(`${ts.Loggeduser}|${ts.TicketID}`);
                taskIdSet.add(String(ts.TicketID));
            });

            // Fetch the touched tasks + apply the task-level filters. Tasks that
            // don't survive the filters drop out of the tally entirely.
            const taskMap = {};
            const tIds = objIds([...taskIdSet]);
            if (tIds.length) {
                const taskFilter = { _id: { $in: tIds }, deletedStatusKey: 0 };
                if (projectIds.length) taskFilter.ProjectID = { $in: projectIds };
                if (includeSubtasks === false) taskFilter.isParentTask = true;
                const tasks = await MongoDbCrudOpration(companyId, {
                    type: SCHEMA_TYPE.TASKS,
                    data: [taskFilter, { TaskType: 1 }],
                }, "find").catch(() => []);
                (tasks || []).forEach((t) => { taskMap[String(t._id)] = t; });
            }

            // Count DISTINCT tasks per user per category (each user|task pair =
            // one task). Only tasks whose TaskType is mapped to a category are
            // counted; unmapped types are ignored (no "uncategorized").
            const byUser = {}; // uid → { total, cats:{} }
            userTaskPairs.forEach((key) => {
                const sep = key.indexOf("|");
                const uid = key.slice(0, sep);
                const tid = key.slice(sep + 1);
                const t = taskMap[tid];
                if (!t) return; // filtered out (project / subtask / deleted)
                const cat = typeToCat[String(t.TaskType || "").trim().toLowerCase()];
                if (!cat) return; // unmapped type → ignored
                if (!byUser[uid]) byUser[uid] = { total: 0, cats: {} };
                byUser[uid].cats[cat] = (byUser[uid].cats[cat] || 0) + 1;
                byUser[uid].total += 1;
            });

            // Join user names / avatars.
            const uids = objIds(Object.keys(byUser));
            const userMap = {};
            if (uids.length) {
                const users = await MongoDbCrudOpration(SCHEMA_TYPE.GOLBAL, {
                    type: SCHEMA_TYPE.USERS,
                    data: [{ _id: { $in: uids } }, { Employee_Name: 1, Employee_FName: 1, Employee_LName: 1, Employee_profileImage: 1 }],
                }, "find").catch(() => []);
                (users || []).forEach((u) => { userMap[String(u._id)] = u; });
            }

            const rows = Object.keys(byUser).map((uid) => {
                const b = byUser[uid];
                const u = userMap[uid] || {};
                const cats = {};
                categories.forEach((c) => { cats[c] = b.cats[c] || 0; });
                return {
                    userId: uid,
                    userName: u.Employee_Name || `${u.Employee_FName || ""} ${u.Employee_LName || ""}`.trim() || "—",
                    avatar: u.Employee_profileImage || "",
                    categories: cats,
                    total: b.total,
                };
            }).filter((r) => r.total > 0).sort((a, b) => b.total - a.total);

            const byCategory = {};
            categories.forEach((c) => { byCategory[c] = 0; });
            let grand = 0;
            rows.forEach((r) => {
                categories.forEach((c) => { byCategory[c] += r.categories[c]; });
                grand += r.total;
            });

            return res.status(200).json({
                status: true,
                data: {
                    categories,
                    rows,
                    totals: { byCategory, grand },
                    userCount: rows.length,
                },
            });
        }

        return res.status(400).json({ status: false, message: "Unknown metric" });
    } catch (error) {
        logger.error(`getProjectProgressMetric error: ${error && error.message ? error.message : error}`);
        return res.status(500).json({
            status: false,
            message: "An error occurred while building project-progress metrics.",
            error: error && error.message ? error.message : String(error),
        });
    }
};

/**
 * On Leave board — backs the OnLeaveCard. Leaves are managed as ordinary
 * tasks ("leave tickets") inside a designated project (e.g. Support / HR):
 * the card config picks that project (projectIds) plus the status(es) that
 * mean the leave is approved (statusKeys). A ticket counts for the window
 * when its startDate–DueDate period overlaps [dateFrom, dateTo].
 *
 * The person on leave is the ticket's FIRST assignee (the applicant, by the
 * HR workflow convention; later assignees are the approvers).
 *
 * Returns the ticket rows plus the AB/PR headcounts:
 *   absent  (AB) — distinct applicants with an overlapping approved ticket
 *   present (PR) — active company members minus the absent ones
 *
 * Company-scoped and read-only. Like the utilization summary, this is a
 * team-visibility widget, so no role gate: everyone sees who is on leave.
 */
exports.getOnLeaveBoard = async (req, res) => {
    try {
        const companyId = req.headers["companyid"];
        if (!companyId) {
            return res.status(400).json({ status: false, message: "companyId header required" });
        }

        const payload = req.body || {};
        // SECURITY (CodeRabbit): derive caller identity + role from the
        // authenticated session, never the request body. req.uid is the verified
        // JWT user; the role is resolved server-side. A forged
        // callerUserId/callerRoleType in the body can no longer widen scope.
        payload.callerUserId = String(req.uid || "");
        payload.callerRoleType = await resolveCallerRoleType(companyId, req.uid);
        const projectIds = (Array.isArray(payload.projectIds) ? payload.projectIds : [])
            .filter((id) => mongoose.Types.ObjectId.isValid(String(id)))
            .map((id) => new mongoose.Types.ObjectId(String(id)));
        if (!projectIds.length) {
            return res.status(200).json({
                status: true,
                data: { rows: [], stats: { absent: 0, present: 0, totalUsers: 0, tickets: 0 } },
            });
        }
        const statusKeys = (Array.isArray(payload.statusKeys) ? payload.statusKeys : [])
            .map(Number).filter((n) => !Number.isNaN(n));

        const { dateFrom, dateTo } = getDayOrRangeBounds(payload);

        // Leave-period overlap on the ticket's startDate/DueDate (Date fields):
        // starts in the window, ends in the window, or spans it entirely.
        // Tickets with neither date can't be placed on a timeline → excluded.
        const taskFilter = {
            ProjectID: { $in: projectIds },
            deletedStatusKey: 0,
            $or: [
                { startDate: { $gte: dateFrom, $lte: dateTo } },
                { DueDate: { $gte: dateFrom, $lte: dateTo } },
                { startDate: { $lte: dateFrom }, DueDate: { $gte: dateTo } },
            ],
        };
        if (statusKeys.length) taskFilter.statusKey = { $in: statusKeys };

        const tickets = await MongoDbCrudOpration(companyId, {
            type: SCHEMA_TYPE.TASKS,
            data: [taskFilter, {
                TaskName: 1, TaskKey: 1, AssigneeUserId: 1,
                startDate: 1, DueDate: 1, statusKey: 1, ProjectID: 1, sprintArray: 1,
            }],
        }, "find").catch(() => []);

        // AssigneeUserId entries are usually plain id strings; tolerate object
        // shapes the same way buildUserTeamMap does.
        const extractId = (entry) => {
            if (entry == null) return "";
            if (typeof entry === "object") return String(entry.userId || entry._id || entry.id || "");
            return String(entry);
        };

        const absentIds = new Set();
        const rows = (tickets || []).map((t) => {
            const applicantId = extractId((t.AssigneeUserId || [])[0]);
            if (applicantId) absentIds.add(applicantId);
            return {
                taskId: String(t._id),
                taskName: t.TaskName || "—",
                taskKey: t.TaskKey || "",
                projectId: t.ProjectID ? String(t.ProjectID) : "",
                sprintId: (t.sprintArray && t.sprintArray.id) || "",
                userId: applicantId,
                startDate: t.startDate || null,
                dueDate: t.DueDate || null,
                statusKey: t.statusKey,
            };
        }).sort((a, b) => new Date(a.startDate || a.dueDate || 0) - new Date(b.startDate || b.dueDate || 0));

        // Join applicant names/avatars (global users collection).
        const uids = [...absentIds]
            .filter((id) => mongoose.Types.ObjectId.isValid(id))
            .map((id) => new mongoose.Types.ObjectId(id));
        const userMap = {};
        if (uids.length) {
            const users = await MongoDbCrudOpration(SCHEMA_TYPE.GOLBAL, {
                type: SCHEMA_TYPE.USERS,
                data: [{ _id: { $in: uids } }, { Employee_Name: 1, Employee_FName: 1, Employee_LName: 1, Employee_profileImage: 1 }],
            }, "find").catch(() => []);
            (users || []).forEach((u) => { userMap[String(u._id)] = u; });
        }
        rows.forEach((r) => {
            const u = userMap[r.userId] || {};
            r.userName = u.Employee_Name || `${u.Employee_FName || ""} ${u.Employee_LName || ""}`.trim() || "—";
            r.avatar = u.Employee_profileImage || "";
        });

        // PR headcount base — active members of this company (same query the
        // workload report uses to enumerate the team).
        const members = await MongoDbCrudOpration(SCHEMA_TYPE.GOLBAL, {
            type: SCHEMA_TYPE.USERS,
            data: [{ isActive: true, AssignCompany: companyId }, { _id: 1 }],
        }, "find").catch(() => []);
        const totalUsers = (members || []).length;
        const memberIdSet = new Set((members || []).map((m) => String(m._id)));
        const absent = [...absentIds].filter((id) => memberIdSet.has(id)).length;

        return res.status(200).json({
            status: true,
            data: {
                rows,
                stats: {
                    absent,
                    present: Math.max(totalUsers - absent, 0),
                    totalUsers,
                    tickets: rows.length,
                },
            },
        });
    } catch (error) {
        logger.error(`getOnLeaveBoard error: ${error && error.message ? error.message : error}`);
        return res.status(500).json({
            status: false,
            message: "An error occurred while building the on-leave board.",
            error: error && error.message ? error.message : String(error),
        });
    }
};

// Priority label → sort rank (lower = more urgent). Unknown priorities sort last.
const MEMBER_PRIORITY_RANK = { urgent: 0, highest: 0, high: 1, medium: 2, normal: 2, low: 3, lowest: 4 };

/**
 * My Next Up (member self-card). The caller's open assigned tasks, ordered by
 * due date (soonest first, undated last) then priority. Self-scoped: the member
 * is req.uid (JWT), never the body — a member only ever sees their own work.
 *
 * Response: { tasks: [{ taskId, taskKey, taskName, projectId, projectName,
 *                       sprintId, dueDate, priority, statusKey, status, overdue }] }
 */
exports.getMyNextTasks = async (req, res) => {
    try {
        const companyId = req.headers["companyid"];
        if (!companyId) {
            return res.status(400).json({ status: false, message: "companyId header required" });
        }
        const uid = String(req.uid || "");
        if (!uid) return res.status(200).json({ status: true, data: { tasks: [] } });
        const limit = Math.min(Number(req.body && req.body.limit) || 8, 25);

        const nextFilter = applyTaskMatch({
            deletedStatusKey: 0,
            statusType: { $ne: "close" },
            $or: [{ AssigneeUserId: uid }, { Task_Leader: uid }],
        }, bodyTaskMatch(req.body));
        const tasks = await MongoDbCrudOpration(companyId, {
            type: SCHEMA_TYPE.TASKS,
            data: [
                nextFilter,
                { TaskName: 1, TaskKey: 1, DueDate: 1, Task_Priority: 1, ProjectID: 1, statusKey: 1, status: 1, sprintArray: 1 },
            ],
        }, "find").catch(() => []);

        const projIds = [...new Set((tasks || []).map((t) => String(t.ProjectID)).filter(Boolean))];
        const projectsMap = {};
        if (projIds.length) {
            const projects = await MongoDbCrudOpration(companyId, {
                type: SCHEMA_TYPE.PROJECTS,
                data: [
                    { _id: { $in: projIds.filter((id) => mongoose.Types.ObjectId.isValid(id)).map((id) => new mongoose.Types.ObjectId(id)) } },
                    { ProjectName: 1 },
                ],
            }, "find").catch(() => []);
            (projects || []).forEach((p) => { projectsMap[String(p._id)] = p.ProjectName || ""; });
        }

        const now = Date.now();
        const rows = (tasks || []).map((t) => {
            const dueMs = t.DueDate ? new Date(t.DueDate).getTime() : null;
            return {
                taskId: String(t._id),
                taskKey: t.TaskKey || "",
                taskName: t.TaskName || "—",
                projectId: t.ProjectID ? String(t.ProjectID) : "",
                projectName: projectsMap[String(t.ProjectID)] || "",
                sprintId: (t.sprintArray && t.sprintArray.id) || "",
                dueDate: t.DueDate || null,
                priority: t.Task_Priority || "",
                statusKey: t.statusKey,
                status: t.status,
                overdue: !!(dueMs && dueMs < now),
                _due: dueMs,
                _prank: MEMBER_PRIORITY_RANK[String(t.Task_Priority || "").toLowerCase()] ?? 9,
            };
        }).sort((a, b) => {
            // Due date ascending, undated last; then priority rank.
            if (a._due == null && b._due != null) return 1;
            if (a._due != null && b._due == null) return -1;
            if (a._due != null && b._due != null && a._due !== b._due) return a._due - b._due;
            return a._prank - b._prank;
        }).slice(0, limit).map(({ _due, _prank, ...r }) => r); // eslint-disable-line no-unused-vars

        return res.status(200).json({ status: true, data: { tasks: rows } });
    } catch (error) {
        logger.error(`getMyNextTasks error: ${error && error.message ? error.message : error}`);
        return res.status(500).json({
            status: false,
            message: "An error occurred while building the next-up list.",
            error: error && error.message ? error.message : String(error),
        });
    }
};

/**
 * My Achievements (member self-card). For the caller (req.uid) over the window:
 * tasks they completed, split into within-estimate vs over-estimate, on-time %,
 * and a current on-estimate streak.
 *
 * Completion is detected by `statusType === 'close'` with the task's `updatedAt`
 * falling in the window (tasks carry no dedicated completedAt — updatedAt is the
 * best available proxy; a task edited after closing can shift its date).
 * On-estimate compares the task's total logged time vs its shared
 * totalEstimatedTime.
 *
 * Response: { completedCount, onEstimate, overEstimate, onEstimateRate,
 *             onTime, withDue, onTimeRate, currentStreak, recent: [...] }
 */
exports.getMyAchievements = async (req, res) => {
    try {
        const companyId = req.headers["companyid"];
        if (!companyId) {
            return res.status(400).json({ status: false, message: "companyId header required" });
        }
        const uid = String(req.uid || "");
        const empty = { completedCount: 0, onEstimate: 0, overEstimate: 0, onEstimateRate: null, onTime: 0, withDue: 0, onTimeRate: null, currentStreak: 0, recent: [] };
        if (!uid) return res.status(200).json({ status: true, data: empty });

        const { dateFrom, dateTo } = getDayOrRangeBounds(req.body || {});

        // Tasks the member completed in the window (updatedAt = completion proxy).
        const achFilter = applyTaskMatch({
            deletedStatusKey: 0,
            statusType: "close",
            $or: [{ AssigneeUserId: uid }, { Task_Leader: uid }],
            updatedAt: { $gte: dateFrom, $lte: dateTo },
        }, bodyTaskMatch(req.body));
        const tasks = await MongoDbCrudOpration(companyId, {
            type: SCHEMA_TYPE.TASKS,
            data: [
                achFilter,
                { TaskName: 1, TaskKey: 1, totalEstimatedTime: 1, DueDate: 1, updatedAt: 1, ProjectID: 1, sprintArray: 1 },
            ],
        }, "find").catch(() => []);

        // Total logged per task (any user) → compared to the shared estimate.
        const loggedByTask = {};
        const taskIds = (tasks || []).map((t) => String(t._id));
        if (taskIds.length) {
            const tlogs = await MongoDbCrudOpration(companyId, {
                type: SCHEMA_TYPE.TIMESHEET,
                data: [{ TicketID: { $in: taskIds } }, { TicketID: 1, LogTimeDuration: 1 }],
            }, "find").catch(() => []);
            (tlogs || []).forEach((ts) => {
                if (!ts.TicketID) return;
                loggedByTask[String(ts.TicketID)] = (loggedByTask[String(ts.TicketID)] || 0) + (Number(ts.LogTimeDuration) || 0);
            });
        }

        let onEstimate = 0;
        let overEstimate = 0;
        let onTime = 0;
        let withDue = 0;
        const recent = (tasks || []).map((t) => {
            const estimate = Number(t.totalEstimatedTime) || 0;
            const logged = loggedByTask[String(t._id)] || 0;
            const within = estimate > 0 ? logged <= estimate : null;
            if (within === true) onEstimate += 1;
            else if (within === false) overEstimate += 1;

            let onTimeFlag = null;
            if (t.DueDate) {
                withDue += 1;
                const doneMs = t.updatedAt ? new Date(t.updatedAt).getTime() : 0;
                const dueEnd = new Date(t.DueDate); dueEnd.setHours(23, 59, 59, 999);
                onTimeFlag = !!(doneMs && doneMs <= dueEnd.getTime());
                if (onTimeFlag) onTime += 1;
            }
            return {
                taskId: String(t._id),
                taskKey: t.TaskKey || "",
                taskName: t.TaskName || "—",
                projectId: t.ProjectID ? String(t.ProjectID) : "",
                sprintId: (t.sprintArray && t.sprintArray.id) || "",
                logged,
                estimate,
                within,
                onTime: onTimeFlag,
                dueDate: t.DueDate || null,
                completedAt: t.updatedAt || null,
            };
        }).sort((a, b) => new Date(b.completedAt || 0) - new Date(a.completedAt || 0));

        const rated = onEstimate + overEstimate;
        // Current streak — trailing consecutive on-estimate completions (most
        // recent first); tasks with no estimate are skipped, an over-estimate breaks it.
        let currentStreak = 0;
        for (const r of recent) {
            if (r.within === null) continue;
            if (r.within) currentStreak += 1;
            else break;
        }

        return res.status(200).json({
            status: true,
            data: {
                completedCount: (tasks || []).length,
                onEstimate,
                overEstimate,
                onEstimateRate: rated ? Math.round((onEstimate / rated) * 100) : null,
                onTime,
                withDue,
                onTimeRate: withDue ? Math.round((onTime / withDue) * 100) : null,
                currentStreak,
                recent: recent.slice(0, 100),
            },
        });
    } catch (error) {
        logger.error(`getMyAchievements error: ${error && error.message ? error.message : error}`);
        return res.status(500).json({
            status: false,
            message: "An error occurred while building achievements.",
            error: error && error.message ? error.message : String(error),
        });
    }
};

/**
 * My Leave (member self-card). The caller's own leave tickets in the configured
 * leave project(s), across ALL statuses (so pending / approved / rejected are
 * all visible) — "what's the status of my requests". Self-scoped (req.uid);
 * status label/colour is resolved client-side from the status settings.
 *
 * Response: { configured, rows: [{ taskId, taskKey, taskName, projectId,
 *             sprintId, startDate, dueDate, statusKey, statusType }] }
 */
exports.getMyLeave = async (req, res) => {
    try {
        const companyId = req.headers["companyid"];
        if (!companyId) {
            return res.status(400).json({ status: false, message: "companyId header required" });
        }
        const uid = String(req.uid || "");
        const projectIds = (Array.isArray(req.body && req.body.projectIds) ? req.body.projectIds : [])
            .filter((id) => mongoose.Types.ObjectId.isValid(String(id)))
            .map((id) => new mongoose.Types.ObjectId(String(id)));
        if (!uid || !projectIds.length) {
            return res.status(200).json({ status: true, data: { configured: projectIds.length > 0, rows: [] } });
        }

        const leaveFilter = applyTaskMatch({
            ProjectID: { $in: projectIds },
            deletedStatusKey: 0,
            $or: [{ AssigneeUserId: uid }, { Task_Leader: uid }],
        }, bodyTaskMatch(req.body));
        const tickets = await MongoDbCrudOpration(companyId, {
            type: SCHEMA_TYPE.TASKS,
            data: [
                leaveFilter,
                { TaskName: 1, TaskKey: 1, startDate: 1, DueDate: 1, statusKey: 1, statusType: 1, ProjectID: 1, sprintArray: 1 },
            ],
        }, "find").catch(() => []);

        const rows = (tickets || []).map((t) => ({
            taskId: String(t._id),
            taskKey: t.TaskKey || "",
            taskName: t.TaskName || "—",
            projectId: t.ProjectID ? String(t.ProjectID) : "",
            sprintId: (t.sprintArray && t.sprintArray.id) || "",
            startDate: t.startDate || null,
            dueDate: t.DueDate || null,
            statusKey: t.statusKey,
            statusType: t.statusType,
        })).sort((a, b) => new Date(b.startDate || b.dueDate || 0) - new Date(a.startDate || a.dueDate || 0))
            .slice(0, 20);

        return res.status(200).json({ status: true, data: { configured: true, rows } });
    } catch (error) {
        logger.error(`getMyLeave error: ${error && error.message ? error.message : error}`);
        return res.status(500).json({
            status: false,
            message: "An error occurred while building my-leave.",
            error: error && error.message ? error.message : String(error),
        });
    }
};

/**
 * My Due Soon (member self-card). The caller's open tasks whose due date falls
 * within the next N days (default 7), ordered soonest-first. Self-scoped
 * (req.uid). Complements Next Up (priority order) and Overdue (past due).
 *
 * Response: { days, tasks: [{ taskId, taskKey, taskName, projectId, projectName,
 *             sprintId, dueDate, priority, statusKey, status, daysUntil }] }
 */
exports.getMyDueSoon = async (req, res) => {
    try {
        const companyId = req.headers["companyid"];
        if (!companyId) {
            return res.status(400).json({ status: false, message: "companyId header required" });
        }
        const uid = String(req.uid || "");
        if (!uid) return res.status(200).json({ status: true, data: { days: 7, tasks: [] } });
        const days = Math.min(Math.max(Number(req.body && req.body.days) || 7, 1), 60);

        const start = new Date(); start.setHours(0, 0, 0, 0);
        const end = new Date(); end.setDate(end.getDate() + days); end.setHours(23, 59, 59, 999);

        const filter = applyTaskMatch({
            deletedStatusKey: 0,
            statusType: { $ne: "close" },
            $or: [{ AssigneeUserId: uid }, { Task_Leader: uid }],
            DueDate: { $gte: start, $lte: end },
        }, bodyTaskMatch(req.body));

        const tasks = await MongoDbCrudOpration(companyId, {
            type: SCHEMA_TYPE.TASKS,
            data: [filter, { TaskName: 1, TaskKey: 1, DueDate: 1, Task_Priority: 1, ProjectID: 1, statusKey: 1, status: 1, sprintArray: 1 }],
        }, "find").catch(() => []);

        const projIds = [...new Set((tasks || []).map((t) => String(t.ProjectID)).filter(Boolean))];
        const projectsMap = {};
        if (projIds.length) {
            const projects = await MongoDbCrudOpration(companyId, {
                type: SCHEMA_TYPE.PROJECTS,
                data: [
                    { _id: { $in: projIds.filter((id) => mongoose.Types.ObjectId.isValid(id)).map((id) => new mongoose.Types.ObjectId(id)) } },
                    { ProjectName: 1 },
                ],
            }, "find").catch(() => []);
            (projects || []).forEach((p) => { projectsMap[String(p._id)] = p.ProjectName || ""; });
        }

        const todayMs = start.getTime();
        const rows = (tasks || []).map((t) => {
            const dueMs = t.DueDate ? new Date(t.DueDate).setHours(0, 0, 0, 0) : null;
            return {
                taskId: String(t._id),
                taskKey: t.TaskKey || "",
                taskName: t.TaskName || "—",
                projectId: t.ProjectID ? String(t.ProjectID) : "",
                projectName: projectsMap[String(t.ProjectID)] || "",
                sprintId: (t.sprintArray && t.sprintArray.id) || "",
                dueDate: t.DueDate || null,
                priority: t.Task_Priority || "",
                statusKey: t.statusKey,
                status: t.status,
                daysUntil: dueMs != null ? Math.round((dueMs - todayMs) / 86400000) : null,
            };
        }).sort((a, b) => new Date(a.dueDate || 0) - new Date(b.dueDate || 0)).slice(0, 15);

        return res.status(200).json({ status: true, data: { days, tasks: rows } });
    } catch (error) {
        logger.error(`getMyDueSoon error: ${error && error.message ? error.message : error}`);
        return res.status(500).json({
            status: false,
            message: "An error occurred while building due-soon.",
            error: error && error.message ? error.message : String(error),
        });
    }
};

/**
 * My Time (member self-card). The caller's planned hours (estimated_time) vs
 * logged hours (timesheets) for the window. Self-scoped (req.uid).
 *
 * Response: { plannedMinutes, loggedMinutes }
 */
exports.getMyTime = async (req, res) => {
    try {
        const companyId = req.headers["companyid"];
        if (!companyId) {
            return res.status(400).json({ status: false, message: "companyId header required" });
        }
        const uid = String(req.uid || "");
        if (!uid) return res.status(200).json({ status: true, data: { plannedMinutes: 0, loggedMinutes: 0 } });

        const { dateFrom, dateTo, fromSec, toSec } = getDayOrRangeBounds(req.body || {});

        const [ests, tlogs] = await Promise.all([
            MongoDbCrudOpration(companyId, {
                type: SCHEMA_TYPE.ESTIMATES_TIME,
                data: [{ UserId: uid, Date: { $gte: dateFrom, $lte: dateTo } }, { EstimatedTime: 1 }],
            }, "find").catch(() => []),
            MongoDbCrudOpration(companyId, {
                type: SCHEMA_TYPE.TIMESHEET,
                data: [{ Loggeduser: uid, LogStartTime: { $gte: fromSec, $lte: toSec } }, { LogTimeDuration: 1 }],
            }, "find").catch(() => []),
        ]);

        const plannedMinutes = (ests || []).reduce((s, e) => s + (Number(e.EstimatedTime) || 0), 0);
        const loggedMinutes = (tlogs || []).reduce((s, t) => s + (Number(t.LogTimeDuration) || 0), 0);

        return res.status(200).json({ status: true, data: { plannedMinutes, loggedMinutes } });
    } catch (error) {
        logger.error(`getMyTime error: ${error && error.message ? error.message : error}`);
        return res.status(500).json({
            status: false,
            message: "An error occurred while building my-time.",
            error: error && error.message ? error.message : String(error),
        });
    }
};
