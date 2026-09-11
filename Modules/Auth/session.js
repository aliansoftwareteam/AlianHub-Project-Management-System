const mongoC = require("../../utils/mongo-handler/mongoQueries")
const { myCache } = require('../../Config/config');
const serviceCtr = require("../serviceFunction.js")
const { removeCache } = require('../../utils/commonFunctions');
const { dbCollections } = require("../../Config/collections.js");
const { newSessionCredentials } = require("./helpers/refreshSession");
const { sessionTokenQuery } = require("./helpers/refreshTokenRules");


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
            const cacheKey = `session:${reqData.userId}:${credentials.refreshToken}`;
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


/**
 * Update Session Function
 * @param {Object} reqData 
 * @param {*} cb 
 * @returns 
 */
exports.updateSessionFun = async (reqData, cb) => {
    try {
        if (!(reqData && reqData.userId)) {
            cb({
                status: false,
                message: "User Id is require"
            });
            return;
        }
        if (!(reqData && reqData.refreshToken)) {
            cb({
                status: false,
                message: "Refresh Token is require"
            });
            return;
        }
        let obj = {
            type: dbCollections.SESSIONS,
            data: [
                { userId: reqData.userId, ...sessionTokenQuery(reqData.refreshToken) },
                reqData.updateObject
            ]
        }

        mongoC.MongoDbCrudOpration(dbCollections.GLOBAL, obj, "findOneAndUpdate").then((res)=>{
            const cacheKey = `session:${reqData.userId}:${reqData.refreshToken}`;
            removeCache(cacheKey, true);
            cb({
                status: true,
                data: {userId: reqData.userId, refreshToken: reqData.refreshToken}
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
        exports.updateSessionFun(req.body, (resData) => {
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
    const targetRole = await getRoleType(companyId, targetId);
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
        const bodyData = req.body;
        let obj = {
            type: dbCollections.SESSIONS,
            data: [{
                userId: bodyData.id,
                ...sessionTokenQuery(bodyData.refreshToken)
            }]
        }
        mongoC.MongoDbCrudOpration(dbCollections.GLOBAL, obj, "deleteMany").then((resData)=>{
            // Treat "no session found" as success — the user is already logged out.
            // Only propagate failures if the DB operation itself throws (handled in .catch).
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
