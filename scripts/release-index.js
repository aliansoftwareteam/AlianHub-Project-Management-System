#!/usr/bin/env node
'use strict';

/* Builds index.json, the machine-readable list of releases attached to every GitHub release
 * (`releases/latest/download/index.json` is the stable address). The AlianHub Cloud control plane
 * reads it to pick an image digest, decide whether a rollback can skip a restore, and tell
 * self-hosters when an upgrade needs a manual step.
 *
 *   node scripts/release-index.js --version 14.40.0 --digest sha256:… \
 *     [--tag v14.40.0] [--repository ghcr.io/aliansoftwareteam/alianhub] [--mirror <repository>]
 *     [--signed] [--prerelease] [--published-at <ISO>] [--previous index.json] [--out index.json] */

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const FLAGS_FILE = path.join(ROOT, 'deploy', 'release-flags.json');
const MIGRATIONS_DIR = path.join(ROOT, 'migrations');
const SCHEMA = 1;
const DEFAULT_REPOSITORY = 'ghcr.io/aliansoftwareteam/alianhub';
const SEMVER = /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?$/;
const DIGEST = /^sha256:[a-f0-9]{64}$/;
const MIGRATION_FILE = /^(\d{3}-[a-z0-9-]+)\.js$/;

function compareVersions(a, b) {
    const [, ...pa] = SEMVER.exec(a);
    const [, ...pb] = SEMVER.exec(b);
    for (let i = 0; i < 3; i += 1) {
        const diff = Number(pa[i]) - Number(pb[i]);
        if (diff) return diff;
    }
    if (pa[3] === pb[3]) return 0;
    if (!pa[3]) return 1;
    if (!pb[3]) return -1;
    const left = pa[3].split('.');
    const right = pb[3].split('.');
    for (let i = 0; i < Math.max(left.length, right.length); i += 1) {
        if (left[i] === undefined) return -1;
        if (right[i] === undefined) return 1;
        const numeric = /^\d+$/.test(left[i]) && /^\d+$/.test(right[i]);
        const diff = numeric ? Number(left[i]) - Number(right[i]) : left[i].localeCompare(right[i]);
        if (diff) return diff;
    }
    return 0;
}

const migrationIds = (dir = MIGRATIONS_DIR) => fs.readdirSync(dir)
    .map((file) => MIGRATION_FILE.exec(file))
    .filter(Boolean)
    .map((match) => match[1])
    .sort();

const loadFlags = (file = FLAGS_FILE) => JSON.parse(fs.readFileSync(file, 'utf8'));

function emptyIndex() {
    return { schema: SCHEMA, updatedAt: null, latest: null, releases: [] };
}

/* An index this script cannot read is replaced, not merged: guessing at its shape could attribute
 * a migration or an upgrade step to the wrong release. */
function usableIndex(index) {
    return Boolean(index && index.schema === SCHEMA && Array.isArray(index.releases));
}

function buildEntry({ version, tag, digest, repository = DEFAULT_REPOSITORY, mirror = null, signed = false,
    prerelease = false, publishedAt, flags, migrations, earlier = [] }) {
    const previous = earlier.reduce((best, entry) => (!best || compareVersions(entry.version, best.version) > 0 ? entry : best), null);
    const latestBefore = previous && previous.migration ? previous.migration.latest : undefined;
    const added = latestBefore === undefined ? null : migrations.filter((id) => !latestBefore || id > latestBefore);
    const breaking = new Set(flags.breakingMigrations || []);
    const shippedBefore = new Set(earlier.flatMap((entry) => (entry.selfHost && entry.selfHost.ids) || []));
    const upgrades = (flags.selfHostUpgrades || []).filter((step) => !shippedBefore.has(step.id));

    return {
        version,
        tag: tag || `v${version}`,
        publishedAt,
        prerelease: Boolean(prerelease),
        image: { repository, digest, mirror: mirror || null, signed: Boolean(signed) },
        minTrackerVersion: flags.minTrackerVersion || null,
        migration: {
            latest: migrations.length ? migrations[migrations.length - 1] : null,
            added,
            reversible: !(added || migrations).some((id) => breaking.has(id))
        },
        selfHost: {
            upgradeNeeded: upgrades.length > 0,
            ids: upgrades.map((step) => step.id),
            notes: upgrades.map((step) => step.note)
        }
    };
}

function mergeIndex(previous, entry, now) {
    const base = usableIndex(previous) ? previous : emptyIndex();
    const releases = base.releases.filter((r) => r.version !== entry.version).concat(entry)
        .sort((a, b) => compareVersions(b.version, a.version));
    const stable = releases.find((r) => !r.prerelease);
    return { schema: SCHEMA, updatedAt: now, latest: stable ? stable.version : null, releases };
}

function buildIndex(options) {
    const problems = [];
    if (!SEMVER.test(options.version || '')) problems.push('--version must be a semantic version');
    if (!DIGEST.test(options.digest || '')) problems.push('--digest must be sha256: followed by 64 hex characters');
    if (problems.length) return { problems };
    const previous = usableIndex(options.previous) ? options.previous : emptyIndex();
    const earlier = previous.releases.filter((r) => SEMVER.test(r.version) && compareVersions(r.version, options.version) < 0);
    const entry = buildEntry({ ...options, earlier });
    return { problems, index: mergeIndex(previous, entry, options.now) };
}

function parseArgs(argv) {
    const flags = new Set(['--signed', '--prerelease']);
    const options = {};
    for (let i = 0; i < argv.length; i += 1) {
        const arg = argv[i];
        if (!arg.startsWith('--')) throw new Error(`unexpected argument ${arg}`);
        const key = arg.slice(2).replace(/-([a-z])/g, (_, c) => c.toUpperCase());
        if (flags.has(arg)) options[key] = true;
        else {
            if (argv[i + 1] === undefined) throw new Error(`${arg} needs a value`);
            options[key] = argv[i + 1];
            i += 1;
        }
    }
    return options;
}

function main(argv) {
    let options;
    try {
        options = parseArgs(argv.slice(2));
    } catch (error) {
        process.stderr.write(`${error.message}\n`);
        return 2;
    }
    let previous = null;
    if (options.previous && fs.existsSync(options.previous)) {
        try {
            previous = JSON.parse(fs.readFileSync(options.previous, 'utf8'));
        } catch (error) {
            process.stderr.write(`ignoring the previous index: ${error.message}\n`);
        }
        if (previous && !usableIndex(previous)) process.stderr.write('ignoring the previous index: unknown schema\n');
    }
    const now = new Date().toISOString();
    const { problems, index } = buildIndex({
        ...options,
        publishedAt: options.publishedAt || now,
        now,
        previous,
        flags: loadFlags(),
        migrations: migrationIds()
    });
    if (problems.length) {
        process.stderr.write(`${problems.join('\n')}\n`);
        return 2;
    }
    const text = `${JSON.stringify(index, null, 2)}\n`;
    if (options.out) fs.writeFileSync(options.out, text);
    else process.stdout.write(text);
    return 0;
}

if (require.main === module) process.exitCode = main(process.argv);

module.exports = { SCHEMA, compareVersions, migrationIds, loadFlags, buildEntry, mergeIndex, buildIndex, parseArgs, main };
