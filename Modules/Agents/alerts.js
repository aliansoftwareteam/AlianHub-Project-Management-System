const { SCHEMA_TYPE } = require('../../Config/schemaType');
const { dbCollections } = require('../../Config/collections');
const { MongoDbCrudOpration } = require('../../utils/mongo-handler/mongoQueries');
const { removeCache } = require('../../utils/commonFunctions');
const { ROLE_OWNER, ROLE_ADMIN } = require('../../Config/permissionGuard');
const socketEmitter = require('../../event/socketEventEmitter');
const logger = require('../../Config/loggerConfig');
const telemetry = require('../../Config/telemetry');
const metrics = require('./metrics');
const budget = require('./budget');
const runs = require('./runs');
const spend = require('../AICore/spend');
const rules = require('./alertRules');

const JOB_NAME = 'agent.rate-alerts';
const DEFAULT_INTERVAL_MINUTES = 15;
const MIN_DECIDED = 5;
const COMPANY_KEY = 'company';
const NOTIFICATION_SCOPE = 'ai-alerts';
const NOTIFICATION_KEY = 'agent_rate_alert';
const CHANGE_TYPE = 'agent_alert';
const STATUS = Object.freeze({ OPEN: 'open', RESOLVED: 'resolved' });
const AGENT_QUEUE = ['queued', 'running'];
const AUTOMATION_QUEUE = ['queued', 'retrying'];
const MINUTE_MS = 60 * 1000;
const DAY_MS = 24 * 60 * MINUTE_MS;
const RESOLVED_LOOKBACK_MS = 7 * DAY_MS;
const CACHE_SECONDS = 60;
const LOG_PREFIX = '[agent-alerts]';

const intervalMs = () => {
    const minutes = Number(process.env.AGENT_ALERTS_INTERVAL_MINUTES || 15);
    return (Number.isFinite(minutes) && minutes > 0 ? minutes : DEFAULT_INTERVAL_MINUTES) * MINUTE_MS;
};

const cacheKey = (companyId) => `agentAlerts:${companyId}`;
const tenth = (n) => Math.round(n * 10) / 10;
const pct = (rate) => tenth(rate * 100);
const money = (n) => Math.round(Number(n || 0) * 100) / 100;

const errorRateBreaches = (agents, s) => (agents || [])
    .filter((a) => a.agentId !== 'unknown' && a.finished >= s.errorMinRuns && typeof a.errorRate === 'number' && pct(a.errorRate) >= s.errorRatePct)
    .map((a) => ({
        type: 'agent_error_rate', key: String(a.agentId), agentName: a.agentName || '',
        value: pct(a.errorRate), threshold: s.errorRatePct, window: '1h', detail: { finished: a.finished, failed: a.failed },
    }));

const approvalOf = (proposals) => {
    const counts = { approved: 0, declined: 0 };
    proposals.forEach((p) => {
        const outcome = metrics.outcomeOf(p);
        if (outcome === 'approved' || outcome === 'undone') counts.approved += 1;
        else if (outcome === 'declined') counts.declined += 1;
    });
    const decided = counts.approved + counts.declined;
    return { decided, rate: decided ? counts.approved / decided : null };
};

const approvalBreaches = ({ day, week }, s) => {
    if (day.decided < MIN_DECIDED || day.rate === null) return [];
    const dayPct = pct(day.rate);
    const weekPct = week.rate === null ? null : pct(week.rate);
    const belowFloor = dayPct < s.approvalFloorPct;
    const dropped = weekPct !== null && tenth(weekPct - dayPct) >= s.approvalDropPts;
    if (!belowFloor && !dropped) return [];
    return [{
        type: 'approval_rate_falling', key: COMPANY_KEY, value: dayPct,
        threshold: belowFloor ? s.approvalFloorPct : tenth(weekPct - s.approvalDropPts), window: '24h',
        detail: { reason: belowFloor ? 'floor' : 'drop', baselinePct: weekPct, decided: day.decided },
    }];
};

const monthBounds = (now) => ({
    from: Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1),
    to: Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1),
});

