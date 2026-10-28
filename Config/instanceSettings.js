const crypto = require('crypto');
const { CATALOG, OWNERS, byKey, describeSettings, platformOwnedKeys, validateSettings } = require('../Modules/Instance/settingsCatalog');
const { applyEnvMap, isSet } = require('./applyEnv');
const hostingMode = require('./hostingMode');

const DOC_ID = 'instance';
const ENC_PREFIX = 'enc:v1:';

/* Secrets rest encrypted with a key derived from JWT_SECRET: the one value every
 * install already has to keep private, so no second secret to manage. Rotating
 * JWT_SECRET therefore makes stored secrets unreadable; they read as unset. */
const keyFor = (secret) => crypto.createHash('sha256').update(`instance-settings:${secret}`).digest();

function encrypt(plain, secret = process.env.JWT_SECRET || '') {
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', keyFor(secret), iv);
    const body = Buffer.concat([cipher.update(String(plain), 'utf8'), cipher.final()]);
    return ENC_PREFIX + [iv, cipher.getAuthTag(), body].map((b) => b.toString('base64')).join(':');
}

function decrypt(stored, secret = process.env.JWT_SECRET || '') {
    if (!String(stored).startsWith(ENC_PREFIX)) return String(stored);
    const [iv, tag, body] = stored.slice(ENC_PREFIX.length).split(':').map((s) => Buffer.from(s, 'base64'));
    const decipher = crypto.createDecipheriv('aes-256-gcm', keyFor(secret), iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(body), decipher.final()]).toString('utf8');
}

const isEncrypted = (value) => String(value).startsWith(ENC_PREFIX);

let fromEnv = null;
let saved = {};
let platformValues = {};
let ownershipOverrides = {};
let loaded = false;

/* Snapshot of what the environment (real env or .env) set, taken once before any
 * stored value is applied: those keys stay the environment's for the process life. */
function envKeys() {
    if (!fromEnv) fromEnv = CATALOG.map((f) => f.key).filter((key) => isSet(process.env[key]));
    return fromEnv;
}

const platformOwned = () => (hostingMode.isManaged() ? platformOwnedKeys(ownershipOverrides) : []);

/* What the owner's own values cannot reach: env > platform > saved > default, and on a hosted
 * instance every platform-owned key, set or not. */
function lockedKeys() {
    return [...new Set([...envKeys(), ...Object.keys(platformValues), ...platformOwned()])];
}

function applyInstanceSettings(values) {
    const lockedSet = new Set(lockedKeys());
    const applicable = Object.fromEntries(Object.entries(values).filter(([key]) => byKey.has(key) && !byKey.get(key).readOnly && !lockedSet.has(key)));
    applyEnvMap(applicable, { override: true });
    return Object.keys(applicable);
}

const savedFallback = (key) => (platformOwned().includes(key) || saved[key] === undefined ? '' : saved[key]);

/* Names only the keys whose live value moved, so a full platform push that repeats yesterday's
 * values does not ask for a restart. */
function applyChanges(map) {
    const changed = Object.keys(map).filter((key) => String(process.env[key] ?? '') !== String(map[key]));
    applyEnvMap(Object.fromEntries(changed.map((key) => [key, map[key]])), { override: true });
    return changed;
}

function applyPlatformValues(next, previous = {}) {
    const env = new Set(envKeys());
    const map = {};
    for (const [key, value] of Object.entries(next)) if (!env.has(key) && byKey.has(key) && !byKey.get(key).readOnly) map[key] = value;
    for (const key of Object.keys(previous)) if (!(key in next) && !env.has(key)) map[key] = savedFallback(key);
    return applyChanges(map);
}

function decodeStored(stored, logger) {
    const out = {};
    for (const [key, value] of Object.entries(stored || {})) {
        if (!byKey.has(key)) continue;
        try {
            out[key] = byKey.get(key).secret ? decrypt(value) : String(value);
        } catch (error) {
            if (logger) logger.error(`instance settings: ${key} could not be decrypted (JWT_SECRET changed?), treating as unset`);
        }
    }
    return out;
}

const encodeStored = (values) => Object.fromEntries(Object.entries(values).map(([key, value]) => [key, byKey.get(key).secret ? encrypt(value) : value]));

