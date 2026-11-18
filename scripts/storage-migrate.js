#!/usr/bin/env node
/* npm run storage:migrate -- --to-prefix --bucket <name> --prefix <p>/ [--apply] [--switch] [--only <companyId,...>]
 *
 * Moves an install from a bucket per workspace to one bucket and a key prefix (S3_BUCKET / S3_PREFIX):
 * every workspace bucket is copied to <prefix><companyId>/ and USERPROFILEBUCKET to <prefix>public/,
 * server side (CopyObject), and every copy is read back and compared by size and checksum. The
 * database is not touched: it holds keys relative to the area, which stay the same.
 *
 * A dry run by default: it lists what would be copied. --apply copies. A run can stop at any point
 * and be started again: an object already copied, same size and checksum, is skipped. --switch, after
 * an --apply with nothing failed, saves S3_BUCKET and S3_PREFIX in the instance settings; restart the
 * server afterwards. The old buckets are left for the operator to delete.
 *
 * Files uploaded while it runs land in the old buckets, so: run --apply once, turn maintenance mode on,
 * run --apply again (it copies only what is new), then --switch and restart. */
const path = require('path');

const COPY_CONCURRENCY = 8;
const MAX_SINGLE_COPY_BYTES = 5 * 1024 * 1024 * 1024;

const USAGE = 'npm run storage:migrate -- --to-prefix --bucket <name> --prefix <prefix>/ [--apply] [--switch] [--only <companyId,...>]';

function parseArgs(argv) {
    const args = { toPrefix: false, apply: false, switchSettings: false, bucket: '', prefix: '', only: [] };
    for (let i = 0; i < argv.length; i += 1) {
        const arg = argv[i];
        if (arg === '--to-prefix') args.toPrefix = true;
        else if (arg === '--apply') args.apply = true;
        else if (arg === '--switch') args.switchSettings = true;
        else if (arg === '--bucket') { args.bucket = String(argv[i + 1] || ''); i += 1; }
        else if (arg === '--prefix') { args.prefix = String(argv[i + 1] || ''); i += 1; }
        else if (arg === '--only') { args.only = String(argv[i + 1] || '').split(',').map((id) => id.trim()).filter(Boolean); i += 1; }
        else throw new Error(`Unknown argument "${arg}". Usage: ${USAGE}`);
    }
    if (!args.toPrefix) throw new Error(`Only --to-prefix is supported. Usage: ${USAGE}`);
    if (!args.bucket) throw new Error(`--bucket is required. Usage: ${USAGE}`);
    if (args.switchSettings && !args.apply) throw new Error('--switch needs --apply: the settings are switched only after a run that copied everything.');
    return args;
}

/* A multipart ETag ("…-3") is not the MD5 of the bytes, and a server-side copy may store it as one part,
 * so such a pair is compared by size alone. */
const singlePart = (etag) => Boolean(etag) && !String(etag).includes('-');
const sameObject = (source, target) => Boolean(target) && Number(target.size) === Number(source.size)
    && (!singlePart(source.etag) || !singlePart(target.etag) || source.etag === target.etag);

const isMissingBucket = (error) => Boolean(error) && (error.name === 'NoSuchBucket' || error.Code === 'NoSuchBucket');

async function listAll(store, owner) {
    const objects = [];
    try {
        for await (const object of store.list(owner)) objects.push(object);
    } catch (error) {
        if (!isMissingBucket(error)) throw error;
    }
    return objects;
}

async function planOwner({ owner, source, target }) {
    const copied = new Map((await listAll(target, owner)).map((object) => [object.key, object]));
    const plan = { owner, copies: [], done: 0, doneBytes: 0, bytes: 0, tooLarge: [] };
    for (const object of await listAll(source, owner)) {
        if (sameObject(object, copied.get(object.key))) {
            plan.done += 1;
            plan.doneBytes += object.size;
        } else if (object.size > MAX_SINGLE_COPY_BYTES) {
            plan.tooLarge.push(object.key);
        } else {
            plan.copies.push(object);
            plan.bytes += object.size;
        }
    }
    return plan;
}

async function copyOne({ owner, object, sourceLayout, targetLayout, send, sdk }) {
    const from = sourceLayout.locate(owner, object.key);
    const to = targetLayout.locate(owner, object.key);
    if (!targetLayout.owns(to)) throw new Error(`refusing to write ${to.Key} outside the prefix`);
    await send(new sdk.CopyObjectCommand({ ...to, CopySource: targetLayout.copySource(from) }));
    const head = await send(new sdk.HeadObjectCommand(to));
    const written = { size: Number(head && head.ContentLength) || 0, etag: head && head.ETag };
    if (!sameObject(object, written)) throw new Error(`copy of ${object.key} reads back ${written.size} bytes (${written.etag}), expected ${object.size} (${object.etag})`);
}

async function inPool(items, size, run) {
    let next = 0;
    const worker = async () => {
        while (next < items.length) {
            const item = items[next];
            next += 1;
            await run(item);
        }
    };
    await Promise.all(Array.from({ length: Math.min(size, items.length) }, worker));
}

const mb = (bytes) => `${(bytes / (1024 * 1024)).toFixed(1)} MB`;

