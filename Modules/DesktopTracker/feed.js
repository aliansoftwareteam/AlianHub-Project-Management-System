const axios = require('axios');
const logger = require('../../Config/loggerConfig');
const { myCache } = require('../../Config/config');

const DEFAULT_FEED_URL = 'https://downloads.alianhub.com/tracker';
const CHANNELS = ['stable', 'beta'];
const FEED_TTL_SECONDS = 15 * 60;
const MISS_TTL_SECONDS = 5 * 60;
const FETCH_TIMEOUT_MS = 5000;

const FEEDS = [
    { os: 'windows', file: 'latest.yml' },
    { os: 'mac', file: 'latest-mac.yml' },
    { os: 'linux', file: 'latest-linux.yml' },
];

const feedBase = (env = process.env) => {
    const raw = String(env.TRACKER_UPDATE_URL || DEFAULT_FEED_URL).trim();
    if (!raw || raw === 'off') return null;
    return raw.replace(/\/+$/, '');
};

const unquote = (value) => {
    const text = String(value).trim();
    const quoted = text.match(/^(['"])(.*)\1$/);
    return quoted ? quoted[2] : text;
};

/* The update manifests electron-builder writes are flat YAML with one list (files); reading them
 * here keeps a YAML library out of the server's dependencies. */
const parseLatestYml = (text) => {
    const out = { files: [] };
    let inFiles = false;
    let current = null;
    for (const line of String(text || '').split(/\r?\n/)) {
        if (!line.trim() || line.trim().startsWith('#')) continue;
        const item = line.match(/^\s+-\s+([A-Za-z0-9_]+):\s*(.*)$/);
        const nested = line.match(/^\s+([A-Za-z0-9_]+):\s*(.*)$/);
        const top = line.match(/^([A-Za-z0-9_]+):\s*(.*)$/);
        if (top) {
            inFiles = top[1] === 'files';
            current = null;
            if (!inFiles) out[top[1]] = unquote(top[2]);
        } else if (inFiles && item) {
            current = { [item[1]]: unquote(item[2]) };
            out.files.push(current);
        } else if (inFiles && current && nested) {
            current[nested[1]] = unquote(nested[2]);
        }
    }
    if (!out.files.length && out.path) out.files.push({ url: out.path });
    return out.version ? out : null;
};

const absolute = (base, channel, file) => (/^https?:\/\//i.test(file) ? file : `${base}/${channel}/${encodeURIComponent(file)}`);

const extensionOf = (file) => {
    const match = String(file).match(/\.([A-Za-z0-9]+)$/);
    return match ? match[1] : '';
};

/* latest-linux.yml names only the AppImage, the one Linux format that updates itself; the .deb is
 * built beside it under the artifactName pattern in time-tracker-app/electron-builder.yml. */
const debNameFor = (version) => `AlianHub-Tracker-${version}-amd64.deb`;

const PREFERRED = { windows: ['exe'], mac: ['dmg', 'zip'], linux: ['AppImage'] };

const downloadsFor = (os, manifest, base, channel) => {
    const files = manifest.files.map((f) => f.url).filter(Boolean);
    const pick = PREFERRED[os].map((ext) => files.find((f) => extensionOf(f) === ext)).find(Boolean);
    if (!pick) return [];
    const list = [{ os, kind: extensionOf(pick), version: manifest.version, url: absolute(base, channel, pick) }];
    if (os === 'linux') list.push({ os, kind: 'deb', version: manifest.version, url: absolute(base, channel, debNameFor(manifest.version)) });
    return list;
};

const compareVersions = (a, b) => {
    const parse = (v) => String(v || '').split('-')[0].split('.').map((n) => Number(n) || 0);
    const [x, y] = [parse(a), parse(b)];
    for (let i = 0; i < 3; i += 1) {
        if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) < (y[i] || 0) ? -1 : 1;
    }
    return 0;
};

const releaseFromManifests = (manifests, base, channel) => {
    const downloads = FEEDS.flatMap(({ os }) => (manifests[os] ? downloadsFor(os, manifests[os], base, channel) : []));
    if (!downloads.length) return null;
    const version = downloads.map((d) => d.version).reduce((max, v) => (compareVersions(v, max) > 0 ? v : max));
    return { channel, version, downloads };
};

const fetchManifest = async (url) => {
    try {
        const res = await axios.get(url, { timeout: FETCH_TIMEOUT_MS, responseType: 'text', transformResponse: (body) => body });
        return parseLatestYml(res.data);
    } catch (error) {
        logger.warn(`tracker feed unreadable ${url}: ${error.message}`);
        return null;
    }
};

const latestRelease = async ({ channel = 'stable', env = process.env } = {}) => {
    const base = feedBase(env);
    if (!base || !CHANNELS.includes(channel)) return null;
    const key = `tracker:feed:${base}:${channel}`;
    const cached = myCache.get(key);
    if (cached !== undefined) return cached.release;
    const entries = await Promise.all(FEEDS.map(async ({ os, file }) => [os, await fetchManifest(`${base}/${channel}/${file}`)]));
    const release = releaseFromManifests(Object.fromEntries(entries), base, channel);
    myCache.set(key, { release }, release ? FEED_TTL_SECONDS : MISS_TTL_SECONDS);
    return release;
};

module.exports = { DEFAULT_FEED_URL, feedBase, parseLatestYml, releaseFromManifests, compareVersions, latestRelease };
