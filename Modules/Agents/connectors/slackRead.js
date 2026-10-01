const flag = require('./flag');
const connection = require('./slackConnection');
const api = require('./slackApi');
const limits = require('./readLimits');
const taint = require('../taint');
const egressContext = require('../engine/egressContext');
const { recordAudit } = require('../../Audit/recorder');

/* slack.channel.read: the recent messages of one public channel an owner or admin ticked for reading, as plain
 * text. The allow-list and the channel's privacy are checked at every call, each read is counted against the
 * run, and what is recorded about it (run row, audit row) is counts and ids, never what the channel said. */

const ACTION = 'slack.channel.read';
const READER = 'slack.channel';
const AUDIT_ACTION = 'connector.call';
const LIMITS = Object.freeze({ ...limits.SLACK_READ, RUN_CALLS: limits.RUN.CALLS, RUN_CHARS: limits.RUN.CHARS });
const STATE = Object.freeze({ APPLIED: 'applied', FAILED: 'failed', REFUSED: 'refused' });
const KEPT_SUBTYPES = Object.freeze(['bot_message', 'thread_broadcast', 'file_share']);
const SLACK_ID = /^[A-Z0-9]{2,20}$/;
const MIN_PARTIAL_LINE = 40;

const refusal = (code, message, extra = {}) => Object.assign(new Error(`${code}: ${message}`), { code, deterministic: true, ...extra });

/* Slack's own markup for mentions, channels and links is turned into words, so the model is not handed syntax
 * that would notify people or a whole channel if it echoed it into a message. */
const plainText = (value) => String(value || '')
    .replace(/<!([a-z]+)(?:\^[^|>]*)?(?:\|[^>]*)?>/g, '@$1')
    .replace(/<@([UW][A-Z0-9]+)(?:\|[^>]*)?>/g, '@$1')
    .replace(/<#(C[A-Z0-9]+)(?:\|([^>]*))?>/g, (all, id, name) => `#${name || id}`)
    .replace(/<((?:https?|mailto):[^|>\s]+)(?:\|([^>]*))?>/g, (all, url, label) => (label ? `${label} (${url})` : url))
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, ' ')
    .trim();

const isText = (m) => Boolean(m) && m.type === 'message' && (!m.subtype || KEPT_SUBTYPES.includes(m.subtype)) && typeof m.text === 'string' && Boolean(plainText(m.text));
const whoOf = (m) => [m.user, m.bot_id].map((id) => String(id || '')).find((id) => SLACK_ID.test(id)) || 'unknown';
const minuteOf = (ts) => { const at = new Date(Number(ts) * 1000); return Number.isNaN(at.getTime()) ? '' : at.toISOString().slice(0, 16).replace('T', ' '); };
const lineOf = (m) => `${minuteOf(m.ts)} ${whoOf(m)}: ${plainText(m.text)}`.trim();

/* Slack answers newest first. The newest messages are kept while they fit, then put in the order they were said. */
const linesOf = (messages, { limit, maxChars, more }) => {
    const texts = (Array.isArray(messages) ? messages : []).filter(isText);
    const lines = [];
    let left = maxChars;
    let truncated = Boolean(more) || texts.length > limit;
    for (const message of texts.slice(0, limit)) {
        const line = lineOf(message);
        const room = left - (lines.length ? 1 : 0);
        if (line.length <= room) { lines.push(line); left = room - line.length; continue; }
        truncated = true;
        if (!lines.length || room >= MIN_PARTIAL_LINE) lines.push(line.slice(0, Math.max(0, room)));
        break;
    }
    const text = lines.reverse().join('\n');
    return { text, count: lines.length, chars: text.length, truncated };
};

const clamp = (value, min, max, fallback) => { const n = Math.round(Number(value)); return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback; };

const record = async ({ companyId, runId, actor }, entry) => {
    const what = { action: ACTION, channelId: '', ...entry };
    await require('../runs').patch(companyId, runId, {}, { $push: { connectorReads: { ...what, connector: connection.CONNECTOR, at: new Date() } } });
    recordAudit(companyId, {
        actorId: String(actor.userId || 'system'), action: AUDIT_ACTION, entityType: 'connector', entityId: connection.CONNECTOR, entityName: 'Slack',
        meta: { ...what, runId: String(runId), agentId: String(actor.agentId || ''), agentName: String(actor.agentName || '') },
    });
};

const refused = async (who, code, message, channelId = '') => {
    await record(who, { channelId, state: STATE.REFUSED, reason: code });
    return refusal(code, message);
};

