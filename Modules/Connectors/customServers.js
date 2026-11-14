const mongoose = require('mongoose');
const { SCHEMA_TYPE } = require('../../Config/schemaType');
const { MongoDbCrudOpration } = require('../../utils/mongo-handler/mongoQueries');
const secrets = require('../../Config/secrets');
const logger = require('../../Config/loggerConfig');
const { recordAudit } = require('../Audit/recorder');
const socketEmitter = require('../../event/socketEventEmitter');
const egressContext = require('../Agents/engine/egressContext');
const fetcher = require('../Agents/engine/safeFetch');
const egressRules = require('../Agents/engine/egressRules');
const customFlag = require('./customFlag');
const mcpAuth = require('./mcpAuth');

/* A workspace's own MCP server, added by its address by someone holding "Add custom apps" (task 096). It is a
 * provider like any other, `custom_<row id>`, whose definition is built from its row instead of a file under
 * providers/; members connect their own accounts to it through the generic connect routes. */

const T = SCHEMA_TYPE.CONNECTOR_SERVERS;
const PREFIX = 'custom_';
const PROVIDER = /^custom_([a-f0-9]{24})$/;
const OBJECT_ID = /^[a-f0-9]{24}$/;
const SIGN_IN = Object.freeze({ SELF_REGISTER: 'self_register', REGISTERED_APP: 'registered_app', PERSONAL_TOKEN: 'personal_token' });
const STATUS = Object.freeze({ ACTIVE: 'active', NEEDS_APP: 'needs_app' });
const PRODUCT = 'server';
const NAME_MAX = 80;
const URL_MAX = 500;
const MAX_CLIENT_ID = 400;
const SECRET_KIND = 'connector_app';
const AUTH_KEYS = Object.freeze(['authorizeUrl', 'tokenUrl', 'revokeUrl', 'pkce', 'registration', 'registrationUrl']);
// A server that publishes no sign-in metadata, or metadata without both addresses, takes members' own tokens.
const TOKEN_ONLY = Object.freeze(['no_metadata', 'no_endpoints']);
const PERSONAL_ACCOUNT = 'personal_token';
const ACCOUNT_IDS = Object.freeze(['sub', 'user_id', 'account_id', 'id']);
const ACCOUNT_LABELS = Object.freeze(['email', 'name', 'login', 'username']);
const EGRESS_ATTEMPTS = 3;
const EGRESS_ACTION = 'agent.egress_allowlist';

class ServerError extends Error {
    constructor(status, code, message) { super(message); this.name = 'ServerError'; this.status = status; this.code = code; }
}

const plain = (doc) => (doc && typeof doc.toObject === 'function' ? doc.toObject() : doc);
const db = (companyId, data, method) => MongoDbCrudOpration(String(companyId), { type: T, data }, method);
const actorIdOf = (actor) => String((actor && typeof actor === 'object' ? actor.id : actor) || 'system');

const isCustomId = (provider) => PROVIDER.test(String(provider || ''));
const serverIdOf = (provider) => (PROVIDER.exec(String(provider || '')) || [])[1] || '';
const providerOf = (serverId) => `${PREFIX}${serverId}`;

const findRow = async (companyId, serverId) => (OBJECT_ID.test(String(serverId || ''))
    ? plain(await db(companyId, [{ _id: String(serverId), companyId: String(companyId) }], 'findOne'))
    : null);
const rowsOf = async (companyId) => ((await db(companyId, [{ companyId: String(companyId) }, null, { sort: { createdAt: 1 } }], 'find')) || []).map(plain);

const deepFreeze = (value) => {
    if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
    Object.freeze(value);
    Object.values(value).forEach(deepFreeze);
    return value;
};

const firstOf = (body, keys, max) => {
    const found = keys.map((key) => body && body[key]).find((value) => (typeof value === 'string' && value.trim()) || Number.isFinite(value));
    return found === undefined ? '' : String(found).trim().slice(0, max);
};

/* Most servers' token answers name nobody, so a connection falls back to one account per member: reconnecting then
 * replaces the tokens rather than revoking an account it cannot tell apart. */
