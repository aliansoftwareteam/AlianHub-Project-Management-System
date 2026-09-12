const mongoose = require("mongoose");
const mongoC = require("../../utils/mongo-handler/mongoQueries")
const { myCache } = require('../../Config/config');
const serviceCtr = require("../serviceFunction.js")
const { removeCache } = require('../../utils/commonFunctions');
const { dbCollections } = require("../../Config/collections.js");
const { newSessionCredentials } = require("./helpers/refreshSession");
const { sessionCacheKey } = require("./helpers/refreshTokenRules");


/**
 * Insert Session Function
 * @param {Object} reqData 
 * @param {Object} cb 
 * @returns 
 */
exports.insertSessionFun = async (reqData, userAgent, ip, cb) => {
    try {
        if (!(reqData && reqData.userId)) {
            cb({
                status: false,
                message: "User id is require"
            });
            return;
        }
        const userAgentObj = serviceCtr.getBrowersInfo(userAgent) || {};
        const credentials = newSessionCredentials(reqData.userId);
        let obj = {
            type: dbCollections.SESSIONS,
            data: {
                ...credentials.fields,
                userId: reqData.userId,
                ip: ip,
                info: userAgentObj
            }
        }
        mongoC.MongoDbCrudOpration(dbCollections.GLOBAL, obj, "save").then((res)=>{
            const cacheKey = sessionCacheKey(String(reqData.userId), String(res._id), credentials.fields.refreshTokenJti);
            myCache.set(cacheKey, JSON.stringify({_id: res._id, userId: reqData.userId}), 600);
            cb({
                status: true,
                data: {userId: reqData.userId, refreshToken: credentials.refreshToken, _id: res._id},
            })
        }).catch((error)=>{
            cb({
                status: false,
                message: serviceCtr.mongoErrorMessage(error)
            });
        })
    } catch (error) {
        cb({
            status: false,
            message: error.message || error
        });
    }
};


const SESSION_UPDATABLE_FIELDS = {
    webToken: (value) => typeof value === 'string',
    lastActive: (value) => (typeof value === 'string' || typeof value === 'number') && !Number.isNaN(new Date(value).getTime()),
};

// The body used to be handed to Mongo as the update itself, which let a caller rewrite
// the owner or token fields of their own session row.
const sessionUpdateOf = (updateObject) => {
    if (!updateObject || typeof updateObject !== 'object' || Array.isArray(updateObject)) return null;
    const entries = Object.entries(updateObject);
    const allowed = entries.length && entries.every(([field, value]) => Object.hasOwn(SESSION_UPDATABLE_FIELDS, field) && SESSION_UPDATABLE_FIELDS[field](value));
    if (!allowed) return null;
    return { $set: Object.fromEntries(entries.map(([field, value]) => [field, field === 'lastActive' ? new Date(value) : value])) };
};

exports.updateSessionFun = async (reqData, cb) => {
    try {
        if (!(reqData && reqData.userId)) {
            cb({
                status: false,
                message: "User Id is require"
            });
            return;
        }
        if (!(reqData.sessionId && mongoose.Types.ObjectId.isValid(reqData.sessionId))) {
            cb({
                status: false,
                message: "Session id is required"
            });
            return;
        }
        const update = sessionUpdateOf(reqData.updateObject);
        if (!update) {
            cb({
                status: false,
                message: "Only webToken and lastActive can be updated"
            });
            return;
        }
        let obj = {
            type: dbCollections.SESSIONS,
            data: [
                { _id: new mongoose.Types.ObjectId(reqData.sessionId), userId: String(reqData.userId) },
                update
            ]
        }

        mongoC.MongoDbCrudOpration(dbCollections.GLOBAL, obj, "findOneAndUpdate").then(()=>{
            cb({
                status: true,
                data: {userId: reqData.userId, _id: reqData.sessionId}
            })
        }).catch((error)=>{
            cb({
                status: false,
                message: serviceCtr.mongoErrorMessage(error)
            });
        })
    } catch (error) {
        cb({
            status: false,
            message: error.message || error
        });
    }
};


exports.updateSession = (req, res) => {
    try {
        exports.updateSessionFun({ userId: req.uid, sessionId: req.sessionId, updateObject: req.body && req.body.updateObject }, (resData) => {
            if (!(resData && resData.status)) {
                res.status(400).json({message: resData.message});
                return;
            }
            res.status(200).json(resData);
        });
    } catch (error) {
        res.status(400).json({message: error.message ? error.message : error});
    }
}
exports.getSessionwithRefreshTokenFun = (data, cb) => {
    try {
        let obj = {
            type: dbCollections.SESSIONS,
            data: [{
                userId: data.userId,
                ip: data.ip,
                refreshToken: data.refreshToken,
                browser: data.browser || "",
                os: data.os || ""
            }]
        }
        mongoC.MongoDbCrudOpration(dbCollections.GLOBAL, obj, "findOne").then((resData)=>{
            if ((!resData && resData._id)) {
                cb({
                    status: false,
                    message: "session not found"
                });
                return;
            }
            cb({
                status: true,
                data: {userId: data.userId, refreshToken: obj.data.refreshToken, _id: resData._id},
            })
        }).catch((error)=>{
            cb({
                status: false,
                message: serviceCtr.mongoErrorMessage(error)
            });
        })
    } catch (error) {
        cb({status: false, message: error.message ? error.message : error});
    }
};


