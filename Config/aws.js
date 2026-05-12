// BUG-041 / #95 — drop `aws-sdk` v2; consolidate on @aws-sdk/* v3.
// The only consumer of the AWS clients we expose is
// `Modules/servicewithAWS.js`, which sends transactional email via SES.
// The other clients we used to export here (sesv2, ssmClient, s3,
// sesWithAttachment) had zero call sites — they were dead weight.
//
// `awsRef.ses` is preserved as the v3 SESClient + a `.sendEmail(params, cb)`
// shim so existing callers in servicewithAWS.js continue to work without
// rewriting their callback contract.

const { SESClient, SendEmailCommand } = require('@aws-sdk/client-ses');

const sesClient = new SESClient({
    region: process.env.AWS_SES_REGION,
    credentials: (process.env.AWS_SES_KEY && process.env.AWS_SES_SECRET) ? {
        accessKeyId: process.env.AWS_SES_KEY,
        secretAccessKey: process.env.AWS_SES_SECRET,
    } : undefined,
});

// v2 -> v3 callback shim. v2's `ses.sendEmail(params, callback)` is
// callback-style; v3 returns a Promise from `client.send(command)`.
// Keep the v2 surface so callers don't have to change.
const ses = {
    /**
     * Drop-in for the v2 `ses.sendEmail(params, callback)` call site.
     * Resolves to the same `data` v2 emitted on success; the callback
     * is fired with `(error, data)`.
     */
    sendEmail(params, callback) {
        sesClient.send(new SendEmailCommand(params))
            .then(data => callback && callback(null, data))
            .catch(err => callback && callback(err));
    },
    // Some legacy code paths may have called `.promise()` to get a
    // Promise out of v2 — preserve that shape too.
    sendEmailPromise(params) {
        return sesClient.send(new SendEmailCommand(params));
    }
};

const wasabiAccessKey = process.env.WASABI_ACCESS_KEY
const wasabiSecretAccessKey = process.env.WASABI_SECRET_ACCESS_KEY
const wasabiEndPoint = process.env.WASABIENDPOINT
const region = process.env.WASABI_REGION
const iamEndPoint = process.env.IAM_ENDPOINT
const userProfileBucket = process.env.USERPROFILEBUCKET
const wasabiUserId = process.env.WASABI_USERID

module.exports = {
    ses,
    // Expose the raw v3 client too in case future code wants to use it
    // directly with Commands rather than the legacy shim.
    sesClient,
    wasabiEndPoint,
    wasabiAccessKey,
    wasabiSecretAccessKey,
    region,
    iamEndPoint,
    userProfileBucket,
    wasabiUserId
}
