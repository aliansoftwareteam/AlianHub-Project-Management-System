const mongoose = require('mongoose');
const { SCHEMA_TYPE } = require('../../Config/schemaType');
const { dbCollections } = require('../../Config/collections');
const { MongoDbCrudOpration } = require('../../utils/mongo-handler/mongoQueries');
const logger = require('../../Config/loggerConfig');
const runs = require('./runs');

// The Team board (handoff 13h): who is on what right now, people and agents in
// one list.
//
// It lives in the agents module because the "right now" half is the run summary
// this module already computes; the board is that summary widened to people, so
// the two can never disagree about who is working.

const DAY_MS = 24 * 60 * 60 * 1000;
const oid = (id) => { try { return new mongoose.Types.ObjectId(String(id)); } catch (e) { return null; } };
const hours = (ms) => Math.round((ms / 3600000) * 10) / 10;

const nameOf = (u) => u.Employee_Name || [u.Employee_FName, u.Employee_LName].filter(Boolean).join(' ') || u.Employee_Email || '';

const weekStart = () => {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
    return d;
};

/* Open tracker sessions, for everyone. `startTimeTracker` is the heartbeat the
 * web timer writes; a session with one and no LogEndTime is a live timer. */
const liveTimers = async (companyId) => {
    const rows = await MongoDbCrudOpration(companyId, {
        type: SCHEMA_TYPE.TIMESHEET,
        data: [{ startTimeTracker: { $exists: true, $ne: null }, LogEndTime: { $in: [null, 0, undefined] } },
               { Loggeduser: 1, TicketID: 1, ProjectId: 1, LogStartTime: 1 },
               { sort: { LogStartTime: -1 }, limit: 200 }],
    }, 'find').catch(() => []);
    return rows || [];
};

const loggedThisWeek = async (companyId) => {
    const from = Math.floor(weekStart().getTime() / 1000);
    const rows = await MongoDbCrudOpration(companyId, {
        type: SCHEMA_TYPE.TIMESHEET,
        data: [[{ $match: { LogStartTime: { $gte: from } } },
                { $group: { _id: '$Loggeduser', minutes: { $sum: '$LogTimeDuration' } } }]],
    }, 'aggregate').catch(() => []);
    const byUser = {};
    (rows || []).forEach((r) => { byUser[String(r._id)] = Number(r.minutes || 0); });
    return byUser;
};

const activePto = async (companyId) => {
    const now = new Date();
    const rows = await MongoDbCrudOpration(companyId, {
        type: SCHEMA_TYPE.PTO_ENTRIES,
        data: [{ status: 'approved', deletedStatusKey: { $ne: 1 }, startDate: { $lte: new Date(now.getTime() + 14 * DAY_MS) }, endDate: { $gte: now } },
               { userId: 1, startDate: 1, endDate: 1, type: 1 }],
    }, 'find').catch(() => []);
    return rows || [];
};

const inProgressTasks = async (companyId) => {
    const rows = await MongoDbCrudOpration(companyId, {
        type: SCHEMA_TYPE.TASKS,
        data: [{ deletedStatusKey: { $ne: 1 }, statusType: { $nin: ['close', 'done', 'default_close'] }, AssigneeUserId: { $exists: true, $ne: [] } },
               { TaskName: 1, TaskKey: 1, AssigneeUserId: 1, ProjectID: 1, statusType: 1, status: 1, updatedAt: 1, totalEstimatedTime: 1 },
               { sort: { updatedAt: -1 }, limit: 400 }],
    }, 'find').catch(() => []);
    return rows || [];
};

const assigneeIds = (task) => {
    const raw = task.AssigneeUserId;
    if (Array.isArray(raw)) return raw.map(String);
    return raw ? [String(raw)] : [];
};

/* One row per person and per agent, with what each is doing at this moment and
 * how loaded they are this week. */
