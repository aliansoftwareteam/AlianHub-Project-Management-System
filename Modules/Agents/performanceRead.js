const mongoose = require('mongoose');
const { SCHEMA_TYPE } = require('../../Config/schemaType');
const { MongoDbCrudOpration } = require('../../utils/mongo-handler/mongoQueries');
const registry = require('./registry');
const actions = require('./actions');
const scope = require('./scope');
const runs = require('./runs');
const { ACTION } = require('./performanceFlag');
const replay = require('../AICore/replay');
const { resolveSheetScope, scopedTimeMatch, SHEET_PERMISSION } = require('../TimeSheet/helpers/timeScope');
const { summarize } = require('../TimeSheet/helpers/billableRules');
const varianceRules = require('../VarianceReport/helpers/varianceRules');
const { hiddenSprintFilter } = require('../Sprints/helpers/sprintVisibility');
const velocity = require('../AgileReports/velocity');
const cfd = require('../AgileReports/cfd');

// Structured performance numbers are queried, not retrieved (docs/AI-PLATFORM-ARCHITECTURE.md §E).
// Every figure comes from the code behind an existing report, read as the person
// behind the agent: the registry's permission check, the projects that person can
// open narrowed to the token's or agent's projects, their timesheet grant and the
// private sprints they are on. A project outside that is refused, never dropped.

const METRICS = Object.freeze(['time', 'variance', 'velocity', 'flow']);
const MAX_PROJECTS = 5;
// The cumulative-flow report's own cap, so no metric is silently cut short.
const MAX_RANGE_DAYS = cfd.MAX_DAYS;
const DAY_MS = 86400000;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const OBJECT_ID = /^[0-9a-fA-F]{24}$/;

const oid = (id) => new mongoose.Types.ObjectId(String(id));
const listOf = (value) => (value === undefined || value === null || value === '' ? [] : [].concat(value));

const dayOf = (value) => {
    if (typeof value !== 'string' || !DATE.test(value)) return null;
    const start = new Date(`${value}T00:00:00.000Z`);
    return Number.isNaN(start.getTime()) || start.toISOString().slice(0, 10) !== value ? null : start;
};

/* { query, window } or { reason }. The query is what the replay record keeps as the
 * arguments; the window is its UTC day bounds, the one reading every metric uses. */
const parseArgs = (args = {}) => {
    const projectIds = [...new Set([...listOf(args.projectIds), ...listOf(args.projectId)].map(String))];
    if (!projectIds.length) return { reason: 'projectId is required' };
    const malformed = projectIds.find((id) => !OBJECT_ID.test(id));
    if (malformed) return { reason: `"${malformed.slice(0, 40)}" is not a valid project id` };
    if (projectIds.length > MAX_PROJECTS) return { reason: `at most ${MAX_PROJECTS} projects per call` };

    if (args.from === undefined || args.from === null || args.from === '' || args.to === undefined || args.to === null || args.to === '') {
        return { reason: 'from and to are required' };
    }
    const from = dayOf(args.from);
    const to = dayOf(args.to);
    if (!from || !to) return { reason: 'from and to must be calendar dates written YYYY-MM-DD' };
    if (from > to) return { reason: 'from must not be after to' };
    if ((to - from) / DAY_MS + 1 > MAX_RANGE_DAYS) return { reason: `the range may cover at most ${MAX_RANGE_DAYS} days` };

    const asked = listOf(args.metrics).map(String);
    const unknown = asked.find((m) => !METRICS.includes(m));
    if (unknown) return { reason: `unknown metric "${unknown.slice(0, 40)}" (have: ${METRICS.join(', ')})` };
    const metrics = asked.length ? METRICS.filter((m) => asked.includes(m)) : [...METRICS];

    const end = new Date(to.getTime() + DAY_MS - 1);
    const window = { from, to: end, fromSeconds: Math.floor(from.getTime() / 1000), toSeconds: Math.floor(end.getTime() / 1000) };
    return { query: { projectIds, from: args.from, to: args.to, metrics }, window };
};