const accountOfAnswer = ({ tokenResponse }) => ({ id: firstOf(tokenResponse, ACCOUNT_IDS, 200) || 'account', label: firstOf(tokenResponse, ACCOUNT_LABELS, 254) });

/* A pasted token is checked with one listing of the server's tools; the server names no account for it. */
const checkToken = async (definition, { companyId, actor, token }) => {
    try {
        await egressContext.run(
            { companyId: String(companyId), actor: String(actor || '') },
            () => require('./mcpClient').listTools({ provider: definition.id, url: definition.mcp.url, hosts: definition.egressHosts, token }),
        );
        return { ok: true, account: { id: PERSONAL_ACCOUNT, label: '' } };
    } catch (e) {
        return { ok: false, error: 'token_refused' };
    }
};

const definitionOf = (row) => {
    const personal = row.signIn === SIGN_IN.PERSONAL_TOKEN;
    const auth = personal ? { personalToken: true } : Object.fromEntries(AUTH_KEYS.filter((key) => row.auth && row.auth[key]).map((key) => [key, String(row.auth[key])]));
    const definition = {
        id: providerOf(row._id),
        name: String(row.name),
        custom: true,
        serverId: String(row._id),
        signIn: row.signIn,
        status: row.status,
        signIns: personal ? ['token'] : ['oauth'],
        transport: 'mcp',
        mcp: { url: String(row.url) },
        auth,
        products: { [PRODUCT]: personal ? [] : [...(row.scopes || [])] },
        readAccount: accountOfAnswer,
        egressHosts: [...(row.hosts || [])],
    };
    if (personal) definition.checkToken = (args) => checkToken(definition, args);
    return deepFreeze(definition);
};

const definitionFor = async (companyId, provider) => {
    const row = isCustomId(provider) ? await findRow(companyId, serverIdOf(provider)) : null;
    return row ? definitionOf(row) : null;
};

const isOffered = async (companyId, provider) => {
    if (!isCustomId(provider) || !customFlag.on()) return false;
    const row = await findRow(companyId, serverIdOf(provider));
    return Boolean(row) && row.status === STATUS.ACTIVE;
};

/* The servers members may connect to now: none while custom apps are switched off. */
const offered = async (companyId) => (customFlag.on() ? (await rowsOf(companyId)).filter((row) => row.status === STATUS.ACTIVE).map(definitionOf) : []);

/* Every server the workspace has, switched on or not, so a departed member's connections to them still end. */
const providerIds = async (companyId) => (await rowsOf(companyId)).map((row) => providerOf(row._id));

const nameOf = (value) => {
    // eslint-disable-next-line no-control-regex
    const text = typeof value === 'string' ? value.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim() : '';
    if (!text || text.length > NAME_MAX) throw new ServerError(400, 'bad_name', `Give the app a name of at most ${NAME_MAX} characters.`);
    return text;
};

const addressOf = (value) => {
    const text = typeof value === 'string' ? value.trim() : '';
    const bad = () => new ServerError(400, 'bad_address', 'Give the server\'s full address, starting with https://.');
    if (!text || text.length > URL_MAX) throw bad();
    let url;
    try { url = new URL(text); } catch (e) { throw bad(); }
    if (url.protocol !== 'https:') throw new ServerError(400, 'not_https', 'The address must start with https://, so what is sent to the server stays private on the way.');
    if (url.username || url.password) throw new ServerError(400, 'bad_address', 'An address with a name or password in it is not accepted.');
    url.hash = '';
    return url;
};

const privateHost = (host) => new ServerError(400, 'private_address', `${host} is a private, local or internal address, so AlianHub does not connect to it.`);

/* Every host the server and its sign-in name is judged by the address it resolves to now; safeFetch judges it again
 * on every later call, so a name that moves to a private address afterwards is refused then too. */
