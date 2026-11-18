const crypto = require('crypto');
const { LIMITS } = require('./config');
const { isBlockedHostname } = require('../Agents/engine/safeFetch');
const { hostMatches } = require('../Agents/engine/egressRules');

const STATE = Object.freeze({
    OFFERED: 'offered',
    ACTIVE: 'active',
    COMPLETED: 'completed',
    FAILED: 'failed',
    REVOKED: 'revoked',
    UNRESPONSIVE: 'unresponsive',
});
const OPEN = Object.freeze([STATE.OFFERED, STATE.ACTIVE]);

const ACTIVITY_TYPES = Object.freeze(['thought', 'action', 'elicitation', 'response', 'error']);

const isOpen = (session) => Boolean(session) && OPEN.includes(session.state);

const isControl = (code) => (code < 32 && ![9, 10, 13].includes(code)) || code === 127;

const cleanText = (value, max = LIMITS.textChars) => Array.from(String(value === undefined || value === null ? '' : value))
    .filter((ch) => !isControl(ch.charCodeAt(0)))
    .join('')
    .trim()
    .slice(0, max);

/* Answers { activity } or { problem }; the text is cut to the limit rather than refused. */
const activityOf = (input = {}, now = new Date()) => {
    const type = String(input.type || '');
    if (!ACTIVITY_TYPES.includes(type)) return { problem: `type must be one of ${ACTIVITY_TYPES.join(', ')}` };
    const text = cleanText(input.text);
    if (!text) return { problem: 'text is required' };
    return { activity: { type, text, at: now } };
};

const newHandle = () => `ahs_${crypto.randomBytes(24).toString('base64url')}`;
const hashOf = (handle) => crypto.createHash('sha256').update(String(handle)).digest('hex');

const handleMatches = (session, handle, now = new Date()) => {
    if (!session || !session.handleHash || !handle) return false;
    if (session.handleExpiresAt && new Date(session.handleExpiresAt).getTime() <= now.getTime()) return false;
    const given = Buffer.from(hashOf(handle), 'hex');
    const stored = Buffer.from(String(session.handleHash), 'hex');
    return given.length === stored.length && crypto.timingSafeEqual(given, stored);
};

const portOf = (url) => Number(url.port || (url.protocol === 'https:' ? 443 : 80));

/* https on a public host; http only to a private host the instance owner allows for webhooks. With a workspace egress
 * list, the host must be on it, as the gateway will check again at delivery. Answers '' or the problem. */
const deliveryUrlProblem = (value, { allowlist, egressHosts = [] } = {}) => {
    let url;
    try { url = new URL(String(value || '').trim()); } catch (error) { return 'the delivery URL is not a valid URL'; }
    if (url.username || url.password) return 'the delivery URL must not carry credentials';
    const ownerAllowed = Boolean(allowlist && allowlist.allowsHost(url.hostname));
    if (url.protocol !== 'https:' && !(url.protocol === 'http:' && ownerAllowed)) return 'the delivery URL must use https';
    if (isBlockedHostname(url.hostname) && !ownerAllowed) return 'the delivery URL names a private, local or internal host';
    if (egressHosts.length && !hostMatches(egressHosts, url.hostname, portOf(url))) return `${url.hostname} is not on this workspace's egress allowlist`;
    return '';
};

/* What the outside client is told. The handle is the only secret, it is short-lived and it only lets the client take
 * this session up; it never carries an access token. */
const announcement = ({ session, handle, issuer, now = new Date() }) => ({
    type: 'agent_session.offered',
    sentAt: now.toISOString(),
    sessionId: String(session._id),
    workspaceId: String(session.companyId || ''),
    task: { id: String(session.taskId), key: session.taskKey || '', title: session.taskName || '' },
    handle,
    handleExpiresAt: new Date(session.handleExpiresAt).toISOString(),
    firstActivityWithinSeconds: Math.round(LIMITS.firstActivityMs / 1000),
    replayWindowSeconds: LIMITS.replayWindowSeconds,
    mcp: issuer ? `${String(issuer).replace(/\/+$/, '')}/mcp` : '',
    tools: ['session.activity', 'session.complete', 'session.fail'],
});

const iso = (d) => (d ? new Date(d).toISOString() : null);

const publicView = (session, { shown = LIMITS.activitiesShown } = {}) => ({
    id: String(session._id),
    taskId: String(session.taskId),
    clientId: session.clientId,
    clientName: session.clientName || '',
    delegatedBy: session.delegatedBy,
    state: session.state,
    reason: session.reason || '',
    createdAt: iso(session.createdAt),
    deliveredAt: iso(session.deliveredAt),
    firstActivityAt: iso(session.firstActivityAt),
    lastActivityAt: iso(session.lastActivityAt),
    endedAt: iso(session.endedAt),
    activityCount: Number(session.activityCount || 0),
    ...(session.workflowRunId ? { workflowRunId: String(session.workflowRunId), workflowStepId: String(session.workflowStepId || '') } : {}),
    activities: (session.activities || []).slice(-shown).map((a) => ({ type: a.type, text: a.text || '', at: iso(a.at) })),
});

module.exports = {
    STATE, OPEN, ACTIVITY_TYPES, isOpen, cleanText, activityOf, newHandle, hashOf, handleMatches,
    deliveryUrlProblem, announcement, publicView,
};
