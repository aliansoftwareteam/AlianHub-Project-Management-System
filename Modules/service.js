const nodemailer = require("nodemailer");
const config =  require('../Config/config.js');
const logger = require("../Config/loggerConfig.js");

// TLS certificate validation is ON by default. Only disable it (e.g. a
// self-signed SMTP cert in a controlled environment) via an explicit env
// opt-in — never silently, since disabling it exposes SMTP traffic to MITM.
const allowSelfSigned = String(process.env.NODEMAILER_ALLOW_SELF_SIGNED || "").toLowerCase() === "true";

// options.accountMail: password reset, activation, verification and sign-in links, which the daily cap never holds back.
const heldForTomorrow = (kind, message, options) => require("./Entitlements/mailCap").holdForTomorrow(kind, message, options || {});
const QUEUED = Object.freeze({ status: true, queued: true });


/**
 * Send mail via email
 * @param {*} subject
 * @param {*} html
 * @param {*} toMail
 * @param {*} isHtml
 * @param {*} cb
 */
exports.SendEmail = async (subject, html, toMail, isHtml, cb, options) => {
    try {
        if (await heldForTomorrow("to", { subject, html, to: toMail, isHtml }, options)) return cb({ ...QUEUED });

        let transporter = nodemailer.createTransport({
            host: config.NODEMAILER_HOST,
            port: config.NODEMAILER_PORT,
            secure: config.NODEMAILER_PORT == 465, // true for 465, false for other ports
            auth: {
                user: config.NODEMAILER_USER || config.NODEMAILER_EMAIL,
                pass: config.NODEMAILER_EMAIL_PASSWORD,
            },
            tls: {
                rejectUnauthorized: !allowSelfSigned
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
                    error: err.message ? err.message : err,
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
exports.SendNotificationEmail = async (subject, html, toMail, isHtml, cb, options) => {
    try {
        if (await heldForTomorrow("bcc", { subject, html, to: toMail, isHtml }, options)) return cb({ ...QUEUED });
        const toArr = toMail.toString().toLowerCase()
        let transporter = nodemailer.createTransport({
            host: config.NODEMAILER_HOST,
            port: config.NODEMAILER_PORT,
            secure: config.NODEMAILER_PORT == 465, // true for 465, false for other ports
            auth: {
                user: config.NODEMAILER_USER || config.NODEMAILER_EMAIL,
                pass: config.NODEMAILER_EMAIL_PASSWORD,
            },
            tls: {
                rejectUnauthorized: !allowSelfSigned
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
                    error: err.message ? err.message : err,
                })
            } else {
                cb({
                    status: true,
                    data: res
                })
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
 * Send Attachment via email
 * @param {*} subject
 * @param {*} html
 * @param {*} toMail
 * @param {*} attachMents
 * @param {*} cb
 */
exports.sendAttachMail = async (subject, html, toMail,attachMents, cb, options) => {
    if (await heldForTomorrow("attach", { subject, html, to: toMail, attachments: attachMents }, options)) return cb({ ...QUEUED });
    let transporter = nodemailer.createTransport({
        host: config.NODEMAILER_HOST,
        port: config.NODEMAILER_PORT,
        secure: config.NODEMAILER_PORT == 465, // true for 465, false for other ports
        auth: {
            user: config.NODEMAILER_USER || config.NODEMAILER_EMAIL,
            pass: config.NODEMAILER_EMAIL_PASSWORD,
        },
        tls: {
            rejectUnauthorized: !allowSelfSigned
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

const asBuffer = (content) => (content && content.buffer && !Buffer.isBuffer(content) ? Buffer.from(content.buffer) : content);

/* Sends a message the daily cap held back; resolves once the transport accepted it. */
exports.deliverQueued = (row) => new Promise((resolve, reject) => {
    const done = (result) => (result && result.status ? resolve(result) : reject(new Error(String((result && (result.error || result.statusText)) || "Mail not sent"))));
    const options = { fromQueue: true };
    if (row.kind === "bcc") return exports.SendNotificationEmail(row.subject, row.html, row.to, row.isHtml, done, options);
    if (row.kind === "attach") {
        const attachments = (row.attachments || []).map((attachment) => ({ ...attachment, content: asBuffer(attachment.content) }));
        return exports.sendAttachMail(row.subject, row.html, row.to, attachments, done, options);
    }
    return exports.SendEmail(row.subject, row.html, row.to, row.isHtml, done, options);
});
