const fs = require('fs');
const path = require('path');
const { deriveBuildInfo, readPackage, repoUrlOf, STAMP_FILE } = require('../scripts/build-info');

const ROOT = path.resolve(__dirname, '..');

function warn(message) {
    try {
        require('./loggerConfig').warn(message);
    } catch {
        console.warn(message);
    }
}

function fromPackage(root) {
    const pkg = readPackage(root);
    const release = String(pkg.version || '0.0.0');
    return { version: release, release, base: release, next: release, channel: 'release', build: 0, commit: null, builtAt: null, source: 'package', repoUrl: repoUrlOf(pkg), entries: [] };
}

function resolveBuildInfo({ root = ROOT, derive = deriveBuildInfo, onWarning = warn } = {}) {
    if (fs.existsSync(path.join(root, '.git'))) {
        try {
            return derive({ cwd: root, ref: 'HEAD' });
        } catch (error) {
            onWarning(`build info: could not read git (${error.message}); using the stamp or package.json`);
        }
    }
    const stampFile = path.join(root, STAMP_FILE);
    if (fs.existsSync(stampFile)) {
        try {
            const stamp = JSON.parse(fs.readFileSync(stampFile, 'utf8'));
            return { ...stamp, entries: Array.isArray(stamp.entries) ? stamp.entries : [], source: 'stamp' };
        } catch (error) {
            onWarning(`build info: ${STAMP_FILE} is unreadable (${error.message}); using package.json`);
        }
    }
    return fromPackage(root);
}

let cached = null;

const get = () => {
    if (!cached) cached = resolveBuildInfo();
    return cached;
};

const summary = () => {
    const info = { ...get() };
    delete info.entries;
    return info;
};

module.exports = { get, summary, resolveBuildInfo };
