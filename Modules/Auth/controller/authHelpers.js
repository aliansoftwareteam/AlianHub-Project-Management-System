const mongoC = require("../../../utils/mongo-handler/mongoQueries")
const { dbCollections } = require('../../../Config/collections');
const bcrypt = require('bcrypt');
const crypto = require('crypto');
const config = require("../../../Config/config");
const logger = require("../../../Config/loggerConfig");
const serviceCtr = require("../../serviceFunction.js")
const sendMail = require("../../service.js");
const { generateToken, verifyToken, generateJWTToken, removeCacheAndCookie } = require("../../../Config/jwt.js");
const { accessClaimsFor } = require("../helpers/refreshTokenRules");
const helperCtr = require("../helper.js");
const sesstionCtr = require("../session.js");
const mongoose = require("mongoose");
const { removeCache } = require("../../../utils/commonFunctions.js");
const { updateUserFun } = require("../../Users/controller.js");
const { toAuthView } = require("../../Users/helpers/userAccessRules");
const { SocialSignInRefusal, isSocialProvider, resolveSocialAccount, verifySocialIdentity } = require("../helpers/socialIdentity");



exports.addAndRemoveUserInMongodbNotificationCount = (companyId,userId,type) => {
    return new Promise((resolve, reject) => {
        try {
            if (type === 'Add') {
                let obj = {
                    type: dbCollections.USERID,
                    data: {
                        userId: userId
                    }
                }
                mongoC.MongoDbCrudOpration(companyId,obj,"save").then((res)=>{
                    resolve(({
                        status: true,
                        statusText: res
                    }))
                }).catch((error)=>{
                    reject(error)
                })
            } else {
                let obj = {
                    type: dbCollections.USERID,
                    data: [{
                        userId: userId
                    }]
                }
                mongoC.MongoDbCrudOpration(companyId,obj,"findOneAndDelete").then((res)=>{
                    resolve(({
                        status: true,
                        statusText: res
                    }))
                }).catch((error)=>{
                    reject(error)
                })
            }
        } catch (error) {
            reject(error);
        }
    })
}

const unverifiedEmailAnswer = (user) => ({
    status: false,
    isLogout: true,
    isEmailVerified: false,
    userData: toAuthView(user),
    message: 'Email is not verified.',
});

exports.sessionRefusalFor = async (uid) => {
    const user = await mongoC.MongoDbCrudOpration(dbCollections.GLOBAL, { type: dbCollections.USERS, data: [{ _id: uid }] }, "findOne");
    if (!(user && user._id)) return { status: false, isLogout: true, message: 'user not found.' };
    if (!user.isEmailVerified) return unverifiedEmailAnswer(user);
    return null;
};

exports.generateTokenV2Fun = (uid, refreshToken, cb) => {
    try {
        const sessionClaims = accessClaimsFor(refreshToken);
        if (!sessionClaims) {
            cb({
                status: false,
                isLogout: true,
                message: 'Your session is expired',
            });
            return;
        }
        let object = {
            type: dbCollections.USERS,
            data: [
                {
                    _id: uid
                }
            ]
        }
        mongoC.MongoDbCrudOpration(dbCollections.GLOBAL, object, "findOne").then(async (response) => {
            if (!(response && response._id)) {
                cb({
                    status: false,
                    isLogout: true,
                    message: 'user not found.',
                });
                return;
            }
            if(!response.isEmailVerified){
                cb(unverifiedEmailAnswer(response));
                return;
            }
            const companyIds = response.AssignCompany && response.AssignCompany.length ? response.AssignCompany : [];
            const token = await generateJWTToken({uid: uid, companyIds: companyIds, ...sessionClaims});
            cb({
                status: true,
                message: "Jwt token generate successfully.",
                token: token
            });
        }).catch((error) => {
            logger.error(`Generate Jwt Token Error: ${error}`);
            cb({
                status: false, 
                error,
                isLogout: true,
                message: 'user not found.',
            });
        })
    } catch (error) {
        logger.error(`Generate Jwt Token Error: ${error}`);
        cb({
            status: false,
            isLogout: true,
            message: "Authentication failed!"
        });
    }
};


/**
 * Generate JWT Token V2 Function
 * @param {Object} req 
 * @param {Object} res 
 */

