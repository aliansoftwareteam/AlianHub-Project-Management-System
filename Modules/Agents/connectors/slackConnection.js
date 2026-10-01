const mongoose = require('mongoose');
const { SCHEMA_TYPE } = require('../../../Config/schemaType');
const { MongoDbCrudOpration } = require('../../../utils/mongo-handler/mongoQueries');
const store = require('../../../Config/secrets');
const { recordAudit } = require('../../Audit/recorder');
const api = require('./slackApi');

/* The workspace's Slack connection. The bot token and the signing secret are kept in the secrets store under the
 * kind `connector` and this row holds their handles only; nothing here returns, logs or audits a value. */

const T = SCHEMA_TYPE.CONNECTOR_CONNECTIONS;
const CONNECTOR = 'slack';
const SECRET_KIND = 'connector';
const STATUS = Object.freeze({ CONNECTED: 'connected', BROKEN: 'broken' });
const SECRETS = Object.freeze({
    bot_token: Object.freeze({ name: 'Slack connector: bot token', format: /^xoxb-[A-Za-z0-9-]{20,250}$/, problem: 'A Slack bot token starts with xoxb-.' }),
    signing_secret: Object.freeze({ name: 'Slack connector: signing secret', format: /^[A-Za-z0-9]{20,64}$/, problem: 'A Slack signing secret is 20 to 64 letters and digits.' }),
});
const SECRET_KEYS = Object.freeze(Object.keys(SECRETS));
const CHANNEL_ID = /^C[A-Z0-9]{6,20}$/;
const CHANNEL_PAGE = 200;
const CHANNEL_PAGES = 5;
const MAX_ALLOWED = 50;

class ConnectionError extends Error {
    constructor(status, message, code) { super(message); this.name = 'ConnectionError'; this.status = status; this.code = code || ''; }
}

const plain = (doc) => (doc && typeof doc.toObject === 'function' ? doc.toObject() : doc);
const live = { connector: CONNECTOR, deletedStatusKey: { $ne: 1 } };
const actorOf = (actor) => (actor && typeof actor === 'object' ? actor : { id: actor });

const find = async (companyId) => plain(await MongoDbCrudOpration(companyId, { type: T, data: [live] }, 'findOne'));

const audit = (companyId, actor, action, meta = {}) => {
    const who = actorOf(actor);
    recordAudit(companyId, { actorId: String(who.id || 'system'), ...(who.ip ? { ip: String(who.ip) } : {}), action, entityType: 'connector', entityId: CONNECTOR, entityName: 'Slack', meta });
};

const update = async (companyId, row, change) => plain(await MongoDbCrudOpration(companyId, {
    type: T, data: [{ _id: row._id }, change, { returnDocument: 'after' }],
}, 'findOneAndUpdate'));

const channelsOf = (list) => (Array.isArray(list) ? list : [])
    .filter((c) => c && CHANNEL_ID.test(String(c.id || '')) && typeof c.name === 'string' && c.name)
    .map((c) => ({ id: String(c.id), name: String(c.name).slice(0, 80), ...(c.member !== undefined ? { member: Boolean(c.member) } : {}) }));

/* A channel an owner or admin allowed, with what agents may do there. A row saved before reading existed has no
 * ticks and reads as post-only, which is all it could mean then. */
const allowedOf = (list) => (Array.isArray(list) ? list : [])
    .filter((c) => c && CHANNEL_ID.test(String(c.id || '')) && typeof c.name === 'string' && c.name)
    .map((c) => ({ id: String(c.id), name: String(c.name).slice(0, 80), read: c.read === true, post: c.post !== false }));

