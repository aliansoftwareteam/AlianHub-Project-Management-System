/* The storage layer against a real S3 server: MinIO, started by the integration job in CI. The same
 * scenarios run against an in-memory bucket in tests/storage-usage-counter.test.js. Skipped where no
 * S3_TEST_ENDPOINT is set, so a laptop without MinIO still runs the rest of the suite. */
const crypto = require('crypto');
const sdk = require('@aws-sdk/client-s3');
const { scenarios, settle, COMPANY } = require('../fixtures/s3Scenarios');
const { createUsageStore } = require('../fixtures/fakeS3');
const { resolveS3Config } = require('../../common-storage/s3Config');
const { layoutOf } = require('../../common-storage/s3Layout');
const { buildS3Client, resetS3Client } = require('../../common-storage/s3Client');
const { storeOf } = require('../../common-storage/s3Store');
const { usageOf } = require('../../common-storage/storageUsage');

const ENDPOINT = process.env.S3_TEST_ENDPOINT;
const ACCESS_KEY = process.env.S3_TEST_ACCESS_KEY || 'minioadmin';
const SECRET_KEY = process.env.S3_TEST_SECRET_KEY || 'minioadmin';
const BUCKET = `alianhub-it-${crypto.randomBytes(4).toString('hex')}`;
const withMinio = ENDPOINT ? describe : describe.skip;

const envFor = (prefix, extra = {}) => ({
    STORAGE_TYPE: 's3', S3_ENDPOINT: ENDPOINT, S3_REGION: 'us-east-1', S3_ACCESS_KEY: ACCESS_KEY, S3_SECRET_KEY: SECRET_KEY,
    S3_BUCKET: BUCKET, S3_PREFIX: prefix, S3_FORCE_PATH_STYLE: 'true', ...extra,
});

let worlds = 0;
const world = () => {
    worlds += 1;
    const prefix = `ins_${worlds}_${crypto.randomBytes(3).toString('hex')}/`;
    const cfg = resolveS3Config(envFor(prefix));
    const client = buildS3Client(cfg);
    const layout = layoutOf(cfg);
    const usage = usageOf(createUsageStore());
    const logger = { info: jest.fn(), warn: jest.fn(), error: jest.fn() };
    const store = storeOf({ client: () => client, layout: () => layout, counter: usage });
    return { store, usage, layout, logger, send: (command) => client.send(command), bucket: BUCKET, prefix };
};

withMinio('object storage on a real S3 server', () => {
    const admin = ENDPOINT && buildS3Client(resolveS3Config(envFor('')));

    beforeAll(async () => {
        await admin.send(new sdk.CreateBucketCommand({ Bucket: BUCKET }));
    });

    afterAll(async () => {
        const root = storeOf({ client: () => admin, layout: () => layoutOf({ ...resolveS3Config(envFor('')), prefixMode: false }), counter: null });
        for await (const object of root.list(BUCKET)) await admin.send(new sdk.DeleteObjectCommand({ Bucket: BUCKET, Key: object.fullKey }));
        await admin.send(new sdk.DeleteBucketCommand({ Bucket: BUCKET }));
    });

    it.each(Object.keys(scenarios))('%s', async (name) => {
        await scenarios[name](world());
    });

    it('hands out a signed address that downloads the file and nothing else', async () => {
        const ctx = world();
        await ctx.store.put(COMPANY, 'Project/p1/Attachment/a b.txt', 'signed bytes', { contentType: 'text/plain' });
        const url = await ctx.store.signedGetUrl(COMPANY, 'Project/p1/Attachment/a b.txt', 60);
        expect(url).toContain(`/${BUCKET}/${ctx.prefix}${COMPANY}/Project/p1/Attachment/a%20b.txt`);
        const response = await fetch(url);
        expect(response.status).toBe(200);
        expect(await response.text()).toBe('signed bytes');
        const tampered = new URL(url);
        tampered.pathname = tampered.pathname.replace(`${COMPANY}/`, '6731b7c2a1b2c3d4e5f60719/');
        expect((await fetch(tampered)).status).toBe(403);
    });

    describe('a key rotated mid-run', () => {
        const KEYS = ['STORAGE_TYPE', 'S3_ENDPOINT', 'S3_REGION', 'S3_ACCESS_KEY', 'S3_SECRET_KEY', 'S3_BUCKET', 'S3_PREFIX', 'S3_FORCE_PATH_STYLE'];
        const saved = {};
        beforeEach(() => KEYS.forEach((key) => { saved[key] = process.env[key]; }));
        afterEach(() => {
            KEYS.forEach((key) => { if (saved[key] === undefined) delete process.env[key]; else process.env[key] = saved[key]; });
            resetS3Client();
        });

        it('lets the upload in flight finish on the old key and sends the next request with the new one', async () => {
            const prefix = `rotation_${crypto.randomBytes(3).toString('hex')}/`;
            Object.assign(process.env, envFor(prefix));
            const { applyEnvMap } = require('../../Config/applyEnv');
            const usage = usageOf(createUsageStore());
            const store = storeOf({ counter: usage });

            const inFlight = store.put(COMPANY, 'Project/p1/big.bin', crypto.randomBytes(4 * 1024 * 1024));
            applyEnvMap({ S3_SECRET_KEY: `${SECRET_KEY}-revoked` });
            await expect(store.put(COMPANY, 'Project/p1/after.bin', 'x')).rejects.toMatchObject({ name: expect.stringMatching(/SignatureDoesNotMatch|InvalidAccessKeyId|AccessDenied/) });
            await expect(inFlight).resolves.toBeDefined();

            applyEnvMap({ S3_SECRET_KEY: SECRET_KEY });
            await store.put(COMPANY, 'Project/p1/after.bin', 'x');
            await settle();
            expect(await store.measure(COMPANY)).toEqual({ bytes: 4 * 1024 * 1024 + 1, objects: 2 });
            expect(await usage.storageUsage(COMPANY)).toMatchObject({ bytes: 4 * 1024 * 1024 + 1, objects: 2 });
        });
    });
});
