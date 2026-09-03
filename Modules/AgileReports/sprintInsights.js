// What a sprint report cannot answer from totals alone (16a): which work is
// blocked and for how long, and who changed the scope mid-sprint. Read-only;
// every figure comes from data the app already writes (task status types and
// the history log), so nothing here needs a new write path.
const mongoose = require('mongoose');
const { SCHEMA_TYPE } = require('../../Config/schemaType');
const { dbCollections } = require('../../Config/collections');
const { MongoDbCrudOpration } = require('../../utils/mongo-handler/mongoQueries');
const logger = require('../../Config/loggerConfig');

const OBJECT_ID_PATTERN = /^[0-9a-fA-F]{24}$/;
const BLOCKED_TYPE = 'onhold';
const DONE_TYPE = 'close';
const SCOPE_FILTER = { deletedStatusKey: { $in: [0, 2, undefined] }, isParentTask: true };

const oid = (id) => { try { return new mongoose.Types.ObjectId(String(id)); } catch (e) { return null; } };
const daysSince = (date, nowMs) => {
    const t = new Date(date).getTime();
    if (Number.isNaN(t)) return null;
    return Math.max(0, Math.floor((nowMs - t) / 86400000));
};

/* GET /api/v1/agile/sprint-insights?sprintId=  (companyId from header) */
exports.getSprintInsights = async (req, res) => {
    try {
        const companyId = req.headers['companyid'] || '';
        const sprintId = String((req.query && req.query.sprintId) || '');
        if (!companyId || !OBJECT_ID_PATTERN.test(sprintId)) {
            return res.send({ status: false, statusText: 'companyId and a valid sprintId are required.' });
        }
        const sprintObjId = oid(sprintId);
        const sprint = await MongoDbCrudOpration(companyId, {
            type: SCHEMA_TYPE.SPRINTS, data: [{ _id: sprintObjId }, '_id name projectId startDate endDate commitment'],
        }, 'findOne');
        if (!sprint) return res.send({ status: false, statusText: 'Sprint not found.' });

        const tasks = await MongoDbCrudOpration(companyId, {
            type: SCHEMA_TYPE.TASKS,
            data: [{ sprintId: sprintObjId, ...SCOPE_FILTER }, '_id TaskKey TaskName statusType points ProjectID sprintId folderObjId createdAt updatedAt'],
        }, 'find') || [];

        const startedAt = sprint.startDate ? new Date(sprint.startDate) : null;
        const committedIds = new Set(((sprint.commitment && sprint.commitment.taskIds) || []).map(String));
        const blocked = tasks.filter((t) => t.statusType === BLOCKED_TYPE);
        const addedAfterStart = committedIds.size ? tasks.filter((t) => !committedIds.has(String(t._id))) : [];

        const historyIds = [...new Set([...blocked, ...addedAfterStart].map((t) => String(t._id)))];
        const historyRows = historyIds.length
            ? await MongoDbCrudOpration(companyId, {
                type: SCHEMA_TYPE.HISTORY,
                data: [{
                    Key: { $in: ['Task_Status', 'Task_Moved', 'Task_Created'] },
                    TaskId: { $in: [...historyIds, ...historyIds.map(oid).filter(Boolean)] },
                }, 'TaskId Key UserId createdAt'],
            }, 'find').catch(() => [])
            : [];

        const latest = new Map();
        (historyRows || []).forEach((row) => {
            const key = `${String(row.TaskId)}|${row.Key}`;
            const seen = latest.get(key);
            if (!seen || new Date(row.createdAt) > new Date(seen.createdAt)) latest.set(key, row);
        });

        const actorIds = [...new Set((historyRows || []).map((r) => String(r.UserId || '')).filter(Boolean))];
        const users = actorIds.length
            ? await MongoDbCrudOpration(dbCollections.GLOBAL, {
                type: SCHEMA_TYPE.USERS, data: [{ _id: { $in: actorIds.map(oid).filter(Boolean) } }, { Employee_Name: 1, Employee_Email: 1 }],
            }, 'find').catch(() => [])
            : [];
        const nameById = {};
        (users || []).forEach((u) => { nameById[String(u._id)] = u.Employee_Name || u.Employee_Email || ''; });

        const nowMs = Date.now();
        const identify = (t) => ({
            taskId: String(t._id),
            taskKey: t.TaskKey || '',
            name: t.TaskName || '',
            points: Number(t.points) || 0,
            projectId: String(t.ProjectID || sprint.projectId || ''),
            sprintId: String(t.sprintId || sprintId),
            folderId: t.folderObjId ? String(t.folderObjId) : '',
        });

        const blockers = blocked.map((t) => {
            const since = latest.get(`${String(t._id)}|Task_Status`);
            const from = since ? since.createdAt : t.updatedAt;
            return { ...identify(t), blockedDays: daysSince(from, nowMs), since: from || null };
        }).sort((a, b) => (b.blockedDays || 0) - (a.blockedDays || 0));

        const scopeAdds = addedAfterStart.map((t) => {
            const moved = latest.get(`${String(t._id)}|Task_Moved`);
            const created = latest.get(`${String(t._id)}|Task_Created`);
            const bornInSprint = startedAt && new Date(t.createdAt) >= startedAt;
            const source = (moved && (!created || new Date(moved.createdAt) > new Date(created.createdAt))) ? moved : created;
            return {
                ...identify(t),
                done: t.statusType === DONE_TYPE,
                action: bornInSprint && (!moved || !source || source === created) ? 'created' : 'moved',
                // Who is only claimed when the log actually names them.
                by: source && source.UserId ? (nameById[String(source.UserId)] || '') : '',
                at: source ? source.createdAt : (bornInSprint ? t.createdAt : null),
            };
        }).sort((a, b) => new Date(b.at || 0) - new Date(a.at || 0));

        return res.send({
            status: true,
            statusText: 'Sprint insights computed.',
            data: {
                sprintId,
                sprintName: sprint.name || '',
                projectId: String(sprint.projectId || ''),
                startDate: sprint.startDate || null,
                endDate: sprint.endDate || null,
                blockers,
                scopeAdds,
                // Every task the sprint holds now, so the report can list the
                // tasks behind any number it shows rather than only the totals.
                tasks: tasks.map((t) => ({
                    ...identify(t),
                    done: t.statusType === DONE_TYPE,
                    blocked: t.statusType === BLOCKED_TYPE,
                    committed: committedIds.size ? committedIds.has(String(t._id)) : true,
                })),
                hasCommitment: committedIds.size > 0,
            },
        });
    } catch (error) {
        logger.error(`ERROR in agile sprint-insights: ${error.message}`);
        return res.send({ status: false, statusText: error.message });
    }
};