/* What an owner or admin sees: that each secret is set and since when, never the secret or its handle. */
const view = (row) => {
    const handles = (row && row.secretHandles) || {};
    const setAt = (row && row.secretSetAt) || {};
    return {
        connected: Boolean(handles.bot_token),
        secrets: Object.fromEntries(SECRET_KEYS.map((key) => [key, { set: Boolean(handles[key]), setAt: handles[key] ? setAt[key] || null : null }])),
        team: row && row.team ? { id: String(row.team.id || ''), name: String(row.team.name || '') } : null,
        channels: channelsOf(row && row.channels),
        channelsFetchedAt: (row && row.channelsFetchedAt) || null,
        allowedChannels: allowedOf(row && row.allowedChannels),
        status: handles.bot_token ? (row.status || STATUS.CONNECTED) : null,
        brokenReason: row && row.status === STATUS.BROKEN ? row.brokenReason || '' : '',
        brokenAt: row && row.status === STATUS.BROKEN ? row.brokenAt || null : null,
        lastPostAt: (row && row.lastPostAt) || null,
        lastReadAt: (row && row.lastReadAt) || null,
    };
};

/* The view, with a secret that was revoked from the stored-secrets screen shown as no longer set. */
const describe = async (companyId) => {
    const row = await find(companyId);
    const out = view(row);
    for (const key of SECRET_KEYS) {
        const handle = row && row.secretHandles && row.secretHandles[key];
        if (!handle) continue;
        // eslint-disable-next-line no-await-in-loop
        const held = await store.describe({ companyId, handle }).then(() => true).catch(() => false);
        if (!held) out.secrets[key] = { set: false, setAt: null, revoked: true };
    }
    if (!out.secrets.bot_token.set) Object.assign(out, { connected: false, status: null });
    return out;
};

const refusedBySlack = (out) => (api.isTokenError(out.error)
    ? new ConnectionError(400, `Slack did not accept this token (${out.error}).`, out.error)
    : new ConnectionError(502, `Slack could not be reached to check the token (${out.error}${out.detail ? `: ${out.detail}` : ''}).`, out.error));

const listChannels = async ({ companyId, actor, token }) => {
    const found = [];
    let cursor = '';
    for (let page = 0; page < CHANNEL_PAGES; page += 1) {
        // eslint-disable-next-line no-await-in-loop
        const out = await api.call({ companyId, actor: actorOf(actor).id, token, method: 'conversations.list', args: { types: 'public_channel', exclude_archived: 'true', limit: String(CHANNEL_PAGE), ...(cursor ? { cursor } : {}) } });
        if (!out.ok) return out;
        (out.body.channels || []).forEach((c) => found.push({ id: c.id, name: c.name, member: Boolean(c.is_member) }));
        cursor = String((out.body.response_metadata && out.body.response_metadata.next_cursor) || '');
        if (!cursor) break;
    }
    return { ok: true, channels: channelsOf(found).sort((a, b) => a.name.localeCompare(b.name)) };
};

const valueOf = (key, value) => {
    if (value === undefined || value === null || value === '') return '';
    const text = typeof value === 'string' ? value.trim() : '';
    if (!SECRETS[key].format.test(text)) throw new ConnectionError(400, SECRETS[key].problem, 'invalid_format');
    return text;
};

const keep = async ({ companyId, handle, key, value, actor }) => {
    if (handle) {
        try {
            return (await store.rotate({ companyId, handle, value, actor })).handle;
        } catch (error) {
            if (!['revoked', 'not_found'].includes(error.code)) throw error;
        }
    }
    return (await store.create({ companyId, name: SECRETS[key].name, kind: SECRET_KIND, value, actor })).handle;
};

