/**
 * Shared helpers for the Resource Utilization & Consumption dashboard cards.
 *
 * These back the new resolvers in controller.js (project-utilization-summary,
 * team-tasktype-breakdown, team-logged-vs-eta). They deliberately mirror the
 * conventions already used by getEmployeeWorkloadReport:
 *   - timesheets pivot on Unix-SECONDS `LogStartTime`
 *   - estimated_time pivots on a JS `Date` in the `Date` field
 *   - joins are done in JS by String(_id) keys, never $lookup, because
 *     timesheet TicketID/ProjectId are Strings while task/project _id are
 *     ObjectIds.
 */
const mongoose = require("mongoose");
const { SCHEMA_TYPE } = require("../../../Config/schemaType");
const { MongoDbCrudOpration } = require("../../../utils/mongo-handler/mongoQueries");

/**
 * Resolve the reporting window from a card payload.
 * Accepts `dateFrom`/`dateTo` ISO strings (as the frontend cards send). When
 * absent, defaults to the current day (server-local midnight → 23:59:59.999).
 *
 * @param {{dateFrom?:string, dateTo?:string}} payload
 * @returns {{dateFrom:Date, dateTo:Date, fromSec:number, toSec:number}}
 */
function getDayOrRangeBounds(payload = {}) {
    let dateFrom;
    let dateTo;
    if (payload.dateFrom) {
        dateFrom = new Date(payload.dateFrom);
    } else {
        dateFrom = new Date();
        dateFrom.setHours(0, 0, 0, 0);
    }
    if (payload.dateTo) {
        dateTo = new Date(payload.dateTo);
    } else {
        dateTo = new Date();
        dateTo.setHours(23, 59, 59, 999);
    }
    return {
        dateFrom,
        dateTo,
        fromSec: Math.floor(dateFrom.getTime() / 1000),
        toSec: Math.floor(dateTo.getTime() / 1000),
    };
}

/**
 * Build a userId → teams lookup from the teams_management collection.
 * A user can belong to multiple teams. Users in no team are handled by the
 * caller (bucketed under an "Unassigned" group).
 *
 * @param {string} companyId
 * @returns {Promise<{ map: Object.<string, Array<{teamId:string,name:string,color:*}>>, teams: Array }>}
 */
async function buildUserTeamMap(companyId) {
    // NOTE: the teams_management schema has no `deletedStatusKey` field, so we
    // must NOT filter on it (doing so matches zero docs → everyone "Unassigned").
    // `$ne: 1` still tolerates any future soft-delete flag while matching docs
    // that lack the field.
    const teams = await MongoDbCrudOpration(companyId, {
        type: SCHEMA_TYPE.TEAMS_MANAGEMENT,
        data: [{ deletedStatusKey: { $ne: 1 } }, { name: 1, value: 1, assigneeUsersArray: 1, teamColor: 1 }],
    }, "find").catch(() => []);

    // assigneeUsersArray entries are usually plain user-id strings, but tolerate
    // object shapes ({ userId } / { _id } / { id }) just in case.
    const extractId = (entry) => {
        if (entry == null) return "";
        if (typeof entry === "object") return String(entry.userId || entry._id || entry.id || "");
        return String(entry);
    };

    const map = {};
    (teams || []).forEach((t) => {
        const entry = { teamId: String(t._id), name: t.name, color: t.teamColor || null };
        (t.assigneeUsersArray || []).forEach((u) => {
            const key = extractId(u);
            if (!key) return;
            if (!map[key]) map[key] = [];
            map[key].push(entry);
        });
    });
    return { map, teams: teams || [] };
}

/**
 * Status-name → canonical bucket keyword map for the worked-tasks table.
 * Best-effort substring match on the (lowercased) status name. Tunable here.
 */
const STATUS_BUCKET_KEYWORDS = {
    backlog: ["backlog", "todo", "to do", "open", "new"],
    review: ["review", "qa", "testing", "verify"],
    progress: ["progress", "doing", "active", "wip", "development", "dev"],
};

/**
 * Bucket an arbitrary per-project status into one of the four canonical
 * columns: complete | review | progress | backlog.
 *
 * `statusType === 'close'` always wins → complete. Otherwise we name-match;
 * anything active but unmatched falls through to `progress` (the safe default
 * called out in the plan).
 *
 * @param {string} statusName human-readable status label
 * @param {string} statusType normalized type ('active' | 'close')
 * @returns {'complete'|'review'|'progress'|'backlog'}
 */
function bucketForStatus(statusName, statusType) {
    if (statusType === "close" || statusType === "done") return "complete";
    const name = String(statusName || "").toLowerCase();
    for (const bucket of ["review", "backlog", "progress"]) {
        if (STATUS_BUCKET_KEYWORDS[bucket].some((kw) => name.includes(kw))) return bucket;
    }
    return "progress";
}

/**
 * Fetch logged time (per user|task) and the worked tasks for a window.
 * Shared by the team-tasktype-breakdown and team-logged-vs-eta resolvers.
 * Follows the JS-join convention: timesheet TicketID (String) → task _id
 * (ObjectId), collected in JS rather than $lookup.
 *
 * @param {string} companyId
 * @param {{fromSec:number, toSec:number, projectIds?:string[], statusKeys?:number[], visibleUserIds?:string[]|null}} opts
 * @returns {Promise<{loggedByUserTask:Object.<string,number>, taskMap:Object.<string,object>, userIds:Set<string>}>}
 */
