const mongoose = require('mongoose');
const { verifyCompanyMembership } = require('../../Config/jwt');
const { MongoDbCrudOpration } = require('../../utils/mongo-handler/mongoQueries');
const { dbCollections } = require('../../Config/collections');
const { SCHEMA_TYPE } = require('../../Config/schemaType');
const { safeFileFilter, safeRelativePath } = require('../../utils/uploadConfig');
const { ACTIVE_SEAT } = require('../../Config/seatStatus');
const { escapeRegex } = require('../../utils/escapeRegex');

const OBJECT_ID = /^[a-f0-9]{24}$/i;
const USER_PROFILES_BUCKET = 'USER_PROFILES';
const OWNED_PROFILE_IMAGE = /^[a-f0-9]{24}_/i;
const THUMBNAIL_SUFFIX = /-\d+x\d+(\.[^./]+)$/i;

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

const findUser = (query) => MongoDbCrudOpration(dbCollections.GLOBAL, { type: dbCollections.USERS, data: [query, { _id: 1 }] }, 'findOne');

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

async function accessRefusal(req, bucketId, filePath, mayUseProfileImage) {
    if (!req.uid) return refusal(401, 'Unauthorized');
    if (String(bucketId || '') === USER_PROFILES_BUCKET) {
        return (await mayUseProfileImage(req.uid, filePath)) ? null : refusal(403, 'You can only change your own profile image');
    }
    return (await belongsToCompany(req, bucketId)) ? null : refusal(403, 'You do not have access to this bucket');
}

async function uploadRefusal(req, bucketId, filePath) {
    return (await accessRefusal(req, bucketId, filePath, mayWriteProfileImage))
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

function requireAccess(pickBucketId, pickPath, mayUseProfileImage) {
    return async (req, res, next) => {
        try {
            const found = await accessRefusal(req, pickBucketId(req), pickPath(req), mayUseProfileImage);
            return found ? refuse(res, found.code, found.statusText) : next();
        } catch (error) {
            return refuse(res, 500, error.message);
        }
    };
}

const requireBucketWrite = (pickBucketId, pickPath) => requireAccess(pickBucketId, pickPath, mayWriteProfileImage);
const requireBucketRemoval = (pickBucketId, pickPath) => requireAccess(pickBucketId, pickPath, mayRemoveProfileImage);

function requireOwnBucket(pickBucketId, { allowUserProfiles = false } = {}) {
    return async (req, res, next) => {
        if (!req.uid) return refuse(res, 401, 'Unauthorized');
        const bucketId = String(pickBucketId(req) || '');
        if (allowUserProfiles && bucketId === USER_PROFILES_BUCKET) return next();
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

module.exports = {
    USER_PROFILES_BUCKET,
    belongsToCompany,
    mayWriteProfileImage,
    mayRemoveProfileImage,
    uploadRefusal,
    isProfileUpload,
    refuseBeforeWrite,
    refuseUpload,
    requireBucketWrite,
    requireBucketRemoval,
    requireOwnBucket,
    requireSafeObjectPath,
    bucketIdParam,
    bodyField,
    queryField,
};
