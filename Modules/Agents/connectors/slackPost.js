const flag = require('./flag');
const connection = require('./slackConnection');
const api = require('./slackApi');

/* slack.message.post, checked twice: when the proposal is filed, so a person is never asked to approve a post
 * that cannot be made, and again when it is applied, because the allow-list may have changed in between. */

const ACTION = 'slack.message.post';
const MAX_TEXT = 3000;
const SPECIAL_MENTION = /<![^>]*>/;
const FILE_KEYS = Object.freeze(['file', 'files', 'attachments', 'blocks', 'upload']);

const refuse = (message, code) => Object.assign(new Error(message), { status: 400, code, deterministic: true });

const textOf = (value) => {
    if (typeof value !== 'string' || !value.trim()) throw refuse('A Slack message needs text.', 'text_required');
    const text = value.replace(/\r\n/g, '\n').trim();
    if (text.length > MAX_TEXT) throw refuse(`A Slack message is at most ${MAX_TEXT} characters.`, 'text_too_long');
    // eslint-disable-next-line no-control-regex
    if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(text)) throw refuse('A Slack message cannot hold control characters.', 'text_invalid');
    if (SPECIAL_MENTION.test(text)) throw refuse('A Slack message from an agent cannot notify a whole channel or use Slack\'s <!…> commands.', 'text_broadcast');
    return text;
};

/* The change as it is stored and shown: the channel's id and Slack's own name for it, and the exact text. */
const admit = async (companyId, params = {}) => {
    if (!flag.slackOn()) throw refuse('The Slack connector is off.', 'connector_off');
    if (FILE_KEYS.some((key) => params[key] !== undefined)) throw refuse('A Slack message from an agent is text only: no files, attachments or blocks.', 'text_only');
    const text = textOf(params.text);
    const row = await connection.find(companyId);
    if (!row || !(row.secretHandles && row.secretHandles.bot_token)) throw refuse('Slack is not connected in this workspace.', 'not_connected');
    const channel = connection.allowedChannel(row, params.channelId || params.channel);
    if (!channel) throw refuse('That Slack channel is not on this workspace\'s allow-list.', 'channel_not_allowed');
    return { channelId: channel.id, channelName: channel.name, text };
};

const labelOf = (params) => `Post to #${params.channelName} in Slack`;

/* Rewrites every Slack change of a proposal to what admit() answers, and refuses the proposal when one fails. */
const prepareChanges = async (companyId, changes) => {
    const out = [];
    for (const change of Array.isArray(changes) ? changes : []) {
        if (!change || change.action !== ACTION) { out.push(change); continue; }
        // eslint-disable-next-line no-await-in-loop
        const params = await admit(companyId, change.params);
        out.push({ ...change, params, label: labelOf(params) });
    }
    return out;
};

const hasSlackChange = (changes) => (Array.isArray(changes) ? changes : []).some((c) => c && c.action === ACTION);

const failure = (out) => {
    const text = out.error === api.ERROR.RATE_LIMITED
        ? `slack: rate_limited${out.retryAfter ? `, retry after ${out.retryAfter}s` : ''}`
        : `slack: ${out.error}${out.detail ? ` (${out.detail})` : ''}`;
    return Object.assign(new Error(text), { slackError: out.error, ...(out.retryAfter ? { retryAfter: out.retryAfter } : {}) });
};

/* The executor behind an approved proposal. One attempt: a refused token marks the connection broken. */
const post = async ({ companyId, actor, params }) => {
    const sent = await admit(companyId, params);
    const { row, token, reason } = await connection.tokenFor(companyId);
    if (!token) throw failure({ error: reason === 'broken' ? `connection_broken_${row.brokenReason || 'token'}` : reason });
    const out = await api.call({
        companyId, actor: actor && actor.userId, token, method: 'chat.postMessage',
        args: { channel: sent.channelId, text: sent.text, parse: 'none', link_names: 'false', unfurl_links: 'false', unfurl_media: 'false' },
    });
    if (!out.ok) {
        if (api.isTokenError(out.error)) await connection.markBroken(companyId, row, out.error);
        throw failure(out);
    }
    await connection.notePosted(companyId, row);
    const ts = String(out.body.ts || '');
    return {
        result: { channelId: sent.channelId, channelName: sent.channelName, ts },
        undo: null, entityType: 'slack_message', entityId: `${sent.channelId}:${ts}`, entityName: `#${sent.channelName}`,
    };
};

/* What the proposal keeps of each Slack change once it was applied: the message timestamp or the error. */
const deliveryOf = (changes, applied) => (Array.isArray(changes) ? changes : [])
    .map((change, i) => ({ change, outcome: (applied || [])[i] || {} }))
    .filter(({ change }) => change && change.action === ACTION)
    .map(({ change, outcome }) => ({
        action: ACTION, ok: Boolean(outcome.ok),
        channelId: String((change.params || {}).channelId || ''), channelName: String((change.params || {}).channelName || ''),
        ...(outcome.ok ? { ts: String((outcome.result && outcome.result.ts) || '') } : { error: String(outcome.error || 'not sent').slice(0, 300) }),
        at: new Date(),
    }));

module.exports = { ACTION, MAX_TEXT, admit, prepareChanges, hasSlackChange, post, deliveryOf, labelOf };
