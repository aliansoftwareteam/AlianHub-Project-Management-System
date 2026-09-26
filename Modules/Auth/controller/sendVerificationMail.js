const mongoRef = require('../../../utils/mongo-handler/mongoQueries');
const verificationMailTemplate = require("../../Template/sendEmailVerification.js");
const sendMail = require("../../service.js");
const config = require("../../../Config/config");
const { dbCollections } = require('../../../Config/collections');
const { newLinkToken } = require('../helpers/linkToken');
const { ACCOUNT_MAIL_ANSWER } = require('../helpers/accountMail');
const logger = require('../../../Config/loggerConfig');

const OBJECT_ID_PATTERN = /^[a-f0-9]{24}$/i;

const failure = (userId, error) => ({
    status: false,
    statusText: `Error sending verification email for user ${userId} : ${error && error.message ? error.message : error}`
});

exports.storeVerificationToken = async (userId) => {
    try {
        const token = newLinkToken();
        await mongoRef.MongoDbCrudOpration('global', {
            type: dbCollections.USERS,
            data: [
                { _id: userId },
                {
                    verificationToken: token,
                    verificationTokenTime: new Date(),
                }
            ]
        }, "updateOne");
        return token;
    } catch (error) {
        throw failure(userId, error);
    }
};

exports.mailVerificationLink = (userId, email, token) => new Promise((resolve, reject) => {
    try {
        const verificationLink = `${config.WEBURL}/#/verify-email/${userId}/${token}`;
        const mail = verificationMailTemplate(verificationLink, config.WEBURL);
        sendMail.SendEmail(mail.subject, mail.mail, String(email).toLowerCase(), true, (result) => {
            if(result.status) {
                resolve({
                    status: true,
                    statusText: 'Verification email sent sucessfully.'
                });
            } else {
                reject({
                    status: false,
                    statusText: result.error
                });
            }
        });
    } catch (error) {
        reject(failure(userId, error));
    }
});

exports.sendVerificationEmailPromise = (userId, email) => exports.storeVerificationToken(userId)
    .then((token) => exports.mailVerificationLink(userId, email, token));

/* The same answer whatever state the account is in; a link goes out only to an account that
 * still needs one, and the answer does not wait for the mail. */
exports.sendVerificationEmail = async (req,res) => {
    const uid = String((req.body && req.body.uid) || '');
    if (!OBJECT_ID_PATTERN.test(uid)) {
        return res.send({ status: false, statusText: "Userid is required." });
    }
    try {
        const account = await mongoRef.MongoDbCrudOpration("global", {
            type: dbCollections.USERS,
            data: [{ _id: uid }, { Employee_Email: 1, isEmailVerified: 1, isDeleted: 1 }]
        }, "findOne");
        if (account && account.Employee_Email && account.isEmailVerified !== true && account.isDeleted !== true) {
            exports.sendVerificationEmailPromise(uid, account.Employee_Email).catch((error) => {
                logger.error(`Resend verification email: ${(error && error.statusText) || error}`);
            });
        }
    } catch (error) {
        logger.error(`Resend verification email: ${(error && error.message) || error}`);
    }
    return res.send({ status: true, statusText: ACCOUNT_MAIL_ANSWER });
};
