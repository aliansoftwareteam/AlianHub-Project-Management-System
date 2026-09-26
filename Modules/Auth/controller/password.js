const mongoC = require("../../../utils/mongo-handler/mongoQueries")
const { dbCollections } = require('../../../Config/collections');
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

const { ACCOUNT_MAIL_ANSWER } = require("../helpers/accountMail");
const { PASSWORD_RULE_MESSAGE, meetsPasswordRule } = require("../helpers/passwordRule");
const { hashPassword, verifyPassword } = require("../helpers/passwordHash");

exports.changePassword = async (req, res) => {
    try {
        const reqData = req.body;
        if (!(req.params && req.params.id)) {
            res.status(400).json({message: "user id is require"});
            return;
        }
        if (String(req.params.id) !== String(req.uid)) {
            res.status(403).json({message: "You can only change your own password."});
            return;
        }
        if (!(reqData && reqData.oldPassword)) {
            res.status(400).json({message: "Old Password is require"});
            return;
        }
        if (!(reqData && reqData.newPassword)) {
            res.status(400).json({message: "New Password is require"});
            return;
        }
        if (!meetsPasswordRule(reqData.newPassword)) {
            res.status(400).json({message: PASSWORD_RULE_MESSAGE});
            return;
        }
        let obj = {
            type: dbCollections.USER_AUTH,
            data: [{
                _id: req.params.id
            }]
        }
        
        mongoC.MongoDbCrudOpration(dbCollections.GLOBAL, obj, "findOne").then(async (resUserData)=>{
            if (!(resUserData && resUserData._id)) {
                res.status(400).json({message: "user not found"});
                return;
            }
            const isValid = await verifyPassword(resUserData._id + reqData.oldPassword, resUserData);
            if (!isValid) {
                res.status(400).json({message: "Auth.previous_wasnot_valid"});
                return;
            }

            const checkNewPass = resUserData._id + reqData.newPassword;
            const stored = await hashPassword(checkNewPass);
            const isNewValid = await verifyPassword(checkNewPass, stored);
            if (!isNewValid) {
                res.status(400).json({message: "Auth.password_wasnot_valid"});
                return;
            }
            let object = {
                type: dbCollections.USER_AUTH,
                data: [
                    {
                        _id: req.params.id
                    },
                    stored
                ]
            }
            mongoC.MongoDbCrudOpration(dbCollections.GLOBAL, object, "findOneAndUpdate").then(()=>{
                res.status(200).json({
                    status: true,
                    message: "Your password has been successfully changed."
                });
            }).catch((error)=>{
                res.status(400).json({message: serviceCtr.mongoErrorMessage(error)});
            })
        }).catch((error)=>{
            res.status(400).json({message: serviceCtr.mongoErrorMessage(error)});
        })
    } catch (error) {
        res.status(400).json({message: error.message ? error.message : error});
    }
};

const sendResetLink = async (email, isAdmin) => {
    const token = generateToken(600);
    const account = await mongoC.MongoDbCrudOpration(dbCollections.GLOBAL, {
        type: dbCollections.USER_AUTH,
        data: [{ email }, { token }]
    }, "findOneAndUpdate");
    if (!(account && account._id)) return;
    const link = `${config.WEBURL}${isAdmin ? '/admin' : ''}/#/reset-password/${token}`;
    const mail = require("../../Template/forgotPassword")(email, link);
    sendMail.SendEmail(mail.subject, mail.mail, email, true, (result) => {
        if (!result.status) logger.error(`Forgot password email: ${result.error}`);
    });
};

/* The same answer whether or not the address has an account; the answer does not wait for the mail. */
exports.forgotPassword = (req, res) => {
    const email = req.body && req.body.email;
    if (!email) {
        res.status(400).json({message: `email is required`});
        return;
    }
    if (typeof email === 'string') {
        sendResetLink(email, req.body.key === "admin").catch((error) => {
            logger.error(`Forgot password: ${serviceCtr.mongoErrorMessage(error)}`);
        });
    }
    res.status(200).json({ status: true, message: ACCOUNT_MAIL_ANSWER });
};