async function getLoggedAndTasksInRange(companyId, opts = {}) {
    const { fromSec, toSec, projectIds = [], statusKeys = [], visibleUserIds = null, taskMatch = null } = opts;

    const tsFilter = { LogStartTime: { $gte: fromSec, $lte: toSec } };
    if (Array.isArray(visibleUserIds)) {
        tsFilter.Loggeduser = { $in: visibleUserIds.map(String) };
    }
    const tlogs = await MongoDbCrudOpration(companyId, {
        type: SCHEMA_TYPE.TIMESHEET,
        data: [tsFilter, { Loggeduser: 1, TicketID: 1, LogTimeDuration: 1 }],
    }, "find").catch(() => []);

    const loggedByUserTask = {};
    const ticketIds = new Set();
    const userIds = new Set();
    (tlogs || []).forEach((ts) => {
        if (!ts.TicketID) return;
        const key = `${ts.Loggeduser}|${ts.TicketID}`;
        loggedByUserTask[key] = (loggedByUserTask[key] || 0) + (Number(ts.LogTimeDuration) || 0);
        ticketIds.add(String(ts.TicketID));
        userIds.add(String(ts.Loggeduser));
    });

    const taskMap = {};
    if (ticketIds.size) {
        const validIds = Array.from(ticketIds)
            .filter((id) => mongoose.Types.ObjectId.isValid(id))
            .map((id) => new mongoose.Types.ObjectId(id));
        const taskFilter = { _id: { $in: validIds }, deletedStatusKey: 0 };
        if (projectIds.length) {
            taskFilter.ProjectID = { $in: projectIds.map((id) => new mongoose.Types.ObjectId(String(id))) };
        }
        if (statusKeys.length) {
            taskFilter.statusKey = { $in: statusKeys.map(Number) };
        }
        // Advanced "Add filter" builder — the frontend translates filterData
        // into a Mongo match (buildFilterQuery) on task fields ($and/$or) and
        // sends it as taskMatch. Merge it into the task query so the card's
        // Filters section actually narrows results.
        if (taskMatch && typeof taskMatch === "object" && Object.keys(taskMatch).length) {
            Object.assign(taskFilter, taskMatch);
        }
        const tasks = await MongoDbCrudOpration(companyId, {
            type: SCHEMA_TYPE.TASKS,
            data: [taskFilter, {
                TaskType: 1, ProjectID: 1, statusKey: 1, totalEstimatedTime: 1,
                TaskName: 1, TaskKey: 1, sprintId: 1,
                aiTaskCategory: 1, aiTaskCategoryManual: 1,
            }],
        }, "find").catch(() => []);
        (tasks || []).forEach((t) => { taskMap[String(t._id)] = t; });
    }

    return { loggedByUserTask, taskMap, userIds };
}

/**
 * Fetch a userId → display-name map for the given ids (global users collection).
 * @param {Array<string>} userIds
 * @returns {Promise<Object.<string,string>>}
 */
async function getUserNameMap(userIds = []) {
    const ids = Array.from(new Set((userIds || []).map(String)))
        .filter((id) => mongoose.Types.ObjectId.isValid(id));
    if (!ids.length) return {};
    const users = await MongoDbCrudOpration(SCHEMA_TYPE.GOLBAL, {
        type: SCHEMA_TYPE.USERS,
        data: [
            { _id: { $in: ids.map((id) => new mongoose.Types.ObjectId(id)) } },
            { Employee_Name: 1, Employee_FName: 1, Employee_LName: 1 },
        ],
    }, "find").catch(() => []);
    const map = {};
    (users || []).forEach((u) => {
        map[String(u._id)] = u.Employee_Name || `${u.Employee_FName || ""} ${u.Employee_LName || ""}`.trim() || "—";
    });
    return map;
}

/**
 * Fetch a sprintId → (lowercased) sprint type map, for classifying tasks as
 * backlog vs active in the Effort Nature breakdown.
 * @param {string} companyId
 * @param {Array} sprintIds
 * @returns {Promise<Object.<string,string>>}
 */
async function getSprintTypeMap(companyId, sprintIds = []) {
    const ids = Array.from(new Set((sprintIds || []).map(String)))
        .filter((id) => mongoose.Types.ObjectId.isValid(id));
    if (!ids.length) return {};
    const sprints = await MongoDbCrudOpration(companyId, {
        type: SCHEMA_TYPE.SPRINTS,
        data: [{ _id: { $in: ids.map((id) => new mongoose.Types.ObjectId(id)) } }, { type: 1 }],
    }, "find").catch(() => []);
    const map = {};
    (sprints || []).forEach((s) => { map[String(s._id)] = String(s.type || "").toLowerCase(); });
    return map;
}

module.exports = {
    getDayOrRangeBounds,
    buildUserTeamMap,
    bucketForStatus,
    STATUS_BUCKET_KEYWORDS,
    getLoggedAndTasksInRange,
    getUserNameMap,
    getSprintTypeMap,
};
