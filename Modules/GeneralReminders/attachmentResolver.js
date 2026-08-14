// Resolves a stored attachment KEY into something nodemailer can actually
// attach. Uploads store a relative storage key (e.g.
// "Reminders/<companyId>/<userId>/1753948_file.png"), never a fetchable URL,
// so the mail path has to resolve it per storage backend:
//
//   STORAGE_TYPE=server  -> absolute path on disk (nodemailer reads it directly)
//   STORAGE_TYPE=wasabi  -> short-lived presigned https URL
//
// Self-contained on purpose: it does not modify or re-export any existing
// storage module, it only mirrors how Modules/storage/wasabi/controller.js
// builds its S3 client.
const path = require('path');
const fs = require('fs');
const awsRef = require('../../Config/aws.js');
const { requestHandler } = require('../../Config/config');
const { safeRelativePath } = require('../../utils/uploadConfig');
const logger = require('../../Config/loggerConfig');

const LOG_PREFIX = '[general-reminders]';
// Presigned URLs only need to outlive the SMTP fetch.
const MAIL_URL_TTL_SECONDS = 3600;

let cachedClient = null;
function getS3Client() {
    if (cachedClient) return cachedClient;
    // Required lazily so a server-storage deployment never loads the S3 SDK.
    const { S3Client } = require('@aws-sdk/client-s3');
    cachedClient = new S3Client({
        region: awsRef.region,
        credentials: {
            accessKeyId: awsRef.wasabiAccessKey,
            secretAccessKey: awsRef.wasabiSecretAccessKey,
        },
        endpoint: awsRef.wasabiEndPoint,
        requestHandler,
    });
    return cachedClient;
}

function storageType() {
    return process.env.STORAGE_TYPE || 'wasabi';
}

// Absolute on-disk location for server storage: <root>/storage/<companyId>/<key>
function resolveLocalPath(companyId, key) {
    const safeKey = safeRelativePath(String(key));
    const safeCompany = safeRelativePath(String(companyId));
    if (!safeKey || !safeCompany) return null;
    const abs = path.join(__dirname, '../../storage', safeCompany, safeKey);
    return fs.existsSync(abs) ? abs : null;
}

async function resolvePresignedUrl(companyId, key) {
    const { GetObjectCommand } = require('@aws-sdk/client-s3');
    const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');
    const command = new GetObjectCommand({ Bucket: String(companyId), Key: String(key) });
    return getSignedUrl(getS3Client(), command, { expiresIn: MAIL_URL_TTL_SECONDS });
}

// Turn the reminder's stored attachments into nodemailer attachment objects.
// Anything that cannot be resolved is dropped with a log line rather than
// failing the whole email.
async function buildMailAttachments(companyId, attachments) {
    if (!Array.isArray(attachments) || !attachments.length) return [];
    const isServer = storageType() === 'server';
    const out = [];
    for (const att of attachments) {
        const key = att && att.url ? String(att.url) : '';
        if (!key) continue;
        const filename = (att && att.name) || 'attachment';
        try {
            // Already a fetchable URL (defensive — lets a caller pass one through).
            if (/^https?:\/\//i.test(key)) {
                out.push({ filename, path: key });
                continue;
            }
            if (isServer) {
                const local = resolveLocalPath(companyId, key);
                if (!local) {
                    logger.error(`${LOG_PREFIX} attachment missing on disk: ${key}`);
                    continue;
                }
                out.push({ filename, path: local });
            } else {
                out.push({ filename, path: await resolvePresignedUrl(companyId, key) });
            }
        } catch (e) {
            logger.error(`${LOG_PREFIX} attachment resolve failed (${key}): ${e.message}`);
        }
    }
    return out;
}

module.exports = {
    buildMailAttachments,
    resolveLocalPath,
    storageType,
};
