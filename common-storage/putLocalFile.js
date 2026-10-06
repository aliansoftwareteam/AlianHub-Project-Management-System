const fs = require('fs');
const path = require('path');

// Put a file that is already on local disk where a normal upload would have put
// it, honouring STORAGE_TYPE.
//
// This exists because there is no Buffer or stream entry point anywhere in
// common-storage/: every write primitive reads a local path. It is also NOT
// `handleFileUploadForTrackerSS`, which looks like the generic entry point but
// on STORAGE_TYPE=server only generates thumbnails and resolves
// {status:false, statusText:'Invalid Key thumbnail'} without writing the file
// and without throwing — a caller would store a record pointing at a file that
// was never created.
//
// The shape below mirrors Modules/CloudStorage/controller.js's storeImportedFile,
// which solved the same problem first; that copy is left in place rather than
// rewired, since it works and this is additive.

const STORAGE_ROOT = path.join(__dirname, '..', 'storage');

/**
 * @param {string} companyId  the tenant — the Wasabi bucket, or the directory
 *                            under storage/ for the server driver
 * @param {string} storagePath the object key. Must be derived by the caller from
 *                            trusted values: on the public form path nothing the
 *                            submitter sends may reach it.
 * @param {string} tmpPath    a local file to read
 * @param {string} filename   the original name, used only for the size/name the
 *                            wasabi helper reads off a multer-like object
 * @param {number} size
 * @returns {Promise<string>} the resolved key, which is what to store on the
 *                            record — the wasabi helper may rename what it was
 *                            given.
 */
const putLocalFile = async ({ companyId, storagePath, tmpPath, filename, size }) => {
    const storageType = String(process.env.STORAGE_TYPE || 'wasabi');

    if (storageType === 'server') {
        // Server storage: multer normally writes straight to the final location,
        // so "uploading" is placing the file there. The source is left for the
        // caller to unlink — unlike the wasabi branch, which consumes it.
        const dest = path.join(STORAGE_ROOT, String(companyId), storagePath);
        fs.mkdirSync(path.dirname(dest), { recursive: true });
        fs.copyFileSync(tmpPath, dest);
        return { key: storagePath, consumedSource: false };
    }

    const { uploadFileWasabiPromise } = require('../Modules/storage/wasabi/controller');
    // Same argument shape the /api/v1/wasabi/uploadFile route passes. The empty
    // thumbnail key is deliberate: generating thumbnails would mean running an
    // image decoder over bytes an anonymous submitter chose.
    const stored = await uploadFileWasabiPromise(
        String(companyId),
        storagePath,
        tmpPath,
        false,
        { path: tmpPath, originalname: filename, size },
        '',
    );
    // This branch reads and then unlinks the source itself.
    return { key: Array.isArray(stored) ? stored[0] : stored, consumedSource: true };
};

module.exports = { putLocalFile, STORAGE_ROOT };
