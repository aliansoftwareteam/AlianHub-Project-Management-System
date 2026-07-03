const nodemailer = require("nodemailer");
const config =  require('../Config/config.js');
const logger = require("../Config/loggerConfig.js");


/**
 * Send mail via email
 * @param {*} subject
 * @param {*} html
 * @param {*} toMail
 * @param {*} isHtml
 * @param {*} cb
 */
exports.SendEmail = async (subject, html, toMail, isHtml, cb) => {
    try {

        let transporter = nodemailer.createTransport({
            host: config.NODEMAILER_HOST,
            port: config.NODEMAILER_PORT,
            secure: config.NODEMAILER_PORT == 465, // true for 465, false for other ports
            auth: {
                user: config.NODEMAILER_EMAIL, // generated ethereal user
                pass: config.NODEMAILER_EMAIL_PASSWORD, // generated ethereal password
            },
            tls: {
                rejectUnauthorized: false
            }
        });

        await transporter.sendMail({
            from: ""+'<'+config.NODEMAILER_EMAIL+'>', // sender address
            to: toMail, // list of receivers
            subject: subject, // Subject line
            [isHtml ? "html" : "text"]: html
        },(err, res)=>{
            if (err) {
                cb({
                    status:false,
                    error: err,
                })
            } else {
                cb({
                    status: true,
                    data: res
                })
            }
        });
    } catch(error) {
        cb({
            status: false,
            error: error.message
        });
    }
};


/**
 * Send notification via email
 * @param {*} subject
 * @param {*} html
 * @param {*} toMail
 * @param {*} isHtml
 * @param {*} cb
 */
exports.SendNotificationEmail = async (subject, html, toMail, isHtml, cb) => {
    try {
        const toArr = toMail.toString().toLowerCase()
        let transporter = nodemailer.createTransport({
            host: config.NODEMAILER_HOST,
            port: config.NODEMAILER_PORT,
            secure: config.NODEMAILER_PORT == 465, // true for 465, false for other ports
            auth: {
                user: config.NODEMAILER_EMAIL, // generated ethereal user
                pass: config.NODEMAILER_EMAIL_PASSWORD, // generated ethereal password
            },
            tls: {
                rejectUnauthorized: false
            }
        });

        await transporter.sendMail({
            from: ""+'<'+config.NODEMAILER_EMAIL+'>', // sender address
            bcc: toArr, // list of receivers
            subject: subject, // Subject line
            [isHtml ? "html" : "text"]: html
        },(err, res)=>{
            if (err) {
                cb({
                    status:false,
                    error: err,
                })
            } else {
                cb({
                    status: true,
                    data: res
                })
            }
        });
    } catch(error) {
        logger.error(`Send Verify Email Catch Error: ${error.messge}`);
        cb({
            status: false,
            error: error.message
        });
    }
};


/**
 * Send Attachment via email
 * @param {*} subject
 * @param {*} html
 * @param {*} toMail
 * @param {*} attachMents
 * @param {*} cb
 */
exports.sendAttachMail = (subject, html, toMail,attachMents, cb) => {
    let transporter = nodemailer.createTransport({
        host: config.NODEMAILER_HOST,
        port: config.NODEMAILER_PORT,
        secure: config.NODEMAILER_PORT == 465, // true for 465, false for other ports
        auth: {
            user: config.NODEMAILER_EMAIL, // generated ethereal user
            pass: config.NODEMAILER_EMAIL_PASSWORD, // generated ethereal password
        },
        tls: {
            rejectUnauthorized: false
        }
    });
    transporter.sendMail({
        from: ""+'<'+config.NODEMAILER_EMAIL+'>', // sender address
        to: toMail, // list of receivers
        subject: subject, // Subject line
        html : html,
        attachments: attachMents
    }, (err, res) => {
        if (err) {
            logger.error("sendEmail: ", err);
            cb({
                status: false,
                statusText: err.message ? err.message : err
            });
        } else {
            cb({
                status: true,
                res,
            });
        }
    });
};
