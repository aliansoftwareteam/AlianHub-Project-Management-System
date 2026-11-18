const { SLACK_READ } = require('../../../Agents/connectors/readLimits');
const { linesOf } = require('./text');

const API = 'https://slack.com/api/';
const PAGE = 200;
const PAGES = 5;
const MAX_TEXT = 3000;
const CHANNEL_ID = /^[CG][A-Z0-9]{6,20}$/;
const SPECIAL_MENTION = /<![^>]*>/;

const channel = { type: 'string', maxLength: 81, pattern: '^(#?[a-z0-9._-]{1,80}|[CG][A-Z0-9]{6,20})$', description: 'The channel\'s name, with or without #, or its id.' };

const json = (res) => JSON.parse(res.body);
const refuse = (message) => Object.assign(new Error(message), { code: 'bad_input', status: 400, deterministic: true });

/* Public channels, and the private ones the person is in: Slack lists a private channel only to its members. A write's
 * requester posts unless told otherwise, so every read here names GET. */
const listChannels = async (connection, pages = PAGES) => {
    const found = [];
    let cursor = '';
    for (let page = 0; page < pages; page += 1) {
        // eslint-disable-next-line no-await-in-loop
        const body = json(await connection.request(`${API}conversations.list`, {
            method: 'get',
            query: { types: 'public_channel,private_channel', exclude_archived: true, limit: PAGE, ...(cursor ? { cursor } : {}) },
        }));
        found.push(...(body.channels || []));
        cursor = String((body.response_metadata && body.response_metadata.next_cursor) || '');
        if (!cursor) break;
    }
    return found.filter((c) => c && CHANNEL_ID.test(String(c.id || '')) && c.name).sort((a, b) => String(a.name).localeCompare(String(b.name)));
};

/* The channel a reference names, checked with Slack at every call: a direct message is never read or posted to,
 * whatever id the model sends. With no reference, the first channel by name the person is a member of. */
const channelOf = async (connection, ref) => {
    const text = String(ref || '').trim().replace(/^#/, '');
    let id = CHANNEL_ID.test(text) ? text : '';
    if (!id) {
        const listed = await listChannels(connection);
        const found = text ? listed.find((c) => String(c.name).toLowerCase() === text.toLowerCase()) : listed.find((c) => c.is_member);
        if (!found) throw refuse(text ? `There is no Slack channel #${text} that you can see.` : 'You are not a member of any Slack channel.');
        id = found.id;
    }
    const live = json(await connection.request(`${API}conversations.info`, { method: 'get', query: { channel: id } })).channel || {};
    if (live.is_im || live.is_mpim) {
        throw refuse('That is a direct message, and agents never read or post to those.');
    }
    return { id: String(live.id || id), name: String(live.name || text || id).slice(0, 80), isPrivate: Boolean(live.is_private) };
};

const textOf = (value) => {
    const text = String(value || '').replace(/\r\n/g, '\n').trim();
    if (!text) throw refuse('A Slack message needs text.');
    // eslint-disable-next-line no-control-regex
    if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(text)) throw refuse('A Slack message cannot hold control characters.');
    if (SPECIAL_MENTION.test(text)) throw refuse('A Slack message from an agent cannot notify a whole channel or use Slack\'s <!…> commands.');
    return text;
};

const clamp = (value, min, max, fallback) => { const n = Math.round(Number(value)); return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback; };

module.exports = [{
    key: 'slack.channels.list',
    label: 'Connectors.tool.slackChannelsList',
    kind: 'read',
    product: 'messages',
    scope: 'channels:read',
    input: {
        type: 'object',
        description: 'The Slack channels the person can see: every public channel, and the private ones they are in. No direct messages.',
        properties: { name: { type: 'string', maxLength: 80, description: 'Only channels whose name contains this.' }, limit: { type: 'integer', minimum: 1, maximum: PAGE, default: 100 } },
        additionalProperties: false,
    },
    caps: { maxItems: PAGE, maxChars: 8000 },
    run: async ({ input, connection, caps }) => {
        const wanted = String(input.name || '').trim().replace(/^#/, '').toLowerCase();
        const listed = (await listChannels(connection)).filter((c) => !wanted || String(c.name).toLowerCase().includes(wanted));
        const shown = listed.slice(0, Math.min(input.limit || 100, caps.maxItems));
        if (!shown.length) return 'No channels found.';
        return shown.map((c) => `- #${c.name}${c.is_private ? ' (private)' : ''}${c.is_member ? ' (member)' : ''} [id: ${c.id}]`).join('\n');
    },
}, {
    key: 'slack.channel.read',
    label: 'Connectors.tool.slackChannelRead',
    kind: 'read',
    product: 'messages',
    scope: 'channels:history',
    input: {
        type: 'object',
        description: `The latest messages of one Slack channel the person can see, oldest first, with people left as Slack ids: at most ${SLACK_READ.MESSAGES} messages. With no channel named it reads the first channel by name the person is a member of.`,
        properties: {
            channel,
            hours: { type: 'integer', minimum: 1, maximum: SLACK_READ.HOURS, default: SLACK_READ.DEFAULT_HOURS },
            limit: { type: 'integer', minimum: 1, maximum: SLACK_READ.MESSAGES, default: SLACK_READ.MESSAGES },
        },
        additionalProperties: false,
    },
    caps: { maxItems: SLACK_READ.MESSAGES, maxChars: SLACK_READ.CHARS },
    fields: ['channel', 'channelId', 'count'],
    run: async ({ input, connection, caps }) => {
        const found = await channelOf(connection, input.channel);
        const limit = clamp(input.limit, 1, caps.maxItems, caps.maxItems);
        const hours = clamp(input.hours, 1, SLACK_READ.HOURS, SLACK_READ.DEFAULT_HOURS);
        const history = json(await connection.request(`${API}conversations.history`, {
            query: { channel: found.id, limit, oldest: Math.floor(Date.now() / 1000) - hours * 3600, inclusive: false },
        }));
        const out = linesOf(history.messages, { limit, maxChars: caps.maxChars, more: Boolean(history.has_more) });
        return {
            text: out.count ? out.text : `No messages in #${found.name} in the last ${hours} hours.`,
            fields: { channel: found.name, channelId: found.id, count: out.count },
        };
    },
}, {
    key: 'slack.message.post',
    label: 'Connectors.tool.slackMessagePost',
    kind: 'write',
    product: 'messages',
    scope: 'chat:write',
    input: {
        type: 'object',
        description: 'Posts a plain-text message as the person to one Slack channel they can see. No files, no blocks, and never @here, @channel or @everyone.',
        properties: { channel, text: { type: 'string', maxLength: MAX_TEXT } },
        required: ['channel', 'text'],
        additionalProperties: false,
    },
    caps: { maxItems: 1, maxChars: 500 },
    card: (input) => ({ target: `#${String(input.channel).replace(/^#/, '')}`, text: textOf(input.text) }),
    editable: [{ param: 'text', label: 'Connectors.card.text', long: true }],
    run: async ({ input, connection }) => {
        const text = textOf(input.text);
        const found = await channelOf(connection, input.channel);
        const sent = json(await connection.request(`${API}chat.postMessage`, {
            method: 'post',
            json: { channel: found.id, text, parse: 'none', link_names: false, unfurl_links: false, unfurl_media: false },
        }));
        return `Posted to #${found.name} (message ${sent.ts}).`;
    },
}];
