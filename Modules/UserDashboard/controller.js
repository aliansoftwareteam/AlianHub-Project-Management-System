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
        //    only pairs whose task survived the filters.
        const pairsByUser = {}; // uid → Set of tid
        userTaskPairs.forEach((key) => {
            const [uid, tid] = key.split("|");
            if (!taskMap[tid]) return; // task filtered out
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