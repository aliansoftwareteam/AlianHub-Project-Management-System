const crypto = require('crypto');
const { SCHEMA_TYPE } = require('./schemaType');
const logger = require('./loggerConfig');

/*
 * Sprint 8 slice 9: per-company secrets referenced by handle. A value is AES-256-GCM ciphertext under a key
 * derived from SECRETS_KEY, bound to its company and handle through the authenticated data, so a row copied
 * into another company's database or under another handle will not open. Each row records the id of the key
 * that sealed it; SECRETS_KEY_PREVIOUS keeps old rows readable while `npm run secrets:reencrypt` moves them.
 */

const LOG = '[secrets]';
const FLAG_ON = ['true', '1', 'on', 'yes'];
const MIN_KEY_LENGTH = 32;
const MAX_NAME_LENGTH = 120;
const MAX_KIND_LENGTH = 60;
const MAX_VALUE_LENGTH = 8192;
const HANDLE = /^sec_[a-f0-9]{24}$/;
const OBJECT_ID = /^[a-f0-9]{24}$/i;
const ERROR_LOG_INTERVAL_MS = 60 * 1000;
const IV_BYTES = 12;
const TAG_BYTES = 16;
const RESOLVE_FAILED_AUDIT_INTERVAL_MS = 60 * 60 * 1000;
const RESOLVE_FAILED_TRACKED = 5000;
const STATUS_BY_CODE = { store_off: 404, key_invalid: 503, invalid_input: 400, not_found: 404, revoked: 409 };
const READ_KIND = 'skill_read';
const MAX_READ_HOSTS = 20;
const HEADER_NAME = /^[a-z0-9][a-z0-9-]{0,63}$/;
// Headers the transport or the read itself sets, so a credential can never replace them.
const RESERVED_HEADERS = ['host', 'content-length', 'content-type', 'transfer-encoding', 'connection', 'keep-alive', 'upgrade', 'te', 'trailer', 'proxy-connection', 'user-agent', 'accept', 'accept-encoding', 'cookie'];

class SecretsStoreError extends Error {
    constructor(code, message) {
        super(message);
        this.name = 'SecretsStoreError';
        this.code = code;
        this.statusCode = STATUS_BY_CODE[code] || 500;
    }
}

const derived = new Map();
const derivedKey = (material) => {
    if (!derived.has(material)) derived.set(material, crypto.scryptSync(material, 'alianhub-secrets-store', 32));
    return derived.get(material);
};

/* The id is shown to admins, audited and logged, so it comes from the scrypt output: testing a guessed
 * SECRETS_KEY against it costs a full key stretch, where a plain hash of the key would cost one SHA-256. */
const keyIdOf = (key) => `k${crypto.createHmac('sha256', derivedKey(key)).update('alianhub-secrets-key-id').digest('hex').slice(0, 16)}`;

/* Rows written before that carry a plain hash of the key; it is only ever compared, never shown or written. */
const plainHashKeyIdOf = (key) => `k${crypto.createHash('sha256').update(`alianhub-secrets-key-id:${key}`).digest('hex').slice(0, 16)}`;

const keyProblem = (key) => (key ? (key.length >= MIN_KEY_LENGTH ? '' : `shorter than ${MIN_KEY_LENGTH} characters`) : 'missing');

const storeConfig = (env = process.env) => {
    const requested = FLAG_ON.includes(String(env.SECRETS_STORE || '').trim().toLowerCase());
    const key = String(env.SECRETS_KEY || '');
    const previous = String(env.SECRETS_KEY_PREVIOUS || '');
    const problem = keyProblem(key);
    const keyValid = !problem;
    const previousValid = previous.length >= MIN_KEY_LENGTH;
    const error = requested && !keyValid
        ? `SECRETS_STORE is on but SECRETS_KEY is ${problem}, so the secrets store refuses every read and write until a key of at least ${MIN_KEY_LENGTH} characters is set`
        : '';
    return { requested, on: requested && keyValid, keyValid, keyId: keyValid ? keyIdOf(key) : '', previousKeyId: previousValid ? keyIdOf(previous) : '', error };
};

let lastErrorLoggedAt = 0;

