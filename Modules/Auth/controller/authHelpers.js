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

exports.generateTokenV2Fun = (uid, refreshToken, cb) => {
    try {
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
                cb({
                    status: false,
                    isLogout: true,
                    isEmailVerified: false,
                    userData: response ?? null,
                    message: 'Email is not verified.',
                });
                return;
            }
            const companyIds = response.AssignCompany && response.AssignCompany.length ? response.AssignCompany : [];
            const token = await generateJWTToken({uid: uid, companyIds: companyIds, refreshToken});
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


/**
 * User Auth Function
 * @param {Object} req 
 * @param {Object} res 
 */

exports.verifyAuth = (reqData, cb) => {
    try {
        if (!(reqData && reqData.email)) {
            cb({ status: false, message: "Email is required" });
            return;
        }

        if (reqData.authProvider === "google") {
            verifyGoogleAuth(reqData, cb);
        } else if (reqData.authProvider === "github") {
            verifyGithubAuth(reqData, cb);
        } else {
            verifyLocalAuth(reqData, cb);
        }
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
            let mail = require("../Template/forgotPassword")(reqData.email, link);
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
