/* What the storage layer must do, written once and run twice: against the in-memory S3 in
 * tests/storage-usage-counter.test.js and against MinIO in tests/integration/s3-storage.int.test.js.
 * ctx: { store, usage, layout, send, bucket, prefix, logger }, where `send` reaches the bucket directly. */
const sdk = require('@aws-sdk/client-s3');
const { reconcileOwner } = require('../../common-storage/storageReconcile');
const { removeCompanyFiles } = require('../../common-storage/companyFiles');
const { PUBLIC_OWNER } = require('../../common-storage/s3Layout');

const COMPANY = '6731a0c2a1b2c3d4e5f60718';
const OTHER = '6731b7c2a1b2c3d4e5f60719';

const settle = async () => {
    for (let i = 0; i < 10; i += 1) await new Promise((resolve) => { setImmediate(resolve); });
};

const counted = async (ctx, owner = COMPANY) => {
    await settle();
    const { bytes, objects } = await ctx.usage.storageUsage(owner);
    return { bytes, objects };
};

const rawKeys = async (ctx, prefix) => {
    const keys = [];
    let token;
    do {
        const page = await ctx.send(new sdk.ListObjectsV2Command({ Bucket: ctx.bucket, Prefix: prefix, ...(token ? { ContinuationToken: token } : {}) }));
        keys.push(...(page.Contents || []).map((object) => object.Key));
        token = page.IsTruncated ? page.NextContinuationToken : undefined;
    } while (token);
    return keys.sort();
};