// An empty filter here would sign out every user on the instance.
exports.deleteSessionFun = (id, cb) => {
    try {
        if (!id) {
            cb({ status: false, message: "User id is required" });
            return;
        }
        let obj = {
            type: dbCollections.SESSIONS,
            data: [{ userId: String(id) }]
        }
        mongoC.MongoDbCrudOpration(dbCollections.GLOBAL, obj, "deleteMany").then((resData)=>{
            if (!(resData && resData.deletedCount)) {
                cb({
                    status: false,
                    message: "session not found"
                });
                return;
            }
            
            cb({
                status: true,
                data: resData,
            })
        }).catch((error)=>{
            cb({
                status: false,
                message: serviceCtr.mongoErrorMessage(error)
            });
        });
    } catch (error) {
        cb({status: false, message: error.message ? error.message : error});
    }
};

const respondDeleted = (res, userId) => (resData) => {
    if (!(resData && resData.status)) {
        res.status(400).json({status: false, message: resData.message});
        return;
    }
    removeCache(`session:${userId}:`, true);
    res.status(200).json(resData);
};

exports.deleteAllSession = (req, res) => {
    try {
        if (!req.uid) {
            return res.status(401).json({ status: false, message: "Unauthorized" });
        }
        exports.deleteSessionFun(String(req.uid), respondDeleted(res, String(req.uid)));
    } catch (error) {
        res.status(400).json({status: false, message: error.message ? error.message : error});
    }
};

const OBJECT_ID_PATTERN = /^[a-f0-9]{24}$/i;

exports.canManageUserSessions = async (uid, targetId, companyId) => {
    if (String(uid) === String(targetId)) return true;
    if (!OBJECT_ID_PATTERN.test(String(targetId || '')) || !OBJECT_ID_PATTERN.test(String(companyId || ''))) return false;
    const { getRoleType, isPrivileged, ROLE_OWNER } = require("../../Config/permissionGuard");
    const callerRole = await getRoleType(companyId, uid);
    if (!isPrivileged(callerRole)) return false;
    // Ending a departed member's sessions is exactly what an admin needs after removing them, so the
    // target's role is read from whatever row they still hold.
    const targetRole = await getRoleType(companyId, targetId, { seat: 'any' });
    if (targetRole === null) return false;
    return callerRole === ROLE_OWNER || targetRole !== ROLE_OWNER;
};

exports.deleteUserSpecificSession = async (req, res) => {
    try {
        if (!req.uid) {
            return res.status(401).json({ status: false, message: "Unauthorized" });
        }
        if (!(req.params && req.params.id)) {
            res.status(400).json({status: false, message: "User id is required"});
            return;
        }
        const targetId = String(req.params.id);
        const allowed = await exports.canManageUserSessions(String(req.uid), targetId, req.headers['companyid']);
        if (!allowed) {
            return res.status(403).json({ status: false, message: "You can only sign out your own sessions, or a member of a company you administer." });
        }
        exports.deleteSessionFun(targetId, respondDeleted(res, targetId));
    } catch (error) {
        res.status(400).json({status: false, message: error.message ? error.message : error});
    }
};


exports.removeSession = (req, cb) => {
    try {
        // Treat "no session found" as success — the user is already logged out.
        // Only propagate failures if the DB operation itself throws (handled in .catch).
        if (!(req.uid && req.sessionId && mongoose.Types.ObjectId.isValid(req.sessionId))) {
            cb({ status: true, data: { deletedCount: 0 } });
            return;
        }
        let obj = {
            type: dbCollections.SESSIONS,
            data: [{
                _id: new mongoose.Types.ObjectId(req.sessionId),
                userId: String(req.uid)
            }]
        }
        mongoC.MongoDbCrudOpration(dbCollections.GLOBAL, obj, "deleteMany").then((resData)=>{
            removeCache(`session:${req.uid}:${req.sessionId}:`, true);
            cb({
                status: true,
                data: resData,
            })
        }).catch((error)=>{
            cb({
                status: false,
                message: serviceCtr.mongoErrorMessage(error)
            });
        });
    } catch (error) {
        cb({status: false, message: error.message ? error.message : error});
    }
};
