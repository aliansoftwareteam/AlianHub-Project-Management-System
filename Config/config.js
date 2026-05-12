const dotenv = require('dotenv');
const path = require('path');
const { NodeHttpHandler } = require("@smithy/node-http-handler");

const appDir = path.dirname(require.main.filename);
dotenv.config({
    path: path.resolve(appDir, `.env`)
});
const NodeCache = require( "node-cache" );
const myCache = new NodeCache();

module.exports = {
    NODE_ENV : process.env.NODE_ENV || 'development',
    PORT : process.env.PORT || 4000,
    APP_NAME: process.env.APP_NAME,

    SERVICE_FILE : process.env.SERVICE_FILE,

    FIREBASE_APIKEY : process.env.APIKEY,
    FIREBASE_AUTODOMAIN : process.env.AUTODOMAIN,
    FIREBASE_PROJECTID : process.env.PROJECTID,
    FIREBASE_STORAGEBUCKET : process.env.STORAGEBUCKET,
    FIREBASE_MESSAGINGSENDERID : process.env.MESSAGINGSENDERID,
    FIREBASE_APPID : process.env.APPID,
    FIREBASE_MEASUREMENTID : process.env.MEASUREMENTID,

    APIURL: process.env.APIURL,
    WEBURL: process.env.WEBURL,

    NODEMAILER_EMAIL: process.env.NODEMAILER_EMAIL,
    NODEMAILER_EMAIL_PASSWORD : process.env.NODEMAILER_EMAIL_PASSWORD,
    NODEMAILER_HOST: process.env.NODEMAILER_HOST,
    NODEMAILER_PORT: process.env.NODEMAILER_PORT,

    AWS_SES_KEY: process.env.AWS_SES_KEY,
    AWS_SES_SECRET: process.env.AWS_SES_SECRET,
    AWS_SES_REGION: process.env.AWS_SES_REGION,
    AWS_SES_FROM_DEFAULT: process.env.AWS_SES_FROM_DEFAULT,

    ENDPOINT_KEY: process.env.ENDPOINT_KEY,
    MONGODB_URL:process.env.MONGODB_URL,

    ERRORRECIVEREMAIL:process.env.ERRORRECIVEREMAIL,
    NOOFPRESETCOMPANY: process.env.NOOFPRESETCOMPANY,
    PRECOMPANYKEY: process.env.PRECOMPANYKEY,

    AI_API_KEY:process.env.AI_API_KEY,
    AI_MODEL:process.env.AI_MODEL,

    RESEND_API_KEY: process.env.RESEND_API_KEY,
    RESEND_FROM_EMAIL: process.env.RESEND_FROM_EMAIL,

    STORAGE_TYPE:process.env.STORAGE_TYPE,

    UNDER_MAINTENANCE: process.env.UNDER_MAINTENANCE,
    myCache: myCache,
    USERPROFILEBUCKET: process.env.USERPROFILEBUCKET,
    // BUG-038 / #92 — S3 request handler timeouts.
    // Previously both timeouts were 300_000ms (5 minutes). A hung Wasabi
    // call would pin the request worker for that long, so a brief
    // upstream outage saturated the pool and degraded unrelated routes.
    // Drop to 30s (covers normal multi-MB uploads on slow links but
    // gives up quickly on truly stuck connections). Env-tunable via
    // `S3_CONNECTION_TIMEOUT_MS` / `S3_SOCKET_TIMEOUT_MS` for operators
    // who need a different ceiling (e.g. very large file uploads).
    requestHandler: new NodeHttpHandler({
        connectionTimeout: Number(process.env.S3_CONNECTION_TIMEOUT_MS) || 30000,
        socketTimeout: Number(process.env.S3_SOCKET_TIMEOUT_MS) || 30000,
    })
}