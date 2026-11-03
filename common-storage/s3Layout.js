const { resolveS3Config } = require('./s3Config');

/* The only module that names a bucket. Bucket-per-company (self-hosted today): a company's files
 * live in a bucket named after its id and public assets in USERPROFILEBUCKET. Prefix mode, on when
 * S3_BUCKET is set: everything lives in that one bucket, under S3_PREFIX + companyId + '/' and
 * S3_PREFIX + 'public/'. tests/conventions/s3-layout.test.js keeps `Bucket:` out of every other file. */

const PUBLIC_OWNER = 'public';
const SAFE_OWNER = /^[A-Za-z0-9][A-Za-z0-9_-]*$/;

const refusal = (code, message) => Object.assign(new Error(message), { code });

const encodeKey = (key) => String(key).split('/').map(encodeURIComponent).join('/');

function layoutOf(cfg = resolveS3Config()) {
    const { prefixMode, prefix } = cfg;
    const isPublic = (owner) => owner === PUBLIC_OWNER;

    const ownerSegment = (owner) => {
        const id = String(owner ?? '');
        if (!SAFE_OWNER.test(id) || isPublic(id)) throw refusal('invalid_owner', `"${id}" cannot name a storage area.`);
        return id;
    };

    /* Prefix mode shares the bucket with other tenants, so a key that could climb out of its area is refused. */
    const checkedKey = (key) => {
        const value = String(key ?? '');
        if (!prefixMode) return key;
        if (!value || value.startsWith('/') || value.includes('\0') || value.split('/').some((part) => part === '.' || part === '..')) {
            throw refusal('invalid_key', `"${value}" is not a key inside a storage area.`);
        }
        return value;
    };

    const rootOf = (owner) => {
        if (!prefixMode) return '';
        return isPublic(owner) ? `${prefix}${PUBLIC_OWNER}/` : `${prefix}${ownerSegment(owner)}/`;
    };

    const bucketOf = (owner) => {
        if (prefixMode) return cfg.bucket;
        if (isPublic(owner)) return cfg.profileBucket;
        return owner === undefined || owner === null ? owner : String(owner);
    };

    const withBucket = (owner, rest = {}) => ({ Bucket: bucketOf(owner), ...rest });

    const locate = (owner, key) => withBucket(owner, { Key: `${rootOf(owner)}${checkedKey(key)}` });

    const listing = (owner) => (prefixMode ? withBucket(owner, { Prefix: rootOf(owner) }) : withBucket(owner));

    const instanceListing = () => (prefixMode ? { Bucket: cfg.bucket, Prefix: prefix } : null);

    /* Outside every workspace and the public area, so a test object never counts as anyone's file. */
    const probeLocation = (name) => (prefixMode
        ? { Bucket: cfg.bucket, Key: `${prefix}.alianhub-probe/${name}` }
        : { Bucket: cfg.profileBucket, Key: `.alianhub-probe/${name}` });

    const logicalKey = (owner, fullKey) => {
        if (!prefixMode) return fullKey === undefined || fullKey === null ? '' : String(fullKey);
        const root = rootOf(owner);
        const key = String(fullKey ?? '');
        return key.startsWith(root) && key.length > root.length ? key.slice(root.length) : null;
    };

    const ownerOfKey = (fullKey) => {
        if (!prefixMode) return null;
        const key = String(fullKey ?? '');
        if (!key.startsWith(prefix)) return null;
        const owner = key.slice(prefix.length).split('/')[0];
        return owner && key.length > prefix.length + owner.length + 1 ? owner : null;
    };

    const owns = (location) => !prefixMode
        || (Boolean(location) && location.Bucket === cfg.bucket && String(location.Key || location.Prefix || '').startsWith(prefix)
            && String(location.Key || location.Prefix || '').length > prefix.length);

    const copySource = (location) => (prefixMode ? `${location.Bucket}/${encodeKey(location.Key)}` : `${location.Bucket}/${location.Key}`);

    /* Prefix mode never makes the bucket public: an asset is reachable only through S3_PUBLIC_BASE_URL
     * (a CDN or a policy scoped to <prefix>public/) or a signed url. */
    const publicUrl = (key) => {
        if (cfg.publicBaseUrl) return `${cfg.publicBaseUrl}/${encodeKey(key)}`;
        if (!prefixMode) return `https://s3.${cfg.region}.wasabisys.com/${cfg.profileBucket}/${key}`;
        const endpoint = String(cfg.endpoint || `https://s3.${cfg.region}.wasabisys.com`).replace(/\/+$/, '');
        return `${endpoint}/${cfg.bucket}/${encodeKey(`${rootOf(PUBLIC_OWNER)}${key}`)}`;
    };

    return {
        prefixMode, prefix, bucket: cfg.bucket,
        rootOf, bucketOf, withBucket, locate, listing, instanceListing, probeLocation, logicalKey, ownerOfKey, owns, copySource, publicUrl,
    };
}

const currentLayout = () => layoutOf(resolveS3Config());

module.exports = { layoutOf, currentLayout, PUBLIC_OWNER, encodeKey };
