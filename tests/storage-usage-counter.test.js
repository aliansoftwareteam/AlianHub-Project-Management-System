/* The storage layer against an in-memory S3: every put, copy and delete keeps storage_usage equal to
 * what a listing finds, reconciliation corrects drift, an instance never touches keys outside its prefix,
 * and a rotated key is used by the next request while the one in flight finishes on the old client. */
jest.mock('../Config/loggerConfig', () => ({ info: jest.fn(), error: jest.fn(), warn: jest.fn(), debug: jest.fn() }));

const { S3Client, PutObjectCommand } = require('@aws-sdk/client-s3');
const { createFakeS3, createUsageStore } = require('./fixtures/fakeS3');
const { scenarios, settle, COMPANY, OTHER } = require('./fixtures/s3Scenarios');
const { resolveS3Config } = require('../common-storage/s3Config');
const { layoutOf, PUBLIC_OWNER } = require('../common-storage/s3Layout');
const { storeOf } = require('../common-storage/s3Store');
const { usageOf, driftOf } = require('../common-storage/storageUsage');
const { reconcileAll } = require('../common-storage/storageReconcile');
const { scheduleCompanyFilesRemoval } = require('../common-storage/companyFiles');

const BUCKET = 'alianhub-cloud-tenants-test';
const PREFIX = 'ins_01jd3k8w/';
const HOSTED_ENV = { STORAGE_TYPE: 's3', S3_BUCKET: BUCKET, S3_PREFIX: PREFIX, S3_REGION: 'us-east-1', S3_ENDPOINT: 'http://fake-s3.test', S3_FORCE_PATH_STYLE: 'true', S3_ACCESS_KEY: 'AK', S3_SECRET_KEY: 'SK' };

const world = ({ pageSize = 2, env = HOSTED_ENV } = {}) => {
    const fake = createFakeS3({ pageSize });
    fake.store(BUCKET, '.keep', '');
    fake.buckets.get(BUCKET).delete('.keep');
    const usageStore = createUsageStore();
    const logger = { info: jest.fn(), warn: jest.fn(), error: jest.fn() };
    const usage = usageOf(usageStore, { logger });
    const layout = layoutOf(resolveS3Config(env));
    const store = storeOf({ client: () => fake.client, layout: () => layout, counter: usage });
    return { fake, usageStore, usage, layout, store, logger, send: fake.send, bucket: BUCKET, prefix: PREFIX };
};

describe('in prefix mode, against an in-memory bucket', () => {
    it.each(Object.keys(scenarios))('%s', async (name) => {
        await scenarios[name](world());
    });
});

describe('with a bucket per workspace', () => {
    const WASABI_ENV = { STORAGE_TYPE: 'wasabi', WASABI_REGION: 'us-east-1', USERPROFILEBUCKET: 'profiles' };

    it('writes the same objects to the same bucket and key as before, and counts them too', async () => {
        const ctx = world({ env: WASABI_ENV });
        ctx.fake.store(COMPANY, '.keep', '');
        ctx.fake.buckets.get(COMPANY).delete('.keep');
        await ctx.store.put(COMPANY, 'Project/p1/a.txt', 'hello', { contentType: 'text/plain' });
        await ctx.store.put(PUBLIC_OWNER, 'public_assets/a.png', 'png', { acl: 'public-read', replace: true });
        await settle();
        expect(ctx.fake.keys(COMPANY)).toEqual(['Project/p1/a.txt']);
        expect(ctx.fake.keys('profiles')).toEqual(['public_assets/a.png']);
        expect(ctx.fake.calls.find((call) => call.name === 'PutObject').input).toEqual({ Bucket: COMPANY, Key: 'Project/p1/a.txt', Body: 'hello', ContentType: 'text/plain' });
        expect(ctx.fake.buckets.get('profiles').get('public_assets/a.png').acl).toBe('public-read');
        expect(await ctx.usage.storageUsage(COMPANY)).toMatchObject({ bytes: 5, objects: 1 });
    });

    it('creates and deletes the workspace bucket as before', async () => {
        const ctx = world({ env: WASABI_ENV });
        await ctx.store.createArea(COMPANY);
        expect(ctx.fake.buckets.has(COMPANY)).toBe(true);
        await ctx.store.removeArea(COMPANY);
        expect(ctx.fake.buckets.has(COMPANY)).toBe(false);
    });
});

