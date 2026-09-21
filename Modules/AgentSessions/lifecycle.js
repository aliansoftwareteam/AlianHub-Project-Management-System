const { recordAudit } = require('../Audit/recorder');
const store = require('./store');
const events = require('./events');
const clients = require('./clients');
const { STATE, OPEN } = require('./rules');
const { LIMITS } = require('./config');
const logger = require('../../Config/loggerConfig');

const timers = new Map();
const keyOf = (companyId, id) => `${companyId}:${id}`;
const tracked = new Set();

const auditSystem = (session, action, meta = {}) => recordAudit(session.companyId, {
    actorId: 'system',
    actorName: 'Agent sessions',
    action,
    entityType: 'task',
    entityId: String(session.taskId),
    entityName: session.taskName || '',
    meta: { sessionId: String(session._id), clientId: session.clientId, grantId: session.grantId, delegatedBy: session.delegatedBy, ...meta },
});

const disarm = (companyId, id) => {
    const key = keyOf(companyId, id);
    clearTimeout(timers.get(key));
    timers.delete(key);
};

/* Closes an open session the system decided on (no answer in time, a revoked grant, a failed announcement). */
const close = async (session, state, reason, { from = OPEN, extra = {}, now = new Date() } = {}) => {
    disarm(session.companyId, session._id);
    const closed = await store.transition(session.companyId, session._id, from, { state, reason, endedAt: now, handleHash: '' }, extra);
    if (!closed) return null;
    auditSystem(closed, `agent_session.${state}`, { reason });
    events.emitSession(closed);
    return closed;
};

const deadlineOf = (session) => new Date(new Date(session.deliveredAt).getTime() + LIMITS.firstActivityMs);

/* The owner's rule: the clock starts when the announcement was delivered, and an offer still untaken ten seconds later
 * is unresponsive. The filter repeats the rule, so a timer that fires early or twice changes nothing. */
const expire = (session, now = new Date()) => close(session, STATE.UNRESPONSIVE, 'no first activity within ten seconds of delivery', {
    from: [STATE.OFFERED],
    extra: { deliveredAt: { $lte: new Date(now.getTime() - LIMITS.firstActivityMs) } },
    now,
});

const arm = (session, now = Date.now()) => {
    if (!session || session.state !== STATE.OFFERED || !session.deliveredAt) return;
    disarm(session.companyId, session._id);
    const wait = Math.max(0, deadlineOf(session).getTime() - now);
    const timer = setTimeout(() => {
        timers.delete(keyOf(session.companyId, session._id));
        expire(session).catch((error) => logger.error(`agent sessions: expiring ${session._id} failed: ${error.message}`));
    }, wait);
    if (timer.unref) timer.unref();
    timers.set(keyOf(session.companyId, session._id), timer);
    tracked.add(String(session.companyId));
};

const revokedBecause = async (session, now) => {
    if (!(await clients.grantStanding(session.grantId, now))) return 'the grant behind this session was revoked or has expired';
    if (!(await clients.clientStanding(session.companyId, session.clientId)).ok) return 'the outside client is no longer approved in this workspace';
    return '';
};

/* Survives a restart: every timer that died with the process is decided here from the stored times, and revocations
 * made anywhere (a grant, a client, an approval) close the sessions they cover. */
const sweepCompany = async (companyId, now = new Date()) => {
    const open = await store.openRows(companyId);
    let closed = 0;
    for (const session of open) {
        // eslint-disable-next-line no-await-in-loop
        const why = await revokedBecause(session, now);
        if (why) {
            // eslint-disable-next-line no-await-in-loop
            if (await close(session, STATE.REVOKED, why, { now })) closed += 1;
        } else if (session.state === STATE.OFFERED && session.deliveredAt) {
            if (deadlineOf(session).getTime() <= now.getTime()) {
                // eslint-disable-next-line no-await-in-loop
                if (await expire(session, now)) closed += 1;
            } else if (!timers.has(keyOf(companyId, session._id))) {
                arm(session, now.getTime());
            }
        } else if (session.state === STATE.OFFERED && new Date(session.createdAt).getTime() + LIMITS.handleMs <= now.getTime()) {
            // eslint-disable-next-line no-await-in-loop
            if (await close(session, STATE.FAILED, 'the announcement was never delivered', { from: [STATE.OFFERED], now })) closed += 1;
        }
    }
    if (open.length > closed) tracked.add(String(companyId));
    else tracked.delete(String(companyId));
    return { open: open.length, closed };
};

const sweepTracked = async (now = new Date()) => {
    let closed = 0;
    for (const companyId of [...tracked]) {
        // eslint-disable-next-line no-await-in-loop
        closed += (await sweepCompany(companyId, now).catch((error) => {
            logger.error(`agent sessions: sweep of ${companyId} failed: ${error.message}`);
            return { closed: 0 };
        })).closed;
    }
    return { closed };
};

const track = (companyId) => tracked.add(String(companyId));
const reset = () => { [...timers.values()].forEach(clearTimeout); timers.clear(); tracked.clear(); };

module.exports = { close, expire, arm, disarm, sweepCompany, sweepTracked, track, reset };