exports.insertAuthFun = async (reqData, cb) => {
    try {
        if (!(reqData && reqData.email)) {
            cb({
                status: false,
                message: "Email is require"
            });
            return;
        }
        if (!(reqData && reqData.password)) {
            cb({
                status: false,
                message: "Password is require"
            });
            return;
        }
        const salt = await bcrypt.genSalt(10);
        let obj = {
            type: dbCollections.USER_AUTH,
            data: {
                email: reqData.email,
                passwordHash: await bcrypt.hash(reqData.password, salt)
            }
        }
        mongoC.MongoDbCrudOpration(dbCollections.GLOBAL, obj, "save").then(async (res)=>{
            const updateobj = {
                type: dbCollections.USER_AUTH,
                data: [{
                        email: reqData.email
                    }, {
                        passwordHash: await bcrypt.hash(res._id + reqData.password, salt)
                    }
                ]
            }
            mongoC.MongoDbCrudOpration(dbCollections.GLOBAL, updateobj, "updateOne").then(()=>{
                cb({
                    status: true,
                    data: {...reqData, _id: res._id},
                })
            }).catch((uError) => {
                cb({
                    status: false,
                    message: serviceCtr.mongoErrorMessage(uError)
                });
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




const verifySocialAuth = async (reqData, cb) => {
    try {
        const identity = await verifySocialIdentity(reqData.authProvider, reqData);
        const account = await resolveSocialAccount(identity, reqData.email);
        cb({ status: true, data: { _id: account._id }, message: `${identity.label} login successful` });
    } catch (error) {
        if (error instanceof SocialSignInRefusal) {
            cb({ status: false, message: error.message });
            return;
        }
        cb({ status: false, message: serviceCtr.mongoErrorMessage(error) });
    }
};

const SIGN_IN_REFUSED = "The email or password is incorrect.";
const BLOCKED_ANSWER = "Your email has been blocked. Please contact the administrator.";

/* A missing account still pays for one bcrypt comparison, at the cost new passwords are
 * hashed with, so the answer's timing does not say whether the address has an account. */
let standInHash;
const standInPasswordHash = () => standInHash || (standInHash = bcrypt.hash(crypto.randomBytes(16).toString("hex"), 10));

const mailSetPasswordLink = async (email, isLoginType) => {
    const token = generateToken(600);
    const stored = await mongoC.MongoDbCrudOpration(dbCollections.GLOBAL, {
        type: dbCollections.USER_AUTH,
        data: [{ email }, { token }],
    }, "findOneAndUpdate");
    if (!stored?._id) return;
    const base = isLoginType === "admin" ? `${config.WEBURL}/admin` : config.WEBURL;
    const mail = require("../../Template/passwordExpiredMail")(email, `${base}/#/set-new-password/${token}`);
    sendMail.SendEmail(mail.subject, mail.mail, email, true, (result) => {
        if (!result.status) logger.error(`Set password mail was not sent: ${result.error}`);
    });
};

/* Blocked and unverified are only said after the right password, so no answer tells someone
 * without the password that the account exists. */
const verifyLocalAuth = async (reqData, cb) => {
    if (!reqData.password) {
        cb({ status: false, message: "Password is required" });
        return;
    }

    try {
        const email = typeof reqData.email === "string" ? reqData.email : "";
        const password = String(reqData.password);
        const resData = email
            ? await mongoC.MongoDbCrudOpration(dbCollections.GLOBAL, { type: dbCollections.USER_AUTH, data: [{ email }] }, "findOne")
            : null;

        if (!(resData?._id && resData.passwordHash)) {
            await bcrypt.compare(password, await standInPasswordHash());
            if (resData?._id && !resData.isBlocked) {
                mailSetPasswordLink(email, reqData.isLoginType).catch((error) => logger.error(`Set password mail: ${error.message || error}`));
            }
            cb({ status: false, message: SIGN_IN_REFUSED });
            return;
        }

        const isValid = await bcrypt.compare(resData._id + password, resData.passwordHash);
        if (!isValid) {
            cb({ status: false, message: SIGN_IN_REFUSED });
            return;
        }
        if (resData.isBlocked) {
            cb({ status: false, message: BLOCKED_ANSWER });
            return;
        }

        cb({
            status: true,
            // twoFactorEnabled tells loginAuth whether to gate this login behind the TOTP second step.
            data: { ...reqData, _id: resData._id, twoFactorEnabled: !!(resData.twoFactor && resData.twoFactor.enabled) },
            message: "User Login Successfully",
        });
    } catch (error) {
        cb({ status: false, message: serviceCtr.mongoErrorMessage(error) });
    }
};

/**
 * User Auth Function
 * @param {Object} req 
 * @param {Object} res 
 */

exports.verifyAuth = (reqData, cb) => {
    try {
        if (reqData && isSocialProvider(reqData.authProvider)) {
            verifySocialAuth(reqData, cb);
            return;
        }
        if (!(reqData && reqData.email)) {
            cb({ status: false, message: "Email is required" });
            return;
        }
        verifyLocalAuth(reqData, cb);
    } catch (error) {
        cb({ status: false, message: error.message || error });
    }
};

/**
 * Login Auth
 * @param {Object} req 
 * @param {Object} res 
 */

exports.sendForgotPassword = (req, res, next) => {
    try {
        const reqData = req.body;
        const token = generateToken(600); // 10 minute
        let object = {
            type: dbCollections.USER_AUTH,
            data: [{
                email: reqData.email
            },{
                token: token
            }]
        }
        mongoC.MongoDbCrudOpration(dbCollections.GLOBAL, object, "findOneAndUpdate").then((resData) => {
            if (!(resData && resData._id)) {
                req.errorMessageObject = {message: "user not found."};
                next();
                return;
            }
            let link = `${config.WEBURL}/#/reset-password/${token}`;
            if (reqData.key === "admin") {
                link = `${config.WEBURL}/admin/#/reset-password/${token}`;
            }
            let mail = require("../../Template/forgotPassword")(reqData.email, link);
            sendMail.SendEmail(mail.subject, mail.mail, reqData.email, true, (result) => {
                if (result.status) {
                    res.status(200).json({
                        status: true,
                        message: "Forgot Password Email sent successfully."
                    });
                } else {
                    req.errorMessageObject = {message: result.error};
                    next();
                }
            });
        }).catch((error) => {
            req.errorMessageObject = {message: serviceCtr.mongoErrorMessage(error)};
            next();
        })
    } catch (error) {
        req.errorMessageObject = {message: error.message ? error.message : error};
        next();
    }
};


/**
 * Forgot Password
 * @param {Object} req 
 * @param {Object} res 
 */
