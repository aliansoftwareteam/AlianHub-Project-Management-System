const { isObjectStorage } = require('./s3Config');
const { PUBLIC_OWNER } = require('./s3Layout');

/* Nightly: every workspace and the public area is measured by a full listing (or a walk of
 * storage/ on the server driver) and its counter set to what was found. Drift above 1% means an
 * upload or delete path does not count, so it is logged as a warning. */

const DRIFT_WARNING = 0.01;
const CONCURRENCY = 3;

const log = () => require('../Config/loggerConfig');
const message = (error) => (error && error.message ? error.message : String(error));

const defaults = () => ({
    usage: require('./storageUsage'),
    measure: (owner) => (isObjectStorage() ? require('./s3Store').measure(owner) : require('./diskUsage').measureOwner(owner)),
    companies: async () => {
        const { getCompanyDataFun } = require('../Modules/Company/controller/updateCompany');
        return ((await getCompanyDataFun([], true)) || []).map((company) => String(company._id));
    },
    removeCompanyFiles: (companyId) => require('./companyFiles').removeCompanyFiles(companyId),
    logger: log(),
});

async function reconcileOwner(owner, deps) {
    const actual = await deps.measure(owner);
    const { before, drift } = await deps.usage.correct(owner, actual);
    const summary = `${owner}: counted ${before.bytes} bytes, found ${actual.bytes} in ${actual.objects} files`;
    if (!before.reconciledAt) deps.logger.info(`[storage-usage] first count, ${summary}`);
    else if (drift > DRIFT_WARNING) deps.logger.warn(`[storage-usage] ${(drift * 100).toFixed(1)}% drift, ${summary}; an upload or delete path is not counted`);
    return { owner, ...actual, counted: before.bytes, drift };
}

async function inBatches(items, run) {
    const results = [];
    for (let i = 0; i < items.length; i += CONCURRENCY) {
        results.push(...await Promise.all(items.slice(i, i + CONCURRENCY).map(run)));
    }
    return results;
}

async function reconcileAll(overrides = {}) {
    const deps = { ...defaults(), ...overrides };
    const pending = await deps.usage.pendingRemovals();
    for (const companyId of pending) {
        await deps.removeCompanyFiles(companyId).catch((error) => deps.logger.error(`[storage-usage] removing ${companyId} failed again: ${message(error)}`));
    }
    const known = await deps.companies();
    const counted = ((await deps.usage.instanceStorageUsage()).byWorkspace || []).map((row) => row.companyId);
    const strays = counted.filter((owner) => !known.includes(owner) && !pending.includes(owner));
    const owners = [...new Set([...known, PUBLIC_OWNER, ...strays])];
    const results = await inBatches(owners, (owner) => reconcileOwner(owner, deps).catch((error) => {
        deps.logger.error(`[storage-usage] could not measure ${owner}: ${message(error)}`);
        return { owner, error: message(error) };
    }));
    for (const owner of strays) {
        const found = results.find((row) => row.owner === owner);
        if (found && !found.error && !found.bytes) await deps.usage.forget(owner).catch(() => {});
    }
    return results;
}

module.exports = { reconcileAll, reconcileOwner, DRIFT_WARNING };