/* The projection counts at least one elapsed day, so a few cents in the first hour of a month do not read as a runaway. */
const costBreaches = ({ usedUsd, budgetUsd, now }, s) => {
    if (!(budgetUsd > 0)) return [];
    const { from, to } = monthBounds(now);
    const elapsed = Math.min(Math.max(now.getTime() - from, DAY_MS), to - from);
    const projectedUsd = (Number(usedUsd) || 0) * ((to - from) / elapsed);
    const value = tenth((projectedUsd / budgetUsd) * 100);
    if (value < s.costForecastPct) return [];
    return [{
        type: 'cost_forecast', key: COMPANY_KEY, value, threshold: s.costForecastPct, window: 'month',
        detail: { usedUsd: money(usedUsd), projectedUsd: money(projectedUsd), budgetUsd },
    }];
};

const queueBreaches = (oldest, now, s) => {
    const at = oldest ? new Date(oldest.startedAt || oldest.createdAt).getTime() : NaN;
    if (!Number.isFinite(at)) return [];
    const value = tenth((now.getTime() - at) / MINUTE_MS);
    if (value < s.queueAgeMinutes) return [];
    return [{
        type: 'queue_age', key: COMPANY_KEY, value, threshold: s.queueAgeMinutes, window: 'now',
        detail: { source: oldest.source, runId: String(oldest._id), status: oldest.status },
    }];
};

const oldestOf = (rows, source) => (rows || [])
    .map((r) => ({ ...r, source, at: new Date(r.startedAt || r.createdAt).getTime() }))
    .filter((r) => Number.isFinite(r.at))
    .sort((a, b) => a.at - b.at)[0] || null;

const checks = {
    agent_error_rate: async (companyId, s, now) => errorRateBreaches((await metrics.companyMetrics(companyId, '1h', { now })).agents, s),
    approval_rate_falling: async (companyId, s, now) => {
        const week = metrics.windowOf('7d', now);
        const dayFrom = metrics.windowOf('24h', now).from.getTime();
        const rows = (await MongoDbCrudOpration(companyId, {
            type: SCHEMA_TYPE.AGENT_PROPOSALS,
            data: [[{ $match: { createdAt: { $gte: week.from, $lt: week.to } } }, { $project: { status: 1, failedReason: 1, createdAt: 1 } }]],
        }, 'aggregate')) || [];
        const inDay = rows.filter((r) => new Date(r.createdAt).getTime() >= dayFrom);
        return approvalBreaches({ day: approvalOf(inDay), week: approvalOf(rows) }, s);
    },
    cost_forecast: async (companyId, s, now, settings) => {
        if (!(settings.monthlyBudgetUsd > 0)) return [];
        const { usedUsd } = await spend.monthly(companyId, runs.monthKey(now));
        return costBreaches({ usedUsd, budgetUsd: settings.monthlyBudgetUsd, now }, s);
    },
    queue_age: async (companyId, s, now) => {
        const [agentRows, automationRows] = await Promise.all([
            MongoDbCrudOpration(companyId, { type: SCHEMA_TYPE.AGENT_RUNS, data: [{ status: { $in: AGENT_QUEUE } }, '_id status startedAt createdAt', { sort: { startedAt: 1 }, limit: 20 }] }, 'find'),
            MongoDbCrudOpration(companyId, { type: SCHEMA_TYPE.AUTOMATION_RUNS, data: [{ status: { $in: AUTOMATION_QUEUE } }, '_id status createdAt', { sort: { createdAt: 1 }, limit: 1 }] }, 'find'),
        ]);
        const oldest = [oldestOf(agentRows, 'agent_run'), oldestOf(automationRows, 'automation_run')].filter(Boolean).sort((a, b) => a.at - b.at)[0];
        return queueBreaches(oldest, now, s);
    },
};

