const crypto = require('crypto');
const logger = require("../../../Config/loggerConfig");
const mongoRef = require('../../../utils/mongo-handler/mongoQueries');
const sendMail = require("../../service.js");
const config = require("../../../Config/config");
const { dbCollections } = require('../../../Config/collections');
const { ACCOUNT_MAIL_ANSWER } = require('../helpers/accountMail');

exports.generateResetToken = () => crypto.randomBytes(32).toString('hex');

const sendResetLink = async ({ email, token: clientToken, tokenId }) => {
    const account = await mongoRef.MongoDbCrudOpration('global', {
        type: dbCollections.USERS,
        data: [{ Employee_Email: email }]
    }, "findOne");
    if (!(account && account._id)) return;
    const token = exports.generateResetToken();
    await mongoRef.MongoDbCrudOpration('global', {
        type: dbCollections.USERS,
        data: [{ _id: account._id }, { forgotPasswordToken: token, forgotPasswordTokenTime: new Date() }]
    }, "updateOne");
    const userEmail = email.toLowerCase();
    const link = `${config.WEBURL}/#/reset-password/${account._id}/${token}/${clientToken}/${tokenId}`;
    const mail = require("../../Template/forgotPassword")(userEmail, link);
    sendMail.SendEmail(mail.subject, mail.mail, userEmail, true, (result) => {
        if (!result.status) logger.error(`Forgot password email: ${result.error}`);
    });
};

/* The same answer whether or not the address has an account; the answer does not wait for the mail. */
exports.sendForgotPasswordEmail = (req,res) => {
    const body = req.body || {};
    for (const field of ['token', 'tokenId', 'email']) {
        if (!body[field]) {
            res.send({ status: false, statusText: `${field} is required` });
            return;
        }
    }
    if ([body.token, body.tokenId, body.email].every((value) => typeof value === 'string')) {
        sendResetLink(body).catch((error) => {
            logger.error(`Forgot password: ${(error && error.message) || error}`);
        });
    }
    res.send({ status: true, statusText: ACCOUNT_MAIL_ANSWER });
};