const config = () => {
    const cfg = storeConfig();
    if (cfg.error && Date.now() - lastErrorLoggedAt >= ERROR_LOG_INTERVAL_MS) {
        lastErrorLoggedAt = Date.now();
        logger.error(`${LOG} ${cfg.error}`);
    }
    return cfg;
};

const isOn = () => config().on;

const logBootState = () => {
    lastErrorLoggedAt = 0;
    const cfg = config();
    if (cfg.on) logger.info(`${LOG} secrets store on: integration and webhook secrets are kept by handle under key ${cfg.keyId}${cfg.previousKeyId ? `, reading ${cfg.previousKeyId} too` : ''}`);
};

const idsOf = (key) => (String(key || '').length >= MIN_KEY_LENGTH ? [keyIdOf(String(key)), plainHashKeyIdOf(String(key))] : []);

/* The key material for a recorded key id, read from the environment at call time and never kept on the config. */
const keyMaterial = (keyId, env = process.env) => [env.SECRETS_KEY, env.SECRETS_KEY_PREVIOUS]
    .map((key) => String(key || ''))
    .find((key) => idsOf(key).includes(keyId)) || '';

const boundTo = (companyId, handle) => Buffer.from(`${companyId}:${handle}`, 'utf8');

const seal = ({ material, companyId, handle, value }) => {
    const iv = crypto.randomBytes(IV_BYTES);
    const cipher = crypto.createCipheriv('aes-256-gcm', derivedKey(material), iv, { authTagLength: TAG_BYTES });
    cipher.setAAD(boundTo(companyId, handle));
    const body = Buffer.concat([cipher.update(String(value), 'utf8'), cipher.final()]);
    return { iv: iv.toString('base64'), tag: cipher.getAuthTag().toString('base64'), ciphertext: body.toString('base64') };
};

/* Without authTagLength Node verifies whatever tag length a row carries, down to 4 bytes, which anyone who
 * can write the row could forge by trial. */
const open = ({ material, companyId, handle, iv, tag, ciphertext }) => {
    try {
        const ivBytes = Buffer.from(String(iv), 'base64');
        const tagBytes = Buffer.from(String(tag), 'base64');
        if (ivBytes.length !== IV_BYTES || tagBytes.length !== TAG_BYTES) return null;
        const decipher = crypto.createDecipheriv('aes-256-gcm', derivedKey(material), ivBytes, { authTagLength: TAG_BYTES });
        decipher.setAAD(boundTo(companyId, handle));
        decipher.setAuthTag(tagBytes);
        return Buffer.concat([decipher.update(Buffer.from(String(ciphertext), 'base64')), decipher.final()]).toString('utf8');
    } catch (error) {
        return null;
    }
};

const invalid = (message) => new SecretsStoreError('invalid_input', message);

const companyOf = (companyId) => {
    const id = String(companyId || '');
    if (!OBJECT_ID.test(id)) throw invalid('A company id is required.');
    return id;
};

const textOf = (value, max, field) => {
    const text = typeof value === 'string' ? value.trim() : '';
    if (!text) throw invalid(`A ${field} is required.`);
    if (text.length > max) throw invalid(`The ${field} is longer than ${max} characters.`);
    return text;
};

const valueOf = (value) => {
    const text = typeof value === 'string' ? value.trim() : '';
    if (!text) throw invalid('A secret value is required.');
    if (text.length > MAX_VALUE_LENGTH) throw invalid(`The secret value is longer than ${MAX_VALUE_LENGTH} characters.`);
    return text;
};

const requireKey = () => {
    const cfg = config();
    if (!cfg.keyValid) throw new SecretsStoreError('key_invalid', cfg.error || `The secrets store has no usable SECRETS_KEY: it is ${keyProblem(String(process.env.SECRETS_KEY || ''))}.`);
    return cfg;
};

const requireOn = () => {
    const cfg = config();
    if (!cfg.requested) throw new SecretsStoreError('store_off', 'The secrets store is off (SECRETS_STORE).');
    return requireKey();
};

const db = (companyId, data, method) => {
    const { MongoDbCrudOpration } = require('../utils/mongo-handler/mongoQueries');
    return MongoDbCrudOpration(String(companyId), { type: SCHEMA_TYPE.SECRETS, data }, method);
};

const plain = (doc) => (doc && typeof doc.toObject === 'function' ? doc.toObject() : doc);

