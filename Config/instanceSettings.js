const crypto = require('crypto');
const { CATALOG, byKey, describeSettings } = require('../Modules/Instance/settingsCatalog');
const { applyEnvMap, isSet } = require('./applyEnv');

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

let locked = null;
let saved = {};
let loaded = false;

/* Snapshot of what the environment (real env or .env) set, taken once before any
 * stored value is applied: those keys stay the environment's for the process life. */
function lockedKeys() {
    if (!locked) locked = CATALOG.map((f) => f.key).filter((key) => isSet(process.env[key]));
    return locked;
}

function applyInstanceSettings(values) {
    const lockedSet = new Set(lockedKeys());
    const applicable = Object.fromEntries(Object.entries(values).filter(([key]) => byKey.has(key) && !lockedSet.has(key)));
    applyEnvMap(applicable, { override: true });
    return Object.keys(applicable);
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

function deps() {
    const { MongoDbCrudOpration } = require('../utils/mongo-handler/mongoQueries');
    const { SCHEMA_TYPE } = require('./schemaType');
    return { run: (data, method) => MongoDbCrudOpration(SCHEMA_TYPE.GOLBAL, { type: SCHEMA_TYPE.INSTANCE_SETTINGS, data }, method) };
}

async function loadInstanceSettings(logger) {
    lockedKeys();
    const doc = await deps().run([{ _id: DOC_ID }], 'findOne');
    const values = doc && doc.values ? (doc.values.toObject ? doc.values.toObject() : doc.values) : {};
    saved = decodeStored(values, logger);
    applyInstanceSettings(saved);
    loaded = true;
    return saved;
}

async function saveInstanceSettings(values, updatedBy = '') {
    const next = { ...saved };
    for (const [key, value] of Object.entries(values)) {
        if (value === '') delete next[key];
        else next[key] = value;
    }
    const stored = Object.fromEntries(Object.entries(next).map(([key, value]) => [key, byKey.get(key).secret ? encrypt(value) : value]));
    await deps().run([{ _id: DOC_ID }, { $set: { values: stored, updatedAt: new Date(), updatedBy } }, { upsert: true }], 'findOneAndUpdate');
    saved = next;
    const applied = applyInstanceSettings(values);
    const restartRequired = applied.filter((key) => byKey.get(key).restart);
    return { applied, restartRequired };
}

const describe = () => describeSettings({ saved, env: process.env, locked: lockedKeys() });

/* What the login page and the SPA shell may know before anyone is logged in. */
function publicConfig() {
    const env = (key) => process.env[key] || '';
    const on = (key) => env(key) === 'true';
    const { version } = require('../package.json');
    return {
        version,
        appName: env('APP_NAME') || 'AlianHub',
        webUrl: env('WEBURL'),
        storageType: env('STORAGE_TYPE') || 'server',
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
    };
}

module.exports = {
    DOC_ID, ENC_PREFIX, encrypt, decrypt, isEncrypted, decodeStored, lockedKeys, applyInstanceSettings,
    loadInstanceSettings, saveInstanceSettings, describe, publicConfig,
    isLoaded: () => loaded,
    savedValues: () => ({ ...saved }),
    _resetForTests: () => { locked = null; saved = {}; loaded = false; },
};
