const mongoC = require("../../../utils/mongo-handler/mongoQueries")
const { dbCollections } = require('../../../Config/collections');
const bcrypt = require('bcrypt');
const config = require("../../../Config/config");
const logger = require("../../../Config/loggerConfig");
const serviceCtr = require("../../serviceFunction.js")
const sendMail = require("../../service.js");
const { generateToken, verifyToken, generateJWTToken, removeCacheAndCookie } = require("../../../Config/jwt.js");
const helperCtr = require("../helper.js");
const sesstionCtr = require("../session.js");
const mongoose = require("mongoose");
const { removeCache } = require("../../../utils/commonFunctions.js");
const { updateUserFun } = require("../../Users/controller.js");



const { addAndRemoveUserInMongodbNotificationCount, generateTokenV2Fun, verifyAuth } = require('./authHelpers');
const twoFactorRules = require('../helpers/twoFactorRules');
exports.manageAttempt = (req, res) => {
    const forwarded = req?.headers['x-forwarded-for'] || req.ip;
    const clientIp = forwarded ? forwarded?.split(',')[0] : req?.connection?.remoteAddress;
    helperCtr.manageResetAttempt(clientIp, req.body, (mRes) => {
        if (!mRes.status) {
            res.status(mRes.statusCode).json({message: mRes.message});
            return;
        }
        res.status(400).json(req.errorMessageObject);
    });
};

/**
 * Check Permission
 * @param {Object} req 
 * @param {Object} res 
 * @returns 
 */

exports.removeUserNotification = (req,res) => {
    if (!(req.body && req.body.companyId)) {
        res.send({
            status: false,
            statusText: "CompanyId is required"
        })
        return;
    }
    if (!(req.body && req.body.userId)) {
        res.send({
            status: false,
            statusText: "UserId is required"
        })
        return;
    }

    let type = req.body.type !== undefined && req.body.type ? req.body.type : "Remove" 

    addAndRemoveUserInMongodbNotificationCount(req.body.companyId,req.body.userId,type).then((response)=>{
        res.send(response)
    }).catch((error)=>{
        res.send(error);
    })
}

/**
 * Add And Remove User In Mongodb For NotificationCount
 * @param {Array} UserIds - User Ids which is need to update
 * @param {String} CompanyId - Company Id In which Count is need to update
 * @param {Object} Type - Type If it is Add Or Remove
 * @returns {Promise<String>} - Promuise which is return Response from db
 *                           Rejects with an error message if any issues occur during the Process.
 */

/**
 * Issue a real session for `uid`: create the session row, mint the access
 * token, set the auth cookies, and respond — the canonical post-auth path.
 * Shared by password login and the 2FA second-step (/api/v2/auth/2fa/validate)
 * so both produce an identical session. On failure it sets
 * req.errorMessageObject and calls next() (the route's manageAttempt handler
 * returns the error). Behaviour is unchanged from the previous inline block.
 */
const finalizeSession = (req, res, uid, next, onSuccess) => {
    const forwarded = req?.headers['x-forwarded-for'] || req.ip;
    const clientIp = forwarded ? forwarded?.split(',')[0] : req?.connection?.remoteAddress;
    sesstionCtr.insertSessionFun({userId: uid}, req.headers['user-agent'] || "", clientIp, (sData) => {
        if (!(sData && sData.status)) {
            req.errorMessageObject = {message: "unauthorize user"};
            next();
            return;
        }
        generateTokenV2Fun(uid, sData.data.refreshToken, (gData) => {
            if (!(gData && gData.status)) {
                req.errorMessageObject = gData;
                next();
                return;
            }
            // TODO(P1-SEC-09): see matching comment near login.
            // Set httpOnly: true once the frontend no longer
            // reads these cookies with js-cookie.
            const setCookie = {
                maxAge: serviceCtr.convertToSeconds(process.env.JWT_EXP)*1000,
                httpOnly: false,
                secure: config.NODE_ENV === "production",
                sameSite: config.NODE_ENV === "production" ? "Strict" : "Lax",
                domain: process.env.NODE_ENV === "production" ? req.hostname : undefined,
            };
            res.cookie("refreshToken", sData.data.refreshToken, { ...setCookie, maxAge: Number(process.env.SESSIONEXPIREDTIME || 172800)*1000 });
            res.cookie("accessToken", gData.token, { ...setCookie });
            const payload = {
                uid: uid,
                refreshToken: sData.data.refreshToken,
                accessToken: gData.token
            };
            if (typeof onSuccess === "function") {
                onSuccess(payload);
                return;
            }
            res.status(200).json(payload);
        });
    });
};
exports.finalizeSession = finalizeSession;

exports.loginAuth = (req, res, next) => {
    try {
        verifyAuth(req.body, (lUserRes) => {
            if (lUserRes.status) {
                if (lUserRes.isResetPassword) {
                    res.status(200).json({
                        uid: lUserRes.data._id,
                        isResetPassword: lUserRes.isResetPassword
                    });
                    return;
                }
                // 2FA gate (password login only, Phase 1): if the account has
                // TOTP enabled, do NOT create a session here. Return a short
                // lived tempToken (signed with a separate secret) that the
                // client must exchange at /api/v2/auth/2fa/validate with a TOTP
                // or recovery code. Accounts without 2FA take the path below,
                // unchanged.
                if (lUserRes.data && lUserRes.data.twoFactorEnabled) {
                    const tempToken = twoFactorRules.issueTempToken(lUserRes.data._id);
                    res.status(200).json({
                        status: true,
                        twoFactorRequired: true,
                        tempToken,
                        uid: lUserRes.data._id
                    });
                    return;
                }
                finalizeSession(req, res, lUserRes.data._id, next);
                return;
            }
            req.errorMessageObject = {message: lUserRes.message};
            next();
        });
    } catch (error) {
        req.errorMessageObject = {message: error.message ? error.message : error};
        next();
    }
};

