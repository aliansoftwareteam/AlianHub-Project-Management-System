const fs = require('fs');
const path = require('path');
const { safeRelativePath } = require('../utils/uploadConfig');

// The read side of putLocalFile: the bytes of one stored object, from the company's own bucket,
// whichever storage type the install runs. There was no such entry point: every other reader
// hands a browser a signed url, which is no use to code that has to parse the file itself.
//
// The key is an object key relative to the company's bucket, as an upload returns it and an
// attachment record stores it. It is never a filesystem path or a url, and the company id is
// never taken from the key.

const STORAGE_ROOT = path.join(__dirname, '..', 'storage');
const OBJECT_ID = /^[a-f0-9]{24}$/i;
const URL_LIKE = /^[a-z][a-z0-9+.-]*:/i;

const refusal = (code, message) => Object.assign(new Error(message), { code });

const safeKey = (key) => {
    if (typeof key !== 'string' || URL_LIKE.test(key)) return null;
    return safeRelativePath(key);
};

const readFromDisk = async (companyId, key, maxBytes) => {
    const bucketRoot = path.resolve(STORAGE_ROOT, companyId);
    const target = path.resolve(bucketRoot, key);
    if (!target.startsWith(bucketRoot + path.sep)) throw refusal('invalid_key', 'The key leaves the company bucket.');
    const stat = await fs.promises.stat(target).catch(() => null);
    if (!stat || !stat.isFile()) throw refusal('not_found', 'No such stored file.');
    /* storage/ may itself be a mount or a link, so both sides are resolved before comparing. */
    const [realRoot, realTarget] = await Promise.all([fs.promises.realpath(bucketRoot), fs.promises.realpath(target)]);
    if (!realTarget.startsWith(realRoot + path.sep)) throw refusal('invalid_key', 'The key leaves the company bucket.');
    if (stat.size > maxBytes) throw refusal('too_large', `The stored file is ${stat.size} bytes, over the ${maxBytes} allowed.`);
    const buffer = await fs.promises.readFile(target);
    return { buffer, size: buffer.length };
};

let s3Client = null;

/* Built the way Modules/storage/wasabi/controller.js builds its client, and only on a wasabi
 * install, so server storage never loads the S3 SDK. */
const client = () => {
    if (s3Client) return s3Client;
    const { S3Client } = require('@aws-sdk/client-s3');
    const awsRef = require('../Config/aws.js');
    const { requestHandler } = require('../Config/config');
    s3Client = new S3Client({
        region: awsRef.region,
        credentials: { accessKeyId: awsRef.wasabiAccessKey, secretAccessKey: awsRef.wasabiSecretAccessKey },
        endpoint: awsRef.wasabiEndPoint,
        requestHandler,
    });
    return s3Client;
};

const isMissing = (error) => Boolean(error) && (['NoSuchKey', 'NotFound', 'NoSuchBucket'].includes(error.name || error.Code)
    || (error.$metadata && error.$metadata.httpStatusCode === 404));

const drop = (body) => { if (body && typeof body.destroy === 'function') body.destroy(); };

/* The declared length is checked first, and the stream is counted as well: a length is only
 * what the bucket says. */
const readFromBucket = async (companyId, key, maxBytes) => {
    const { GetObjectCommand } = require('@aws-sdk/client-s3');
    let response;
    try {
        response = await client().send(new GetObjectCommand({ Bucket: companyId, Key: key }));
    } catch (error) {
        if (isMissing(error)) throw refusal('not_found', 'No such stored file.');
        throw error;
    }
    const body = response && response.Body;
    if (!body) throw refusal('not_found', 'No such stored file.');
    if (Number(response.ContentLength) > maxBytes) {
        drop(body);
        throw refusal('too_large', `The stored file is ${response.ContentLength} bytes, over the ${maxBytes} allowed.`);
    }
    const parts = [];
    let size = 0;
    for await (const part of body) {
        size += part.length;
        if (size > maxBytes) {
            drop(body);
            throw refusal('too_large', `The stored file runs past the ${maxBytes} bytes allowed.`);
        }
        parts.push(Buffer.from(part));
    }
    return { buffer: Buffer.concat(parts), size };
};

/**
 * @param {string} companyId the tenant: the Wasabi bucket, or the directory under storage/
 * @param {string} key       the object key inside that bucket
 * @param {number} maxBytes  refuse anything larger, before reading it where the size is known
 * @returns {Promise<{ buffer: Buffer, size: number }>} rejects with code invalid_key,
 *          not_found or too_large
 */
const readStoredFile = async ({ companyId, key, maxBytes }) => {
    const company = String(companyId || '');
    const cleanKey = safeKey(key);
    if (!OBJECT_ID.test(company) || !cleanKey) throw refusal('invalid_key', 'A company id and a key inside its bucket are required.');
    const limit = Number(maxBytes) > 0 ? Number(maxBytes) : 0;
    if (!limit) throw refusal('too_large', 'A size limit is required.');
    return String(process.env.STORAGE_TYPE || 'wasabi') === 'server'
        ? readFromDisk(company, cleanKey, limit)
        : readFromBucket(company, cleanKey, limit);
};

module.exports = { readStoredFile, STORAGE_ROOT };