const recipientsLoader = (companyId) => {
    let loaded = null;
    const load = async () => {
        const members = (await MongoDbCrudOpration(companyId, {
            type: SCHEMA_TYPE.COMPANY_USERS, data: [{ roleType: { $in: [ROLE_OWNER, ROLE_ADMIN] }, isDelete: { $ne: true } }, 'userId roleType'],
        }, 'find')) || [];
        const ids = [...new Set(members.map((m) => String(m.userId || '')).filter(Boolean))];
        const docs = ids.length ? ((await MongoDbCrudOpration(companyId, {
            type: SCHEMA_TYPE.NOTIFICATIONS_SETTINGS, data: [{ userId: { $in: ids } }, 'userId aiAlerts'],
        }, 'find')) || []) : [];
        const stored = new Map(docs.map((d) => [String(d.userId), d.aiAlerts]));
        return members.map((m) => ({ userId: String(m.userId), prefs: rules.preferencesOf(m.roleType, stored.get(String(m.userId))) }));
    };
    return async (type) => {
        if (!loaded) loaded = load();
        const people = await loaded;
        return [...new Set(people.filter((p) => p.prefs && p.prefs[type]).map((p) => p.userId))];
    };
};

const TYPE_TEXT = Object.freeze({
    agent_error_rate: (a) => `${a.agentName || 'An agent'} failed ${a.lastValue}% of its runs in the last hour (threshold ${a.threshold}%).`,
    approval_rate_falling: (a) => `Approval of agent proposals is ${a.lastValue}% over the last 24 hours (threshold ${a.threshold}%).`,
    cost_forecast: (a) => `AI spend is on course for ${a.lastValue}% of this month's budget (threshold ${a.threshold}%).`,
    queue_age: (a) => `The oldest waiting run has waited ${a.lastValue} minutes (threshold ${a.threshold}).`,
});

const messageOf = (alert, state) => (state === STATUS.OPEN
    ? `AI alert: ${TYPE_TEXT[alert.type](alert)}`
    : `AI alert resolved: ${TYPE_TEXT[alert.type](alert)} It is back within its threshold.`);

let uniqueSeq = 0;
const uniqueId = () => `${Date.now().toString(36)}${(uniqueSeq += 1).toString(36)}${Math.random().toString(36).slice(2, 7)}`;

/* The same three writes as any in-app notification: the company row, the global copy with its socket event, and the bell counter. */
const deliver = async (companyId, userIds, alert, state) => {
    if (!userIds.length) return [];
    const { updateUnReadCommentsCountFun } = require('../notification-count/controller');
    const delivered = [];
    for (const receiverID of userIds) {
        const row = {
            key: NOTIFICATION_KEY, type: 'agent', changeType: CHANGE_TYPE, message: messageOf(alert, state),
            changeData: {
                alertId: String(alert._id), alertType: alert.type, state, key: alert.key, agentName: alert.agentName || '',
                lastValue: alert.lastValue, threshold: alert.threshold, window: alert.window,
            },
            projectId: NOTIFICATION_SCOPE, taskId: '', userId: NOTIFICATION_SCOPE, companyId: String(companyId),
            assigneeUsers: [receiverID], notSeen: [receiverID], receiverID,
            notificationType: 'push', isSchedule: false, isSeen: false, notificationStatus: 'in-process', uniqueId: uniqueId(),
        };
        try {
            // eslint-disable-next-line no-await-in-loop
            const saved = await MongoDbCrudOpration(companyId, { type: SCHEMA_TYPE.NOTIFICATIONS, collection: dbCollections.NOTIFICATIONS, data: row }, 'save');
            // eslint-disable-next-line no-await-in-loop
            const globalRow = await MongoDbCrudOpration(dbCollections.GLOBAL, { type: dbCollections.NOTIFICATIONS, collection: dbCollections.NOTIFICATIONS, data: { ...row, notificationId: saved && saved.id } }, 'save');
            socketEmitter.emit('insert', { type: 'insert', data: globalRow, updatedFields: {}, module: 'globalNotification' });
            // eslint-disable-next-line no-await-in-loop
            await Promise.resolve(updateUnReadCommentsCountFun({ body: { companyId: String(companyId), key: 5, userIds: [receiverID], readAll: false } })).catch((e) => logger.warn(`${LOG_PREFIX} ${companyId}: count bump failed: ${e.message || e}`));
            delivered.push(receiverID);
        } catch (e) {
            logger.error(`${LOG_PREFIX} ${companyId}: ${state} notice for ${alert.type} to ${receiverID} failed: ${e.message || e}`);
        }
    }
    return delivered;
};

