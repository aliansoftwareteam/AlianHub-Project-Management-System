const crypto = require('crypto');
const { getS3Client } = require('./s3Client');
const { currentLayout } = require('./s3Layout');
const usage = require('./storageUsage');

/* Every object-storage operation the app makes, each in one place: the layout picks bucket and key,
 * and each put, copy and delete adds its bytes to the usage counter. `owner` is a company id, or
 * PUBLIC_OWNER for avatars and shared assets. */

const DELETE_BATCH = 1000;

const isMissing = (error) => Boolean(error) && (['NoSuchKey', 'NotFound', 'NoSuchBucket'].includes(error.name || error.Code)
    || (error.$metadata && error.$metadata.httpStatusCode === 404));

const byteLength = (body) => {
    if (typeof body === 'string') return Buffer.byteLength(body);
    if (body && typeof body.length === 'number' && (Buffer.isBuffer(body) || body instanceof Uint8Array)) return body.length;
    return 0;
};

const sizeOfHead = (head) => (Number.isFinite(Number(head && head.ContentLength)) ? Number(head.ContentLength) : 0);

function storeOf({ client = getS3Client, layout = currentLayout, counter = usage } = {}) {
    const sdk = () => require('@aws-sdk/client-s3');
    const send = (command) => client().send(command);

    /* null when the object is not there; a HEAD that fails otherwise rejects. */
    const head = async (owner, key) => {
        try {
            return sizeOfHead(await send(new (sdk().HeadObjectCommand)(layout().locate(owner, key))));
        } catch (error) {
            if (isMissing(error)) return null;
            throw error;
        }
    };
    const sizeBefore = (owner, key) => (counter ? head(owner, key).catch(() => undefined) : Promise.resolve(undefined));

    const count = (owner, bytes, objects) => { if (counter) counter.add(owner, bytes, objects); };

    /* `replace` reads the old size first, so writing over an object adds only the difference. */
    const put = async (owner, key, body, { contentType, acl, replace = false } = {}) => {
        const where = layout();
        const input = { ...where.locate(owner, key), Body: body };
        if (contentType !== undefined) input.ContentType = contentType;
        if (acl && !where.prefixMode) input.ACL = acl;
        const before = replace ? await sizeBefore(owner, key) : null;
        const response = await send(new (sdk().PutObjectCommand)(input));
        const existed = before !== null && before !== undefined;
        count(owner, byteLength(body) - (existed ? before : 0), existed ? 0 : 1);
        return response;
    };

    const remove = async (owner, key) => {
        const target = layout().locate(owner, key);
        const size = await sizeBefore(owner, key);
        const response = await send(new (sdk().DeleteObjectCommand)(target));
        if (size !== null) count(owner, -(size || 0), -1);
        return response;
    };

    const copy = async (owner, fromKey, toKey) => {
        const where = layout();
        const source = where.locate(owner, fromKey);
        const size = await sizeBefore(owner, fromKey);
        const response = await send(new (sdk().CopyObjectCommand)(where.withBucket(owner, { CopySource: where.copySource(source), Key: where.locate(owner, toKey).Key })));
        if (size !== null) count(owner, size || 0, 1);
        return response;
    };

    const get = (owner, key) => send(new (sdk().GetObjectCommand)(layout().locate(owner, key)));

    const signedGetUrl = (owner, key, expiresIn) => {
        const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');
        return getSignedUrl(client(), new (sdk().GetObjectCommand)(layout().locate(owner, key)), { expiresIn });
    };

    /* Every object of one owner, a page at a time; a key outside the area of the owner is never yielded. */
    async function* list(owner) {
        const where = layout();
        let token;
        do {
            const page = await send(new (sdk().ListObjectsV2Command)({ ...where.listing(owner), ...(token ? { ContinuationToken: token } : {}) }));
            for (const object of (page && page.Contents) || []) {
                const key = where.logicalKey(owner, object.Key);
                if (key !== null) yield { key, fullKey: object.Key, size: Number(object.Size) || 0, etag: object.ETag };
            }
            token = page && page.IsTruncated ? page.NextContinuationToken : undefined;
        } while (token);
    }

    const measure = async (owner) => {
        let bytes = 0;
        let objects = 0;
        for await (const object of list(owner)) {
            bytes += object.size;
            objects += 1;
        }
        return { bytes, objects };
    };

    /* Lists from the start after every batch, so a run that stops half way is finished by the next one. */
    const removeAll = async (owner) => {
        const where = layout();
        let deleted = 0;
        let batch;
        do {
            batch = [];
            for await (const object of list(owner)) {
                batch.push({ Key: object.fullKey });
                if (batch.length >= DELETE_BATCH) break;
            }
            if (batch.length) {
                const result = await send(new (sdk().DeleteObjectsCommand)(where.withBucket(owner, { Delete: { Objects: batch, Quiet: true } })));
                const errors = (result && result.Errors) || [];
                if (errors.length) throw Object.assign(new Error(`${errors.length} objects could not be deleted, first: ${errors[0].Key} ${errors[0].Code || ''}`), { code: 'delete_failed' });
                deleted += batch.length;
            }
        } while (batch.length);
        return { deleted };
    };

    /* Prefix mode never creates or deletes a bucket: both only check that the area can be listed.
     * Emptying a deleted workspace is removeAll, run by companyFiles.js. */
    const verifyArea = (where, companyId) => send(new (sdk().ListObjectsV2Command)({ ...where.listing(companyId), MaxKeys: 1 }));

    const createArea = async (companyId) => {
        const where = layout();
        if (!where.prefixMode) return send(new (sdk().CreateBucketCommand)(where.withBucket(companyId)));
        return verifyArea(where, companyId);
    };

    const removeArea = async (companyId) => {
        const where = layout();
        if (!where.prefixMode) return send(new (sdk().DeleteBucketCommand)(where.withBucket(companyId)));
        return verifyArea(where, companyId);
    };

    /* Read-only, for the health page: the public bucket today, the prefix of the instance in prefix mode. */
    const reach = async () => {
        const where = layout();
        if (!where.prefixMode) return send(new (sdk().HeadBucketCommand)(where.withBucket('public')));
        return send(new (sdk().ListObjectsV2Command)({ ...where.instanceListing(), MaxKeys: 1 }));
    };

    /* What the Test button runs: the keys typed are the keys tried, on a write the counter never sees. */
    const roundTrip = async () => {
        const target = layout().probeLocation(`${Date.now()}-${crypto.randomBytes(4).toString('hex')}.txt`);
        const body = `alianhub storage test ${new Date().toISOString()}`;
        await send(new (sdk().PutObjectCommand)({ ...target, Body: body, ContentType: 'text/plain' }));
        try {
            const read = await send(new (sdk().GetObjectCommand)(target));
            const text = read && read.Body && typeof read.Body.transformToString === 'function' ? await read.Body.transformToString() : body;
            if (text !== body) throw Object.assign(new Error('The test object read back different bytes.'), { code: 'read_mismatch' });
        } finally {
            await send(new (sdk().DeleteObjectCommand)(target));
        }
        return { key: target.Key };
    };

    return { put, remove, copy, get, signedGetUrl, head, list, measure, removeAll, createArea, removeArea, reach, roundTrip };
}

const store = storeOf();

module.exports = { ...store, storeOf, isMissing, byteLength, DELETE_BATCH };
