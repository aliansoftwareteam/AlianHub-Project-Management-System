const { myCache } = require("../../Config/config");
const { SCHEMA_TYPE } = require("../../Config/schemaType");
const { MongoDbCrudOpration } = require("../../utils/mongo-handler/mongoQueries");
const axios = require("axios");
const mongoose = require("mongoose");
const logger = require("../../Config/loggerConfig");
const dashboardTemplate = require("../../utils/dashboardTemplate.json");
const cardComponent = require("../../utils/cardComponent.json");
const {
    getDayOrRangeBounds,
    buildUserTeamMap,
    getLoggedAndTasksInRange,
    getUserNameMap,
    getSprintTypeMap,
} = require("./helpers/resourceHelpers");

// Shared role-visibility resolver for the resource cards. Mirrors
// getEmployeeWorkloadReport: roleType 1/2 → all users (null = no
// restriction); everyone else → only themselves.
function resolveVisibleUserIds(payload = {}) {
    const roleType = Number(payload.callerRoleType || 3);
    if (roleType === 1 || roleType === 2) return null;
    const self = String(payload.callerUserId || "");
    return self ? [self] : [];
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
            const defaultDashboard = lanData.find(e => e.isDefault && !e.isDeleted);
            
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

        // 1 + 3 — active projects and their ProjectType mix.
        const activeProjects = await MongoDbCrudOpration(companyId, {
            type: SCHEMA_TYPE.PROJECTS,
            data: [
                { statusType: { $nin: ["close"] }, deletedStatusKey: 0 },
                { ProjectType: 1, ProjectName: 1 },
            ],
        }, "find").catch(() => []);

        // "In House" is not a ProjectType — it's a naming convention: the
        // project name is prefixed with "IH" (e.g. "IH - Foo", "IH Foo",
        // "IH_Foo"). The negative lookahead (?![A-Za-z]) accepts any
        // separator/space/digit/end after "IH" but rejects real words like
        // "IHelp".
        const IH_PREFIX = /^\s*IH(?![A-Za-z])/i;
        const typeCounts = {};
        (activeProjects || []).forEach((p) => {
            const key = IH_PREFIX.test(p.ProjectName || "")
                ? "In House"
                : (p.ProjectType || "Unspecified");
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

        return res.status(200).json({
            status: true,
            data: {
                activeProjects: (activeProjects || []).length,
                workingProjects: workingProjectIds.size,
                typeMix,
            },
        });
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