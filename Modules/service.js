const nodemailer = require("nodemailer");
const config =  require('../Config/config.js');
const awsRef = require('../Config/aws.js');
const logger = require("../Config/loggerConfig.js");

// BUG-041 / #95 — drop the duplicate `aws-sdk` v2 import. The SES
// client lives in Config/aws.js as the v3-based `awsRef.ses` shim, and
// the v3 raw client (`awsRef.sesClient`) is exposed for nodemailer's
// `SES` transport which historically needed a v2 client instance.
const ses = awsRef.sesClient;

/**
 * Send email with AWS
 * @param {*} subject 
 * @param {*} html 
 * @param {*} toMail 
 * @param {*} isHtml 
 * @param {*} cb 
 */
exports.SendEmail = async (subject, html, toMail, isHtml, cb) => {
    try {
        const tmpToMail = toMail.toLowerCase().split(",");
        let toArr = [];
        if (tmpToMail.length === 1) {
            toArr = [toMail.toLowerCase()];
        } else {
            toArr = tmpToMail;
        }

        const params = {
            Destination: {
                ToAddresses: toArr
            },
            Message: {
                Body: {
                    ...(isHtml && { Html: { Charset: 'UTF-8',  Data: html } }),
                    ...(!isHtml && { Text: { Charset: 'UTF-8',  Data: html } })
                },
                Subject: {
                    Charset: 'UTF-8',
                    Data: subject
                }
            },
            ReturnPath: `${config.APP_NAME} <${config.AWS_SES_FROM_DEFAULT}>`,
            Source: `${config.APP_NAME} <${config.AWS_SES_FROM_DEFAULT}>`,
        };
    
        await awsRef.ses.sendEmail(params, (error, data) => {
            if (error) {
                cb({
                    status: false,
                    error: error.message
                });
            } else {
                cb({
                    status: true,
                    data,
                });
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
 * Send notification via AWS email
 * @param {*} subject 
 * @param {*} html 
 * @param {*} toMail 
 * @param {*} isHtml 
 * @param {*} cb 
 */
exports.SendNotificationEmail = async (subject, html, toMail, isHtml, cb) => {
    try {
        let toArr = [];
        toMail.forEach((email) => {
            toArr.push(email.toLowerCase());
        });

        const params = {
            Destination: {
                BccAddresses: toArr,
            },
            Message: {
                Body: {
                    ...(isHtml && { Html: { Charset: 'UTF-8',  Data: html } }),
                    ...(!isHtml && { Text: { Charset: 'UTF-8',  Data: html } })
                },
                Subject: {
                    Charset: 'UTF-8',
                    Data: subject
                }
            },
            ReturnPath: `${config.APP_NAME} <${config.AWS_SES_FROM_DEFAULT}>`,
            Source: `${config.APP_NAME} <${config.AWS_SES_FROM_DEFAULT}>`,
        };

        await awsRef.ses.sendEmail(params, (error, data) => {
            if (error) {
                cb({
                    status: false,
                    error: error.message
                });
            } else {
                cb({
                    status: true,
                    data,
                });
            }
        });
    } catch(error) {
        logger.error(`Send Verify Email Catch Error: ${error.message}`);
        cb({
            status: false,
            error: error.message
        });
    }
};


/**
 * Send attachment via AWS email
 * @param {*} subject 
 * @param {*} html 
 * @param {*} toMail 
 * @param {*} attachMents 
 * @param {*} cb 
 */
exports.sendAttachMail = (subject, html, toMail,attachMents, cb) => {
    // BUG-041 / #95 — nodemailer 6.x accepts the v3 SES transport as
    // `{ SES: { ses, aws } }`. `aws` is the @aws-sdk/client-ses module
    // (used for command classes), `ses` is the v3 client instance.
    let transporter = nodemailer.createTransport({
        SES: { ses, aws: require('@aws-sdk/client-ses') }
    });
    transporter.sendMail({
        from: config.AWS_SES_FROM_DEFAULT, // sender address
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
