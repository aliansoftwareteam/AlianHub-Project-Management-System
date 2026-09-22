const actions = require('../Agents/actions');
const agentAudit = require('../Agents/agentAudit');
const visibility = require('../Mcp/visibility');
const store = require('./store');
const access = require('./access');
const events = require('./events');
const lifecycle = require('./lifecycle');
const { STATE, OPEN, isOpen, activityOf, handleMatches, cleanText } = require('./rules');
const { LIMITS } = require('./config');

const WINDOW_MS = 60 * 1000;
const windows = new Map();

/* A fixed one-minute window per session, in this process: enough to stop a loop from flooding the strip. */
const prune = (now) => {
    windows.forEach((window, key) => { if (now - window.start >= WINDOW_MS) windows.delete(key); });
};

const rateLimited = (sessionId, now = Date.now()) => {
    prune(now);
    const key = String(sessionId);
    const current = windows.get(key);
    if (!current || now - current.start >= WINDOW_MS) {
        windows.set(key, { start: now, count: 1 });
        return false;
    }
    current.count += 1;
    return current.count > LIMITS.activitiesPerMinute;
};

const refuse = async (ctx, action, sessionId, reason) => {
    throw await actions.refusal(ctx.companyId, ctx.actor, {
        action, params: { sessionId: String(sessionId || '') }, reason, ip: ctx.ip, taint: ctx.taint, entityType: 'agent_session', entityId: String(sessionId || ''),
    });
};

/* Each call proves it is the session's own client under the session's own grant, that the session is still open, and
 * that the person behind the grant can still open the task. The first call on an offer also carries its handle. */
const authorize = async (ctx, action, { sessionId, handle }, vis, now = new Date()) => {
    if (!ctx || !ctx.oauth) return refuse(ctx, action, sessionId, 'a session is taken up only with an OAuth access token from the client it was delegated to');
    const session = await store.find(ctx.companyId, sessionId);
    if (!session) return refuse(ctx, action, sessionId, 'no such session in this workspace');
    if (String(session.clientId) !== String(ctx.oauth.clientId)) return refuse(ctx, action, sessionId, 'this session was delegated to another client');
    if (String(session.grantId) !== String(ctx.oauth.grantId)) return refuse(ctx, action, sessionId, 'this session belongs to another grant');
    if (!isOpen(session)) return refuse(ctx, action, sessionId, `this session is ${session.state}`);
    if (session.workflowRunId) {
        const live = await require('../Workflows/externalSession').enforce(ctx.companyId, session, now);
        if (!live.ok) return refuse(ctx, action, sessionId, live.reason);
    }
    if (session.state === STATE.OFFERED && session.deliveredAt && now.getTime() > new Date(session.deliveredAt).getTime() + LIMITS.firstActivityMs) {
        await lifecycle.expire(session, now);
        return refuse(ctx, action, sessionId, 'no first activity came within ten seconds of delivery, so the offer lapsed');
    }
    if (session.state === STATE.OFFERED && !handleMatches(session, handle, now)) {
        return refuse(ctx, action, sessionId, 'the first call on an offered session must carry the handle from its announcement');
    }
    const task = await access.taskOf(ctx.companyId, session.taskId);
    const canOpen = vis ? Boolean(task) && vis.allowsTask(task) : await access.canOpenTask(ctx.companyId, ctx.userId, task);
    if (!canOpen) {
        return refuse(ctx, action, sessionId, `${visibility.NOT_VISIBLE}: the person behind this grant can no longer open the task`);
    }
    return { session, task };
};

const auditTransition = (ctx, action, session, extra = {}) => agentAudit.recordAction(ctx.companyId, ctx.actor, {
    action,
    reason: extra.reason || '',
    params: { sessionId: String(session._id), ...(extra.params || {}) },
    entityType: 'task',
    entityId: String(session.taskId),
    entityName: session.taskName || '',
    ip: ctx.ip,
    taint: ctx.taint,
});

const view = (session) => ({ sessionId: String(session._id), state: session.state, activityCount: Number(session.activityCount || 0) });

const record = async (ctx, args = {}, vis) => {
    const action = 'session.activity';
    const { session } = await authorize(ctx, action, args, vis);
    if (rateLimited(session._id)) return refuse(ctx, action, session._id, `more than ${LIMITS.activitiesPerMinute} activities in a minute on this session`);
    const { activity, problem } = activityOf(args);
    if (problem) return refuse(ctx, action, session._id, problem);
    const added = await store.appendActivity(ctx.companyId, session._id, activity);
    if (!added) return refuse(ctx, action, session._id, 'this session closed before the activity arrived');
    if (added.first) {
        lifecycle.disarm(ctx.companyId, session._id);
        await auditTransition(ctx, 'session.taken_up', added.session, { params: { type: activity.type } });
    }
    events.emitSession(added.session);
    return view(added.session);
};

const finish = async (ctx, args, vis, { action, state, type, textOf }) => {
    const { session } = await authorize(ctx, action, args, vis);
    const text = textOf(args);
    const now = new Date();
    if (text) await store.appendActivity(ctx.companyId, session._id, { type, text, at: now });
    const closed = await store.transition(ctx.companyId, session._id, OPEN, { state, endedAt: now, handleHash: '', ...(state === STATE.FAILED ? { reason: text } : {}) });
    if (!closed) return refuse(ctx, action, session._id, 'this session closed before the call arrived');
    lifecycle.disarm(ctx.companyId, session._id);
    await auditTransition(ctx, action, closed, { reason: text });
    events.emitSession(closed);
    return view(closed);
};

const complete = (ctx, args = {}, vis) => finish(ctx, args, vis, { action: 'session.complete', state: STATE.COMPLETED, type: 'response', textOf: (a) => cleanText(a.summary) });

const fail = (ctx, args = {}, vis) => finish(ctx, args, vis, { action: 'session.fail', state: STATE.FAILED, type: 'error', textOf: (a) => cleanText(a.reason) || 'the outside agent gave up' });

const resetRateLimits = () => windows.clear();
const rateWindowCount = () => windows.size;

module.exports = { authorize, record, complete, fail, rateLimited, resetRateLimits, rateWindowCount };
