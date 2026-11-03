/* npm run storage:migrate -- --to-prefix: a bucket per workspace copied into one bucket and a prefix.
 * A dry run by default, every copy read back and compared, and a second run picks up where one stopped. */
const sdk = require('@aws-sdk/client-s3');
const { createFakeS3 } = require('./fixtures/fakeS3');
const { parseArgs, migrate, planOwner, sameObject, layoutsFor } = require('../scripts/storage-migrate');
const { storeOf } = require('../common-storage/s3Store');
const { PUBLIC_OWNER } = require('../common-storage/s3Layout');

const A = '6731a0c2a1b2c3d4e5f60718';
const B = '6731b7c2a1b2c3d4e5f60719';
const TARGET = 'alianhub-cloud-tenants-test';
const ENV = { STORAGE_TYPE: 'wasabi', WASABI_REGION: 'us-east-1', WASABIENDPOINT: 'https://s3.wasabisys.com', USERPROFILEBUCKET: 'profiles' };

const install = ({ pageSize = 2 } = {}) => {
    const fake = createFakeS3({ pageSize });
    fake.store(A, 'Project/p1/Attachment/20261028T101010000Z_plan.pdf', 'plan');
    fake.store(A, 'Project/p1/Attachment/20261028T101011000Z_a b ü.png', 'image');
    fake.store(A, 'setting/task_type/bug.png', 'bug');
    fake.store(B, 'companyIcon/20261028T101012000Z_logo.png', 'logo');
    fake.store('profiles', 'public_assets/email_banner_icon.png', 'banner');
    fake.store('profiles', `${A}_1_avatar.png`, 'face');
    fake.store(TARGET, 'other-instance/kept.txt', 'not ours');
    const { sourceLayout, targetLayout } = layoutsFor(ENV, { bucket: TARGET, prefix: 'ins_01' });
    const store = (layout) => storeOf({ client: () => fake.client, layout: () => layout, counter: null });
    const run = (options = {}) => migrate({
        owners: [A, B, PUBLIC_OWNER],
        source: store(sourceLayout),
        target: store(targetLayout),
        sourceLayout, targetLayout, send: fake.send, sdk, log: () => {}, ...options,
    });
    return { fake, sourceLayout, targetLayout, run };
};

const copies = (fake) => fake.calls.filter((call) => call.name === 'CopyObject');
const writes = (fake) => fake.calls.filter((call) => ['CopyObject', 'PutObject', 'DeleteObject', 'DeleteObjects', 'CreateBucket', 'DeleteBucket'].includes(call.name));

describe('the command line', () => {
    it('is a dry run unless --apply is given', () => {
        expect(parseArgs(['--to-prefix', '--bucket', TARGET, '--prefix', 'ins_01/'])).toMatchObject({ apply: false, switchSettings: false, bucket: TARGET, prefix: 'ins_01/' });
        expect(parseArgs(['--to-prefix', '--bucket', TARGET, '--apply', '--only', `${A}, ${B}`])).toMatchObject({ apply: true, only: [A, B] });
    });

    it('refuses what it cannot do', () => {
        expect(() => parseArgs(['--bucket', TARGET])).toThrow(/--to-prefix/);
        expect(() => parseArgs(['--to-prefix'])).toThrow(/--bucket/);
        expect(() => parseArgs(['--to-prefix', '--bucket', TARGET, '--switch'])).toThrow(/--apply/);
        expect(() => parseArgs(['--to-prefix', '--bucket', TARGET, '--force'])).toThrow(/Unknown argument/);
    });

    it('refuses an install already in prefix mode, and a prefix that climbs out', () => {
        expect(() => layoutsFor({ ...ENV, S3_BUCKET: 'already' }, { bucket: TARGET, prefix: 'x/' })).toThrow(/already keeps its files/);
        expect(() => layoutsFor(ENV, { bucket: TARGET, prefix: '../x' })).toThrow(/--prefix/);
    });
});

describe('a dry run', () => {
    it('lists what would be copied and writes nothing', async () => {
        const { fake, run } = install();
        const report = await run();
        expect(report).toMatchObject({ toCopy: 6, copied: 0, failed: [], exitCode: 0, complete: false });
        expect(report.bytes).toBe('plan'.length + 'image'.length + 'bug'.length + 'logo'.length + 'banner'.length + 'face'.length);
        expect(writes(fake)).toEqual([]);
    });
});

