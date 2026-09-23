const mongoRef = require('../../../utils/mongo-handler/mongoQueries');
const verificationMailTemplate = require("../../Template/sendEmailVerification.js");
const sendMail = require("../../service.js");
const config = require("../../../Config/config");
const { dbCollections } = require('../../../Config/collections');
const { newLinkToken } = require('../helpers/linkToken');
const { ACCOUNT_MAIL_ANSWER } = require('../helpers/accountMail');
const logger = require('../../../Config/loggerConfig');

const OBJECT_ID_PATTERN = /^[a-f0-9]{24}$/i;

/**
 * Send Verification Email
 * @param {Object} UserId - Id of user For which We need to send the email
 * @param {Object} Email - Email of user For which We need to send the email
 * @returns
 */
exports.sendVerificationEmailPromise = (userId,email) => {
    return new Promise((resolve, reject) => {
        const failed = (error) => reject({
            status: false,
            statusText: `Error sending verification email for user ${userId} : ${error && error.message ? error.message : error}`
        });
        try {
            const token = newLinkToken();
            const userEmail = String(email).toLowerCase();
            const obj = {
                type: dbCollections.USERS,
                data: [
                    { _id: userId },
                    {
                        verificationToken: token,
                        verificationTokenTime: new Date(),
                    }
                ]
            };
            mongoRef.MongoDbCrudOpration('global', obj, "updateOne").then(()=>{
                const verificationLink = `${config.WEBURL}/#/verify-email/${userId}/${token}`;
                const mail = verificationMailTemplate(verificationLink, config.WEBURL);
                sendMail.SendEmail(mail.subject, mail.mail, userEmail, true, (result) => {
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
            }).catch(failed);
        } catch (error) {
            failed(error);
        }
    });
};

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
