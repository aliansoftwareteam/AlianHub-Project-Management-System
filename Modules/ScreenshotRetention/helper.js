/**
 * Screenshot Retention — helper layer.
 *
 * Owns:
 *   - reading and writing the per-company policy in the global `companies`
 *     master doc (`screenshotRetention` Map field);
 *   - counting deletable trackshots for the "preview" / confirmation dialog;
 *   - the actual nightly cleanup workflow used by cron.js.
 *
 * Design notes:
 *   - The toggle lives on the master companies document so the cron can
 *     enumerate opted-in companies in one query without opening every
 *     tenant DB to check a setting.
 *   - The cleanup deletes the Wasabi object(s) BEFORE pulling the trackshot
 *     subdoc from the tenant's TimeSheet. If Wasabi delete fails the DB
 *     record stays and the next nightly run retries. The reverse ordering
 *     would create permanent Wasabi orphans on every transient failure.
 *   - For each trackshot we delete the main key + every thumbnail variant
 *     (sizes from utils/thumbnail.json) because handleuploadMainFileForbase64Thumbnail
 *     materialises a thumbnail per declared size at upload time.
 *   - Filtering is by the trackshot's own `screenShotTime` (epoch ms) so a
 *     long-running TimeSheet doesn't keep old screenshots alive forever.
 *   - First-run safety cap prevents the very first cleanup from deleting
 *     hundreds of thousands of records in one go for legacy data; once the
 *     run finishes we stamp `firstRunCompletedAt` and lift the cap.
 *   - An advisory `runningSince` lock on the company doc prevents two cron
 *     invocations from colliding (e.g. a manual run kicking off while the
 *     nightly schedule fires). Stale locks (>4h old) are treated as crashed
 *     and reclaimed.
 *
 * This module is intentionally storage-aware: it imports the Wasabi delete
 * primitive directly. The local-filesystem `STORAGE_TYPE=server` path is
 * out of scope for retention today — companies on local storage simply
 * never enable the toggle.
 */

const { default: mongoose } = require('mongoose');
const { DeleteObjectCommand } = require('@aws-sdk/client-s3');
const { MongoDbCrudOpration } = require('../../utils/mongo-handler/mongoQueries');
const { SCHEMA_TYPE } = require('../../Config/schemaType');
const logger = require('../../Config/loggerConfig');

const LOG_PREFIX = '[ScreenshotRetention]';

// Mirror the trackshot entries declared in thumbnail.json. We hard-code them
// here so the cleanup is stable even if that JSON is reshuffled — if a new
// size is added at upload time but missed here, we'd just leave a few small
// thumbnails orphaned (not catastrophic; cheap to add later).
const TRACKSHOT_THUMBNAIL_SIZES = [
    { width: 78,  height: 140 },
    { width: 118, height: 210 },
    { width: 218, height: 390 },
    { width: 479, height: 853 }
];

// UI offers a fixed set of retention windows. Anything outside the set is
// rejected at the API layer to keep the toggle predictable.
const VALID_MAX_AGE_MONTHS = [3, 6, 12, 24];
const DEFAULT_MAX_AGE_MONTHS = 3;

// Per-company guardrails for the cron loop.
const FIRST_RUN_MAX_DELETIONS = 50000;          // cap the very first cleanup
const STALE_LOCK_THRESHOLD_MS = 4 * 60 * 60 * 1000; // 4h — assume crashed
const COMPANY_CONCURRENCY = 5;                  // how many tenants to process in parallel
const TENANT_BATCH_SIZE = 100;                  // TimeSheet docs per page

// ----- S3 client (lazy) --------------------------------------------------
// We reuse Modules/storage/wasabi/controller's S3 client at call time so
// any future credential rotation in awsRef propagates here without
// re-requiring this module. require() is cached, so this still resolves
// once per process.
let _s3 = null;
function getS3Client() {
    if (_s3) return _s3;
    // eslint-disable-next-line global-require
    const wasabiCtrl = require('../storage/wasabi/controller');
    _s3 = wasabiCtrl.s3Client || wasabiCtrl.default && wasabiCtrl.default.s3Client;
    if (!_s3) {
        // Fallback: build our own from awsRef. This keeps the cron alive
        // even if controller.js stops exporting s3Client in the future.
        // eslint-disable-next-line global-require
        const { S3Client } = require('@aws-sdk/client-s3');
        // eslint-disable-next-line global-require
        const awsRef = require('../../Config/aws.js');
        _s3 = new S3Client({
            region: awsRef.region,
            endpoint: awsRef.wasabiEndPoint,
            credentials: {
                accessKeyId: awsRef.wasabiAccessKey,
                secretAccessKey: awsRef.wasabiSecretAccessKey
            }
        });
    }
    return _s3;
}

