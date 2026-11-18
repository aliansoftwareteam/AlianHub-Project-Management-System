const fs = require('fs');
const path = require('path');
const { isManaged } = require('../../Config/hostingMode');

/* Raising this refuses every tracker below it, so it moves only after the matching tracker
 * release is on the stable channel. */
const DEFAULT_MIN_TRACKER_VERSION = '6.0.0';
const DESKTOP_LOGO_PATH = '/api/v1/getLogo?key=logo&type=desktop';
const BRAND_SETTINGS_FILE = path.join(__dirname, '..', '..', 'brandSettings.json');

const minTrackerVersion = (env = process.env) => String(env.TRACKER_MIN_VERSION || DEFAULT_MIN_TRACKER_VERSION).trim();

/* The sign-in page already shows this name to anyone. */
const readProductName = async (file = BRAND_SETTINGS_FILE) => {
    try {
        const brand = JSON.parse(await fs.promises.readFile(file, 'utf8'));
        return typeof brand.productName === 'string' && brand.productName.trim() ? brand.productName.trim() : '';
    } catch {
        return '';
    }
};

/* WEBURL is the address this workspace calls itself, so a tracker or finder that reached it by
 * an older name learns the current one. Without it, the address the request came in on. */
const canonicalUrl = (req, env = process.env) => {
    const configured = String(env.WEBURL || '').trim().replace(/\/+$/, '');
    if (/^https?:\/\/[^/\s]+/i.test(configured)) return configured;
    const host = req && req.headers && req.headers.host;
    return host ? `${req.protocol || 'https'}://${host}` : '';
};

const buildHandshake = ({ version, name, enabled, minVersion, managed, url = '' }) => ({
    app: 'alianhub',
    url,
    version: String(version || ''),
    name: name || 'AlianHub',
    logoUrl: DESKTOP_LOGO_PATH,
    tracker: { enabled: Boolean(enabled), minVersion: minVersion || DEFAULT_MIN_TRACKER_VERSION },
    managed: Boolean(managed),
});

module.exports = { DEFAULT_MIN_TRACKER_VERSION, DESKTOP_LOGO_PATH, minTrackerVersion, isManaged, readProductName, canonicalUrl, buildHandshake };