/* One attempt. A token Slack refuses marks the connection broken, so the next read is refused without a call. */
const failed = async (who, row, channelId, out) => {
    if (api.isTokenError(out.error)) await connection.markBroken(who.companyId, row, out.error);
    await record(who, { channelId, state: STATE.FAILED, error: out.error });
    const wait = out.retryAfter ? `, retry after ${out.retryAfter}s` : '';
    return refusal('slack_failed', `Slack did not answer the read (${out.error}${wait}); it is not tried again in this run`, { slackError: out.error });
};

/* A refused read took nothing in and reached no message, so it does not count against the run. */
const usedBy = async (companyId, runId) => {
    const run = await require('../runs').get(companyId, runId);
    if (!run) return null;
    const reads = (Array.isArray(run.connectorReads) ? run.connectorReads : []).filter((r) => r && r.state !== STATE.REFUSED);
    return { calls: reads.length, chars: reads.reduce((sum, r) => sum + (Number(r.chars) || 0), 0) };
};

const read = async ({ companyId, runId, actor, allowedActions, params = {} }) => {
    if (!flag.slackOn()) throw refusal('connector_off', 'the Slack connector is off on this server');
    if (!runId || !actor || !actor.agentId) throw refusal('run_required', 'a Slack channel is read only inside an agent run, where the read is counted and recorded');
    await require('../actions').authorizeRead({ companyId, actor, action: ACTION, params: { channel: String(params.channel || '') }, allowedActions });
    const used = await usedBy(companyId, runId);
    if (!used) throw refusal('run_required', 'the run this read belongs to was not found');

    const who = { companyId, runId, actor };
    if (used.calls >= LIMITS.RUN_CALLS) throw await refused(who, 'run_call_cap', `a run reads a connector at most ${LIMITS.RUN_CALLS} times`);
    const charsLeft = LIMITS.RUN_CHARS - used.chars;
    if (charsLeft <= 0) throw await refused(who, 'run_char_cap', `a run takes in at most ${LIMITS.RUN_CHARS} characters from connectors`);

    const { row, token, reason } = await connection.tokenFor(companyId);
    if (!token) {
        throw reason === 'broken'
            ? await refused(who, 'connection_broken', 'Slack refused the stored bot token; an owner or admin has to replace it')
            : await refused(who, 'not_connected', 'Slack is not connected in this workspace');
    }

    const uses = params.postable ? [connection.USE.READ, connection.USE.POST] : [connection.USE.READ];
    const channel = params.channel ? connection.allowedChannel(row, params.channel, uses) : connection.channelsFor(row, uses)[0];
    if (!channel) {
        throw await refused(who, 'channel_not_readable', `that Slack channel is not on this workspace's allow-list for reading${params.postable ? ' and posting' : ''}; an owner or admin ticks it on the Integrations screen`);
    }

    const ask = (method, args) => api.call({ companyId, actor: actor.userId, token, method, args });
    const info = await ask('conversations.info', { channel: channel.id });
    if (!info.ok) throw await failed(who, row, channel.id, info);
    const live = info.body.channel || {};
    if (live.is_channel !== true || live.is_private || live.is_im || live.is_mpim || live.is_group) {
        throw await refused(who, 'channel_private', 'Slack says that channel is private or a direct message, which agents never read', channel.id);
    }

    const limit = clamp(params.limit, 1, LIMITS.MESSAGES, LIMITS.MESSAGES);
    const hours = clamp(params.hours, 1, LIMITS.HOURS, LIMITS.DEFAULT_HOURS);
    const maxChars = Math.min(clamp(params.maxChars, 1, LIMITS.CHARS, LIMITS.CHARS), charsLeft);
    const history = await ask('conversations.history', { channel: channel.id, limit: String(limit), oldest: String(Math.floor(Date.now() / 1000) - hours * 3600), inclusive: 'false' });
    if (!history.ok) throw await failed(who, row, channel.id, history);

    const out = linesOf(history.body.messages, { limit, maxChars, more: Boolean(history.body.has_more) });
    await record(who, { channelId: channel.id, state: STATE.APPLIED, messages: out.count, chars: out.chars, truncated: out.truncated });
    await connection.noteRead(companyId, row);
    if (!out.count) return { skip: `no messages in #${channel.name} in the last ${hours} hours` };
    egressContext.noteConnectorRead(connection.CONNECTOR);
    return { channelId: channel.id, channel: channel.name, ...out, taint: [taint.connector(connection.CONNECTOR, channel.id)] };
};

module.exports = { ACTION, READER, AUDIT_ACTION, LIMITS, STATE, read, plainText, linesOf };