// ----- Policy read / write ----------------------------------------------

/**
 * Read the policy for a company. Always returns a fully-shaped object —
 * even when the field is absent on the master doc (legacy companies).
 * Map-typed Mongoose fields surface as Map instances; we normalise to a
 * plain object for the API response.
 */
async function getCompanyPolicy(companyId) {
    const query = {
        type: SCHEMA_TYPE.COMPANIES,
        data: [
            { _id: new mongoose.Types.ObjectId(companyId) },
            { _id: 1, screenshotRetention: 1 }
        ]
    };
    const company = await MongoDbCrudOpration(SCHEMA_TYPE.GOLBAL, query, 'findOne');
    const raw = mapToObject(company && company.screenshotRetention);
    return normalisePolicy(raw);
}

/**
 * Normalise to plain-object defaults so callers can rely on the shape.
 */
function normalisePolicy(raw) {
    const policy = raw && typeof raw === 'object' ? raw : {};
    return {
        enabled: policy.enabled === true,
        maxAgeMonths: VALID_MAX_AGE_MONTHS.includes(Number(policy.maxAgeMonths))
            ? Number(policy.maxAgeMonths)
            : DEFAULT_MAX_AGE_MONTHS,
        enabledAt: policy.enabledAt || null,
        enabledBy: policy.enabledBy || null,
        lastRunAt: policy.lastRunAt || null,
        lastRunStats: policy.lastRunStats || null,
        firstRunCompletedAt: policy.firstRunCompletedAt || null,
        runningSince: policy.runningSince || null
    };
}

/**
 * Mongoose Map → plain object. Returns null for missing values so the
 * caller can fall through to defaults.
 */
function mapToObject(value) {
    if (!value) return null;
    if (value instanceof Map) return Object.fromEntries(value);
    return value;
}

/**
 * Compute the cutoff Date for "older than N months". Anchored to "now" so
 * the boundary slides forward each day.
 */
function computeCutoff(maxAgeMonths) {
    const cutoff = new Date();
    cutoff.setMonth(cutoff.getMonth() - Number(maxAgeMonths));
    return cutoff;
}

/**
 * Update the policy. Patch is a partial Map of fields to set; we whitelist
 * the keys that may be touched to keep callers honest. `enabling=true`
 * stamps enabledAt/enabledBy automatically.
 */
async function updateCompanyPolicy(companyId, patch, opts = {}) {
    const setObj = {};
    if (patch.enabled !== undefined) setObj['screenshotRetention.enabled'] = patch.enabled === true;
    if (patch.maxAgeMonths !== undefined) {
        const n = Number(patch.maxAgeMonths);
        if (!VALID_MAX_AGE_MONTHS.includes(n)) {
            throw new Error(`Invalid maxAgeMonths ${patch.maxAgeMonths}`);
        }
        setObj['screenshotRetention.maxAgeMonths'] = n;
    }
    if (opts.markEnabled && opts.userId) {
        setObj['screenshotRetention.enabledAt'] = new Date();
        setObj['screenshotRetention.enabledBy'] = String(opts.userId);
    }
    if (Object.keys(setObj).length === 0) return getCompanyPolicy(companyId);

    const query = {
        type: SCHEMA_TYPE.COMPANIES,
        data: [
            { _id: new mongoose.Types.ObjectId(companyId) },
            { $set: setObj },
            { new: true, useFindAndModify: false }
        ]
    };
    await MongoDbCrudOpration(SCHEMA_TYPE.GOLBAL, query, 'findOneAndUpdate');
    return getCompanyPolicy(companyId);
}

// ----- Counting (used by the "preview" / confirm dialog) ----------------

/**
 * Count trackshots in the tenant's TimeSheets older than the cutoff. Uses
 * an aggregation rather than `.find().forEach()` so large companies don't
 * stream the full payload over the network.
 */