/**
 * Token Verfiy Forgot Password
 * @param {Object} req 
 * @param {Object} res 
 * @returns 
 */

exports.tokenVerfiyForgotPassword = (req, res) => {
    try {
        const reqData = req.body;
        const isValid = verifyToken(reqData.token);
        if (!isValid.status) {
            res.status(400).json({message: isValid.statusText, key: isValid.key});
            return;
        }
        let object = {
            type: dbCollections.USER_AUTH,
            data: [{
                token: reqData.token
            }]
        }
        mongoC.MongoDbCrudOpration(dbCollections.GLOBAL, object, "findOne").then((resData) => {
            if (!(resData && resData._id)) {
                res.status(400).json({message: "user not found", key: 5});
                return;
            }
            res.status(200).json({
                status: true,
                data: {
                    _id: resData._id,
                    email: resData.email
                }
            });
        }).catch((error) => {
            res.status(400).json({message: serviceCtr.mongoErrorMessage(error)});
        })
    } catch (error) {
        res.status(400).json({message: error.message ? error.message : error});
    }
};


/**
 * Reset Password
 * @param {Object} req 
 * @param {Object} res 
 */

exports.resetPassword = async (req, res, next) => {
    try {
        const reqData = req.body;
        const isValid = verifyToken(reqData.token);
        if (!isValid.status) {
            req.errorMessageObject = {message: isValid.statusText, key: isValid.key};
            next();
            return;
        }
        // Security fix: validate token against DB to prevent token reuse after reset
        // JWT signature alone is not sufficient — the stored token must match exactly.
        // After a successful reset, token is cleared (""), so any replay is rejected.
        const tokenRecord = await mongoC.MongoDbCrudOpration(dbCollections.GLOBAL, {
            type: dbCollections.USER_AUTH,
            data: [{ _id: reqData.id, token: reqData.token }]
        }, "findOne");
        if (!(tokenRecord && tokenRecord._id)) {
            req.errorMessageObject = {message: "Reset link is invalid or has already been used.", key: 5};
            next();
            return;
        }
        if (!meetsPasswordRule(reqData.password)) {
            req.errorMessageObject = {message: PASSWORD_RULE_MESSAGE};
            next();
            return;
        }
        const setNewPass = reqData.id + reqData.password;
        const stored = await hashPassword(setNewPass);
        const isNewValid = await verifyPassword(setNewPass, stored);
        if (!isNewValid) {
            req.errorMessageObject = {message: "Auth.password_wasnot_valid"};
            next();
            return;
        }
        let object = {
            type: dbCollections.USER_AUTH,
            data: [
                {
                    _id: reqData.id
                },
                {
                    ...stored,
                    token: ""
                }
            ]
        }
        mongoC.MongoDbCrudOpration(dbCollections.GLOBAL, object, "findOneAndUpdate").then(()=>{
            let object = {
                type: dbCollections.USERS,
                data: [
                    {
                        _id: reqData.id
                    },
                    {
                        verificationToken: "",
                        isEmailVerified: true
                    }
                ]
            }
            updateUserFun(dbCollections.GLOBAL,object,"findOneAndUpdate").then(()=>{
                res.status(200).json({
                    status: true,
                    message: "Your password has been successfully changed."
                });
            }).catch((error)=>{
                req.errorMessageObject = {message: error.message ? error.message : error};
                next();
            })
        }).catch((error)=>{
            req.errorMessageObject = {message: serviceCtr.mongoErrorMessage(error)};
            next();
        })
    } catch (error) {
        req.errorMessageObject = {message: error.message ? error.message : error};
        next();
    }
};


/**
 * Logout Function
 * @param {Object} req 
 * @param {Object} res 
 */
