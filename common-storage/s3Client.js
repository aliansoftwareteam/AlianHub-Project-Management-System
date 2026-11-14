const { resolveS3Config, clientFingerprint } = require('./s3Config');

let cached = null;

const clientOptions = (cfg, requestHandler) => ({
    region: cfg.region,
    credentials: { accessKeyId: cfg.accessKeyId, secretAccessKey: cfg.secretAccessKey },
    endpoint: cfg.endpoint,
    ...(cfg.forcePathStyle ? { forcePathStyle: true } : {}),
    ...(requestHandler ? { requestHandler } : {}),
});

/* Built lazily, so a server-storage install never loads the S3 SDK. A replaced client is never
 * destroyed: a request already sent on it finishes there, and the socket pool is shared. */
function buildS3Client(cfg = resolveS3Config()) {
    const { S3Client } = require('@aws-sdk/client-s3');
    const { requestHandler } = require('../Config/config');
    return new S3Client(clientOptions(cfg, requestHandler));
}

/* Rebuilt whenever the resolved credentials differ from the cached client's, so a key pushed
 * into the environment is used by the next request even if nobody called resetS3Client(). */
function getS3Client() {
    const cfg = resolveS3Config();
    const fingerprint = clientFingerprint(cfg);
    if (!cached || cached.fingerprint !== fingerprint) cached = { fingerprint, client: buildS3Client(cfg) };
    return cached.client;
}

function resetS3Client() {
    cached = null;
}

const SIGNED_URL_CACHE = /^(image|imageExists):/;

/* Called whenever a storage setting is applied (Config/applyEnv.js), so a rotated key is used by the next
 * request; urls signed with the old key are dropped too, since they stop working once it is revoked. */
function reloadStorageClient() {
    resetS3Client();
    try {
        const { myCache } = require('../Config/config');
        const stale = myCache.keys().filter((key) => SIGNED_URL_CACHE.test(key));
        if (stale.length) myCache.del(stale);
    } catch (error) {
        // The cache is a nicety; a url it still holds expires within twenty minutes.
    }
}

module.exports = { getS3Client, resetS3Client, reloadStorageClient, buildS3Client, clientOptions };
