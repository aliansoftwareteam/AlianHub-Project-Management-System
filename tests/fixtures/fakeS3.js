/* An in-memory S3 that answers the commands of @aws-sdk/client-s3 the app sends, so the storage layer
 * can be exercised end to end without a bucket. `pageSize` keeps listings short to exercise paging. */
const crypto = require('crypto');

const failure = (name, status) => Object.assign(new Error(name), { name, Code: name, $metadata: { httpStatusCode: status } });
const etagOf = (body) => `"${crypto.createHash('md5').update(body).digest('hex')}"`;
const asBuffer = (body) => (Buffer.isBuffer(body) ? body : Buffer.from(body instanceof Uint8Array ? body : String(body)));

function createFakeS3({ pageSize = 1000 } = {}) {
    const buckets = new Map();
    const calls = [];

    const bucket = (name, { create = false } = {}) => {
        if (!buckets.has(name) && create) buckets.set(name, new Map());
        if (!buckets.has(name)) throw failure('NoSuchBucket', 404);
        return buckets.get(name);
    };
    const object = (input) => {
        const found = bucket(input.Bucket).get(input.Key);
        if (!found) throw failure(input.Key === undefined ? 'NotFound' : 'NoSuchKey', 404);
        return found;
    };
    const store = (name, key, body, extra = {}) => {
        const data = asBuffer(body);
        bucket(name, { create: true }).set(key, { body: data, etag: etagOf(data), ...extra });
    };

    const handlers = {
        CreateBucket: (input) => { bucket(input.Bucket, { create: true }); return {}; },
        DeleteBucket: (input) => {
            if (bucket(input.Bucket).size) throw failure('BucketNotEmpty', 409);
            buckets.delete(input.Bucket);
            return {};
        },
        HeadBucket: (input) => { bucket(input.Bucket); return {}; },
        PutObject: (input) => {
            store(input.Bucket, input.Key, input.Body, { contentType: input.ContentType, acl: input.ACL });
            return { ETag: bucket(input.Bucket).get(input.Key).etag };
        },
        HeadObject: (input) => {
            const found = bucket(input.Bucket).get(input.Key);
            if (!found) throw failure('NotFound', 404);
            return { ContentLength: found.body.length, ETag: found.etag, ContentType: found.contentType };
        },
        GetObject: (input) => {
            const found = object(input);
            return {
                ContentLength: found.body.length,
                ETag: found.etag,
                Body: {
                    transformToString: async () => found.body.toString('utf8'),
                    async* [Symbol.asyncIterator]() { yield found.body; },
                },
            };
        },
        DeleteObject: (input) => { bucket(input.Bucket).delete(input.Key); return {}; },
        DeleteObjects: (input) => {
            const target = bucket(input.Bucket);
            for (const { Key } of input.Delete.Objects) target.delete(Key);
            return { Deleted: input.Delete.Objects };
        },
        CopyObject: (input) => {
            const [sourceBucket, ...rest] = String(input.CopySource).split('/');
            const sourceKey = rest.map(decodeURIComponent).join('/');
            const found = object({ Bucket: sourceBucket, Key: sourceKey });
            store(input.Bucket, input.Key, Buffer.from(found.body), { contentType: found.contentType });
            return { CopyObjectResult: { ETag: bucket(input.Bucket).get(input.Key).etag } };
        },
        ListObjectsV2: (input) => {
            const prefix = input.Prefix || '';
            const keys = [...bucket(input.Bucket).keys()].filter((key) => key.startsWith(prefix)).sort();
            const start = input.ContinuationToken ? Number(input.ContinuationToken) : 0;
            const size = Math.min(input.MaxKeys || pageSize, pageSize);
            const page = keys.slice(start, start + size);
            const truncated = start + size < keys.length;
            return {
                Contents: page.map((key) => ({ Key: key, Size: bucket(input.Bucket).get(key).body.length, ETag: bucket(input.Bucket).get(key).etag })),
                KeyCount: page.length,
                IsTruncated: truncated,
                ...(truncated ? { NextContinuationToken: String(start + size) } : {}),
            };
        },
    };

    const send = async (command) => {
        const name = command.constructor.name.replace(/Command$/, '');
        calls.push({ name, input: command.input });
        if (!handlers[name]) throw new Error(`fake S3 does not answer ${name}`);
        return handlers[name](command.input);
    };

    const keys = (name) => (buckets.has(name) ? [...buckets.get(name).keys()].sort() : []);
    const read = (name, key) => (buckets.has(name) && buckets.get(name).has(key) ? buckets.get(name).get(key).body.toString('utf8') : null);
    const bytesUnder = (name, prefix = '') => [...(buckets.get(name) || new Map()).entries()]
        .filter(([key]) => key.startsWith(prefix)).reduce((sum, [, value]) => sum + value.body.length, 0);

    return { send, client: { send }, buckets, calls, store, keys, read, bytesUnder };
}

/* storage_usage held in memory, with the store interface common-storage/storageUsage.js expects. */
function createUsageStore() {
    const rows = new Map();
    return {
        rows,
        inc: async (id, bytes, objects, at) => {
            const row = rows.get(id) || { _id: id, bytes: 0, objects: 0 };
            rows.set(id, { ...row, bytes: row.bytes + bytes, objects: row.objects + objects, updatedAt: at });
        },
        get: async (id) => (rows.has(id) ? { ...rows.get(id) } : null),
        all: async () => [...rows.values()].map((row) => ({ ...row })),
        set: async (id, fields) => { rows.set(id, { _id: id, ...(rows.get(id) || {}), ...fields }); },
        remove: async (id) => { rows.delete(id); },
    };
}

module.exports = { createFakeS3, createUsageStore, etagOf };