const checkHost = async (host) => {
    if (fetcher.isBlockedHostname(host)) throw privateHost(host);
    const { reason } = egressRules.parseEntry(host, { isBlockedHostname: fetcher.isBlockedHostname });
    if (reason === egressRules.REASON.PRIVATE) throw privateHost(host);
    if (reason) throw new ServerError(400, 'not_a_host_name', `${host} is not a host name AlianHub can connect to. Use the server's name rather than a numeric address.`);
    try {
        await fetcher.resolvePublic(`https://${host}/`);
    } catch (error) {
        if (error && error.code === 'dns_failed') throw new ServerError(400, 'not_found', `${host} could not be found. Check the address.`);
        throw privateHost(host);
    }
};

const announce = (companyId, change, serverId) => {
    socketEmitter.emit('update', {
        type: 'update', module: 'connector', companyId: String(companyId),
        data: { change, provider: providerOf(serverId) },
        actor: { kind: 'person' }, depth: 1,
    });
};

const audit = (companyId, actor, action, row, meta = {}) => recordAudit(String(companyId), {
    actorId: actorIdOf(actor), ...(actor && actor.ip ? { ip: String(actor.ip) } : {}),
    action, entityType: 'connector', entityId: providerOf(row._id), entityName: String(row.name), meta: { serverId: String(row._id), ...meta },
});

const egressStore = () => require('../Agents/engine/egressAllowlist');
const listedHosts = (doc) => (doc && Array.isArray(doc.hosts) ? doc.hosts.map(String) : []);

/* With the workspace gateway on and a host list in use, the server's hosts go on it so its members' calls are not
 * refused. An empty list already admits every public host, and listing these would shut out the rest, so it stays
 * empty. Only the hosts added here are remembered, to be taken off again with the server. */
const listHosts = async (companyId, hosts, actor, row) => {
    if (!egressContext.isOn()) return [];
    const store = egressStore();
    for (let attempt = 0; attempt < EGRESS_ATTEMPTS; attempt += 1) {
        // eslint-disable-next-line no-await-in-loop
        const doc = await store.readList(String(companyId));
        const current = listedHosts(doc);
        if (!current.length) return [];
        const added = hosts.filter((host) => !egressRules.hostMatches(current, host, 443));
        if (!added.length) return [];
        const { hosts: next, errors } = egressRules.validateHosts([...current, ...added], { isBlockedHostname: fetcher.isBlockedHostname });
        if (errors.length) throw new ServerError(409, 'egress_full', 'The workspace\'s list of reachable sites is full, so this app\'s hosts cannot be added to it. Ask the instance owner to make room.');
        // eslint-disable-next-line no-await-in-loop
        const saved = await store.replaceHosts(String(companyId), next, actorIdOf(actor), store.versionOf(doc));
        if (saved) {
            recordAudit(String(companyId), {
                actorId: actorIdOf(actor), action: EGRESS_ACTION, entityType: 'company', entityId: String(companyId), entityName: String(row.name),
                meta: { added, removed: [], count: next.length, via: 'custom_app' },
            });
            return added;
        }
    }
    throw new ServerError(409, 'egress_busy', 'The workspace\'s list of reachable sites changed while saving. Try again.');
};

const unlistHosts = async (companyId, row, actor) => {
    const mine = Array.isArray(row.egressAdded) ? row.egressAdded : [];
    if (!egressContext.isOn() || !mine.length) return;
    const stillNamed = (await rowsOf(companyId)).filter((other) => String(other._id) !== String(row._id)).flatMap((other) => other.hosts || []);
    const drop = mine.filter((host) => !stillNamed.includes(host));
    if (!drop.length) return;
    const store = egressStore();
    for (let attempt = 0; attempt < EGRESS_ATTEMPTS; attempt += 1) {
        // eslint-disable-next-line no-await-in-loop
        const doc = await store.readList(String(companyId));
        const current = listedHosts(doc);
        const next = current.filter((host) => !drop.includes(host));
        // An emptied list would admit every public host, so the last hosts stay rather than open it.
        if (next.length === current.length || !next.length) return;
        // eslint-disable-next-line no-await-in-loop
        if (await store.replaceHosts(String(companyId), next, actorIdOf(actor), store.versionOf(doc))) {
            recordAudit(String(companyId), {
                actorId: actorIdOf(actor), action: EGRESS_ACTION, entityType: 'company', entityId: String(companyId), entityName: String(row.name),
                meta: { added: [], removed: current.filter((host) => drop.includes(host)), count: next.length, via: 'custom_app' },
            });
            return;
        }
    }
    logger.error(`[connectors] the hosts of a removed custom app stayed on the workspace list of ${companyId}: it kept changing`);
};