const board = async (companyId, { hoursPerWeek = 40 } = {}) => {
    const [members, timers, weekMinutes, pto, tasks, agents, openRuns, recentRuns] = await Promise.all([
        MongoDbCrudOpration(companyId, { type: SCHEMA_TYPE.COMPANY_USERS, data: [{ isDelete: { $ne: true } }, { userId: 1, userEmail: 1, roleType: 1, status: 1 }] }, 'find').catch(() => []),
        liveTimers(companyId),
        loggedThisWeek(companyId),
        activePto(companyId),
        inProgressTasks(companyId),
        MongoDbCrudOpration(companyId, { type: SCHEMA_TYPE.AGENTS, data: [{ deletedStatusKey: { $ne: 1 } }, {}, { sort: { createdAt: 1 } }] }, 'find').catch(() => []),
        runs.list(companyId, { status: 'open', limit: 50 }),
        runs.list(companyId, { limit: 60 }),
    ]);

    const userIds = (members || []).map((m) => String(m.userId || '')).filter(Boolean);
    const profiles = userIds.length
        ? await MongoDbCrudOpration(dbCollections.GLOBAL, {
            type: SCHEMA_TYPE.USERS,
            data: [{ _id: { $in: userIds.map(oid).filter(Boolean) } }, { Employee_Name: 1, Employee_FName: 1, Employee_LName: 1, Employee_Email: 1, Employee_profileImageURL: 1, isOnline: 1 }],
        }, 'find').catch(() => [])
        : [];
    const profileById = {};
    (profiles || []).forEach((p) => { profileById[String(p._id)] = p; });

    const taskIds = [...new Set((timers || []).map((t) => String(t.TicketID || '')).filter(Boolean))];
    const timerTasks = taskIds.length
        ? await MongoDbCrudOpration(companyId, { type: SCHEMA_TYPE.TASKS, data: [{ _id: { $in: taskIds.map(oid).filter(Boolean) } }, { TaskName: 1, TaskKey: 1 }] }, 'find').catch(() => [])
        : [];
    const timerTaskById = {};
    (timerTasks || []).forEach((t) => { timerTaskById[String(t._id)] = t; });

    const timerByUser = {};
    (timers || []).forEach((t) => { if (!timerByUser[String(t.Loggeduser)]) timerByUser[String(t.Loggeduser)] = t; });

    const ptoByUser = {};
    (pto || []).forEach((p) => { if (!ptoByUser[String(p.userId)]) ptoByUser[String(p.userId)] = p; });

    const tasksByUser = {};
    (tasks || []).forEach((t) => {
        assigneeIds(t).forEach((uid) => {
            if (!tasksByUser[uid]) tasksByUser[uid] = [];
            tasksByUser[uid].push(t);
        });
    });

    const now = Date.now();
    const people = (members || []).filter((m) => m.userId).map((m) => {
        const uid = String(m.userId);
        const profile = profileById[uid] || {};
        const timer = timerByUser[uid];
        const leave = ptoByUser[uid];
        const mine = tasksByUser[uid] || [];
        const minutes = Number(weekMinutes[uid] || 0);
        const onLeaveNow = leave && new Date(leave.startDate) <= new Date() && new Date(leave.endDate) >= new Date();
        const timerTask = timer ? timerTaskById[String(timer.TicketID)] : null;
        return {
            kind: 'person',
            id: uid,
            name: nameOf(profile) || m.userEmail || '',
            email: m.userEmail || profile.Employee_Email || '',
            avatar: profile.Employee_profileImageURL || '',
            roleType: m.roleType,
            online: Boolean(profile.isOnline),
            timer: timer ? { taskId: String(timer.TicketID || ''), taskName: timerTask ? timerTask.TaskName : '', elapsedMs: Math.max(0, now - (Number(timer.LogStartTime) || 0) * 1000) } : null,
            nowOn: timer && timerTask ? timerTask.TaskName : (mine[0] ? mine[0].TaskName : ''),
            openTasks: mine.length,
            loggedHours: hours(minutes * 60000),
            capacityHours: hoursPerWeek,
            load: hoursPerWeek ? Math.round((hours(minutes * 60000) / hoursPerWeek) * 100) : 0,
            pto: leave ? { from: leave.startDate, to: leave.endDate, type: leave.type || 'pto', active: Boolean(onLeaveNow) } : null,
            status: onLeaveNow ? 'away' : (timer ? 'working' : (profile.isOnline ? 'available' : 'offline')),
        };
    }).sort((a, b) => a.name.localeCompare(b.name));

    const runsByAgent = {};
    (openRuns || []).forEach((r) => { if (!runsByAgent[String(r.agentId)]) runsByAgent[String(r.agentId)] = r; });
    const runTaskIds = [...new Set((openRuns || []).map((r) => String(r.taskId || '')).filter(Boolean))];
    const runTasks = runTaskIds.length
        ? await MongoDbCrudOpration(companyId, { type: SCHEMA_TYPE.TASKS, data: [{ _id: { $in: runTaskIds.map(oid).filter(Boolean) } }, { TaskName: 1, TaskKey: 1 }] }, 'find').catch(() => [])
        : [];
    const runTaskById = {};
    (runTasks || []).forEach((t) => { runTaskById[String(t._id)] = t; });

    const agentRows = (agents || []).map((a) => {
        const run = runsByAgent[String(a._id)];
        const task = run ? runTaskById[String(run.taskId)] : null;
        const month = a.spendMonth && a.spendMonth.month === runs.monthKey() ? a.spendMonth : { usd: 0, runs: 0 };
        return {
            kind: 'agent',
            id: String(a._id),
            name: a.name || '',
            ownerId: a.ownerId ? String(a.ownerId) : '',
            autonomy: Number(a.autonomy || 0),
            paused: Boolean(a.paused),
            skills: a.skills || [],
            allowedActions: a.allowedActions || [],
            projectIds: (a.projectIds || []).map(String),
            spend: { usd: Math.round(Number(month.usd || 0) * 100) / 100, cap: Number(a.spendCapUsd || 0), runs: Number(month.runs || 0) },
            run: run ? { id: String(run._id), status: run.status, taskId: String(run.taskId || ''), taskKey: task ? task.TaskKey : '', taskName: task ? task.TaskName : '', startedAt: run.startedAt, elapsedMs: Math.max(0, now - new Date(run.startedAt || now).getTime()) } : null,
            nowOn: run && task ? `${task.TaskKey || task.TaskName}` : '',
            status: a.paused ? 'paused' : (run ? 'running' : 'idle'),
        };
    });

    const activity = (recentRuns || []).slice(0, 12).map((r) => ({
        at: r.finishedAt || r.startedAt,
        kind: 'agent',
        who: r.agentName || '',
        what: r.outcome || r.status,
        taskId: r.taskId ? String(r.taskId) : '',
        runId: String(r._id),
        status: r.status,
    }));

    const loads = people.map((p) => p.load);
    return {
        people,
        agents: agentRows,
        activity,
        totals: {
            people: people.length,
            agents: agentRows.length,
            running: agentRows.filter((a) => a.status === 'running').length,
            away: people.filter((p) => p.status === 'away').length,
            load: loads.length ? Math.round(loads.reduce((s, n) => s + n, 0) / loads.length) : 0,
            weekStart: weekStart(),
        },
    };
};