const actorOf = (actor) => (actor && typeof actor === 'object' ? actor : { id: actor });

const audit = (companyId, actor, entry) => {
    const { recordAudit } = require('../Modules/Audit/recorder');
    const who = actorOf(actor);
    recordAudit(companyId, {
        actorId: String(who.id || 'system'),
        actorName: String(who.name || ''),
        ...(who.ip ? { ip: String(who.ip) } : {}),
        entityType: 'secret',
        ...entry,
    });
};

const metadata = (row) => ({
    handle: row.handle,
    name: row.name,
    kind: row.kind,
    keyId: row.keyId,
    createdBy: row.createdBy,
    createdAt: row.createdAt,
    rotatedAt: row.rotatedAt || null,
    revokedAt: row.revokedAt || null,
    lastResolvedAt: row.lastResolvedAt || null,
    ...(Array.isArray(row.hosts) ? { hosts: [...row.hosts] } : {}),
    ...(row.header ? { header: row.header } : {}),
});

/* A skill_read secret names the exact hosts it may be sent to; no other kind carries any. `undefined` leaves a
 * rotate's binding as it was. */
const hostsOf = (kind, hosts, { required }) => {
    if (kind !== READ_KIND) {
        if (hosts !== undefined) throw invalid(`Only a ${READ_KIND} secret names the hosts it is sent to.`);
        return undefined;
    }
    if (hosts === undefined && !required) return undefined;
    if (!Array.isArray(hosts) || !hosts.length) throw invalid('Name at least one host this secret may be sent to.');
    if (hosts.length > MAX_READ_HOSTS) throw invalid(`A secret names at most ${MAX_READ_HOSTS} hosts.`);
    const { parseDeclaredHost, hostProblem } = require('../Modules/Agents/skills/externalReads');
    const out = [];
    for (const raw of hosts) {
        const { entry, reason } = parseDeclaredHost(raw);
        if (!entry) throw invalid(`"${String(raw).slice(0, 100)}" ${hostProblem(reason)}.`);
        if (!out.includes(entry.text)) out.push(entry.text);
    }
    return out;
};

const headerOf = (kind, header) => {
    if (header === undefined || header === null || header === '') return undefined;
    if (kind !== READ_KIND) throw invalid(`Only a ${READ_KIND} secret names a header.`);
    const name = typeof header === 'string' ? header.trim().toLowerCase() : '';
    if (!HEADER_NAME.test(name)) throw invalid('A header name is letters, digits and dashes, up to 64 characters.');
    if (RESERVED_HEADERS.includes(name)) throw invalid(`A credential cannot be sent as the ${name} header.`);
    return name === 'authorization' ? undefined : name;
};

const bindingMeta = (row) => (Array.isArray(row.hosts) ? { hosts: [...row.hosts], ...(row.header ? { header: row.header } : {}) } : {});

const findRow = async (companyId, handle) => {
    const id = String(handle || '');
    if (!HANDLE.test(id)) return null;
    return plain(await db(companyId, [{ handle: id }], 'findOne'));
};

const requireRow = async (companyId, handle) => {
    const row = await findRow(companyId, handle);
    if (!row) throw new SecretsStoreError('not_found', 'No such secret in this company.');
    if (row.revokedAt) throw new SecretsStoreError('revoked', 'This secret is revoked.');
    return row;
};

async function create({ companyId, name, kind, value, actor, hosts, header }) {
    const cfg = requireOn();
    const id = companyOf(companyId);
    const kindText = textOf(kind, MAX_KIND_LENGTH, 'kind');
    const boundHosts = hostsOf(kindText, hosts, { required: true });
    const boundHeader = headerOf(kindText, header);
    const row = {
        handle: `sec_${crypto.randomBytes(12).toString('hex')}`,
        name: textOf(name, MAX_NAME_LENGTH, 'name'),
        kind: kindText,
        keyId: cfg.keyId,
        createdBy: String(actorOf(actor).id || ''),
        createdAt: new Date(),
        rotatedAt: null,
        revokedAt: null,
        lastResolvedAt: null,
        ...(boundHosts ? { hosts: boundHosts } : {}),
        ...(boundHeader ? { header: boundHeader } : {}),
    };
    Object.assign(row, seal({ material: keyMaterial(cfg.keyId), companyId: id, handle: row.handle, value: valueOf(value) }));
    const saved = plain(await db(id, row, 'save')) || row;
    audit(id, actor, { action: 'secret.create', entityId: row.handle, entityName: row.name, meta: { kind: row.kind, keyId: cfg.keyId, ...bindingMeta(row) } });
    return metadata(saved);
}