const plainOf = (doc) => (doc && typeof doc.toObject === 'function' ? doc.toObject() : { ...doc });

const announce = (companyId, alert) => {
    removeCache(cacheKey(companyId));
    socketEmitter.emit('update', { type: 'update', module: 'agent', companyId: String(companyId), data: { kind: 'alert', alert }, updatedFields: { kind: 'alert' }, actor: { kind: 'agent' }, depth: 1 });
};

const openIncident = async (companyId, breach, now, traceId, recipientsFor) => {
    let saved;
    try {
        saved = plainOf(await MongoDbCrudOpration(companyId, {
            type: SCHEMA_TYPE.AI_ALERTS,
            data: {
                type: breach.type, key: breach.key, agentName: breach.agentName, status: STATUS.OPEN, openedAt: now,
                lastValue: breach.value, threshold: breach.threshold, window: breach.window, detail: breach.detail,
                lastEvaluatedAt: now, notifiedUserIds: [], traceId,
            },
        }, 'save'));
    } catch (e) {
        if (e && e.code === 11000) return null;
        throw e;
    }
    const notified = await deliver(companyId, await recipientsFor(breach.type), saved, STATUS.OPEN);
    await MongoDbCrudOpration(companyId, { type: SCHEMA_TYPE.AI_ALERTS, data: [{ _id: saved._id }, { $set: { notifiedUserIds: notified } }] }, 'updateOne');
    const alert = { ...saved, notifiedUserIds: notified };
    announce(companyId, alert);
    return alert;
};

const resolveIncident = async (companyId, incident, now) => {
    const resolved = await MongoDbCrudOpration(companyId, {
        type: SCHEMA_TYPE.AI_ALERTS,
        data: [{ _id: incident._id, status: STATUS.OPEN }, { $set: { status: STATUS.RESOLVED, resolvedAt: now, lastEvaluatedAt: now } }, { returnDocument: 'after' }],
    }, 'findOneAndUpdate');
    if (!resolved) return null;
    const alert = plainOf(resolved);
    await deliver(companyId, (alert.notifiedUserIds || []).map(String), alert, STATUS.RESOLVED);
    announce(companyId, alert);
    return alert;
};

/* One evaluation: a breach with no open incident opens one and notifies; a breach with one only refreshes it;
 * an open incident whose check ran clean is resolved. A check that throws leaves its incidents as they are. */
const evaluateCompany = async (companyId, { now = new Date() } = {}) => {
    const settings = await budget.settings(companyId);
    const s = settings.alerts;
    const summary = { companyId: String(companyId), skipped: false, opened: [], updated: [], resolved: [], failed: [] };
    if (!s.enabled) return { ...summary, skipped: true };

    const traceId = telemetry.newTraceId();
    const outcomes = await Promise.all(rules.TYPES.map((type) => checks[type](companyId, s, now, settings)
        .then((breaches) => ({ type, breaches }))
        .catch((e) => { logger.error(`${LOG_PREFIX} ${companyId}: ${type} check failed: ${e.message}`); return { type, failed: true }; })));
    const evaluated = new Set(outcomes.filter((o) => !o.failed).map((o) => o.type));
    summary.failed = outcomes.filter((o) => o.failed).map((o) => o.type);
    const breaches = outcomes.flatMap((o) => o.breaches || []);

    const open = (await MongoDbCrudOpration(companyId, { type: SCHEMA_TYPE.AI_ALERTS, data: [{ status: STATUS.OPEN }] }, 'find')) || [];
    const openOf = (type, key) => open.find((o) => o.type === type && String(o.key) === String(key));
    const recipientsFor = recipientsLoader(companyId);

    for (const breach of breaches) {
        const existing = openOf(breach.type, breach.key);
        if (existing) {
            // eslint-disable-next-line no-await-in-loop
            await MongoDbCrudOpration(companyId, {
                type: SCHEMA_TYPE.AI_ALERTS,
                data: [{ _id: existing._id, status: STATUS.OPEN }, { $set: { lastValue: breach.value, threshold: breach.threshold, detail: breach.detail, agentName: breach.agentName || existing.agentName, lastEvaluatedAt: now } }],
            }, 'updateOne');
            summary.updated.push({ type: breach.type, key: breach.key, value: breach.value });
        } else {
            // eslint-disable-next-line no-await-in-loop
            const alert = await openIncident(companyId, breach, now, traceId, recipientsFor);
            if (alert) summary.opened.push({ _id: String(alert._id), type: alert.type, key: alert.key, value: alert.lastValue, notified: alert.notifiedUserIds.length });
        }
    }

    const cleared = open.filter((o) => evaluated.has(o.type) && !breaches.some((b) => b.type === o.type && String(b.key) === String(o.key)));
    for (const incident of cleared) {
        // eslint-disable-next-line no-await-in-loop
        const alert = await resolveIncident(companyId, incident, now);
        if (alert) summary.resolved.push({ _id: String(alert._id), type: alert.type, key: alert.key });
    }
    if (summary.updated.length) removeCache(cacheKey(companyId));
    return summary;
};

