#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

const TEMPLATE_FILE = path.join(__dirname, 'compose.yml.tmpl');
const TIERS_FILE = path.join(__dirname, 'tiers.json');
const DEFAULT_BASE_DOMAIN = 'alianhub.com';
const HEAP_SHARE = 0.75;

const INSTANCE_ID = /^ins_[a-z0-9]{20,32}$/;
const HOST = /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;
const VERSION = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;
const IMAGE = /^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?(?::\d+)?(?:\/[a-z0-9]+(?:(?:[._]|__|-+)[a-z0-9]+)*)+$/;
const DIGEST = /^sha256:[a-f0-9]{64}$/;
const PATCH = /^\d{1,3}$/;
const CPUS = /^\d+(?:\.\d+)?$/;
const MEMORY = /^(\d+(?:\.\d+)?)([mg])$/;
const CACHE_GB = /^\d+(?:\.\d+)?$/;
const PLACEHOLDER = /\$\{([A-Z0-9_]+)\}/g;

const loadTiers = (file = TIERS_FILE) => JSON.parse(fs.readFileSync(file, 'utf8'));
const loadTemplate = (file = TEMPLATE_FILE) => fs.readFileSync(file, 'utf8');

function memoryMb(text) {
    const match = MEMORY.exec(String(text));
    if (!match) return NaN;
    return match[2] === 'g' ? Number(match[1]) * 1024 : Number(match[1]);
}

const tierLimits = (tier) => ({
    appCpus: tier.app.cpus,
    appMemory: tier.app.memory,
    mongoCpus: tier.mongo.cpus,
    mongoMemory: tier.mongo.memory,
    mongoCacheGb: tier.mongo.cacheGb
});

function hostnameOf(meta) {
    if (meta.hostname) return String(meta.hostname);
    if (meta.subdomain) return `${meta.subdomain}.${meta.baseDomain || DEFAULT_BASE_DOMAIN}`;
    return '';
}

/* Problems name the field, never its value: meta.json is written by the control plane and the
 * output lands in job logs. */
function stackValues(meta, tiers) {
    const problems = [];
    const check = (ok, message) => { if (!ok) problems.push(message); };
    const source = meta || {};
    const tierNames = Object.keys(tiers.tiers);
    const tier = Object.prototype.hasOwnProperty.call(tiers.tiers, source.tier) ? tiers.tiers[source.tier] : null;
    const hostname = hostnameOf(source);
    const mongoPatch = String(source.mongoPatch ?? tiers.mongo.patch);

    check(INSTANCE_ID.test(source.instanceId || ''), 'instanceId must be "ins_" followed by 20 to 32 lowercase letters or digits');
    check(HOST.test(hostname), 'hostname (or subdomain) must be a lowercase DNS name');
    check(Boolean(tier), `tier must be one of ${tierNames.join(', ')}`);
    check(VERSION.test(source.version || ''), 'version must be a semantic version');
    check(IMAGE.test(source.image || ''), 'image must be a repository reference without a tag or digest');
    check(DIGEST.test(source.imageDigest || ''), 'imageDigest must be sha256: followed by 64 hex characters');
    check(PATCH.test(mongoPatch), 'mongoPatch must be a number');
    if (problems.length) return { problems };

    const limits = { ...tierLimits(tier), ...(source.limits || {}) };
    check(CPUS.test(limits.appCpus) && Number(limits.appCpus) > 0, 'limits.appCpus must be a positive number');
    check(CPUS.test(limits.mongoCpus) && Number(limits.mongoCpus) > 0, 'limits.mongoCpus must be a positive number');
    check(memoryMb(limits.appMemory) >= 256, 'limits.appMemory must be at least 256m (e.g. 512m, 1g)');
    check(memoryMb(limits.mongoMemory) >= 256, 'limits.mongoMemory must be at least 256m (e.g. 512m, 1g)');
    check(CACHE_GB.test(limits.mongoCacheGb) && Number(limits.mongoCacheGb) >= 0.25, 'limits.mongoCacheGb must be at least 0.25');
    // WiredTiger's cache is only part of mongod's memory; above half the limit it gets OOM-killed.
    check(Number(limits.mongoCacheGb) * 1024 <= memoryMb(limits.mongoMemory) / 2, 'limits.mongoCacheGb must be at most half of limits.mongoMemory');
    if (problems.length) return { problems };

    return {
        problems,
        values: {
            INSTANCE_ID: source.instanceId,
            IMAGE: source.image,
            IMAGE_DIGEST: source.imageDigest,
            VERSION: source.version,
            TIER: source.tier,
            TENANT_HOST: hostname,
            APP_CPUS: limits.appCpus,
            APP_MEM: limits.appMemory,
            NODE_HEAP_MB: Math.floor(memoryMb(limits.appMemory) * HEAP_SHARE),
            MONGO_PATCH: mongoPatch,
            MONGO_CPUS: limits.mongoCpus,
            MONGO_MEM: limits.mongoMemory,
            MONGO_CACHE_GB: limits.mongoCacheGb
        }
    };
}