/* A webhook whose secret is gone resolves on every task event, and the public Slack route on every request:
 * one audit row per handle per hour says it is failing without burying the log. */
const resolveFailedAt = new Map();
const auditsResolveFailure = (companyId, handle) => {
    const key = `${companyId}:${handle}`;
    const now = Date.now();
    if (resolveFailedAt.has(key) && now - resolveFailedAt.get(key) < RESOLVE_FAILED_AUDIT_INTERVAL_MS) return false;
    resolveFailedAt.delete(key);
    if (resolveFailedAt.size >= RESOLVE_FAILED_TRACKED) resolveFailedAt.delete(resolveFailedAt.keys().next().value);
    resolveFailedAt.set(key, now);
    return true;
};

const unchanged = (row) => ({ _id: row._id, keyId: row.keyId, ciphertext: row.ciphertext });

/* Server-internal: the only path that yields a value. A failure answers null and is audited with its reason. */
async function resolve({ companyId, handle }) {
    requireKey();
    const id = companyOf(companyId);
    const refused = (reason, row) => {
        if (auditsResolveFailure(id, String(handle || ''))) {
            audit(id, null, { action: 'secret.resolve_failed', entityId: String(handle || ''), entityName: (row && row.name) || '', meta: { reason } });
        }
        return null;
    };
    const row = await findRow(id, handle);
    if (!row) return refused('not_found');
    if (row.revokedAt) return refused('revoked', row);
    const material = keyMaterial(row.keyId);
    if (!material) return refused('unknown_key', row);
    const value = open({ material, companyId: id, handle: row.handle, iv: row.iv, tag: row.tag, ciphertext: row.ciphertext });
    if (value === null) return refused('undecryptable', row);
    await db(id, [{ _id: row._id }, { $set: { lastResolvedAt: new Date() } }], 'updateOne');
    if (row.keyId !== keyIdOf(material)) await db(id, [unchanged(row), { $set: { keyId: keyIdOf(material) } }], 'updateOne');
    return value;
}

async function describe({ companyId, handle }) {
    requireOn();
    return metadata(await requireRow(companyOf(companyId), handle));
}

async function rotate({ companyId, handle, value, actor, hosts, header }) {
    const cfg = requireOn();
    const id = companyOf(companyId);
    const row = await requireRow(id, handle);
    const boundHosts = hostsOf(row.kind, hosts, { required: false });
    const boundHeader = headerOf(row.kind, header);
    const set = {
        keyId: cfg.keyId,
        rotatedAt: new Date(),
        ...(boundHosts ? { hosts: boundHosts } : {}),
        ...(header !== undefined && row.kind === READ_KIND ? { header: boundHeader || '' } : {}),
        ...seal({ material: keyMaterial(cfg.keyId), companyId: id, handle: row.handle, value: valueOf(value) }),
    };
    const updated = plain(await db(id, [{ _id: row._id }, { $set: set }, { returnDocument: 'after' }], 'findOneAndUpdate'));
    audit(id, actor, { action: 'secret.rotate', entityId: row.handle, entityName: row.name, meta: { kind: row.kind, keyId: cfg.keyId, ...bindingMeta({ ...row, ...set }) } });
    return metadata(updated || { ...row, ...set });
}

/* The ciphertext goes with the revocation, so a later key leak cannot recover a secret nobody may use. It needs
 * the key but not the flag: a rollback that turns SECRETS_STORE off must still be able to clear the store. */
async function revoke({ companyId, handle, actor }) {
    requireKey();
    const id = companyOf(companyId);
    const row = await requireRow(id, handle);
    const set = { revokedAt: new Date(), ciphertext: '', iv: '', tag: '' };
    const updated = plain(await db(id, [{ _id: row._id }, { $set: set }, { returnDocument: 'after' }], 'findOneAndUpdate'));
    audit(id, actor, { action: 'secret.revoke', entityId: row.handle, entityName: row.name, meta: { kind: row.kind } });
    return metadata(updated || { ...row, ...set });
}