const isDuplicate = (error) => Boolean(error) && (error.code === 11000 || /E11000|duplicate key/i.test(String(error.message || '')));

/* A server that registers clients itself is ready at once; one that needs a registered app waits for its client id
 * and secret, since the callback to register names the new row; one with no sign-in metadata takes members' tokens. */
const add = async ({ companyId, actor, name, url: given }) => {
    const label = nameOf(name);
    const url = addressOf(given);
    await checkHost(url.hostname);
    if ((await rowsOf(companyId)).some((row) => row.url === url.href)) throw new ServerError(409, 'server_exists', 'This workspace already has a custom app at that address.');
    const found = await mcpAuth.discover({ url: url.href, companyId, actor: actorIdOf(actor), unlisted: true });
    let fields;
    if (found.ok) {
        const selfRegisters = found.auth.registration === 'dynamic';
        fields = {
            signIn: selfRegisters ? SIGN_IN.SELF_REGISTER : SIGN_IN.REGISTERED_APP,
            status: selfRegisters ? STATUS.ACTIVE : STATUS.NEEDS_APP,
            auth: Object.fromEntries(AUTH_KEYS.filter((key) => found.auth[key]).map((key) => [key, found.auth[key]])),
            scopes: found.scopes,
            hosts: [...new Set([url.hostname, ...found.hosts])],
        };
    } else if (TOKEN_ONLY.includes(found.error)) {
        fields = { signIn: SIGN_IN.PERSONAL_TOKEN, status: STATUS.ACTIVE, auth: {}, scopes: [], hosts: [url.hostname] };
    } else {
        throw new ServerError(400, 'sign_in_not_https', 'The server names a sign-in address that does not start with https://, so it cannot be added.');
    }
    for (const host of fields.hosts.filter((h) => h !== url.hostname)) {
        // eslint-disable-next-line no-await-in-loop
        await checkHost(host);
    }
    const now = new Date();
    const row = {
        _id: new mongoose.Types.ObjectId(), companyId: String(companyId), name: label, url: url.href, ...fields,
        clientId: '', secretHandle: '', addedBy: actorIdOf(actor), createdAt: now, updatedAt: now,
    };
    try {
        await db(companyId, row, 'save');
    } catch (error) {
        if (isDuplicate(error)) throw new ServerError(409, 'server_exists', 'This workspace already has a custom app at that address.');
        throw error;
    }
    const saved = { ...row, _id: String(row._id) };
    const listed = await listHosts(companyId, fields.hosts, actor, saved).catch(async (error) => {
        await db(companyId, [{ _id: saved._id }], 'deleteOne');
        throw error;
    });
    if (listed.length) await db(companyId, [{ _id: saved._id }, { $set: { egressAdded: listed } }], 'updateOne');
    audit(companyId, actor, 'connector.server_added', saved, { signIn: fields.signIn, hosts: fields.hosts });
    announce(companyId, 'server_added', saved._id);
    return { ...saved, egressAdded: listed };
};

/* Connections a changed app can no longer refresh are sent back through connect, as a company app's are (FR-6). */
const markReauth = (companyId, row) => MongoDbCrudOpration(String(companyId), {
    type: SCHEMA_TYPE.CONNECTOR_CONNECTIONS,
    data: [{ provider: providerOf(row._id), status: 'connected', signIn: SIGN_IN.REGISTERED_APP, deletedStatusKey: { $ne: 1 } }, { $set: { status: 'reauth_required' } }],
}, 'updateMany');