/**
 * Tracker login Auth
 * @param {Object} req 
 * @param {Object} res 
 */

exports.loginAuthTracker = (req,res) => {
    try {
        let obj = {
            type: dbCollections.SESSIONS,
            data: [{
                refreshToken: req.body.refreshToken
            }]
        }
        
        mongoC.MongoDbCrudOpration(dbCollections.GLOBAL, obj, "findOne").then(async (sessionData)=>{
            if (sessionData) {
                const forwarded = req?.headers['x-forwarded-for'] || req.ip;
                const clientIp = forwarded ? forwarded?.split(',')[0] : req?.connection?.remoteAddress;
                sesstionCtr.insertSessionFun({userId: sessionData.userId}, req.headers['user-agent'] || "", clientIp, (sData) => {
                    if (!(sData && sData.status)) {
                        res.status(400).json({message: 'Invalid Refresh Token'})
                        return;
                    }
                    generateTokenV2Fun(sessionData.userId, sData.data.refreshToken, (gData) => {
                        if (!(gData && gData.status)) {
                            res.status(400).json({message: 'Invalid Refresh Token'})
                            return;
                        }
                        res.status(200).json({
                            uid: sessionData.userId,
                            refreshToken: sData.data.refreshToken,
                            accessToken: gData.token
                        });
                    });
                });
                return;
            } else {
                res.status(400).json({message: 'Invalid Refresh Token'})
            }
        })
    } catch (error) {
        res.status(400).json({message: error.message ? error.message : error});
    }
}


/**
 * Change Password
 * @param {Object} req 
 * @param {Object} res 
 */

exports.logout = (req, res) => {
    sesstionCtr.removeSession(req, async(data) => {
        if (!data.status) {
            res.status(400).json({
                message: data.message
            });
            return;
        }
        const deleteCookie = { 
            domain: process.env.NODE_ENV === "production" ? req.hostname : undefined,
            expires: new Date(0)
        }
        const updateData = [
            { _id: new mongoose.Types.ObjectId(req.body.id) },
            {
                $set: { isOnline: false, lastActive: new Date() }
            }
        ];
        let obj = {
            type: dbCollections.USERS,
            data: updateData
        }
        const cacheKey = `UserData:${req.body.id}`;
        await mongoC.MongoDbCrudOpration('global', obj, "updateOne");         
        removeCache(cacheKey)
        removeCache('UserAllData:',true)
            
        res.cookie("accessToken","deleted",{...deleteCookie})
        res.cookie("refreshToken","deleted",{...deleteCookie})
        
        res.status(200).json({
            status: true,
            message: data
        });
    });
};

exports.testV2 = (req, res) => {
    res.json(req.body);
}

exports.generateTokenV2 = async (req, res) => {
    const refreshToken = req.headers['refresh-token'] || "";
    if (!(req.body && req.body.uid)) {
        res.status(400).json({
            status: false,
            statusText: "The user id is required."
        });
        return;
    }
    if (!refreshToken) {
        res.status(400).json({
            status: false,
            statusText: "Please provide a refresh token."
        });
        return;
    }
    const cacheKey = `session:${req.body.uid}:${refreshToken}`;
    try {   
        const validRefreshToken = verifyToken(refreshToken);
        if (!(validRefreshToken && validRefreshToken.status)) {
            removeCacheAndCookie("", cacheKey, res, refreshToken);
            res.status(400).json({message: "Your session is expired", isLogout: true});
            return;
        }
        generateTokenV2Fun(req.body.uid, refreshToken, (gData) => {
            if (!(gData && gData.status)) {
                removeCacheAndCookie("", cacheKey, res, refreshToken);
                res.status(400).json(gData);
                return;
            }
            // TODO(P1-SEC-09): set httpOnly: true once the frontend stops
            // reading these cookies directly. Currently App.vue,
            // socketHelper.js, CreateCompany.vue, services/index.js, etc.
            // call Cookies.get('accessToken' | 'refreshToken'), so flipping
            // httpOnly here breaks socket auth and the refresh flow until
            // the frontend stores tokens in memory/localStorage (or the
            // backend switches to reading req.cookies via cookie-parser).
            const setCookie = {
                maxAge: serviceCtr.convertToSeconds(process.env.JWT_EXP)*1000,
                httpOnly: false,
                secure: config.NODE_ENV === "production",
                sameSite: config.NODE_ENV === "production" ? "Strict" : "Lax",
                domain: process.env.NODE_ENV === "production" ? req.hostname : undefined
            };
            res.cookie("accessToken", gData.token, { ...setCookie });
            res.json(gData);
        });
    } catch (error) {
        logger.error(`Generate Jwt Token Error: ${error}`);
        removeCacheAndCookie("", cacheKey, res, refreshToken);
        res.status(400).json({
            status: false,
            isLogout: true,
            message: "Authentication failed!"
        });
    }
};


/**
 * Insert Auth Function
 * @param {Object} reqData 
 * @param {Function} cb 
 */
