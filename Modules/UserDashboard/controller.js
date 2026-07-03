const { myCache } = require("../../Config/config");
const { SCHEMA_TYPE } = require("../../Config/schemaType");
const { MongoDbCrudOpration } = require("../../utils/mongo-handler/mongoQueries");
const axios = require("axios");
const mongoose = require("mongoose");
const logger = require("../../Config/loggerConfig");
const dashboardTemplate = require("../../utils/dashboardTemplate.json");
const cardComponent = require("../../utils/cardComponent.json");

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
        {
            const tsFilter = { Loggeduser: { $in: employeeIdStrs } };
            if (dateFromSec != null || dateToSec != null) {
                tsFilter.LogStartTime = {};
                if (dateFromSec != null) tsFilter.LogStartTime.$gte = dateFromSec;
                if (dateToSec != null) tsFilter.LogStartTime.$lte = dateToSec;
            }
            const tlogs = await MongoDbCrudOpration(companyId, {
                type: SCHEMA_TYPE.TIMESHEET,
                data: [tsFilter, { Loggeduser: 1, TicketID: 1, LogTimeDuration: 1 }],
            }, "find").catch(() => []);
            (tlogs || []).forEach((ts) => {
                if (!ts.TicketID) return;
                const key = `${ts.Loggeduser}|${ts.TicketID}`;
                loggedByUserTask[key] = (loggedByUserTask[key] || 0) + (Number(ts.LogTimeDuration) || 0);
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
        {
            const activeFilter = {
                Loggeduser: { $in: employeeIdStrs },
                startTimeTracker: { $gte: nowSec - RUNNING_WINDOW_SEC },
            };
            const activeLogs = await MongoDbCrudOpration(companyId, {
                type: SCHEMA_TYPE.TIMESHEET,
                data: [activeFilter, { Loggeduser: 1, TicketID: 1 }],
            }, "find").catch(() => []);
            (activeLogs || []).forEach((ts) => {
                if (!ts.Loggeduser || !ts.TicketID) return;
                activeTrackerPairs.add(`${ts.Loggeduser}|${ts.TicketID}`);
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

        // ── metric: active projects (company-wide count) ──
        if (metric === "active_projects") {
            const projects = await MongoDbCrudOpration(companyId, {
                type: SCHEMA_TYPE.PROJECTS, data: [activeProjectFilter, { _id: 1 }],
            }, "find").catch(() => []);
            return res.status(200).json({ status: true, data: { count: (projects || []).length } });
        }

        // ── metric: active projects grouped by type (company-wide) ──
        if (metric === "projects_by_type") {
            const projects = await MongoDbCrudOpration(companyId, {
                type: SCHEMA_TYPE.PROJECTS, data: [activeProjectFilter, { ProjectType: 1 }],
            }, "find").catch(() => []);
            const counts = {};
            (projects || []).forEach((p) => {
                const raw = (p.ProjectType && String(p.ProjectType).trim()) || "unspecified";
                counts[raw] = (counts[raw] || 0) + 1;
            });
            const rows = Object.entries(counts).map(([key, value]) => ({ key, value })).sort((a, b) => b.value - a.value);
            return res.status(200).json({ status: true, data: { rows } });
        }

        // ── metric 1: running/working projects (active + logged in range) ──
        if (metric === "running_projects") {
            const tlogs = await MongoDbCrudOpration(companyId, {
                type: SCHEMA_TYPE.TIMESHEET, data: [rangeTsFilter(), { TicketID: 1 }],
            }, "find").catch(() => []);
            const taskIds = objIds((tlogs || []).map((t) => t.TicketID));
            let count = 0;
            if (taskIds.length) {
                const tasks = await MongoDbCrudOpration(companyId, {
                    type: SCHEMA_TYPE.TASKS, data: [{ _id: { $in: taskIds }, deletedStatusKey: 0 }, { ProjectID: 1 }],
                }, "find").catch(() => []);
                const pids = objIds((tasks || []).map((t) => t.ProjectID));
                if (pids.length) {
                    const projects = await MongoDbCrudOpration(companyId, {
                        type: SCHEMA_TYPE.PROJECTS, data: [{ _id: { $in: pids } }, { statusType: 1, deletedStatusKey: 1 }],
                    }, "find").catch(() => []);
                    count = (projects || []).filter((p) => p.statusType !== "close" && !p.deletedStatusKey).length;
                }
            }
            return res.status(200).json({ status: true, data: { count } });
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