/* Lets go of a handle no document points at any more. Without a usable key the store refuses writes to a
 * secret, so the row is only marked, and revokeOrphans clears it once a key is back. */
async function retire({ companyId, handle, actor }) {
    const id = companyOf(companyId);
    if (config().keyValid) {
        try {
            await revoke({ companyId: id, handle, actor });
            return 'revoked';
        } catch (error) {
            if (!['revoked', 'not_found'].includes(error.code)) throw error;
            return 'gone';
        }
    }
    const row = await findRow(id, handle);
    if (!row || row.revokedAt) return 'gone';
    await db(id, [{ _id: row._id, revokedAt: null }, { $set: { orphanedAt: new Date() } }], 'updateOne');
    audit(id, actor, { action: 'secret.orphan', entityId: row.handle, entityName: row.name, meta: { kind: row.kind } });
    return 'orphaned';
}

async function revokeOrphans({ companyId, actor }) {
    requireKey();
    const id = companyOf(companyId);
    const rows = ((await db(id, [{ revokedAt: null, orphanedAt: { $gt: new Date(0) } }], 'find')) || []).map(plain);
    let revoked = 0;
    for (const row of rows) if ((await retire({ companyId: id, handle: row.handle, actor })) === 'revoked') revoked += 1;
    return revoked;
}

async function list({ companyId }) {
    requireOn();
    const rows = await db(companyOf(companyId), [{}, { ciphertext: 0, iv: 0, tag: 0 }, { sort: { createdAt: -1 } }], 'find');
    return (rows || []).map(plain).map(metadata);
}

/* Key rotation: every live row sealed under another readable key is resealed under the current one. The write
 * matches the row as it was read, so a rotate or revoke that lands in between is left alone and counted. */
async function reencryptAll({ companyId, actor, run }) {
    const cfg = requireKey();
    const id = companyOf(companyId);
    const rows = ((await db(id, [{}], 'find')) || []).map(plain);
    const counts = { moved: 0, kept: 0, failed: 0, raced: 0, revoked: 0 };
    for (const row of rows) {
        if (row.revokedAt) { counts.revoked += 1; continue; }
        if (row.keyId === cfg.keyId) { counts.kept += 1; continue; }
        const material = keyMaterial(row.keyId);
        const value = material ? open({ material, companyId: id, handle: row.handle, iv: row.iv, tag: row.tag, ciphertext: row.ciphertext }) : null;
        if (value === null) { counts.failed += 1; continue; }
        const set = { keyId: cfg.keyId, ...seal({ material: keyMaterial(cfg.keyId), companyId: id, handle: row.handle, value }) };
        const written = await db(id, [{ ...unchanged(row), revokedAt: null }, { $set: set }, { returnDocument: 'after' }], 'findOneAndUpdate');
        counts[written ? 'moved' : 'raced'] += 1;
    }
    const left = ((await db(id, [{ revokedAt: null, keyId: { $ne: cfg.keyId } }, { keyId: 1 }], 'find')) || []).map(plain);
    const previousIds = idsOf(process.env.SECRETS_KEY_PREVIOUS);
    counts.onPreviousKey = left.filter((row) => previousIds.includes(row.keyId)).length;
    counts.onUnknownKey = left.length - counts.onPreviousKey;
    if (counts.onUnknownKey) logger.error(`${LOG} ${counts.onUnknownKey} secret(s) in company ${id} are sealed under a key that is neither SECRETS_KEY nor SECRETS_KEY_PREVIOUS`);
    audit(id, actor, { action: 'secret.reencrypt', entityId: id, entityName: 'Secrets store key rotation', meta: { ...counts, keyId: cfg.keyId, ...(run ? { run: String(run) } : {}) } });
    return counts;
}

module.exports = {
    SecretsStoreError, HANDLE, READ_KIND, MIN_KEY_LENGTH, MAX_VALUE_LENGTH, MAX_NAME_LENGTH, MAX_KIND_LENGTH,
    storeConfig, config, isOn, logBootState, keyIdOf,
    create, resolve, describe, rotate, revoke, retire, revokeOrphans, list, reencryptAll,
};