function render(template, values) {
    const missing = new Set();
    const output = template.replace(PLACEHOLDER, (whole, name) => {
        if (!Object.prototype.hasOwnProperty.call(values, name)) {
            missing.add(name);
            return whole;
        }
        return String(values[name]);
    });
    if (missing.size) throw new Error(`template placeholders without a value: ${[...missing].join(', ')}`);
    return output;
}

function renderStack(meta, { tiers = loadTiers(), template = loadTemplate() } = {}) {
    const { problems, values } = stackValues(meta, tiers);
    if (problems.length) return { problems };
    return { problems, values, project: `t_${values.INSTANCE_ID}`, compose: render(template, values) };
}

/* Written beside, then renamed over: the host agent may read compose.yml at any moment, and a
 * half-written file would be a broken stack. */
function writeReadOnly(file, content) {
    const temp = `${file}.tmp-${process.pid}`;
    fs.writeFileSync(temp, content, { mode: 0o444 });
    try {
        fs.renameSync(temp, file);
    } catch (error) {
        if (!['EPERM', 'EACCES', 'EEXIST'].includes(error.code)) throw error;
        fs.rmSync(file, { force: true });
        fs.renameSync(temp, file);
    }
}

function main(argv) {
    const args = argv.slice(2);
    const toStdout = args.includes('--stdout');
    const dir = args.find((a) => !a.startsWith('--'));
    const say = (result) => process.stdout.write(`${JSON.stringify(result)}\n`);
    if (!dir) {
        process.stderr.write('usage: render.js <instanceDir> [--stdout]\n');
        return 2;
    }
    let meta;
    try {
        meta = JSON.parse(fs.readFileSync(path.join(dir, 'meta.json'), 'utf8'));
    } catch (error) {
        say({ ok: false, code: 2, error: 'bad_meta', problems: [`meta.json: ${error.message}`] });
        return 2;
    }
    const result = renderStack(meta);
    if (result.problems.length) {
        say({ ok: false, code: 2, error: 'bad_meta', problems: result.problems });
        return 2;
    }
    if (path.basename(path.resolve(dir)) !== result.values.INSTANCE_ID) {
        say({ ok: false, code: 2, error: 'bad_meta', problems: ['the instance directory must be named after instanceId'] });
        return 2;
    }
    if (toStdout) {
        process.stdout.write(result.compose);
        return 0;
    }
    const file = path.join(dir, 'compose.yml');
    writeReadOnly(file, result.compose);
    say({ ok: true, file, project: result.project });
    return 0;
}

if (require.main === module) process.exitCode = main(process.argv);

module.exports = { TEMPLATE_FILE, TIERS_FILE, loadTiers, loadTemplate, memoryMb, stackValues, render, renderStack, writeReadOnly, main };