const plain = (value) => (value && value.toObject ? value.toObject() : value) || {};

function deps() {
    const { MongoDbCrudOpration } = require('../utils/mongo-handler/mongoQueries');
    const { SCHEMA_TYPE } = require('./schemaType');
    return { run: (data, method) => MongoDbCrudOpration(SCHEMA_TYPE.GOLBAL, { type: SCHEMA_TYPE.INSTANCE_SETTINGS, data }, method) };
}

/* Platform values exist only on a hosted instance: one moved to self-hosting keeps none of ours. */
async function loadInstanceSettings(logger) {
    envKeys();
    const doc = await deps().run([{ _id: DOC_ID }], 'findOne');
    saved = decodeStored(plain(doc && doc.values), logger);
    platformValues = hostingMode.isManaged() ? decodeStored(plain(doc && doc.platformValues), logger) : {};
    applyInstanceSettings(saved);
    applyPlatformValues(platformValues);
    loaded = true;
    return saved;
}

async function saveInstanceSettings(values, updatedBy = '') {
    const next = { ...saved };
    for (const [key, value] of Object.entries(values)) {
        if (value === '') delete next[key];
        else next[key] = value;
    }
    await deps().run([{ _id: DOC_ID }, { $set: { values: encodeStored(next), updatedAt: new Date(), updatedBy } }, { upsert: true }], 'findOneAndUpdate');
    saved = next;
    const applied = applyInstanceSettings(values);
    const restartRequired = applied.filter((key) => byKey.get(key).restart);
    return { applied, restartRequired };
}

/* The platform always sends its whole set, so this replaces `platformValues`; a key it leaves out
 * falls back to the owner's value, or to the default. Invalid input is refused whole and the last
 * good values stay. `{set:true}` for a secret keeps the one already pushed. */
async function savePlatformSettings(values = {}, updatedBy = 'platform') {
    const { values: clean, errors, valid } = validateSettings(values);
    if (!valid) {
        const error = new Error('Some platform settings are not valid.');
        Object.assign(error, { code: 'invalid_settings', statusCode: 400, errors });
        throw error;
    }
    envKeys();
    const next = {};
    for (const [key, raw] of Object.entries(values)) {
        if (raw && typeof raw === 'object' && raw.set === true) {
            if (platformValues[key] !== undefined) next[key] = platformValues[key];
        } else if (clean[key] !== undefined && clean[key] !== '') next[key] = clean[key];
    }
    await deps().run([{ _id: DOC_ID }, { $set: { platformValues: encodeStored(next), platformUpdatedAt: new Date(), platformUpdatedBy: updatedBy } }, { upsert: true }], 'findOneAndUpdate');
    const previous = platformValues;
    platformValues = next;
    const applied = applyPlatformValues(next, previous);
    return { applied, restartRequired: applied.filter((key) => byKey.get(key).restart) };
}

/* Replaces the overrides (a group or a key mapped to 'platform' or 'customer') and moves the live
 * values across: a key handed to the customer takes their saved value, one taken back drops it. */
function setOwnershipOverrides(overrides = {}) {
    const before = new Set(platformOwned());
    ownershipOverrides = Object.fromEntries(Object.entries(overrides || {}).filter(([, owner]) => OWNERS.includes(owner)));
    const after = new Set(platformOwned());
    const env = new Set(envKeys());
    const movable = (key) => !env.has(key) && !(key in platformValues) && saved[key] !== undefined;
    const moved = {};
    for (const key of before) if (!after.has(key) && movable(key)) moved[key] = saved[key];
    for (const key of after) if (!before.has(key) && movable(key)) moved[key] = '';
    applyChanges(moved);
    return { ...ownershipOverrides };
}

/* Why the owner may not set each key of a PUT body: 'managed' (ours on a hosted instance) or
 * 'locked' (set in the environment). Sending a secret's mask back changes nothing, so it passes. */
function refusedKeys(patch = {}) {
    const env = new Set(envKeys());
    const managed = new Set(hostingMode.isManaged() ? lockedKeys() : Object.keys(platformValues));
    const errors = {};
    for (const [key, raw] of Object.entries(patch || {})) {
        if (raw && typeof raw === 'object' && raw.set === true) continue;
        if (managed.has(key)) errors[key] = 'managed';
        else if (env.has(key)) errors[key] = 'locked';
    }
    return errors;
}