/* One-click standup (13h) composed from the board, not from a model: yesterday's
 * finished runs and logged work, today's open tasks and timers, and whoever is
 * blocked or away. Deterministic so the same day always reads the same. */
const standup = (data) => {
    const lines = [];
    const working = data.people.filter((p) => p.timer || p.openTasks);
    working.forEach((p) => {
        const bits = [];
        if (p.timer && p.timer.taskName) bits.push(`on "${p.timer.taskName}" right now`);
        else if (p.nowOn) bits.push(`next up "${p.nowOn}"`);
        if (p.openTasks) bits.push(`${p.openTasks} open task${p.openTasks === 1 ? '' : 's'}`);
        if (p.loggedHours) bits.push(`${p.loggedHours}h logged this week`);
        lines.push(`${p.name}: ${bits.join(' · ') || 'nothing assigned'}`);
    });
    const away = data.people.filter((p) => p.status === 'away');
    away.forEach((p) => lines.push(`${p.name}: away until ${new Date(p.pto.to).toISOString().slice(0, 10)}`));
    data.agents.filter((a) => a.run).forEach((a) => {
        lines.push(`${a.name} (agent): ${a.run.taskKey || a.run.taskName || 'running'} · ${Math.round(a.run.elapsedMs / 60000)} min in · $${a.spend.usd.toFixed(2)} this month`);
    });
    const over = data.people.filter((p) => p.load > 100).map((p) => p.name);
    const free = data.people.filter((p) => p.status !== 'away' && p.load < 60).map((p) => p.name);
    return {
        generatedAt: new Date(),
        lines,
        balance: { over, free },
        headline: `${data.totals.people} people · ${data.totals.agents} agents · ${data.totals.load}% load`,
    };
};

module.exports = { board, standup, weekStart };
