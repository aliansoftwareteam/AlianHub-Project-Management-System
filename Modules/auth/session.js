const mongoC = require("../../utils/mongo-handler/mongoQueries")
const { myCache } = require('../../Config/config');
const serviceCtr = require("../serviceFunction.js")
const { removeCache } = require('../../utils/commonFunctions');
const { dbCollections } = require("../../Config/collections.js");
const { generateToken } = require("../../Config/jwt.js");


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
        let obj = {
            type: dbCollections.SESSIONS,
            data: {
                userId: reqData.userId,
                ip: ip,
                refreshToken: generateToken(Number(process.env.SESSIONEXPIREDTIME || 172800)),
                info: userAgentObj
            }
        }
        mongoC.MongoDbCrudOpration(dbCollections.GLOBAL, obj, "save").then((res)=>{
            const cacheKey = `session:${reqData.userId}:${obj.data.refreshToken}`;
            myCache.set(cacheKey, JSON.stringify({_id: res._id, userId: reqData.userId, refreshToken: obj.data.refreshToken}), 600);
            cb({
                status: true,
                data: {userId: reqData.userId, refreshToken: obj.data.refreshToken, _id: res._id},
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
                { refreshToken: reqData.refreshToken, userId: reqData.userId },
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
/**
 * Register Sesstion
 * @param {Object} req 
 * @param {Object} res 
 */
exports.registerSesstion = (req, res) => {
    try {
        const forwarded = req?.headers['x-forwarded-for'] || req.ip;
        const clientIp = forwarded ? forwarded?.split(',')[0] : req?.connection?.remoteAddress;
        exports.insertSessionFun(req.body, req.headers['user-agent'] || "", clientIp, (iSessionRes) => {
            if (iSessionRes.status) {
                res.status(200).json(iSessionRes)
                return;
            }
            res.status(400).json({message: iSessionRes.message});
        });
    } catch (error) {
        res.status(400).json({message: error.message ? error.message : error});
    }
};


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


exports.deleteSessionFun = (id, cb) => {
    try {
        let obj = {
            type: dbCollections.SESSIONS,
            data: [{
            }]
        }
        if (id) {
            obj.data[0].userId = id;
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


/**
 * Delete All Session
 * @param {Object} req 
 * @param {Object} res 
 */
exports.deleteAllSession = (req, res) => {
    try {
        exports.deleteSessionFun("", (resData) => {
            if (!(resData && resData.status)) {
                res.status(400).json({message: resData.message});
                return;
            }
            removeCache(`session:`, true);
            res.status(200).json(resData);
        });
    } catch (error) {
        res.status(400).json({message: error.message ? error.message : error});
    }
};


/**
 * Delete User Specific Session
 * @param {Object} req 
 * @param {Object} res 
 * @returns 
 */
exports.deleteUserSpecificSession = (req, res) => {
    try {
        if (!(req.params && req.params.id)) {
            res.status(400).json({message: "User id is required"});
            return;
        }
        exports.deleteSessionFun(req.params.id, (resData) => {
            if (!(resData && resData.status)) {                
                res.status(400).json({message: resData.message});
                return;
            }
            removeCache(`session:${req.params.id}`, true);
            res.status(200).json(resData);
        });
    } catch (error) {
        res.status(400).json({message: error.message ? error.message : error});
    }
};


exports.removeSession = (req, cb) => {
    try {
        const bodyData = req.body;
        let obj = {
            type: dbCollections.SESSIONS,
            data: [{
                userId: bodyData.id,
                refreshToken: bodyData.refreshToken
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
