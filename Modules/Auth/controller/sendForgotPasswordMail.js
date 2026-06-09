const crypto = require('crypto');
const logger = require("../../../Config/loggerConfig");
const mongoRef = require('../../../utils/mongo-handler/mongoQueries');
const sendMail = require("../../service.js");
const config = require("../../../Config/config");
const { dbCollections } = require('../../../Config/collections');

/**
 * Generate a password-reset token (BUG-005 / #59 fix).
 *
 * The previous implementation built an 8-char alphanumeric token via
 * `Math.random()` — ~48 bits of entropy and not cryptographically secure,
 * which made the reset link feasibly brute-forceable. Replace with 32 bytes
 * (256 bits) of `crypto.randomBytes`, hex-encoded to 64 chars, so the
 * reset URL stays URL-safe without further encoding.
 *
 * Exported for the regression test at .claude/tests/test-bug-005.js.
 */
exports.generateResetToken = () => crypto.randomBytes(32).toString('hex');

/**
 * Send Forgot Password Email
 * @param {Objcet} req
 * @param {Object} res
 * @returns
 */
exports.sendForgotPasswordEmail = (req,res) => {
    try {
        if (!(req.body && req.body.token)) {
            res.send({
                status: false,
                statusText: `token is required`
            })
            return;
        }
        if (!(req.body && req.body.tokenId)) {
            res.send({
                status: false,
                statusText: `tokenId is required`
            })
            return;
        }
        if (!(req.body && req.body.email)) {
            res.send({
                status: false,
                statusText: `email is required`
            })
            return;
        }
        let object = {
            type: dbCollections.USERS,
            data: [
                {
                    Employee_Email : req.body.email
                }
            ]
        }
        mongoRef.MongoDbCrudOpration('global', object, "findOne").then((response)=>{
            let userEmail = req.body.email.toLowerCase();
            const token = exports.generateResetToken();
            let obj = {
                type: dbCollections.USERS,
                data: [
                    {
                        Employee_Email : req.body.email
                    },
                    { 
                        forgotPasswordToken: token,
                        forgotPasswordTokenTime: new Date(),
                    }
                ]
            }
            mongoRef.MongoDbCrudOpration('global', obj, "updateOne").then(()=>{
                let link =  `${config.WEBURL}/#/reset-password/${response._id}/${token}/${req.body.token}/${req.body.tokenId}`
                let mail = require("../../Template/forgotPassword")(userEmail, link);
                sendMail.SendEmail(mail.subject, mail.mail, userEmail, true, (result) => {
                    if(result.status) {
                        res.send({
                            status: true,
                            statusText: "Email sent successfully."
                        });
                    } else {
                        logger.error(`Error Try Catch ${result.error}`);
                        res.send({
                            status: false,
                            statusText: result.error
                        });
                    }
                });
            }).catch((error)=>{
                logger.error(`Error Forgot Password: ${error}`)
                res.send({
                    status: false,
                    statusText: error
                });
            })
        }).catch((error)=>{
            logger.error(`Error Get User In Forgot Password: ${error}`);
            res.send({
                status: false,
                statusText: error
            })
        })
    } catch (error) {
        logger.error(`Error Try Catch ${error.message}`);
        res.send({
            status: false,
            statusText: error
        })
    }
}