const refuse = (companyId, actor, { params, reason, ip, entityType, entityId }) => actions.refusal(companyId, actor, { action: ACTION, params, reason: `${ACTION}: ${reason}`, ip, entityType, entityId });

const outsideScope = async (companyId, uid, projectIds, projectScope) => {
    const visible = new Set((await scope.visibleProjectIds(companyId, uid)).map(String));
    const narrowed = Array.isArray(projectScope) && projectScope.length ? new Set(projectScope.map(String)) : null;
    return projectIds.filter((id) => !visible.has(id) || (narrowed && !narrowed.has(id)));
};

/* The run id comes from the caller (an MCP header), so the row is filed under it only
 * when that run is still open, belongs to this agent and was started by this person. */
const ownRunId = async (companyId, actor) => {
    const runId = String((actor && actor.runId) || '');
    const agentId = String((actor && actor.agentId) || '');
    if (!OBJECT_ID.test(runId) || !agentId) return null;
    const run = await MongoDbCrudOpration(companyId, {
        type: SCHEMA_TYPE.AGENT_RUNS,
        data: [{ _id: oid(runId), agentId, startedBy: String(actor.userId), status: { $in: runs.OPEN } }, { _id: 1 }],
    }, 'findOne').catch(() => null);
    return run ? runId : null;
};

const tasksInSprints = async (companyId, projectId, sprintIds) => {
    if (!sprintIds.length) return [];
    const rows = await MongoDbCrudOpration(companyId, {
        type: SCHEMA_TYPE.TASKS,
        data: [{ ProjectID: oid(projectId), sprintId: { $in: sprintIds } }, { _id: 1 }],
    }, 'find');
    return (rows || []).map((t) => String(t._id));
};

const timeEntries = (companyId, sheetScope, projectId, window, hiddenTaskIds) => {
    const match = {
        ...scopedTimeMatch(sheetScope, { projectIds: [projectId] }),
        LogStartTime: { $gte: window.fromSeconds, $lte: window.toSeconds },
        ...(hiddenTaskIds.length ? { TicketID: { $nin: hiddenTaskIds } } : {}),
    };
    return MongoDbCrudOpration(companyId, {
        type: SCHEMA_TYPE.TIMESHEET,
        data: [match, { TicketID: 1, LogTimeDuration: 1, billable: 1 }],
    }, 'find').then((rows) => rows || []);
};

/* The variance summary's estimate against actual, for the tasks this time was logged on. */
const varianceOf = async (companyId, projectId, entries) => {
    const actualByTask = {};
    entries.forEach((e) => {
        if (!e.TicketID) return;
        const id = String(e.TicketID);
        actualByTask[id] = (actualByTask[id] || 0) + (Number(e.LogTimeDuration) || 0);
    });
    const ids = Object.keys(actualByTask).filter((id) => OBJECT_ID.test(id));
    const tasks = ids.length ? await MongoDbCrudOpration(companyId, {
        type: SCHEMA_TYPE.TASKS,
        data: [{ _id: { $in: ids.map(oid) }, ProjectID: oid(projectId) }, { totalEstimatedTime: 1 }],
    }, 'find') : [];
    return varianceRules.rollup((tasks || []).map((t) => varianceRules.taskVariance(t.totalEstimatedTime, actualByTask[String(t._id)] || 0)));
};

const velocityOf = async (companyId, uid, projectId, window) => {
    const out = await velocity.velocityFor(companyId, uid, projectId, { limit: velocity.MAX_LIMIT, closedFrom: window.from, closedTo: window.to });
    return {
        skipped: out.skipped,
        sprints: out.sprints.map((s) => ({
            sprintId: s.sprintId, name: s.name, startDate: s.startDate, endDate: s.endDate,
            committed: s.committed, completed: s.completed, completedHuman: s.completedHuman, completedAgent: s.completedAgent, rollingAvg: s.rollingAvg,
        })),
    };
};

const whoseTime = (sheetScope) => {
    if (sheetScope.companyWide) return 'company';
    return sheetScope.everyone ? 'everyone' : 'self';
};

