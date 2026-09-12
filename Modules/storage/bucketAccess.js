const mongoose = require('mongoose');
const { verifyCompanyMembership } = require('../../Config/jwt');
const { MongoDbCrudOpration } = require('../../utils/mongo-handler/mongoQueries');
const { dbCollections } = require('../../Config/collections');
const { SCHEMA_TYPE } = require('../../Config/schemaType');
const { myCache } = require('../../Config/config');
const { isPrivileged } = require('../../Config/roleTypes');
const { safeFileFilter, safeRelativePath } = require('../../utils/uploadConfig');
const { ACTIVE_SEAT } = require('../../Config/seatStatus');
const { escapeRegex } = require('../../utils/escapeRegex');

const OBJECT_ID = /^[a-f0-9]{24}$/i;
const USER_PROFILES_BUCKET = 'USER_PROFILES';
const OWNED_PROFILE_IMAGE = /^([a-f0-9]{24})_/i;
const THUMBNAIL_SUFFIX = /-\d+x\d+(\.[^./]+)$/i;
const CREDIT_NOTES = 'InvoiceAndCreditNotes/';
const CREDIT_NOTE_COMPANY = /^InvoiceAndCreditNotes\/CreditNotes\/([a-f0-9]{24})\//i;
const LOOKUP_CACHE_TTL = 60;

const refuse = (res, code, statusText) => res.status(code).json({ status: false, statusText, message: statusText });
const refusal = (code, statusText) => ({ code, statusText });

const inAudience = (aud, companyId) => {
    if (!aud) return false;
    const list = Array.isArray(aud) ? aud : String(aud).split(',');
    return list.some((entry) => String(entry).trim() === companyId);
};

async function hasActiveSeat(uid, companyId) {
    const seat = await MongoDbCrudOpration(companyId, {
        type: SCHEMA_TYPE.COMPANY_USERS,
        data: [{ userId: uid, ...ACTIVE_SEAT }, { _id: 1 }],
    }, 'findOne');
    return Boolean(seat);
}

/* A company's bucket id is the company _id. The JWT audience is frozen at login, and removing
 * someone from the member list leaves users.AssignCompany in place, so the company_users seat
 * is what locks out a removed member. */
async function belongsToCompany(req, companyId) {
    const id = String(companyId || '');
    const uid = String(req.uid || '');
    if (!OBJECT_ID.test(uid) || !OBJECT_ID.test(id) || !inAudience(req.aud, id)) return false;
    return (await verifyCompanyMembership(uid, id)) && hasActiveSeat(uid, id);
}

function mayWriteProfileImage(uid, filePath) {
    const id = String(uid || '');
    const name = String(filePath || '');
    return OBJECT_ID.test(id) && name.startsWith(`${id}_`) && !name.includes('/') && safeRelativePath(name) === name;
}

const findUser = (query, projection = { _id: 1 }) => MongoDbCrudOpration(dbCollections.GLOBAL, { type: dbCollections.USERS, data: [query, projection] }, 'findOne');

async function cached(key, resolve) {
    const hit = myCache.get(key);
    if (hit !== undefined) return hit;
    const value = await resolve();
    myCache.set(key, value, LOOKUP_CACHE_TTL);
    return value;
}

const sameNameIgnoringCase = (name) => ({ $regex: `^${escapeRegex(name)}$`, $options: 'i' });

/* Images uploaded before names carried the owner's id have no owner except the user record that
 * points at them, and a user can point their own record at any name. So a legacy name is only
 * removable while no other user points at it or at the image it is a thumbnail of. Other users'
 * names are matched ignoring case because the disk under storage/ may ignore it too. */
async function isOwnLegacyProfileImage(uid, name) {
    if (!OBJECT_ID.test(uid) || name.includes('/') || OWNED_PROFILE_IMAGE.test(name) || safeRelativePath(name) !== name) return false;
    const self = new mongoose.Types.ObjectId(uid);
    if (!(await findUser({ _id: self, Employee_profileImage: name }))) return false;
    for (const candidate of new Set([name, name.replace(THUMBNAIL_SUFFIX, '$1')])) {
        const sameName = sameNameIgnoringCase(candidate);
        const other = await findUser({ _id: { $ne: self }, $or: [{ Employee_profileImage: sameName }, { Employee_profileImageURL: sameName }] });
        if (other) return false;
    }
    return true;
}

async function mayRemoveProfileImage(uid, filePath) {
    return mayWriteProfileImage(uid, filePath) || isOwnLegacyProfileImage(String(uid || ''), String(filePath || ''));
}

/* An image uploaded since #639 names its owner. A legacy name has no owner but the user
 * record pointing at it, and PUT /api/v1/user now only lets a user point at a name they
 * may write or already hold, so that record is as good as the prefix. */
async function profileImageOwner(name) {
    const owned = OWNED_PROFILE_IMAGE.exec(name);
    if (owned) return owned[1].toLowerCase();
    return cached(`profileImageOwner:${name}`, async () => {
        for (const candidate of new Set([name, name.replace(THUMBNAIL_SUFFIX, '$1')])) {
            const sameName = sameNameIgnoringCase(candidate);
            const holder = await findUser({ $or: [{ Employee_profileImage: sameName }, { Employee_profileImageURL: sameName }] });
            if (holder) return String(holder._id).toLowerCase();
        }
        return null;
    });
}

const companiesOf = (uid) => cached(`profileImageOwnerCompanies:${uid}`, async () => {
    const owner = await findUser({ _id: new mongoose.Types.ObjectId(uid) }, { AssignCompany: 1 });
    return ((owner && owner.AssignCompany) || []).map(String);
});

