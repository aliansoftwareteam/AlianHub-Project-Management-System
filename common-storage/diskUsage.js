const fs = require('fs');
const path = require('path');
const usage = require('./storageUsage');
const { PUBLIC_OWNER } = require('./s3Layout');

/* The server driver keeps the same counter as object storage: a company's files live in
 * storage/<companyId>, avatars and public files in storage/USER_PROFILES. */

const STORAGE_ROOT = path.join(__dirname, '..', 'storage');
const PROFILE_DIR = 'USER_PROFILES';

const ownerOfBucket = (bucketId) => (String(bucketId) === PROFILE_DIR ? PUBLIC_OWNER : String(bucketId));
const dirOfOwner = (owner) => path.join(STORAGE_ROOT, owner === PUBLIC_OWNER ? PROFILE_DIR : String(owner));

const fileSize = (file) => {
    try {
        const stat = fs.statSync(file);
        return stat.isFile() ? stat.size : null;
    } catch (error) {
        return null;
    }
};

const sizesOf = (files) => files.map(fileSize).filter((size) => size !== null);

/* replacedSizes: what the files written over held before, so a replacement adds only the difference. */
const countWritten = (bucketId, files, replacedSizes = []) => {
    const sizes = sizesOf(files.filter(Boolean));
    const total = (list) => list.reduce((sum, size) => sum + size, 0);
    return usage.add(ownerOfBucket(bucketId), total(sizes) - total(replacedSizes), sizes.length - replacedSizes.length);
};

/* Sizes are read before the unlink and counted only for the files that are then gone. */
const countRemoved = (bucketId, sizedFiles) => {
    const gone = sizedFiles.filter(({ file, size }) => size !== null && fileSize(file) === null);
    return usage.add(ownerOfBucket(bucketId), -gone.reduce((sum, { size }) => sum + size, 0), -gone.length);
};

const sized = (files) => files.filter(Boolean).map((file) => ({ file, size: fileSize(file) }));

async function measureDir(dir) {
    let bytes = 0;
    let objects = 0;
    const walk = async (current) => {
        const entries = await fs.promises.readdir(current, { withFileTypes: true }).catch(() => []);
        for (const entry of entries) {
            const full = path.join(current, entry.name);
            if (entry.isDirectory()) await walk(full);
            else if (entry.isFile()) {
                const stat = await fs.promises.stat(full).catch(() => null);
                if (stat) {
                    bytes += stat.size;
                    objects += 1;
                }
            }
        }
    };
    await walk(dir);
    return { bytes, objects };
}

const measureOwner = (owner) => measureDir(dirOfOwner(owner));

module.exports = { countWritten, countRemoved, sized, fileSize, measureOwner, measureDir, ownerOfBucket, dirOfOwner, STORAGE_ROOT, PROFILE_DIR };
