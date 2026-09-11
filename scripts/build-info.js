#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const STAMP_FILE = 'build-info.json';
const LOG_FILE = path.join('docs', 'BETA-LOG.md');
const DEFAULT_REPO_URL = 'https://github.com/aliansoftwareteam/AlianHub-Project-Management-System';
const US = '\x1f';
const RS = '\x1e';
const CONVENTIONAL = /^(\w+)(?:\([^)]*\))?(!)?:\s/;

const git = (cwd, args) => execFileSync('git', args, { cwd, timeout: 3000, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();

function readPackage(cwd) {
    for (const dir of [cwd, ROOT]) {
        const file = path.join(dir, 'package.json');
        if (fs.existsSync(file)) return JSON.parse(fs.readFileSync(file, 'utf8'));
    }
    return {};
}

function repoUrlOf(pkg) {
    const url = String(pkg.repository?.url || pkg.repository || '').replace(/^git\+/, '').replace(/\.git$/, '');
    return /^https:\/\/github\.com\//.test(url) ? url : DEFAULT_REPO_URL;
}

function commitType(title) {
    const match = CONVENTIONAL.exec(title);
    return match ? match[1].toLowerCase() : null;
}

function bumpOf({ subject, body }) {
    const match = CONVENTIONAL.exec(subject);
    if (/BREAKING[ -]CHANGE/.test(body) || (match && match[2])) return 2;
    if (match && match[1].toLowerCase() === 'feat') return 1;
    return 0;
}

function bumpVersion(base, level) {
    const [major, minor, patch] = base.split('.').map((n) => parseInt(n, 10) || 0);
    if (level === 2) return `${major + 1}.0.0`;
    if (level === 1) return `${major}.${minor + 1}.0`;
    return `${major}.${minor}.${patch + 1}`;
}

function describeChange({ subject, body }) {
    const merge = /^Merge pull request #(\d+) from /.exec(subject);
    if (merge) {
        const title = body.split('\n').map((line) => line.trim()).find(Boolean) || subject;
        return { pr: Number(merge[1]), title };
    }
    const squash = /^(.*?)\s*\(#(\d+)\)$/.exec(subject);
    if (squash) return { pr: Number(squash[2]), title: squash[1] };
    return { pr: null, title: subject };
}

function parseLog(output) {
    return output.split(RS).map((record) => record.replace(/^\n/, '')).filter(Boolean).map((record) => {
        const [sha, parents, date, subject, body = ''] = record.split(US);
        return { sha, parents: parents ? parents.split(' ') : [], date, subject, body: body.trim() };
    });
}

function headFacts(cwd, ref) {
    const [sha, iso] = git(cwd, ['log', '-1', `--format=%H${US}%cI`, ref]).split(US);
    return { sha, commit: sha.slice(0, 8), builtAt: new Date(iso).toISOString() };
}

function baseTag(cwd, ref) {
    try {
        return git(cwd, ['describe', '--tags', '--abbrev=0', '--match', 'v[0-9]*.[0-9]*.[0-9]*', '--exclude', '*-*', ref]);
    } catch (error) {
        if (/No names found|No tags can describe|cannot describe/i.test(String(error.stderr || error.message))) return null;
        throw error;
    }
}

/* A merge commit adds no bump of its own; the commits it brings in do. Each
 * build's label uses only the commits reachable from that build, so a number
 * already merged never changes its version. */
function deriveBuildInfo({ cwd = ROOT, ref = 'HEAD' } = {}) {
    const pkg = readPackage(cwd);
    const release = String(pkg.version || '0.0.0');
    const repoUrl = repoUrlOf(pkg);
    const { sha: headSha, commit, builtAt } = headFacts(cwd, ref);
    const tag = baseTag(cwd, ref);
    const common = { release, commit, builtAt, source: 'git', repoUrl };

    if (!tag) return { version: `${release}-dev`, base: null, next: release, channel: 'dev', build: 0, ...common, entries: [] };

    const base = tag.replace(/^v/, '');
    const commits = parseLog(git(cwd, ['log', `--format=%H${US}%P${US}%cs${US}%s${US}%b${RS}`, `${tag}..${ref}`]));
    const bySha = new Map(commits.map((c) => [c.sha, c]));

    const chain = [];
    for (let sha = headSha; bySha.has(sha); sha = bySha.get(sha).parents[0]) chain.unshift(bySha.get(sha));

    if (!chain.length) return { version: base, base, next: release, channel: 'release', build: 0, ...common, entries: [] };

    const seen = new Set();
    let level = 0;
    const entries = chain.map((entry, index) => {
        const stack = [entry.sha];
        while (stack.length) {
            const current = bySha.get(stack.pop());
            if (!current || seen.has(current.sha)) continue;
            seen.add(current.sha);
            if (current.parents.length <= 1) level = Math.max(level, bumpOf(current));
            stack.push(...current.parents);
        }
        const build = index + 1;
        const { pr, title } = describeChange(entry);
        return { build, version: `${bumpVersion(base, level)}-beta.${build}`, date: entry.date, pr, title, type: commitType(title), commit: entry.sha.slice(0, 8) };
    }).reverse();

    return { version: entries[0].version, base, next: bumpVersion(base, level), channel: 'beta', build: entries.length, ...common, entries };
}

const escapeCell = (text) => String(text).replace(/\|/g, '\\|').replace(/\r?\n/g, ' ');

function renderLog(info) {
    const date = info.builtAt ? info.builtAt.slice(0, 10) : 'unknown';
    const since = info.base ? `v${info.base}` : 'no release';
    const lines = [
        '# Beta build log',
        '',
        'Generated by `npm run version:log` from the history of `beta`. Do not edit this file by hand.',
        '',
        'The pull request that updates this file becomes the next build.',
        '',
        `Current build: **${info.version}** · commit \`${info.commit || 'unknown'}\` · ${date} · since ${since} · next release ${info.next}`,
        '',
        '| Build | Version | Date | PR | Change |',
        '|---|---|---|---|---|',
    ];
    for (const entry of info.entries) {
        const pr = entry.pr ? `[#${entry.pr}](${info.repoUrl}/pull/${entry.pr})` : '';
        lines.push(`| ${entry.build} | ${entry.version} | ${entry.date} | ${pr} | ${escapeCell(entry.title)} |`);
    }
    return `${lines.join('\n')}\n`;
}

function refExists(cwd, ref) {
    try {
        git(cwd, ['rev-parse', '--verify', '--quiet', `${ref}^{commit}`]);
        return true;
    } catch {
        return false;
    }
}

function main(argv) {
    const refIndex = argv.indexOf('--ref');
    let ref = refIndex >= 0 && argv[refIndex + 1] ? argv[refIndex + 1] : 'HEAD';
    if (ref !== 'HEAD' && !refExists(ROOT, ref)) {
        console.warn(`build-info: ${ref} not found, using HEAD`);
        ref = 'HEAD';
    }
    const info = deriveBuildInfo({ cwd: ROOT, ref });
    const write = argv.includes('--write');
    const log = argv.includes('--log');
    if (write) {
        fs.writeFileSync(path.join(ROOT, STAMP_FILE), `${JSON.stringify({ ...info, source: 'stamp' }, null, 2)}\n`);
        console.log(`${STAMP_FILE}: ${info.version}`);
    }
    if (log) {
        fs.writeFileSync(path.join(ROOT, LOG_FILE), renderLog(info));
        console.log(`${LOG_FILE}: ${info.version}, ${info.entries.length} builds`);
    }
    if (!write && !log) console.log(info.version);
}

if (require.main === module) {
    try {
        main(process.argv.slice(2));
    } catch (error) {
        console.error(`build-info: ${error.message}`);
        process.exit(1);
    }
}

module.exports = { deriveBuildInfo, renderLog, readPackage, repoUrlOf, STAMP_FILE };