async function countOldTrackshots(companyId, cutoff) {
    const cutoffMs = cutoff.getTime();
    const pipeline = [
        // Limit to docs that have at least one old trackshot.
        { $match: { 'trackShots.screenShotTime': { $lt: cutoffMs } } },
        { $project: {
            count: {
                $size: {
                    $filter: {
                        input: { $ifNull: ['$trackShots', []] },
                        as: 't',
                        cond: { $lt: ['$$t.screenShotTime', cutoffMs] }
                    }
                }
            }
        } },
        { $group: { _id: null, total: { $sum: '$count' } } }
    ];
    const query = { type: SCHEMA_TYPE.TIMESHEET, data: [pipeline] };
    try {
        const result = await MongoDbCrudOpration(companyId, query, 'aggregate');
        if (Array.isArray(result) && result[0] && typeof result[0].total === 'number') {
            return result[0].total;
        }
        return 0;
    } catch (err) {
        logger.error(`${LOG_PREFIX} countOldTrackshots failed companyId=${companyId} ${err && err.message}`);
        return 0;
    }
}

// ----- Wasabi delete ----------------------------------------------------

/**
 * Derive every key for a single trackshot — main object plus the four
 * thumbnail variants — and try to delete them. Returns:
 *   { mainDeleted, thumbsDeleted, thumbsFailed, errors }
 *
 * Wasabi (S3-compatible) returns 204 for both "deleted" and "not found",
 * so any non-throwing call counts as success. Transient errors surface
 * as thrown exceptions and we treat the main delete as failed.
 */
async function deleteTrackshotObjects(companyId, trackshot) {
    const s3 = getS3Client();
    const mainKey = extractKey(trackshot && trackshot.image);
    if (!mainKey) {
        return { mainDeleted: true, thumbsDeleted: 0, thumbsFailed: 0, errors: ['no-key'] };
    }
    const thumbKeys = derivThumbnailKeys(mainKey);

    let mainDeleted = false;
    let thumbsDeleted = 0;
    let thumbsFailed = 0;
    const errors = [];

    try {
        await s3.send(new DeleteObjectCommand({ Bucket: companyId, Key: mainKey }));
        mainDeleted = true;
    } catch (err) {
        errors.push(`main:${mainKey}:${err && err.message ? err.message : err}`);
    }

    // Best-effort thumbnail cleanup. Don't gate the $pull on these; if a
    // thumbnail delete fails today and the main key is gone the orphan is
    // cosmetic, and the next run can't retry because the DB record is gone.
    // Worth flagging in logs for ops to spot a pattern.
    for (const key of thumbKeys) {
        try {
            // eslint-disable-next-line no-await-in-loop
            await s3.send(new DeleteObjectCommand({ Bucket: companyId, Key: key }));
            thumbsDeleted += 1;
        } catch (err) {
            thumbsFailed += 1;
            errors.push(`thumb:${key}:${err && err.message ? err.message : err}`);
        }
    }
    return { mainDeleted, thumbsDeleted, thumbsFailed, errors };
}

/**
 * The `image` field on a trackshot has historically held either a Wasabi
 * key (e.g. "trackshot/abc.png") or a fully-resolved URL (e.g.
 * "https://s3.wasabi.../bucket/trackshot/abc.png"). Strip the URL prefix
 * if present so we always send a pure key to DeleteObjectCommand.
 */