/* Avatars are shown all over the app, so a colleague may read one; someone with no live
 * seat in any company the owner belongs to may not. */
async function mayReadAvatar(req, name) {
    const uid = String(req.uid || '').toLowerCase();
    const ownerId = await profileImageOwner(name);
    if (!ownerId) return false;
    if (ownerId === uid) return true;
    for (const companyId of await companiesOf(ownerId)) {
        if (await belongsToCompany(req, companyId)) return true;
    }
    return false;
}

/* Credit notes are billing documents that happen to share the profile bucket. They go to
 * the people the billing screens are for: an owner or admin of the company they belong to. */
async function mayReadCreditNote(req, name) {
    const match = CREDIT_NOTE_COMPANY.exec(name);
    if (!match || !(await belongsToCompany(req, match[1]))) return false;
    const { getRoleType } = require('../../Config/permissionGuard');
    return isPrivileged(await getRoleType(match[1], req.uid));
}

async function mayReadProfileImage(req, filePath) {
    const name = String(filePath || '');
    if (!name || safeRelativePath(name) !== name) return false;
    if (name.startsWith(CREDIT_NOTES)) return mayReadCreditNote(req, name);
    return name.includes('/') ? false : mayReadAvatar(req, name);
}

const PROFILE_WRITE = { allows: (req, filePath) => mayWriteProfileImage(req.uid, filePath), refusal: 'You can only change your own profile image' };
const PROFILE_REMOVAL = { allows: (req, filePath) => mayRemoveProfileImage(req.uid, filePath), refusal: 'You can only change your own profile image' };
const PROFILE_READ = { allows: mayReadProfileImage, refusal: 'You do not have access to this file' };

async function accessRefusal(req, bucketId, filePath, profileRule) {
    if (!req.uid) return refusal(401, 'Unauthorized');
    if (String(bucketId || '') === USER_PROFILES_BUCKET) {
        return (await profileRule.allows(req, filePath)) ? null : refusal(403, profileRule.refusal);
    }
    return (await belongsToCompany(req, bucketId)) ? null : refusal(403, 'You do not have access to this bucket');
}

async function uploadRefusal(req, bucketId, filePath) {
    return (await accessRefusal(req, bucketId, filePath, PROFILE_WRITE))
        || (safeRelativePath(filePath) ? null : refusal(400, 'Invalid path'));
}

const isProfileUpload = (body) => Boolean(body) && (body.isUserProfile === true || body.isUserProfile === 'true');

/* multer runs fileFilter before the storage engine opens the file, so a refusal here writes nothing.
 * Fields sent after the file part are not parsed yet and count as missing. */
function refuseBeforeWrite(findRefusal) {
    return (req, file, cb) => {
        Promise.resolve(findRefusal(req)).then((found) => {
            if (!found) return safeFileFilter(req, file, cb);
            req.uploadRefusal = found;
            return cb(null, false);
        }).catch(cb);
    };
}

function refuseUpload(findRefusal) {
    return async (req, res, next) => {
        try {
            const found = req.uploadRefusal || await findRefusal(req);
            return found ? refuse(res, found.code, found.statusText) : next();
        } catch (error) {
            return refuse(res, 500, error.message);
        }
    };
}

function requireAccess(pickBucketId, pickPath, profileRule) {
    return async (req, res, next) => {
        try {
            const found = await accessRefusal(req, pickBucketId(req), pickPath(req), profileRule);
            return found ? refuse(res, found.code, found.statusText) : next();
        } catch (error) {
            return refuse(res, 500, error.message);
        }
    };
}

const requireBucketWrite = (pickBucketId, pickPath) => requireAccess(pickBucketId, pickPath, PROFILE_WRITE);
const requireBucketRemoval = (pickBucketId, pickPath) => requireAccess(pickBucketId, pickPath, PROFILE_REMOVAL);
const requireBucketRead = (pickBucketId, pickPath) => requireAccess(pickBucketId, pickPath, PROFILE_READ);
const requireProfileImageRead = (pickPath) => requireAccess(() => USER_PROFILES_BUCKET, pickPath, PROFILE_READ);

function requireOwnBucket(pickBucketId) {
    return async (req, res, next) => {
        if (!req.uid) return refuse(res, 401, 'Unauthorized');
        const bucketId = String(pickBucketId(req) || '');
        try {
            if (await belongsToCompany(req, bucketId)) return next();
        } catch (error) {
            return refuse(res, 500, error.message);
        }
        return refuse(res, 403, 'You do not have access to this bucket');
    };
}

function requireSafeObjectPath(pickPath) {
    return (req, res, next) => (safeRelativePath(pickPath(req)) ? next() : refuse(res, 400, 'Invalid path'));
}

const bucketIdParam = (req) => req.params && req.params.bucketId;
const bodyField = (key) => (req) => req.body && req.body[key];
const queryField = (key) => (req) => req.query && req.query[key];
const paramField = (key) => (req) => req.params && req.params[key];

module.exports = {
    USER_PROFILES_BUCKET,
    belongsToCompany,
    mayWriteProfileImage,
    mayRemoveProfileImage,
    mayReadProfileImage,
    uploadRefusal,
    isProfileUpload,
    refuseBeforeWrite,
    refuseUpload,
    requireBucketWrite,
    requireBucketRemoval,
    requireBucketRead,
    requireProfileImageRead,
    requireOwnBucket,
    requireSafeObjectPath,
    bucketIdParam,
    bodyField,
    queryField,
    paramField,
};
