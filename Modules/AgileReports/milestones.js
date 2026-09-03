// Every dated commitment across projects (16c), with what moved and why.
// Read-only: milestones come from the milestone collection, the baseline and
// the mover come from the history log the milestone module already writes.
const mongoose = require('mongoose');
const { SCHEMA_TYPE } = require('../../Config/schemaType');
const { MongoDbCrudOpration } = require('../../utils/mongo-handler/mongoQueries');
const logger = require('../../Config/loggerConfig');
const H = require('./helpers/milestoneMoves');

const OBJECT_ID_PATTERN = /^[0-9a-fA-F]{24}$/;
const DONE_TYPES = ['close', 'done'];
const AT_RISK_WINDOW_DAYS = 7;

const oid = (id) => { try { return new mongoose.Types.ObjectId(String(id)); } catch (e) { return null; } };
const asMs = (value) => {
    if (value === null || value === undefined || value === '') return null;
    const n = typeof value === 'number' ? value : new Date(value).getTime();
    return Number.isFinite(n) && n > 0 ? n : null;
};

// The date a milestone is actually judged on: its due date when it has one,
// otherwise the end of its window.
const targetOf = (milestone) => (asMs(milestone.dueDate) || asMs(milestone.endDate));
const targetField = (milestone) => (asMs(milestone.dueDate) ? 'dueDate' : 'endDate');

const stateOf = ({ targetMs, slip, openTasks, overdueTasks, signedOff, nowMs }) => {
    if (signedOff) return 'done';
    if (targetMs && targetMs < nowMs) return 'missed';
    if (overdueTasks > 0) return 'at-risk';
    if (slip !== null && slip > 0) return 'at-risk';
    if (targetMs && openTasks > 0 && targetMs - nowMs < AT_RISK_WINDOW_DAYS * H.DAY_MS) return 'at-risk';
    return 'on-track';
};

/* GET /api/v1/agile/milestones?projectId=  (companyId from header; projectId optional) */
exports.getMilestones = async (req, res) => {
    try {
        const companyId = req.headers['companyid'] || '';
        if (!companyId) return res.send({ status: false, statusText: 'companyId is required.' });
        const projectId = String((req.query && req.query.projectId) || '');
        if (projectId && !OBJECT_ID_PATTERN.test(projectId)) {
            return res.send({ status: false, statusText: 'projectId must be a valid id.' });
        }

        const projects = await MongoDbCrudOpration(companyId, {
            type: SCHEMA_TYPE.PROJECTS,
            data: [{
                ...(projectId ? { _id: oid(projectId) } : {}),
                deletedStatusKey: { $nin: [1, 2] },
            }, 'ProjectName status'],
        }, 'find') || [];
        const projectName = {};
        projects.forEach((p) => { projectName[String(p._id)] = p.ProjectName || ''; });
        const projectIds = Object.keys(projectName);
        if (!projectIds.length) {
            return res.send({ status: true, statusText: 'No projects.', data: { milestones: [], totals: { total: 0, atRisk: 0, missed: 0 } } });
        }

        const [milestones, historyRows, tasks] = await Promise.all([
            MongoDbCrudOpration(companyId, {
                type: SCHEMA_TYPE.MILESTONE, data: [{ projectId: { $in: projectIds } }],
            }, 'find').catch(() => []),
            MongoDbCrudOpration(companyId, {
                type: SCHEMA_TYPE.HISTORY,
                data: [{ Key: 'Project_Milestone_Changed', ProjectId: { $in: projectIds } }, 'ProjectId UserId Message createdAt'],
            }, 'find').catch(() => []),
            MongoDbCrudOpration(companyId, {
                type: SCHEMA_TYPE.TASKS,
                data: [{ ProjectID: { $in: projectIds }, deletedStatusKey: { $in: [0, 2, undefined] }, isParentTask: true }, '_id ProjectID DueDate statusType'],
            }, 'find').catch(() => []),
        ]);

        const movesByMilestone = H.indexMoves(H.parseMoves(historyRows || []));
        const tasksByProject = {};
        (tasks || []).forEach((t) => { (tasksByProject[String(t.ProjectID)] = tasksByProject[String(t.ProjectID)] || []).push(t); });

        const nowMs = Date.now();
        const rows = (milestones || []).map((m) => {
            const pid = String(m.projectId || '');
            const field = targetField(m);
            const targetMs = targetOf(m);
            const moves = movesByMilestone.get(H.keyOf(pid, m.milestoneName)) || [];
            const baselineMs = H.baselineFor(moves, field, targetMs);
            const slip = H.slipDays(baselineMs, targetMs);
            const lastMove = [...moves].reverse().find((mv) => mv.field === field) || null;

            const windowStart = asMs(m.startDate);
            const named = Array.isArray(m.taskIds) ? m.taskIds.map(String) : [];
            const scoped = named.length
                ? (tasksByProject[pid] || []).filter((t) => named.includes(String(t._id)))
                : (tasksByProject[pid] || []).filter((t) => {
                    const due = asMs(t.DueDate);
                    if (!due || !targetMs) return false;
                    return due <= targetMs && (!windowStart || due >= windowStart);
                });
            const doneTasks = scoped.filter((t) => DONE_TYPES.includes(String(t.statusType || '').toLowerCase())).length;
            const overdueTasks = scoped.filter((t) => {
                const due = asMs(t.DueDate);
                return due && due < nowMs && !DONE_TYPES.includes(String(t.statusType || '').toLowerCase());
            }).length;
            const signedOff = !!m.signOffAt;

            return {
                milestoneId: String(m._id),
                name: m.milestoneName || '',
                projectId: pid,
                projectName: projectName[pid] || '',
                baseline: baselineMs,
                target: targetMs,
                targetField: field,
                slipDays: slip,
                tasks: scoped.length,
                doneTasks,
                overdueTasks,
                openTasks: scoped.length - doneTasks,
                signedOff,
                state: stateOf({ targetMs, slip, openTasks: scoped.length - doneTasks, overdueTasks, signedOff, nowMs }),
                // What moved, by whom, when. There is no reason field on a
                // milestone edit, so none is claimed.
                lastMove: lastMove ? { by: lastMove.actor, at: lastMove.at, from: lastMove.from, to: lastMove.to } : null,
                moveCount: moves.filter((mv) => mv.field === field).length,
            };
        }).filter((row) => row.target)
            .sort((a, b) => a.target - b.target);

        const totals = rows.reduce((acc, r) => {
            if (r.state === 'at-risk') acc.atRisk += 1;
            else if (r.state === 'missed') acc.missed += 1;
            else if (r.state === 'done') acc.done += 1;
            else acc.onTrack += 1;
            return acc;
        }, { total: rows.length, onTrack: 0, atRisk: 0, missed: 0, done: 0 });

        return res.send({ status: true, statusText: 'Milestones computed.', data: { milestones: rows, totals } });
    } catch (error) {
        logger.error(`ERROR in agile milestones: ${error.message}`);
        return res.send({ status: false, statusText: error.message });
    }
};