async function migrate({ owners, source, target, sourceLayout, targetLayout, send, sdk, apply = false, log = console.log, concurrency = COPY_CONCURRENCY }) {
    const report = { owners: [], copied: 0, failed: [], toCopy: 0, bytes: 0, tooLarge: [] };
    log(`${apply ? 'Copying' : 'Dry run, nothing is copied'}: ${owners.length} areas into ${targetLayout.bucket}/${targetLayout.prefix}`);
    for (const owner of owners) {
        const plan = await planOwner({ owner, source, target });
        report.toCopy += plan.copies.length;
        report.bytes += plan.bytes;
        report.tooLarge.push(...plan.tooLarge.map((key) => `${owner}/${key}`));
        let copied = 0;
        if (apply) {
            await inPool(plan.copies, concurrency, async (object) => {
                try {
                    await copyOne({ owner, object, sourceLayout, targetLayout, send, sdk });
                    copied += 1;
                } catch (error) {
                    report.failed.push({ owner, key: object.key, error: String((error && error.message) || error) });
                }
            });
        }
        report.copied += copied;
        report.owners.push({ owner, toCopy: plan.copies.length, copied, alreadyCopied: plan.done, bytes: plan.bytes });
        log(`  ${owner}: ${plan.done} already copied, ${plan.copies.length} to copy (${mb(plan.bytes)})${apply ? `, ${copied} copied` : ''}${plan.tooLarge.length ? `, ${plan.tooLarge.length} over 5 GB left out` : ''}`);
    }
    for (const failure of report.failed.slice(0, 20)) log(`  FAILED ${failure.owner}/${failure.key}: ${failure.error}`);
    if (report.tooLarge.length) log(`Objects over 5 GB need a multipart copy and were left out: ${report.tooLarge.join(', ')}`);
    report.complete = apply && !report.failed.length && !report.tooLarge.length;
    log(apply
        ? (report.complete ? 'Every object is in place.' : `${report.failed.length} copies failed; run the same command again to retry them.`)
        : `${report.toCopy} objects (${mb(report.bytes)}) would be copied. Add --apply to copy them.`);
    report.exitCode = (!apply || report.complete) ? 0 : 1;
    return report;
}

function layoutsFor(env, args) {
    const { resolveS3Config, normalisePrefix, prefixProblem } = require('../common-storage/s3Config');
    const { layoutOf } = require('../common-storage/s3Layout');
    const cfg = resolveS3Config(env);
    if (cfg.prefixMode) throw new Error(`This install already keeps its files in ${cfg.bucket}/${cfg.prefix} (S3_BUCKET is set).`);
    if (prefixProblem(args.prefix)) throw new Error('--prefix may not contain empty, "." or ".." parts.');
    const sourceCfg = { ...cfg, bucket: '', prefix: '', prefixMode: false };
    const targetCfg = { ...cfg, bucket: args.bucket, prefix: normalisePrefix(args.prefix), prefixMode: true };
    return { cfg, sourceLayout: layoutOf(sourceCfg), targetLayout: layoutOf(targetCfg) };
}

async function switchSettings({ bucket, prefix, log }) {
    const settings = require('../Config/instanceSettings');
    const locked = settings.lockedKeys().filter((key) => ['S3_BUCKET', 'S3_PREFIX'].includes(key));
    if (locked.length) {
        log(`${locked.join(' and ')} come from the environment: set S3_BUCKET="${bucket}" and S3_PREFIX="${prefix}" there, then restart.`);
        return false;
    }
    await settings.saveInstanceSettings({ S3_BUCKET: bucket, S3_PREFIX: prefix }, 'script:storage-migrate');
    log(`Saved S3_BUCKET="${bucket}" and S3_PREFIX="${prefix}". Restart the server so every process uses them.`);
    return true;
}

async function main(argv = process.argv.slice(2), log = console.log) {
    const args = parseArgs(argv);
    require('../Config/applyEnv').loadDotEnv(path.join(__dirname, '..', '.env'));
    if (String(process.env.STORAGE_TYPE || 'wasabi') === 'server') throw new Error('STORAGE_TYPE is server: there are no buckets to move.');
    if (!process.env.MONGODB_URL) throw new Error('MONGODB_URL is not set: the workspaces to move are read from the database.');
    await require('../Config/instanceSettings').loadInstanceSettings({ error: log });
    const { sourceLayout, targetLayout, cfg } = layoutsFor(process.env, args);

    const { SCHEMA_TYPE } = require('../Config/schemaType');
    const { MongoDbCrudOpration } = require('../utils/mongo-handler/mongoQueries');
    const companies = ((await MongoDbCrudOpration(SCHEMA_TYPE.GOLBAL, { type: SCHEMA_TYPE.COMPANIES, data: [{}, { _id: 1 }] }, 'find')) || []).map((row) => String(row._id));
    const { PUBLIC_OWNER } = require('../common-storage/s3Layout');
    const chosen = args.only.length ? companies.filter((id) => args.only.includes(id)) : companies;
    const owners = [...chosen, ...(cfg.profileBucket && !args.only.length ? [PUBLIC_OWNER] : [])];
    if (!cfg.profileBucket) log('USERPROFILEBUCKET is not set: no public files to move.');

    const sdk = require('@aws-sdk/client-s3');
    const { buildS3Client } = require('../common-storage/s3Client');
    const { storeOf } = require('../common-storage/s3Store');
    const client = buildS3Client(cfg);
    const send = (command) => client.send(command);
    const report = await migrate({
        owners,
        source: storeOf({ client: () => client, layout: () => sourceLayout, counter: null }),
        target: storeOf({ client: () => client, layout: () => targetLayout, counter: null }),
        sourceLayout, targetLayout, send, sdk, apply: args.apply, log,
    });
    if (args.switchSettings) {
        if (report.complete) await switchSettings({ bucket: targetLayout.bucket, prefix: targetLayout.prefix, log });
        else log('Not switching: the copy is not complete.');
    }
    return report.exitCode;
}

if (require.main === module) {
    main().then((code) => process.exit(code)).catch((error) => {
        console.error(`storage-migrate: ${error.message || error}`);
        process.exit(1);
    });
}

module.exports = { parseArgs, planOwner, migrate, copyOne, sameObject, layoutsFor, switchSettings, main };