const scenarios = {
    async 'counts every upload, replacement, copy and delete, and matches a full listing'(ctx) {
        await ctx.store.put(COMPANY, 'Project/p1/a/one.txt', 'hello', { contentType: 'text/plain' });
        expect(await counted(ctx)).toEqual({ bytes: 5, objects: 1 });
        await ctx.store.put(COMPANY, 'Project/p1/a/two.txt', Buffer.from('world!!'));
        expect(await counted(ctx)).toEqual({ bytes: 12, objects: 2 });
        await ctx.store.put(COMPANY, 'Project/p1/a/one.txt', 'hi', { replace: true });
        expect(await counted(ctx)).toEqual({ bytes: 9, objects: 2 });
        await ctx.store.copy(COMPANY, 'Project/p1/a/two.txt', 'Project/p2/b/two copy.txt');
        expect(await counted(ctx)).toEqual({ bytes: 16, objects: 3 });
        await ctx.store.remove(COMPANY, 'Project/p1/a/one.txt');
        expect(await counted(ctx)).toEqual({ bytes: 14, objects: 2 });
        await ctx.store.remove(COMPANY, 'Project/p1/a/never-there.txt');
        expect(await counted(ctx)).toEqual({ bytes: 14, objects: 2 });
        expect(await ctx.store.measure(COMPANY)).toEqual(await counted(ctx));
        const read = await ctx.store.get(COMPANY, 'Project/p2/b/two copy.txt');
        expect(await read.Body.transformToString()).toBe('world!!');
    },

    async 'keeps every key of the instance under its prefix and public files under public/'(ctx) {
        await ctx.store.put(COMPANY, 'Project/p1/file.txt', 'abc');
        await ctx.store.put(PUBLIC_OWNER, 'public_assets/logo.png', 'png');
        const keys = await rawKeys(ctx, ctx.prefix);
        expect(keys).toEqual(expect.arrayContaining([`${ctx.prefix}${COMPANY}/Project/p1/file.txt`, `${ctx.prefix}public/public_assets/logo.png`]));
        expect(keys.every((key) => key.startsWith(ctx.prefix))).toBe(true);
        expect(await counted(ctx, PUBLIC_OWNER)).toEqual({ bytes: 3, objects: 1 });
    },

    async 'never lists, counts or deletes a key outside its own area'(ctx) {
        const foreign = [`other-instance/${COMPANY}/secret.txt`, `${ctx.prefix}${OTHER}/theirs.txt`, `${ctx.prefix}${COMPANY}x/near-miss.txt`];
        for (const key of foreign) await ctx.send(new sdk.PutObjectCommand({ Bucket: ctx.bucket, Key: key, Body: 'not yours' }));
        for (const name of ['a.txt', 'b.txt', 'c.txt']) await ctx.store.put(COMPANY, `Project/p1/${name}`, 'mine');
        const listed = [];
        for await (const object of ctx.store.list(COMPANY)) listed.push(object.key);
        expect(listed.sort()).toEqual(['Project/p1/a.txt', 'Project/p1/b.txt', 'Project/p1/c.txt']);
        expect(await ctx.store.measure(COMPANY)).toEqual({ bytes: 12, objects: 3 });
        expect(await ctx.store.removeAll(COMPANY)).toEqual({ deleted: 3 });
        const left = await rawKeys(ctx, '');
        expect(left).toEqual(expect.arrayContaining(foreign));
        expect(left.filter((key) => key.startsWith(`${ctx.prefix}${COMPANY}/`))).toEqual([]);
    },

    async 'reconciliation sets the true figure, and warns about drift once a first count exists'(ctx) {
        await ctx.store.put(COMPANY, 'Project/p1/x.bin', Buffer.alloc(1000));
        await ctx.store.put(COMPANY, 'Project/p1/y.bin', Buffer.alloc(500));
        await settle();
        const deps = { measure: (owner) => ctx.store.measure(owner), usage: ctx.usage, logger: ctx.logger };
        const first = await reconcileOwner(COMPANY, deps);
        expect(first).toMatchObject({ bytes: 1500, objects: 2, drift: 0 });
        expect(ctx.logger.warn).not.toHaveBeenCalled();

        await ctx.send(new sdk.PutObjectCommand({ Bucket: ctx.bucket, Key: ctx.layout.locate(COMPANY, 'Project/p1/uncounted.bin').Key, Body: Buffer.alloc(300) }));
        await ctx.usage.add(COMPANY, -200, 0);
        const second = await reconcileOwner(COMPANY, deps);
        expect(second).toMatchObject({ bytes: 1800, objects: 3, counted: 1300 });
        expect(second.drift).toBeCloseTo(500 / 1800, 5);
        expect(ctx.logger.warn).toHaveBeenCalledWith(expect.stringContaining(`${COMPANY}: counted 1300 bytes, found 1800`));
        expect(await counted(ctx)).toEqual({ bytes: 1800, objects: 3 });
        expect((await ctx.usage.storageUsage(COMPANY)).reconciledAt).toBeInstanceOf(Date);
    },

    async 'deleting a workspace empties its area and drops its counter, and nothing else'(ctx) {
        for (let i = 0; i < 5; i += 1) await ctx.store.put(COMPANY, `Project/p1/f${i}.txt`, 'data');
        await ctx.store.put(OTHER, 'Project/p9/keep.txt', 'keep');
        await settle();
        expect(await removeCompanyFiles(COMPANY, { store: ctx.store, usage: ctx.usage })).toEqual({ deleted: 5 });
        expect(await rawKeys(ctx, `${ctx.prefix}${COMPANY}/`)).toEqual([]);
        expect(await rawKeys(ctx, `${ctx.prefix}${OTHER}/`)).toEqual([`${ctx.prefix}${OTHER}/Project/p9/keep.txt`]);
        expect((await ctx.usage.instanceStorageUsage()).byWorkspace.map((row) => row.companyId)).toEqual([OTHER]);
    },

    async 'the console test writes, reads back and deletes one object, outside every area'(ctx) {
        const before = await rawKeys(ctx, '');
        const { key } = await ctx.store.roundTrip();
        expect(key.startsWith(`${ctx.prefix}.alianhub-probe/`)).toBe(true);
        expect(await rawKeys(ctx, '')).toEqual(before);
        expect((await ctx.usage.instanceStorageUsage()).bytes).toBe(0);
    },
};

module.exports = { scenarios, settle, rawKeys, COMPANY, OTHER };
