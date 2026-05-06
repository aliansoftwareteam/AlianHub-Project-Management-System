const nodemailer = require("nodemailer");
const axios = require("axios");
const config =  require('../Config/config.js');
const logger = require("../Config/loggerConfig.js");


/**
 * Send via Resend HTTP API (used when RESEND_API_KEY is set — bypasses SMTP)
 */
async function sendViaResend({ subject, html, text, toMail, bcc, attachments }) {
    const from = config.RESEND_FROM_EMAIL || 'onboarding@resend.dev';
    const body = {
        from,
        to: Array.isArray(toMail) ? toMail : [toMail],
        subject,
        ...(html ? { html } : { text }),
    };
    if (bcc) body.bcc = Array.isArray(bcc) ? bcc : [bcc];
    if (attachments && attachments.length) {
        body.attachments = attachments.map(a => ({
            filename: a.filename,
            content: a.content ? a.content.toString('base64') : undefined,
            path: a.path,
        }));
    }
    const response = await axios.post('https://api.resend.com/emails', body, {
        headers: {
            'Authorization': `Bearer ${config.RESEND_API_KEY}`,
            'Content-Type': 'application/json',
        },
        timeout: 15000,
    });
    return response.data;
}

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
        // Use Resend HTTP API if key is configured (avoids SMTP port blocks on cloud hosts)
        if (config.RESEND_API_KEY) {
            const data = await sendViaResend({
                subject,
                ...(isHtml ? { html } : { text: html }),
                toMail,
            });
            cb({ status: true, data });
            return;
        }

        let transporter = nodemailer.createTransport({
            host: config.NODEMAILER_HOST,
            port: config.NODEMAILER_PORT,
            secure: config.NODEMAILER_PORT == 465, // true for 465, false for other ports
            auth: {
                user: config.NODEMAILER_EMAIL,
                pass: config.NODEMAILER_EMAIL_PASSWORD,
            },
            tls: {
                rejectUnauthorized: false
            }
        });

        await transporter.sendMail({
            from: ""+'<'+config.NODEMAILER_EMAIL+'>',
            to: toMail,
            subject: subject,
            [isHtml ? "html" : "text"]: html
        },(err, res)=>{
            if (err) {
                cb({ status: false, error: err })
            } else {
                cb({ status: true, data: res })
            }
        });
    } catch(error) {
        cb({
            status: false,
            error: error.response?.data || error.message
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
        const toArr = toMail.toString().toLowerCase();

        // Use Resend HTTP API if key is configured
        if (config.RESEND_API_KEY) {
            const data = await sendViaResend({
                subject,
                ...(isHtml ? { html } : { text: html }),
                bcc: toArr,
            });
            cb({ status: true, data });
            return;
        }

        let transporter = nodemailer.createTransport({
            host: config.NODEMAILER_HOST,
            port: config.NODEMAILER_PORT,
            secure: config.NODEMAILER_PORT == 465,
            auth: {
                user: config.NODEMAILER_EMAIL,
                pass: config.NODEMAILER_EMAIL_PASSWORD,
            },
            tls: {
                rejectUnauthorized: false
            }
        });

        await transporter.sendMail({
            from: ""+'<'+config.NODEMAILER_EMAIL+'>',
            bcc: toArr,
            subject: subject,
            [isHtml ? "html" : "text"]: html
        },(err, res)=>{
            if (err) {
                cb({ status: false, error: err })
            } else {
                cb({ status: true, data: res })
            }
        });
    } catch(error) {
        logger.error(`Send Verify Email Catch Error: ${error.message}`);
        cb({
            status: false,
            error: error.response?.data || error.message
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
exports.sendAttachMail = async (subject, html, toMail, attachMents, cb) => {
    try {
        // Use Resend HTTP API if key is configured
        if (config.RESEND_API_KEY) {
            const data = await sendViaResend({
                subject,
                html,
                toMail,
                attachments: attachMents,
            });
            cb({ status: true, res: data });
            return;
        }

        let transporter = nodemailer.createTransport({
            host: config.NODEMAILER_HOST,
            port: config.NODEMAILER_PORT,
            secure: config.NODEMAILER_PORT == 465,
            auth: {
                user: config.NODEMAILER_EMAIL,
                pass: config.NODEMAILER_EMAIL_PASSWORD,
            },
            tls: {
                rejectUnauthorized: false
            }
        });
        transporter.sendMail({
            from: ""+'<'+config.NODEMAILER_EMAIL+'>',
            to: toMail,
            subject: subject,
            html: html,
            attachments: attachMents
        }, (err, res) => {
            if (err) {
                logger.error("sendEmail: ", err);
                cb({ status: false, statusText: err.message ? err.message : err });
            } else {
                cb({ status: true, res });
            }
        });
    } catch(error) {
        logger.error("sendAttachMail error: ", error.message);
        cb({ status: false, statusText: error.response?.data || error.message });
    }
};