const setApp = async (companyId, row, { clientId, clientSecret }, actor) => {
    if (row.signIn !== SIGN_IN.REGISTERED_APP) throw new ServerError(409, 'no_app_needed', 'This app signs people in without a registered app of yours.');
    const id = typeof clientId === 'string' ? clientId.trim() : '';
    const secret = typeof clientSecret === 'string' ? clientSecret.trim() : '';
    if (!id || id.length > MAX_CLIENT_ID) throw new ServerError(400, 'bad_client_id', `Give the client ID the app's sign-in gave you, at most ${MAX_CLIENT_ID} characters.`);
    if (!secret || secret.length > secrets.MAX_VALUE_LENGTH) throw new ServerError(400, 'bad_client_secret', 'Give the client secret the app\'s sign-in gave you.');
    const who = { id: actorIdOf(actor) };
    const secretHandle = row.secretHandle
        ? (await secrets.rotate({ companyId: String(companyId), handle: row.secretHandle, value: secret, actor: who })).handle
        : (await secrets.create({ companyId: String(companyId), name: `${row.name} custom app client`, kind: SECRET_KIND, value: secret, actor: who })).handle;
    const replacing = Boolean(row.clientId);
    if (replacing) await markReauth(companyId, row);
    return { clientId: id, secretHandle, status: STATUS.ACTIVE, op: replacing ? 'replace' : 'set' };
};

const update = async ({ companyId, row, actor, name, clientId, clientSecret }) => {
    const set = {};
    const meta = {};
    if (name !== undefined) { set.name = nameOf(name); meta.renamed = true; }
    if (clientId !== undefined || clientSecret !== undefined) {
        const { op, ...app } = await setApp(companyId, row, { clientId, clientSecret }, actor);
        Object.assign(set, app);
        meta.app = op;
    }
    if (!Object.keys(set).length) throw new ServerError(400, 'nothing_to_change', 'Nothing was given to change.');
    const saved = plain(await db(companyId, [{ _id: String(row._id), companyId: String(companyId) }, { $set: { ...set, updatedBy: actorIdOf(actor), updatedAt: new Date() } }, { returnDocument: 'after' }], 'findOneAndUpdate'));
    audit(companyId, actor, 'connector.server_changed', saved || row, meta);
    announce(companyId, 'server_changed', row._id);
    return saved;
};

/* Every connection to the server ends first, while its definition can still revoke them; then its secrets, its
 * sign-up, its reviewed tools and the row go. A failure on one connection never keeps the others alive. */
const remove = async ({ companyId, row, actor }) => {
    const connection = require('./connection');
    const provider = providerOf(row._id);
    const open = ((await MongoDbCrudOpration(String(companyId), { type: SCHEMA_TYPE.CONNECTOR_CONNECTIONS, data: [{ provider, deletedStatusKey: { $ne: 1 } }] }, 'find')) || []).map(plain);
    let ended = 0;
    for (const conn of open) {
        try {
            // eslint-disable-next-line no-await-in-loop
            await connection.endOne({ companyId: String(companyId), row: conn, actor, by: connection.BY.SERVER_REMOVED });
            ended += 1;
        } catch (error) {
            logger.error(`[connectors] a connection to a removed custom app did not end cleanly: ${(error && error.name) || 'Error'}`);
        }
    }
    const who = { id: actorIdOf(actor) };
    if (row.secretHandle) await secrets.retire({ companyId: String(companyId), handle: row.secretHandle, actor: who }).catch(() => {});
    await require('./registrations').forget({ companyId: String(companyId), definition: definitionOf(row), actor: who.id }).catch(() => false);
    await MongoDbCrudOpration(String(companyId), { type: SCHEMA_TYPE.CONNECTOR_TOOLS, data: [{ companyId: String(companyId), provider }] }, 'deleteMany');
    await db(companyId, [{ _id: String(row._id), companyId: String(companyId) }], 'deleteOne');
    await unlistHosts(companyId, row, actor).catch((error) => logger.error(`[connectors] the hosts of a removed custom app were not taken off the list: ${(error && error.name) || 'Error'}`));
    audit(companyId, actor, 'connector.server_removed', row, { ended });
    announce(companyId, 'server_removed', row._id);
    return { serverId: String(row._id), ended };
};

module.exports = {
    SIGN_IN, STATUS, PREFIX, PRODUCT, ServerError,
    isCustomId, serverIdOf, providerOf, findRow, rowsOf, definitionOf, definitionFor, isOffered, offered, providerIds,
    add, update, remove, checkHost,
};
