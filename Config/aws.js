const wasabiAccessKey = process.env.WASABI_ACCESS_KEY
const wasabiSecretAccessKey = process.env.WASABI_SECRET_ACCESS_KEY
const wasabiEndPoint = process.env.WASABIENDPOINT
const region = process.env.WASABI_REGION
const iamEndPoint = process.env.IAM_ENDPOINT
const userProfileBucket = process.env.USERPROFILEBUCKET
const wasabiUserId = process.env.WASABI_USERID

module.exports = {
    wasabiEndPoint,
    wasabiAccessKey,
    wasabiSecretAccessKey,
    region,
    iamEndPoint,
    userProfileBucket,
    wasabiUserId
}