describe('in prefix mode, buckets are never created or deleted', () => {
    it('only checks the area can be listed when a workspace is made or its bucket removed', async () => {
        const ctx = world();
        await ctx.store.createArea(COMPANY);
        await ctx.store.removeArea(COMPANY);
        expect(ctx.fake.calls.map((call) => call.name)).toEqual(['ListObjectsV2', 'ListObjectsV2']);
        expect(ctx.fake.calls.every((call) => call.input.Bucket === BUCKET && call.input.Prefix === `${PREFIX}${COMPANY}/`)).toBe(true);
        expect([...ctx.fake.buckets.keys()]).toEqual([BUCKET]);
    });

    it('never asks for a public-read object in a bucket other tenants share', async () => {
        const ctx = world();
        await ctx.store.put(PUBLIC_OWNER, 'public_assets/email_banner_icon.png', 'png', { acl: 'public-read' });
        expect(ctx.fake.calls.find((call) => call.name === 'PutObject').input.ACL).toBeUndefined();
    });

    it('signs a download address that points into the area of the workspace', async () => {
        const fake = createFakeS3();
        const cfg = resolveS3Config(HOSTED_ENV);
        const client = new S3Client({ region: cfg.region, endpoint: cfg.endpoint, forcePathStyle: true, credentials: { accessKeyId: 'AK', secretAccessKey: 'SK' } });
        client.send = fake.send;
        const store = storeOf({ client: () => client, layout: () => layoutOf(cfg), counter: null });
        const url = new URL(await store.signedGetUrl(COMPANY, 'Project/p1/a b.pdf', 60));
        expect(`${url.origin}${url.pathname}`).toBe(`http://fake-s3.test/${BUCKET}/${PREFIX}${COMPANY}/Project/p1/a%20b.pdf`);
        expect(url.searchParams.get('X-Amz-Expires')).toBe('60');
        expect(url.searchParams.get('X-Amz-Credential')).toMatch(/^AK\//);
    });

    it('refuses a key that climbs out of the area before anything is sent', async () => {
        const ctx = world();
        await expect(ctx.store.put(COMPANY, '../theirs.txt', 'x')).rejects.toMatchObject({ code: 'invalid_key' });
        await expect(ctx.store.remove(COMPANY, 'a/../../b')).rejects.toMatchObject({ code: 'invalid_key' });
        expect(ctx.fake.calls).toEqual([]);
    });
});

describe('the usage counter', () => {
    it('never rejects and never blocks the upload it counts, even when the database is down', async () => {
        const logger = { error: jest.fn() };
        const usage = usageOf({ inc: async () => { throw new Error('mongo down'); } }, { logger });
        await expect(usage.add(COMPANY, 10)).resolves.toBe(false);
        expect(logger.error).toHaveBeenCalledWith(expect.stringContaining('mongo down'));
        await expect(usage.add(COMPANY, 0, 0)).resolves.toBe(false);
    });

    it('reports a workspace never counted as empty, and the whole instance with the public area apart', async () => {
        const store = createUsageStore();
        const usage = usageOf(store);
        expect(await usage.storageUsage(COMPANY)).toEqual({ companyId: COMPANY, bytes: 0, objects: 0, updatedAt: null, reconciledAt: null, drift: null });
        await usage.add(COMPANY, 100, 2);
        await usage.add(OTHER, 50, 1);
        await usage.add(PUBLIC_OWNER, 7, 1);
        expect(await usage.instanceStorageUsage()).toEqual({
            bytes: 157,
            objects: 4,
            byWorkspace: [{ companyId: COMPANY, bytes: 100, objects: 2, reconciledAt: null }, { companyId: OTHER, bytes: 50, objects: 1, reconciledAt: null }],
            public: { bytes: 7, objects: 1 },
        });
    });

    it('measures drift against what was found', () => {
        expect(driftOf(100, 100)).toBe(0);
        expect(driftOf(99, 100)).toBeCloseTo(0.01);
        expect(driftOf(5, 0)).toBe(1);
        expect(driftOf(0, 0)).toBe(0);
    });
});

describe('the nightly reconciliation', () => {
    it('finishes interrupted workspace removals, measures every workspace and the public area, and drops empty strays', async () => {
        const store = createUsageStore();
        const usage = usageOf(store);
        await usage.add('6731c0000000000000000001', 10, 1);
        await usage.markForRemoval('6731c0000000000000000002');
        await usage.add('6731c0000000000000000003', 4, 1);
        const sizes = { [COMPANY]: { bytes: 300, objects: 3 }, [PUBLIC_OWNER]: { bytes: 20, objects: 2 }, '6731c0000000000000000001': { bytes: 0, objects: 0 }, '6731c0000000000000000003': { bytes: 4, objects: 1 } };
        const removed = [];
        const logger = { info: jest.fn(), warn: jest.fn(), error: jest.fn() };
        const results = await reconcileAll({
            usage,
            logger,
            companies: async () => [COMPANY],
            measure: async (owner) => sizes[owner],
            removeCompanyFiles: async (owner) => { removed.push(owner); await usage.forget(owner); },
        });
        expect(removed).toEqual(['6731c0000000000000000002']);
        expect(results.map((row) => row.owner).sort()).toEqual([COMPANY, '6731c0000000000000000001', '6731c0000000000000000003', PUBLIC_OWNER].sort());
        expect([...store.rows.keys()].sort()).toEqual([COMPANY, '6731c0000000000000000003', PUBLIC_OWNER].sort());
        expect(await usage.storageUsage(COMPANY)).toMatchObject({ bytes: 300, objects: 3, drift: 1 });
        expect(logger.warn).not.toHaveBeenCalled();
        expect(logger.info).toHaveBeenCalledWith(expect.stringContaining('first count'));
    });

    it('keeps going when one workspace cannot be measured', async () => {
        const usage = usageOf(createUsageStore());
        const logger = { info: jest.fn(), warn: jest.fn(), error: jest.fn() };
        const results = await reconcileAll({
            usage, logger,
            companies: async () => [COMPANY, OTHER],
            measure: async (owner) => { if (owner === COMPANY) throw new Error('AccessDenied'); return { bytes: 1, objects: 1 }; },
            removeCompanyFiles: async () => {},
        });
        expect(results.find((row) => row.owner === COMPANY)).toEqual({ owner: COMPANY, error: 'AccessDenied' });
        expect(await usage.storageUsage(OTHER)).toMatchObject({ bytes: 1 });
        expect(logger.error).toHaveBeenCalledWith(expect.stringContaining('AccessDenied'));
    });
});

describe('deleting a workspace', () => {
    const ENV_KEYS = ['STORAGE_TYPE', 'S3_BUCKET', 'S3_PREFIX'];
    const saved = {};
    beforeEach(() => ENV_KEYS.forEach((key) => { saved[key] = process.env[key]; }));
    afterEach(() => ENV_KEYS.forEach((key) => { if (saved[key] === undefined) delete process.env[key]; else process.env[key] = saved[key]; }));

    it('leaves the files of a bucket-per-workspace install where they are, as before', async () => {
        Object.assign(process.env, { STORAGE_TYPE: 'wasabi' });
        delete process.env.S3_BUCKET;
        const usage = { markForRemoval: jest.fn() };
        expect(await scheduleCompanyFilesRemoval(COMPANY, { usage })).toEqual({ scheduled: false });
        expect(usage.markForRemoval).not.toHaveBeenCalled();
    });

    it('in prefix mode records the removal first, then empties the area in the background', async () => {
        Object.assign(process.env, { STORAGE_TYPE: 's3', S3_BUCKET: BUCKET, S3_PREFIX: PREFIX });
        const ctx = world();
        await ctx.store.put(COMPANY, 'Project/p1/a.txt', 'a');
        await settle();
        const marked = jest.spyOn(ctx.usage, 'markForRemoval');
        expect(await scheduleCompanyFilesRemoval(COMPANY, { store: ctx.store, usage: ctx.usage })).toEqual({ scheduled: true });
        expect(marked).toHaveBeenCalledWith(COMPANY);
        await settle();
        expect(ctx.fake.keys(BUCKET)).toEqual([]);
        expect(ctx.usageStore.rows.has(COMPANY)).toBe(false);
    });
});

describe('a key rotated while the server runs', () => {
    const ENV_KEYS = ['S3_ENDPOINT', 'S3_REGION', 'S3_ACCESS_KEY', 'S3_SECRET_KEY', 'S3_BUCKET', 'S3_PREFIX', 'S3_FORCE_PATH_STYLE', 'STORAGE_TYPE'];
    const saved = {};
    beforeEach(() => ENV_KEYS.forEach((key) => { saved[key] = process.env[key]; }));
    afterEach(() => {
        ENV_KEYS.forEach((key) => { if (saved[key] === undefined) delete process.env[key]; else process.env[key] = saved[key]; });
        jest.restoreAllMocks();
        require('../common-storage/s3Client').resetS3Client();
    });

    it('is used by the next request, while the upload in flight finishes on the client it started with', async () => {
        Object.assign(process.env, { ...HOSTED_ENV, S3_ACCESS_KEY: 'OLD', S3_SECRET_KEY: 'OLD-SECRET' });
        const { applyEnvMap } = require('../Config/applyEnv');
        const { getS3Client } = require('../common-storage/s3Client');
        const fake = createFakeS3();
        fake.store(BUCKET, 'seed', 'x');
        let release;
        const held = new Promise((resolve) => { release = resolve; });
        const send = jest.spyOn(S3Client.prototype, 'send').mockImplementation(async function sendThroughFake(command) {
            if (command.input.Key && command.input.Key.endsWith('slow.bin')) await held;
            return fake.send(command);
        });
        const usage = usageOf(createUsageStore());
        const store = storeOf({ counter: usage });

        const oldClient = getS3Client();
        expect(getS3Client()).toBe(oldClient);
        const slow = store.put(COMPANY, 'Project/p1/slow.bin', Buffer.alloc(64));
        applyEnvMap({ S3_ACCESS_KEY: 'NEW', S3_SECRET_KEY: 'NEW-SECRET' });
        const newClient = getS3Client();
        expect(newClient).not.toBe(oldClient);
        expect((await newClient.config.credentials()).accessKeyId).toBe('NEW');

        await store.put(COMPANY, 'Project/p1/fast.bin', Buffer.alloc(8));
        release();
        await slow;

        expect(send.mock.contexts).toHaveLength(2);
        expect(send.mock.contexts[0]).toBe(oldClient);
        expect(send.mock.contexts[1]).toBe(newClient);
        expect((await oldClient.config.credentials()).accessKeyId).toBe('OLD');
        expect(fake.keys(BUCKET)).toEqual(expect.arrayContaining([`${PREFIX}${COMPANY}/Project/p1/slow.bin`, `${PREFIX}${COMPANY}/Project/p1/fast.bin`]));
    });

    it('also takes effect when the environment changes without a reload, and drops urls signed with the old key', async () => {
        Object.assign(process.env, { ...HOSTED_ENV, S3_ACCESS_KEY: 'ONE' });
        const { getS3Client } = require('../common-storage/s3Client');
        const { applyEnvMap } = require('../Config/applyEnv');
        const { myCache } = require('../Config/config');
        const first = getS3Client();
        process.env.S3_SECRET_KEY = 'ROTATED';
        expect(getS3Client()).not.toBe(first);

        myCache.set(`image:${BUCKET}:a.png`, 'https://signed/old', 60);
        myCache.set('imageExists:avatar.png', 'https://signed/old-avatar', 60);
        myCache.set('unrelated', 'kept', 60);
        applyEnvMap({ APP_NAME: 'AlianHub' });
        expect(myCache.get(`image:${BUCKET}:a.png`)).toBe('https://signed/old');
        applyEnvMap({ S3_ACCESS_KEY: 'TWO' });
        expect(myCache.get(`image:${BUCKET}:a.png`)).toBeUndefined();
        expect(myCache.get('imageExists:avatar.png')).toBeUndefined();
        expect(myCache.get('unrelated')).toBe('kept');
    });

    it('sends PutObject through the client the factory builds from the S3_* names', async () => {
        Object.assign(process.env, { ...HOSTED_ENV });
        const { getS3Client } = require('../common-storage/s3Client');
        const client = getS3Client();
        expect(await client.config.region()).toBe('us-east-1');
        expect(client.config.forcePathStyle).toBe(true);
        expect((await client.config.endpoint()).hostname).toBe('fake-s3.test');
        expect(new PutObjectCommand({ Bucket: BUCKET, Key: 'k' }).input.Bucket).toBe(BUCKET);
    });
});
