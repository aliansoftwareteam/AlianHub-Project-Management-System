const mongoRef = require('../../../utils/mongo-handler/mongoQueries');
const senVerificationMailTemplate = require("../../Template/sendEmailVerification.js")
const sendMail = require("../../service.js");
const config = require("../../../Config/config");
const { dbCollections } = require('../../../Config/collections');


/**
 * Send Verification Email
 * @param {Object} UserId - Id of user For which We need to send the email
 * @param {Object} Email - Email of user For which We need to send the email
 * @returns
 */
exports.sendVerificationEmailPromise = (userId,email) => {
    return new Promise((resolve, reject) => {
        try {
            let temp = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
            let token = '';
            for ( let i = 0; i < 8; i++ ) {
                token += temp.charAt(Math.floor(Math.random() * temp.length));
            }
            let uid = userId;
            let userEmail = (email).toLowerCase();
            let obj = {
                type: dbCollections.USERS,
                data: [
                    {
                        _id: userId
                    },
                    { 
                        verificationToken: token,
                        verificationTokenTime: new Date(),
                    }
                ]
            }
            mongoRef.MongoDbCrudOpration('global', obj, "updateOne").then(()=>{
                let verificationLink = `${config.WEBURL}/#/verify-email/${uid}/${token}`
                let mail = require("../../Template/sendEmailVerification.js")(verificationLink,config.WEBURL);
                sendMail.SendEmail(mail.subject,mail.mail, userEmail, true, (result) => {
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
            }).catch((error)=>{
                reject({
                    status: false, 
                    statusText:`Error sending verification email for user ${email} : ${error.message ? error.message : error}`
                })
            })
    
        } catch (error) {
            reject({
                status: false, 
                statusText:`Error sending verification email for user ${email} : ${error.message ? error.message : error}`
            })
        }
    })
}


/**
 * Send Verification Mail
 * @param {Objcet} req
 * @param {Object} res
 * @returns
 */
exports.sendVerificationEmail = (req,res) => {
    try {
        if(!req.body.uid || req.body.uid === '') {
            res.send({
                status: false,
                statusText: "Userid is required."
            });
            return;
        }
        if (!req.body.email || req.body.email === '') {
            res.send({
                status: false,
                statusText: "email is required."
            })
        }
        let obj = {
            type: dbCollections.USERS,
            data: [
                {
                    _id: req.body.uid
                },
            ]
        }
        mongoRef.MongoDbCrudOpration("global",obj,"findOne").then((response)=>{
            if (response.isEmailVerified === true) {
                res.send({
                    status: false,
                    statusText: `Your Email is already verified`
                })
                return;
            } else {
                exports.sendVerificationEmailPromise(req.body.uid,req.body.email).then((response)=>{
                    res.send(response)
                }).catch((error)=>{
                    res.send(error)
                })
            }
        }).catch((error)=>{
            res.send({
                status: false,
                statusText: error
            })
        })
    } catch (error) {
        res.send({
            status: false,
            statusText: `Error: ${error}`
        })
    }
}