/* Values a migration wrote straight to the stored document, taken into this process as if loaded. */
function adoptStored(values) {
    saved = { ...saved, ...values };
    return applyInstanceSettings(values);
}

/* A moment stored beside the settings rather than in `values`, which every save
 * rewrites whole. The conditional write means the first server to record it wins:
 * a second one hits the existing _id on upsert and reads the stored moment back. */
async function markFirstSeen(field, now = new Date()) {
    const { run } = deps();
    const stored = async () => {
        const doc = await run([{ _id: DOC_ID }], 'findOne');
        return doc && doc[field] ? new Date(doc[field]) : null;
    };
    const existing = await stored();
    if (existing) return existing;
    try {
        const doc = await run([{ _id: DOC_ID, [field]: { $exists: false } }, { $set: { [field]: now } }, { upsert: true, returnDocument: 'after' }], 'findOneAndUpdate');
        if (doc && doc[field]) return new Date(doc[field]);
    } catch (error) {
        if (error.code !== 11000) throw error;
    }
    return (await stored()) || now;
}

const describe = () => describeSettings({
    saved, env: process.env, locked: envKeys(), platform: platformValues, managed: hostingMode.isManaged() ? lockedKeys() : [],
});

/* What the login page and the SPA shell may know before anyone is logged in. */
function publicConfig() {
    const env = (key) => process.env[key] || '';
    const on = (key) => env(key) === 'true';
    const { version } = require('./buildInfo').get();
    return {
        version,
        appName: env('APP_NAME') || 'AlianHub',
        webUrl: env('WEBURL'),
        storageType: env('STORAGE_TYPE') || 'server',
        agentSessions: require('../Modules/AgentSessions/config').isOn(process.env),
        auth: {
            google: { enabled: on('GOOGLE_LOGIN_ENABLED') && Boolean(env('GOOGLE_CLIENT_ID')), clientId: env('GOOGLE_CLIENT_ID') },
            github: { enabled: on('GITHUB_LOGIN_ENABLED') && Boolean(env('GITHUB_CLIENT_ID')), clientId: env('GITHUB_CLIENT_ID'), baseUrl: env('GITHUB_BASE_OAUTH_URL') || 'https://github.com/login/oauth' },
            gitlab: { enabled: on('GITLAB_LOGIN_ENABLED') && Boolean(env('GITLAB_CLIENT_ID')), clientId: env('GITLAB_CLIENT_ID'), baseUrl: env('GITLAB_BASE_OAUTH_URL') || 'https://gitlab.com/oauth' },
            sso: env('SSO_LOGIN_ENABLED') !== 'false',
            magicLink: env('MAGIC_LINK_ENABLED') === 'true',
        },
        firebase: {
            apiKey: env('APIKEY'), authDomain: env('AUTODOMAIN'), projectId: env('PROJECTID'), storageBucket: env('STORAGEBUCKET'),
            messagingSenderId: env('MESSAGINGSENDERID'), appId: env('APPID'), measurementId: env('MEASUREMENTID'),
        },
        demoMode: env('DEMO_MODE') === 'true',
        mcpOAuth: require('../Modules/OAuthServer/config').isOn(process.env),
        hosting: { mode: hostingMode.mode(), portalUrl: hostingMode.portalUrl(), ...(hostingMode.isManaged() ? { lifecycle: require('../Modules/Platform/lifecycle').lifecycle() } : {}) },
    };
}

module.exports = {
    DOC_ID, ENC_PREFIX, encrypt, decrypt, isEncrypted, decodeStored, lockedKeys, envKeys, applyInstanceSettings,
    loadInstanceSettings, saveInstanceSettings, savePlatformSettings, setOwnershipOverrides, refusedKeys,
    adoptStored, markFirstSeen, describe, publicConfig,
    isLoaded: () => loaded,
    savedValues: () => ({ ...saved }),
    platformKeys: () => Object.keys(platformValues),
    ownershipOverrides: () => ({ ...ownershipOverrides }),
    _resetForTests: () => { fromEnv = null; saved = {}; platformValues = {}; ownershipOverrides = {}; loaded = false; },
};
