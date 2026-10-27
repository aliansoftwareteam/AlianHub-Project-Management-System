const hostingMode = require('../../Config/hostingMode');
const { canStore, fileAllowed, unlimited } = require('./checks');
const { refusalError } = require('./answers');
const { limits } = require('./entitlements');

const CACHE_MS = 5 * 1000;
const UNMETERED_OWNERS = new Set(['USER_PROFILES', 'public']);

let readUsage = () => require('../../common-storage/storageUsage').instanceStorageUsage();
let cached = null;

/* Sizes allowed since the last read are added on, so uploads in a burst see each other. */
async function usedBytes(now = Date.now()) {
    if (!cached || now - cached.at >= CACHE_MS) {
        const usage = await readUsage();
        cached = { at: now, bytes: Number(usage && usage.bytes) || 0 };
    }
    return cached.bytes;
}

const forgetStorage = () => { cached = null; };

/* Avatars and the instance's own public assets belong to no workspace and are never refused. */
const metered = (companyId) => Boolean(companyId) && !UNMETERED_OWNERS.has(String(companyId));

/* null, or { code, limit, used } when the file may not be stored. A size of 0 (not known yet)
 * still refuses once the quota is spent. Self-hosted: always null. */
async function uploadLimitRefusal(companyId, size = 0) {
    if (!hostingMode.isManaged() || !metered(companyId)) return null;
    const planLimits = limits();
    const file = fileAllowed({ size, maxFileBytes: planLimits.maxFileBytes });
    if (!file.ok) return file;
    if (unlimited(planLimits.storageBytes)) return null;
    let stored = canStore({ usedBytes: await usedBytes(), adding: size, limit: planLimits.storageBytes });
    if (!stored.ok) {
        forgetStorage();
        stored = canStore({ usedBytes: await usedBytes(), adding: size, limit: planLimits.storageBytes });
        if (!stored.ok) return stored;
    }
    if (cached && size > 0) cached.bytes += Number(size);
    return null;
}

async function assertUploadAllowed(companyId, size = 0) {
    const refusal = await uploadLimitRefusal(companyId, size);
    if (refusal) throw refusalError(refusal);
}

/* What multer may stream before cutting a file off: the environment's cap, lowered to the plan's
 * largest file on a hosted instance. */
function maxUploadBytes(envCap) {
    if (!hostingMode.isManaged()) return envCap;
    const planMax = limits().maxFileBytes;
    return unlimited(planMax) ? envCap : Math.min(envCap, Number(planMax));
}

/* What an upload request says it carries: the stored file, a base64 body, or nothing yet. */
function declaredUploadSize(req) {
    if (req && req.file && Number.isFinite(Number(req.file.size))) return Number(req.file.size);
    const body = (req && req.body) || {};
    const base64 = [body.base64String, body.file].find((value) => typeof value === 'string' && value.length > 0);
    if (base64) return Math.floor(base64.replace(/^data:[^,]*,/, '').length * 3 / 4);
    return 0;
}

module.exports = {
    CACHE_MS, uploadLimitRefusal, assertUploadAllowed, maxUploadBytes, declaredUploadSize, forgetStorage,
    _useUsageForTests: (next) => { readUsage = next; cached = null; },
};