/* A new bot token is checked with Slack before it is kept, and the channel list is read with it once. */
const saveSecrets = async (companyId, { botToken, signingSecret } = {}, actor) => {
    const token = valueOf('bot_token', botToken);
    const signing = valueOf('signing_secret', signingSecret);
    if (!token && !signing) throw new ConnectionError(400, 'A bot token or a signing secret is required.', 'nothing_to_save');
    const existing = await find(companyId);
    if (!token && !(existing && existing.secretHandles && existing.secretHandles.bot_token)) throw new ConnectionError(400, 'Add the bot token first.', 'bot_token_required');

    const set = { updatedBy: String(actorOf(actor).id || '') };
    if (token) {
        const who = await api.call({ companyId, actor: actorOf(actor).id, token, method: 'auth.test' });
        if (!who.ok) throw refusedBySlack(who);
        const listed = await listChannels({ companyId, actor, token });
        if (!listed.ok) throw refusedBySlack(listed);
        const ids = new Set(listed.channels.map((c) => c.id));
        Object.assign(set, {
            team: { id: String(who.body.team_id || ''), name: String(who.body.team || '').slice(0, 120) },
            channels: listed.channels,
            channelsFetchedAt: new Date(),
            allowedChannels: allowedOf(existing && existing.allowedChannels).filter((c) => ids.has(c.id)),
            status: STATUS.CONNECTED,
            brokenReason: '',
            brokenAt: null,
        });
    }
    const handles = { ...((existing && existing.secretHandles) || {}) };
    const setAt = { ...((existing && existing.secretSetAt) || {}) };
    for (const [key, value] of [['bot_token', token], ['signing_secret', signing]]) {
        if (!value) continue;
        // eslint-disable-next-line no-await-in-loop
        handles[key] = await keep({ companyId, handle: handles[key], key, value, actor });
        setAt[key] = new Date();
    }
    Object.assign(set, { secretHandles: handles, secretSetAt: setAt });
    const saved = existing
        ? await update(companyId, existing, { $set: set })
        : plain(await MongoDbCrudOpration(companyId, { type: T, data: { _id: new mongoose.Types.ObjectId(), connector: CONNECTOR, ...set, createdBy: set.updatedBy, deletedStatusKey: 0 } }, 'save'));
    audit(companyId, actor, 'connector.connect', { secrets: [token ? 'bot_token' : '', signing ? 'signing_secret' : ''].filter(Boolean), team: set.team ? set.team.id : undefined });
    return view(saved);
};

/* Removing the bot token ends the connection: the channel list and the allow-list go with it. */
const removeSecret = async (companyId, key, actor) => {
    if (!SECRET_KEYS.includes(String(key))) throw new ConnectionError(400, 'Unknown secret.', 'unknown_secret');
    const existing = await find(companyId);
    const handle = existing && existing.secretHandles && existing.secretHandles[key];
    if (!handle) throw new ConnectionError(404, 'Nothing is set.', 'not_set');
    await store.retire({ companyId, handle, actor });
    const handles = { ...existing.secretHandles };
    const setAt = { ...(existing.secretSetAt || {}) };
    delete handles[key];
    delete setAt[key];
    const gone = key === 'bot_token' ? { channels: [], allowedChannels: [], team: null, status: STATUS.CONNECTED, brokenReason: '', brokenAt: null } : {};
    const saved = await update(companyId, existing, { $set: { secretHandles: handles, secretSetAt: setAt, updatedBy: String(actorOf(actor).id || ''), ...gone } });
    audit(companyId, actor, 'connector.revoke', { secrets: [key] });
    return view(saved);
};

const markBroken = async (companyId, row, reason) => {
    await update(companyId, row, { $set: { status: STATUS.BROKEN, brokenReason: String(reason || '').slice(0, 60), brokenAt: new Date() } });
    audit(companyId, null, 'connector.broken', { reason: String(reason || '').slice(0, 60) });
};

/* The token for one call. A connection Slack already refused is not tried again until its token is replaced. */
const tokenFor = async (companyId) => {
    const row = await find(companyId);
    const handle = row && row.secretHandles && row.secretHandles.bot_token;
    if (!handle) return { row, token: null, reason: 'not_connected' };
    if (row.status === STATUS.BROKEN) return { row, token: null, reason: 'broken' };
    const token = await store.resolve({ companyId, handle }).catch(() => null);
    return token ? { row, token, reason: '' } : { row, token: null, reason: 'token_unavailable' };
};