const evaluateAll = async ({ now = new Date() } = {}) => {
    const companies = (await MongoDbCrudOpration(dbCollections.GLOBAL, { type: dbCollections.COMPANIES, data: [{}, '_id'] }, 'find')) || [];
    const totals = { companies: 0, opened: 0, resolved: 0, failures: 0 };
    for (const c of companies) {
        try {
            // eslint-disable-next-line no-await-in-loop
            const out = await evaluateCompany(String(c._id), { now });
            totals.companies += 1;
            totals.opened += out.opened.length;
            totals.resolved += out.resolved.length;
        } catch (e) {
            totals.failures += 1;
            logger.error(`${LOG_PREFIX} ${c._id}: evaluation failed: ${e.message}`);
        }
    }
    if (totals.opened || totals.resolved) logger.info(`${LOG_PREFIX} opened ${totals.opened}, resolved ${totals.resolved} across ${totals.companies} companies`);
    return totals;
};

const incidentView = (row) => {
    const r = plainOf(row);
    const iso = (d) => (d ? new Date(d).toISOString() : null);
    return {
        _id: String(r._id), type: r.type, key: r.key, agentName: r.agentName || '', status: r.status,
        openedAt: iso(r.openedAt), resolvedAt: iso(r.resolvedAt), lastEvaluatedAt: iso(r.lastEvaluatedAt),
        lastValue: r.lastValue, threshold: r.threshold, window: r.window, detail: r.detail || {}, traceId: r.traceId || null,
    };
};

const incidents = async (companyId, { now = new Date() } = {}) => {
    const [open, resolved] = await Promise.all([
        MongoDbCrudOpration(companyId, { type: SCHEMA_TYPE.AI_ALERTS, data: [{ status: STATUS.OPEN }, null, { sort: { openedAt: -1 } }] }, 'find'),
        MongoDbCrudOpration(companyId, { type: SCHEMA_TYPE.AI_ALERTS, data: [{ status: STATUS.RESOLVED, resolvedAt: { $gte: new Date(now.getTime() - RESOLVED_LOOKBACK_MS) } }, null, { sort: { resolvedAt: -1 }, limit: 10 }] }, 'find'),
    ]);
    return { open: (open || []).map(incidentView), resolved: (resolved || []).map(incidentView) };
};

const cachedIncidents = async (companyId) => {
    const { myCache } = require('../../Config/config');
    const hit = myCache.get(cacheKey(companyId));
    if (hit !== undefined) return hit;
    const value = await incidents(companyId);
    myCache.set(cacheKey(companyId), value, CACHE_SECONDS);
    return value;
};

module.exports = {
    JOB_NAME, STATUS, COMPANY_KEY, NOTIFICATION_KEY, CHANGE_TYPE, AGENT_QUEUE, AUTOMATION_QUEUE, MIN_DECIDED,
    intervalMs, errorRateBreaches, approvalBreaches, costBreaches, queueBreaches,
    evaluateCompany, evaluateAll, incidents, cachedIncidents,
};
