const fs = require('fs');
const path = require('path');
const { deriveBuildInfo, deriveBuildInfoAsync, GIT_TIMEOUT_MS, readPackage, repoUrlOf, STAMP_FILE } = require('../scripts/build-info');

const ROOT = path.resolve(__dirname, '..');
const RETRY_DELAYS_MS = [15000, 60000, 300000];

function logger() {
    try {
        return require('./loggerConfig');
    } catch {
        return console;
    }
}

const warn = (message) => logger().warn(message);
const info = (message) => logger().info(message);

function fromPackage(root) {
    const pkg = readPackage(root);
    const release = String(pkg.version || '0.0.0');
    return { version: release, release, base: release, next: release, channel: 'release', build: 0, commit: null, builtAt: null, source: 'package', repoUrl: repoUrlOf(pkg), entries: [] };
}

function unresolved(root, source) {
    const pkg = readPackage(root);
    const release = String(pkg.version || '0.0.0');
    return { version: release, release, base: null, next: null, channel: 'unknown', build: null, commit: null, builtAt: null, source, repoUrl: repoUrlOf(pkg), entries: [] };
}

function fromStamp(root, onWarning) {
    const stampFile = path.join(root, STAMP_FILE);
    if (!fs.existsSync(stampFile)) return null;
    try {
        const stamp = JSON.parse(fs.readFileSync(stampFile, 'utf8'));
        return { ...stamp, entries: Array.isArray(stamp.entries) ? stamp.entries : [], source: 'stamp' };
    } catch (error) {
        onWarning(`build info: ${STAMP_FILE} is unreadable (${error.message}); using package.json`);
        return null;
    }
}

const hasGit = (root) => fs.existsSync(path.join(root, '.git'));

const describeGitError = (error) => (error.killed ? `git timed out after ${GIT_TIMEOUT_MS} ms` : error.message);

function resolveBuildInfo({ root = ROOT, derive = deriveBuildInfo, onWarning = warn } = {}) {
    if (hasGit(root)) {
        try {
            return derive({ cwd: root, ref: 'HEAD' });
        } catch (error) {
            onWarning(`build info: could not read git (${describeGitError(error)}); the running version is unresolved`);
            return fromStamp(root, onWarning) || unresolved(root, 'git-unavailable');
        }
    }
    return fromStamp(root, onWarning) || fromPackage(root);
}

/* Git is read asynchronously so a slow machine never delays the HTTP server.
 * Until git answers, the channel is 'unknown' rather than a release label that
 * may be wrong (seen under heavy load), and a failed read retries with backoff. */
function createResolver({ root = ROOT, run, delays = RETRY_DELAYS_MS, onWarning = warn, onInfo = info } = {}) {
    let current = null;
    let pending = null;
    let failures = 0;
    let timer = null;

    async function attempt() {
        try {
            const resolved = await deriveBuildInfoAsync({ cwd: root, ref: 'HEAD', run });
            if (failures > 0) onInfo(`build info: git answered after ${failures} failed attempt(s); running ${resolved.version}`);
            failures = 0;
            current = resolved;
        } catch (error) {
            if (failures === 0) onWarning(`build info: could not read git (${describeGitError(error)}); reporting an unresolved version and retrying in the background`);
            current = fromStamp(root, onWarning) || unresolved(root, 'git-unavailable');
            timer = setTimeout(() => { pending = attempt(); }, delays[Math.min(failures, delays.length - 1)]);
            if (timer.unref) timer.unref();
            failures += 1;
        }
        return current;
    }

    function start() {
        if (current) return pending;
        if (!hasGit(root)) {
            current = fromStamp(root, onWarning) || fromPackage(root);
            pending = Promise.resolve(current);
            return pending;
        }
        current = unresolved(root, 'git-pending');
        pending = attempt();
        return pending;
    }

    const get = () => {
        start();
        return current;
    };

    const summary = () => {
        const result = { ...get() };
        delete result.entries;
        return result;
    };

    const stop = () => clearTimeout(timer);

    return { start, get, summary, stop };
}

const resolver = createResolver();

module.exports = {
    start: resolver.start,
    get: resolver.get,
    summary: resolver.summary,
    resolveBuildInfo,
    createResolver,
    RETRY_DELAYS_MS,
};
