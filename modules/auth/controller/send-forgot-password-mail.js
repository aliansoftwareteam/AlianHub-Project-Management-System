const logger = require("../../../Config/loggerConfig");
const mongoRef = require('../../../utils/mongo-handler/mongoQueries');
const sendMail = require("../../service.js");
const config = require("../../../Config/config");
const { dbCollections } = require('../../../Config/collections');

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
            let temp = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
            let token = '';
            for ( let i = 0; i < 8; i++ ) {
                token += temp.charAt(Math.floor(Math.random() * temp.length));
            }
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
                let mail = require("../../template/forgotPassword")(userEmail, link);
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