function extractKey(imageField) {
    if (!imageField || typeof imageField !== 'string') return null;
    const trimmed = imageField.trim();
    if (!trimmed) return null;
    if (!/^https?:\/\//i.test(trimmed)) return trimmed;
    try {
        const url = new URL(trimmed);
        // Path style: /<bucket>/<key>. Virtual-host style: /<key>.
        // We don't know the bucket name without the company context here,
        // so just return everything after the first slash that follows the
        // host — covers both styles well enough for our cleanup.
        const parts = url.pathname.split('/').filter(Boolean);
        if (parts.length <= 1) return parts.join('/');
        // Drop the first segment if it looks like a bucket id (24 hex chars).
        if (/^[a-f0-9]{20,}$/i.test(parts[0])) parts.shift();
        return parts.join('/');
    } catch (e) {
        return trimmed;
    }
}

/**
 * Materialise the thumbnail keys for a given main key, mirroring the
 * pattern from Modules/storage/wasabi/controller.js:210:
 *   `${name.split('.')[0]}-${width}x${height}.${ext}`
 */
function derivThumbnailKeys(mainKey) {
    const lastDot = mainKey.lastIndexOf('.');
    if (lastDot <= 0) return [];
    const base = mainKey.slice(0, lastDot);
    const ext = mainKey.slice(lastDot + 1);
    return TRACKSHOT_THUMBNAIL_SIZES.map(({ width, height }) => `${base}-${width}x${height}.${ext}`);
}

// ----- Cleanup workflow (per company) -----------------------------------

/**
 * Run the cleanup for a single company. Honours the company's policy
 * (maxAgeMonths), the first-run cap, and the advisory lock.
 *
 * Returns the stats object that is also persisted on the master doc.
 */
async function runRetentionForCompany(company) {
    const companyId = String(company._id);
    const policy = normalisePolicy(mapToObject(company.screenshotRetention));
    if (!policy.enabled) return null;

    // Advisory lock — refuse to run if a previous run is still in flight
    // and started recently. A run that started >STALE_LOCK_THRESHOLD ago is
    // assumed crashed and gets reclaimed.
    if (policy.runningSince) {
        const lockAge = Date.now() - new Date(policy.runningSince).getTime();
        if (lockAge < STALE_LOCK_THRESHOLD_MS) {
            logger.warn(`${LOG_PREFIX} skipping companyId=${companyId} — lock held since ${policy.runningSince}`);
            return { skipped: 'locked' };
        }
        logger.warn(`${LOG_PREFIX} reclaiming stale lock companyId=${companyId} lockAge=${Math.round(lockAge / 1000)}s`);
    }

    const startedAt = Date.now();
    const cutoff = computeCutoff(policy.maxAgeMonths);
    const cutoffMs = cutoff.getTime();
    const cap = policy.firstRunCompletedAt ? Infinity : FIRST_RUN_MAX_DELETIONS;

    let deletedCount = 0;
    let failedCount = 0;
    let scannedDocs = 0;
    const failedKeys = [];

    try {
        // Acquire lock.
        await updateCompanyPolicy(companyId, {}, { /* no-op patch */ });
        await stampMasterField(companyId, { 'screenshotRetention.runningSince': new Date() });

        // Loop through tenant TimeSheets in pages. Each page only loads docs
        // that have at least one old trackshot.
        let pagedSkip = 0;
        // eslint-disable-next-line no-constant-condition
        while (true) {
            if (deletedCount >= cap) {
                logger.info(`${LOG_PREFIX} companyId=${companyId} hit first-run cap=${cap}; deferring rest to next run`);
                break;
            }
            const query = {
                type: SCHEMA_TYPE.TIMESHEET,
                data: [
                    { 'trackShots.screenShotTime': { $lt: cutoffMs } },
                    { _id: 1, trackShots: 1 },
                    { skip: pagedSkip, limit: TENANT_BATCH_SIZE, sort: { _id: 1 } }
                ]
            };
            // eslint-disable-next-line no-await-in-loop
            const docs = await MongoDbCrudOpration(companyId, query, 'find');
            if (!Array.isArray(docs) || docs.length === 0) break;
            scannedDocs += docs.length;

            // Process docs sequentially within a page so we don't fan out
            // unbounded Wasabi requests; concurrency at the company level
            // (COMPANY_CONCURRENCY) gives us enough parallelism overall.
            for (const doc of docs) {
                if (deletedCount >= cap) break;
                const oldShots = (doc.trackShots || []).filter(
                    (t) => t && typeof t.screenShotTime === 'number' && t.screenShotTime < cutoffMs
                );
                if (!oldShots.length) continue;

                const keysToPull = [];
                for (const shot of oldShots) {
                    if (deletedCount >= cap) break;
                    // eslint-disable-next-line no-await-in-loop
                    const res = await deleteTrackshotObjects(companyId, shot);
                    if (res.mainDeleted) {
                        keysToPull.push(shot.image);
                        deletedCount += 1;
                    } else {
                        failedCount += 1;
                        failedKeys.push(...res.errors);
                    }
                    if (res.thumbsFailed) {
                        // Thumbnails are best-effort; just log and move on.
                        logger.warn(`${LOG_PREFIX} companyId=${companyId} thumb failures=${res.thumbsFailed} for main=${shot.image}`);
                    }
                }

                if (keysToPull.length) {
                    // eslint-disable-next-line no-await-in-loop
                    await MongoDbCrudOpration(companyId, {
                        type: SCHEMA_TYPE.TIMESHEET,
                        data: [
                            { _id: doc._id },
                            { $pull: { trackShots: { image: { $in: keysToPull } } } }
                        ]
                    }, 'updateOne');
                }
            }
            // Next page. We sort by _id and don't rely on the unchanged-doc
            // assumption, so use skip rather than a resumption cursor — the
            // $pull above can move docs out of the match set, which is
            // tolerable; we'll just see fewer hits on the next page.
            pagedSkip += docs.length;
        }
    } catch (err) {
        logger.error(`${LOG_PREFIX} runRetentionForCompany failed companyId=${companyId} ${err && err.message}`);
    }

    const durationMs = Date.now() - startedAt;
    const stats = {
        deletedCount,
        failedCount,
        scannedDocs,
        durationMs,
        cutoffIso: cutoff.toISOString()
    };

    // Persist stats + clear lock + stamp first-run completion when applicable.
    const finalPatch = {
        'screenshotRetention.lastRunAt': new Date(),
        'screenshotRetention.lastRunStats': stats,
        'screenshotRetention.runningSince': null
    };
    if (!policy.firstRunCompletedAt && deletedCount < cap) {
        finalPatch['screenshotRetention.firstRunCompletedAt'] = new Date();
    }
    try {
        await stampMasterField(companyId, finalPatch);
    } catch (err) {
        logger.error(`${LOG_PREFIX} could not persist run stats companyId=${companyId} ${err && err.message}`);
    }

    logger.info(`${LOG_PREFIX} companyId=${companyId} deleted=${deletedCount} failed=${failedCount} scannedDocs=${scannedDocs} durationMs=${durationMs}`);
    return stats;
}

/**
 * Helper: $set arbitrary screenshotRetention.* fields on the master doc.
 * Kept separate from updateCompanyPolicy so the cron can stamp run-state
 * fields without going through the policy validation surface.
 */
async function stampMasterField(companyId, setObj) {
    const query = {
        type: SCHEMA_TYPE.COMPANIES,
        data: [
            { _id: new mongoose.Types.ObjectId(companyId) },
            { $set: setObj },
            { new: true, useFindAndModify: false }
        ]
    };
    return MongoDbCrudOpration(SCHEMA_TYPE.GOLBAL, query, 'findOneAndUpdate');
}

// ----- Cron entry point -------------------------------------------------

/**
 * Enumerate all companies with retention enabled and process them with
 * bounded parallelism. Invoked by cron.js nightly.
 */
async function runRetentionForAllCompanies() {
    const startedAt = Date.now();
    let companies = [];
    try {
        const query = {
            type: SCHEMA_TYPE.COMPANIES,
            data: [
                { 'screenshotRetention.enabled': true },
                { _id: 1, Cst_CompanyName: 1, screenshotRetention: 1 }
            ]
        };
        companies = await MongoDbCrudOpration(SCHEMA_TYPE.GOLBAL, query, 'find');
    } catch (err) {
        logger.error(`${LOG_PREFIX} could not enumerate opted-in companies ${err && err.message}`);
        return;
    }

    if (!companies.length) {
        logger.info(`${LOG_PREFIX} no companies have retention enabled — nothing to do`);
        return;
    }

    logger.info(`${LOG_PREFIX} starting nightly run for ${companies.length} companies`);

    // Process companies in bounded batches.
    for (let i = 0; i < companies.length; i += COMPANY_CONCURRENCY) {
        const slice = companies.slice(i, i + COMPANY_CONCURRENCY);
        // Promise.allSettled so one tenant's failure doesn't poison the batch.
        // eslint-disable-next-line no-await-in-loop
        await Promise.allSettled(slice.map((cmp) => runRetentionForCompany(cmp)));
    }

    logger.info(`${LOG_PREFIX} nightly run complete in ${Math.round((Date.now() - startedAt) / 1000)}s`);
}

module.exports = {
    // policy
    getCompanyPolicy,
    updateCompanyPolicy,
    normalisePolicy,
    // preview
    countOldTrackshots,
    computeCutoff,
    // cleanup
    runRetentionForCompany,
    runRetentionForAllCompanies,
    // constants (handy for tests and the controller layer)
    VALID_MAX_AGE_MONTHS,
    DEFAULT_MAX_AGE_MONTHS
};
