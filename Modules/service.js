const logger = require("../Config/loggerConfig.js");
const { mailProvider, mailTransport, fromHeader } = require("./mailProvider");

// options.accountMail: password reset, activation, verification and sign-in links, which the daily cap never holds back.
const heldForTomorrow = (kind, message, options) => require("./Entitlements/mailCap").holdForTomorrow(kind, message, options || {});
const QUEUED = Object.freeze({ status: true, queued: true });

const sender = () => fromHeader(mailProvider());

exports.SendEmail = async (subject, html, toMail, isHtml, cb, options) => {
    try {
        if (await heldForTomorrow("to", { subject, html, to: toMail, isHtml }, options)) return cb({ ...QUEUED });

        await mailTransport().sendMail({
            from: sender(),
            to: toMail,
            subject: subject,
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

exports.SendNotificationEmail = async (subject, html, toMail, isHtml, cb, options) => {
    try {
        if (await heldForTomorrow("bcc", { subject, html, to: toMail, isHtml }, options)) return cb({ ...QUEUED });
        const toArr = toMail.toString().toLowerCase()

        await mailTransport().sendMail({
            from: sender(),
            bcc: toArr,
            subject: subject,
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

exports.sendAttachMail = async (subject, html, toMail,attachMents, cb, options) => {
    if (await heldForTomorrow("attach", { subject, html, to: toMail, attachments: attachMents }, options)) return cb({ ...QUEUED });
    mailTransport().sendMail({
        from: sender(),
        to: toMail,
        subject: subject,
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