describe('--apply', () => {
    it('copies every workspace and the public files under the prefix, server side, and keeps every file reachable', async () => {
        const { fake, run, targetLayout } = install();
        const report = await run({ apply: true });
        expect(report).toMatchObject({ toCopy: 6, copied: 6, failed: [], complete: true, exitCode: 0 });
        expect(fake.keys(TARGET)).toEqual([
            `ins_01/${A}/Project/p1/Attachment/20261028T101010000Z_plan.pdf`,
            `ins_01/${A}/Project/p1/Attachment/20261028T101011000Z_a b ü.png`,
            `ins_01/${A}/setting/task_type/bug.png`,
            `ins_01/${B}/companyIcon/20261028T101012000Z_logo.png`,
            'ins_01/public/6731a0c2a1b2c3d4e5f60718_1_avatar.png',
            'ins_01/public/public_assets/email_banner_icon.png',
            'other-instance/kept.txt',
        ].sort());
        expect(fake.calls.filter((call) => call.name === 'PutObject')).toEqual([]);
        expect(copies(fake).find((call) => call.input.Key.endsWith('ü.png')).input.CopySource).toBe(`${A}/Project/p1/Attachment/20261028T101011000Z_a%20b%20%C3%BC.png`);

        const after = storeOf({ client: () => fake.client, layout: () => targetLayout, counter: null });
        expect(await (await after.get(A, 'Project/p1/Attachment/20261028T101011000Z_a b ü.png')).Body.transformToString()).toBe('image');
        expect(await (await after.get(PUBLIC_OWNER, 'public_assets/email_banner_icon.png')).Body.transformToString()).toBe('banner');
        expect(fake.keys(A)).toHaveLength(3);
        expect(fake.read(TARGET, 'other-instance/kept.txt')).toBe('not ours');
    });

    it('starts again where a stopped run left off, copying only what is missing or differs', async () => {
        const { fake, run, targetLayout } = install();
        fake.store(TARGET, targetLayout.locate(A, 'setting/task_type/bug.png').Key, 'bug');
        fake.store(TARGET, targetLayout.locate(B, 'companyIcon/20261028T101012000Z_logo.png').Key, 'half-written');
        const report = await run({ apply: true });
        expect(report).toMatchObject({ toCopy: 5, copied: 5, complete: true });
        expect(copies(fake).map((call) => call.input.Key)).not.toContain(targetLayout.locate(A, 'setting/task_type/bug.png').Key);
        expect(fake.read(TARGET, targetLayout.locate(B, 'companyIcon/20261028T101012000Z_logo.png').Key)).toBe('logo');

        fake.calls.length = 0;
        const again = await run({ apply: true });
        expect(again).toMatchObject({ toCopy: 0, copied: 0, complete: true });
        expect(copies(fake)).toEqual([]);
    });

    it('reports a copy that reads back wrong, keeps going, and exits non-zero so it is run again', async () => {
        const { fake, run } = install();
        const realSend = fake.send;
        const send = async (command) => {
            const out = await realSend(command);
            if (command.constructor.name === 'HeadObjectCommand' && command.input.Key.endsWith('logo.png')) return { ...out, ContentLength: 1 };
            return out;
        };
        const report = await run({ apply: true, send });
        expect(report.complete).toBe(false);
        expect(report.exitCode).toBe(1);
        expect(report.failed).toEqual([expect.objectContaining({ owner: B, key: 'companyIcon/20261028T101012000Z_logo.png' })]);
        expect(report.copied).toBe(5);
    });

    it('treats a workspace whose bucket was never made as empty', async () => {
        const { run } = install();
        const report = await run({ apply: true, owners: [A, '6731c0000000000000000000'] });
        expect(report.owners.find((row) => row.owner === '6731c0000000000000000000')).toEqual({ owner: '6731c0000000000000000000', toCopy: 0, copied: 0, alreadyCopied: 0, bytes: 0 });
        expect(report.complete).toBe(true);
    });
});

describe('the plan for one area', () => {
    it('reads every page of both listings', async () => {
        const fake = createFakeS3({ pageSize: 1 });
        for (let i = 0; i < 5; i += 1) fake.store(A, `k${i}`, `v${i}`);
        const { sourceLayout, targetLayout } = layoutsFor(ENV, { bucket: TARGET, prefix: 'p/' });
        fake.store(TARGET, targetLayout.locate(A, 'k3').Key, 'v3');
        const plan = await planOwner({
            owner: A,
            source: storeOf({ client: () => fake.client, layout: () => sourceLayout, counter: null }),
            target: storeOf({ client: () => fake.client, layout: () => targetLayout, counter: null }),
        });
        expect(plan.copies.map((object) => object.key)).toEqual(['k0', 'k1', 'k2', 'k4']);
        expect(plan.done).toBe(1);
    });

    it('compares size and checksum, and size alone for a multipart checksum', () => {
        expect(sameObject({ size: 4, etag: '"a"' }, { size: 4, etag: '"a"' })).toBe(true);
        expect(sameObject({ size: 4, etag: '"a"' }, { size: 4, etag: '"b"' })).toBe(false);
        expect(sameObject({ size: 4, etag: '"a-3"' }, { size: 4, etag: '"b"' })).toBe(true);
        expect(sameObject({ size: 4, etag: '"a"' }, { size: 5, etag: '"a"' })).toBe(false);
        expect(sameObject({ size: 4, etag: '"a"' }, undefined)).toBe(false);
    });
});
