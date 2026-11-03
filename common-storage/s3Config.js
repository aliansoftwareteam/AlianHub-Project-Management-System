const STORAGE_KEYS = [
    'STORAGE_TYPE', 'USERPROFILEBUCKET',
    'S3_ENDPOINT', 'S3_REGION', 'S3_BUCKET', 'S3_PREFIX', 'S3_ACCESS_KEY', 'S3_SECRET_KEY', 'S3_FORCE_PATH_STYLE', 'S3_PUBLIC_BASE_URL',
    'WASABIENDPOINT', 'WASABI_REGION', 'WASABI_ACCESS_KEY', 'WASABI_SECRET_ACCESS_KEY',
];

const isSet = (value) => value !== undefined && value !== null && String(value).trim() !== '';
const first = (...values) => {
    const found = values.find(isSet);
    return found === undefined ? undefined : String(found).trim();
};

const normalisePrefix = (raw) => {
    const trimmed = String(raw || '').trim().replace(/^\/+/, '');
    if (!trimmed) return '';
    return trimmed.endsWith('/') ? trimmed : `${trimmed}/`;
};

const prefixProblem = (raw) => {
    const prefix = normalisePrefix(raw);
    if (!prefix) return null;
    if (prefix.includes('\\') || prefix.includes('\u0000')) return 'prefix';
    return prefix.split('/').slice(0, -1).some((segment) => !segment || segment === '.' || segment === '..') ? 'prefix' : null;
};

/* The S3_* names are canonical; the WASABI_* names an existing install already has keep working. */
function resolveS3Config(env = process.env) {
    const bucket = isSet(env.S3_BUCKET) ? String(env.S3_BUCKET).trim() : '';
    return {
        endpoint: first(env.S3_ENDPOINT, env.WASABIENDPOINT),
        region: first(env.S3_REGION, env.WASABI_REGION),
        accessKeyId: first(env.S3_ACCESS_KEY, env.WASABI_ACCESS_KEY),
        secretAccessKey: first(env.S3_SECRET_KEY, env.WASABI_SECRET_ACCESS_KEY),
        forcePathStyle: String(env.S3_FORCE_PATH_STYLE || '').trim().toLowerCase() === 'true',
        publicBaseUrl: isSet(env.S3_PUBLIC_BASE_URL) ? String(env.S3_PUBLIC_BASE_URL).trim().replace(/\/+$/, '') : '',
        profileBucket: env.USERPROFILEBUCKET,
        bucket,
        prefix: normalisePrefix(env.S3_PREFIX),
        prefixMode: Boolean(bucket),
    };
}

const isObjectStorage = (env = process.env) => String(env.STORAGE_TYPE || 'wasabi') !== 'server';

const clientFingerprint = (cfg) => JSON.stringify([cfg.endpoint, cfg.region, cfg.accessKeyId, cfg.secretAccessKey, cfg.forcePathStyle]);

const touchesStorage = (keys) => (keys || []).some((key) => STORAGE_KEYS.includes(key));

module.exports = { resolveS3Config, normalisePrefix, prefixProblem, isObjectStorage, clientFingerprint, touchesStorage, STORAGE_KEYS };