const projectNames = async (companyId, projectIds) => {
    const rows = await MongoDbCrudOpration(companyId, {
        type: SCHEMA_TYPE.PROJECTS, data: [{ _id: { $in: projectIds.map(oid) } }, { ProjectName: 1 }],
    }, 'find').catch(() => []);
    return new Map((rows || []).map((p) => [String(p._id), p.ProjectName || '']));
};

const numbersOnly = (projects) => projects.map(({ name, ...rest }) => (rest.velocity
    ? { ...rest, velocity: { ...rest.velocity, sprints: rest.velocity.sprints.map(({ name: sprintName, ...numbers }) => numbers) } }
    : rest));

/* The action. `projectScope` is the token's or the agent's project list; empty means
 * no narrowing beyond what the person can open. */
const read = async ({ companyId, actor, args = {}, projectScope = [], allowedActions, ip = '' }) => {
    const started = Date.now();
    const check = registry.evaluate(ACTION, {}, { allowedActions });
    if (!check.allowed) throw await actions.refusal(companyId, actor, { action: ACTION, params: {}, reason: check.reason, ip });

    const parsed = parseArgs(args);
    if (!parsed.query) throw await refuse(companyId, actor, { params: args, reason: parsed.reason, ip });
    const { query, window } = parsed;

    for (const projectId of query.projectIds) {
        await actions.authorizeRead({ companyId, actor, action: ACTION, params: { projectId }, ip, allowedActions });
    }
    const uid = String(actor.userId);
    const outside = await outsideScope(companyId, uid, query.projectIds, projectScope);
    if (outside.length) {
        throw await refuse(companyId, actor, { params: query, reason: `project ${outside.join(', ')} is not one this agent may read`, ip, entityType: 'project', entityId: outside[0] });
    }

    const wants = (metric) => query.metrics.includes(metric);

    const [sheetScope, names] = await Promise.all([
        resolveSheetScope(companyId, uid, SHEET_PERMISSION.project),
        projectNames(companyId, query.projectIds),
    ]);
    const numbersFor = async (projectId) => {
        const hidden = ((await hiddenSprintFilter(companyId, uid, [projectId])).sprintId || { $nin: [] }).$nin.map(String);
        const entry = { projectId, name: names.get(projectId) || '' };
        if (wants('time') || wants('variance')) {
            const entries = await timeEntries(companyId, sheetScope, projectId, window, await tasksInSprints(companyId, projectId, hidden));
            if (wants('time')) entry.time = { ...summarize(entries), whose: whoseTime(sheetScope) };
            if (wants('variance')) entry.variance = await varianceOf(companyId, projectId, entries);
        }
        if (wants('velocity')) entry.velocity = await velocityOf(companyId, uid, projectId, window);
        if (wants('flow')) entry.flow = { days: (await cfd.flowFor(companyId, uid, projectId, { from: window.from, to: window.to, utc: true })).days };
        return { entry, hidden };
    };
    const computed = await Promise.all(query.projectIds.map(numbersFor));
    const projects = computed.map((c) => c.entry);
    const hiddenSprintIds = Object.fromEntries(computed.map((c) => [c.entry.projectId, c.hidden]));

    const saved = await replay.recordToolStep({
        companyId,
        runId: await ownRunId(companyId, actor),
        agentId: actor.agentId || null,
        action: ACTION,
        args: query,
        scope: {
            userId: uid,
            projectIds: query.projectIds,
            narrowedTo: Array.isArray(projectScope) && projectScope.length ? projectScope.map(String) : null,
            timesheet: whoseTime(sheetScope),
            hiddenSprintIds,
        },
        result: { projects: numbersOnly(projects) },
        durationMs: Date.now() - started,
    });

    return {
        action: ACTION,
        from: query.from,
        to: query.to,
        metrics: query.metrics,
        units: { time: 'minutes', variance: 'minutes', velocity: 'story points' },
        projects,
        replayId: saved && saved._id ? String(saved._id) : null,
    };
};

module.exports = { ACTION, METRICS, MAX_PROJECTS, MAX_RANGE_DAYS, parseArgs, read };
