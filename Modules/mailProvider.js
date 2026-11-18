const nodemailer = require("nodemailer");
const addressparser = require("nodemailer/lib/addressparser");
const axios = require("axios");
const { SESClient, SendRawEmailCommand } = require("@aws-sdk/client-ses");
const config = require("../Config/config.js");

const RESEND_URL = "https://api.resend.com/emails";
const SES_KEYS = ["AWS_SES_KEY", "AWS_SES_SECRET", "AWS_SES_REGION"];
const MAIL_KEYS = [...SES_KEYS, "AWS_SES_FROM_DEFAULT", "RESEND_API_KEY", "RESEND_FROM_EMAIL",
    "NODEMAILER_HOST", "NODEMAILER_PORT", "NODEMAILER_USER", "NODEMAILER_EMAIL", "NODEMAILER_EMAIL_PASSWORD", "APP_NAME"];
const SEND_TIMEOUT_MS = 30000;

// TLS certificate validation is ON by default. Only disable it (e.g. a
// self-signed SMTP cert in a controlled environment) via an explicit env
// opt-in — never silently, since disabling it exposes SMTP traffic to MITM.
const allowSelfSigned = () => String(process.env.NODEMAILER_ALLOW_SELF_SIGNED || "").toLowerCase() === "true";

const isSet = (value) => value !== undefined && value !== null && String(value).trim() !== "";

/* Saved settings land in both process.env and config (Config/applyEnv.js); code that sets only config still counts. */
const liveEnv = () => Object.fromEntries(MAIL_KEYS.map((key) => [key, isSet(process.env[key]) ? process.env[key] : config[key]]));

/* The HTTPS providers come first: DigitalOcean, where hosted instances run, drops outbound SMTP. */
function mailProvider(env = liveEnv()) {
    if (SES_KEYS.every((key) => isSet(env[key]))) return "ses";
    if (isSet(env.RESEND_API_KEY)) return "resend";
    if (isSet(env.NODEMAILER_HOST)) return "smtp";
    return null;
}

function senderAddress(provider, env = liveEnv()) {
    if (provider === "ses") return env.AWS_SES_FROM_DEFAULT || "";
    if (provider === "resend") return env.RESEND_FROM_EMAIL || env.NODEMAILER_EMAIL || "";
    return env.NODEMAILER_EMAIL || "";
}

function mailConfigured(env = liveEnv()) {
    const provider = mailProvider(env);
    return Boolean(provider) && isSet(senderAddress(provider, env));
}

function fromHeader(provider, env = liveEnv()) {
    const address = senderAddress(provider, env);
    if (provider === "ses") return isSet(env.APP_NAME) ? { name: env.APP_NAME, address } : address;
    if (provider === "resend") return address;
    return `<${address}>`;
}

let sesClientCache = { id: null, client: null };

/* One client per set of credentials, so a key changed on the settings page is used on the next mail. */
function sesClient(env = liveEnv()) {
    const id = SES_KEYS.map((key) => env[key]).join("\n");
    if (sesClientCache.id !== id) {
        sesClientCache = {
            id,
            client: new SESClient({
                region: env.AWS_SES_REGION,
                credentials: { accessKeyId: env.AWS_SES_KEY, secretAccessKey: env.AWS_SES_SECRET },
            }),
        };
    }
    return sesClientCache.client;
}

const formatAddress = ({ name, address }) => (name ? `${name} <${address}>` : address);

const addressList = (value) =>
    [].concat(value || [])
        .flatMap((entry) => (typeof entry === "string" ? addressparser(entry) : [entry]))
        .filter((entry) => entry && entry.address)
        .map(formatAddress);

const resolveAttachment = (mail, attachment) => new Promise((resolve, reject) => {
    mail.resolveContent(attachment, "content", (error, content) => {
        if (error) return reject(error);
        resolve({
            filename: attachment.filename || "attachment",
            content: Buffer.from(content || "").toString("base64"),
            ...(attachment.contentType ? { content_type: attachment.contentType } : {}),
        });
    });
});

/* A Nodemailer transport over the Resend HTTPS API. Resend needs a To address,
 * so a BCC-only notice is addressed to the sender. */
function resendTransport(apiKey) {
    return {
        name: "resend",
        version: "1",
        send(mail, callback) {
            const data = mail.data;
            const from = typeof data.from === "string" ? data.from : formatAddress(data.from || {});
            const to = addressList(data.to);
            const bcc = addressList(data.bcc);
            Promise.all((data.attachments || []).map((attachment) => resolveAttachment(mail, attachment)))
                .then((attachments) => axios.post(RESEND_URL, {
                    from,
                    to: to.length ? to : addressList(from),
                    ...(bcc.length ? { bcc } : {}),
                    subject: data.subject,
                    ...(data.html ? { html: data.html } : {}),
                    ...(data.text ? { text: data.text } : {}),
                    ...(attachments.length ? { attachments } : {}),
                }, { headers: { Authorization: `Bearer ${apiKey}` }, timeout: SEND_TIMEOUT_MS }))
                .then((response) => callback(null, { messageId: response.data && response.data.id, response: response.data && response.data.id }))
                .catch((error) => callback(new Error((error.response && error.response.data && error.response.data.message) || error.message)));
        },
    };
}

function mailTransport(env = liveEnv()) {
    const provider = mailProvider(env);
    if (provider === "ses") return nodemailer.createTransport({ SES: { ses: sesClient(env), aws: { SendRawEmailCommand } } });
    if (provider === "resend") return nodemailer.createTransport(resendTransport(env.RESEND_API_KEY));
    const port = env.NODEMAILER_PORT;
    return nodemailer.createTransport({
        host: env.NODEMAILER_HOST,
        port,
        secure: port == 465,
        auth: {
            user: env.NODEMAILER_USER || env.NODEMAILER_EMAIL,
            pass: env.NODEMAILER_EMAIL_PASSWORD,
        },
        tls: {
            rejectUnauthorized: !allowSelfSigned(),
        },
    });
}

module.exports = { SES_KEYS, mailProvider, senderAddress, mailConfigured, fromHeader, sesClient, mailTransport };