const refreshChannels = async (companyId, actor) => {
    const { row, token, reason } = await tokenFor(companyId);
    if (!token) throw new ConnectionError(409, reason === 'broken' ? 'Slack refused the stored token. Replace it first.' : 'Slack is not connected.', reason);
    const listed = await listChannels({ companyId, actor, token });
    if (!listed.ok) {
        if (api.isTokenError(listed.error)) await markBroken(companyId, row, listed.error);
        throw new ConnectionError(api.isTokenError(listed.error) ? 409 : 502, `Slack did not list its channels (${listed.error}${listed.detail ? `: ${listed.detail}` : ''}).`, listed.error);
    }
    const ids = new Set(listed.channels.map((c) => c.id));
    const saved = await update(companyId, row, { $set: {
        channels: listed.channels, channelsFetchedAt: new Date(), updatedBy: String(actorOf(actor).id || ''),
        allowedChannels: allowedOf(row.allowedChannels).filter((c) => ids.has(c.id)),
    } });
    return view(saved);
};

/* A bare id, as the first version of the screen sent it, allows posting only. */
const wantedChannels = (input) => {
    const invalid = () => new ConnectionError(400, 'channels must be a list of { id, read, post }.', 'invalid_channels');
    if (!Array.isArray(input)) throw invalid();
    const wanted = new Map();
    input.forEach((entry) => {
        const given = typeof entry === 'string' ? { id: entry, read: false, post: true } : entry;
        if (!given || typeof given !== 'object' || typeof given.id !== 'string' || typeof given.read !== 'boolean' || typeof given.post !== 'boolean') throw invalid();
        wanted.set(given.id, { id: given.id, read: given.read, post: given.post });
    });
    return [...wanted.values()].filter((c) => c.read || c.post);
};

/* Only channels Slack listed for this token can be allowed, and the stored name is Slack's, not the caller's. */
const setAllowedChannels = async (companyId, input, actor) => {
    const wanted = wantedChannels(input);
    if (wanted.length > MAX_ALLOWED) throw new ConnectionError(400, `At most ${MAX_ALLOWED} channels can be allowed.`, 'too_many_channels');
    const row = await find(companyId);
    if (!row || !(row.secretHandles && row.secretHandles.bot_token)) throw new ConnectionError(409, 'Slack is not connected.', 'not_connected');
    const known = new Map(channelsOf(row.channels).map((c) => [c.id, c]));
    if (wanted.some((c) => !known.has(c.id))) throw new ConnectionError(400, 'A channel that is not in the list Slack gave cannot be allowed. Refresh the list first.', 'unknown_channel');
    const allowedChannels = wanted.map((c) => ({ id: c.id, name: known.get(c.id).name, read: c.read, post: c.post }));
    const saved = await update(companyId, row, { $set: { allowedChannels, updatedBy: String(actorOf(actor).id || '') } });
    const idsWith = (use) => allowedChannels.filter((c) => c[use]).map((c) => c.id);
    audit(companyId, actor, 'connector.channels_set', { channels: allowedChannels.map((c) => c.id), read: idsWith('read'), post: idsWith('post') });
    return view(saved);
};

const USE = Object.freeze({ READ: 'read', POST: 'post' });

/* The channels allowed for every use named, by name. */
const channelsFor = (row, uses) => allowedOf(row && row.allowedChannels)
    .filter((c) => uses.every((use) => c[use]))
    .sort((a, b) => a.name.localeCompare(b.name));

/* The allowed channel a reference names: its id, or its name with or without the #. */
const allowedChannel = (row, ref, uses = [USE.POST]) => {
    const text = String(ref || '').trim();
    const list = channelsFor(row, uses);
    return list.find((c) => c.id === text) || list.find((c) => c.name.toLowerCase() === text.replace(/^#/, '').toLowerCase()) || null;
};

const notePosted = (companyId, row) => update(companyId, row, { $set: { lastPostAt: new Date() } });
const noteRead = (companyId, row) => update(companyId, row, { $set: { lastReadAt: new Date() } });

module.exports = { CONNECTOR, SECRET_KIND, SECRET_KEYS, STATUS, MAX_ALLOWED, ConnectionError, find, view, describe, saveSecrets, removeSecret, refreshChannels, setAllowedChannels, tokenFor, markBroken, USE, channelsFor, allowedChannel, notePosted, noteRead };
