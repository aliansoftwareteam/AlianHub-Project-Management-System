const { isObjectStorage } = require('./s3Config');
const { currentLayout } = require('./s3Layout');

/* A deleted workspace in prefix mode leaves its files under <prefix><companyId>/ in a bucket other
 * tenants share, so they are deleted here. The row is marked first: a run that dies half way is
 * finished by the nightly reconciliation. With a bucket per workspace, or on the server driver,
 * nothing changes: the files stay for the operator, as before. */

const log = () => require('../Config/loggerConfig');

const removesFiles = () => isObjectStorage() && currentLayout().prefixMode;

async function removeCompanyFiles(companyId, {
    store = require('./s3Store'),
    usage = require('./storageUsage'),
} = {}) {
    const { deleted } = await store.removeAll(String(companyId));
    await usage.forget(String(companyId));
    log().info(`[storage] removed ${deleted} files of deleted workspace ${companyId}`);
    return { deleted };
}

/* Resolves once the removal is recorded; the deletion itself runs in the background. */
async function scheduleCompanyFilesRemoval(companyId, deps = {}) {
    if (!removesFiles()) return { scheduled: false };
    const usage = deps.usage || require('./storageUsage');
    await usage.markForRemoval(String(companyId)).catch((error) => {
        log().error(`[storage] could not record the removal of ${companyId}: ${error && error.message ? error.message : error}`);
    });
    setImmediate(() => {
        removeCompanyFiles(companyId, deps).catch((error) => {
            log().error(`[storage] removing the files of ${companyId} stopped, the nightly run retries: ${error && error.message ? error.message : error}`);
        });
    });
    return { scheduled: true };
}

module.exports = { removeCompanyFiles, scheduleCompanyFilesRemoval, removesFiles };
