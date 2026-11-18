// CommonJS, so the repository's jest run can load it without the Electron toolchain.

const UPDATE_FEED_BASE = 'https://downloads.alianhub.com/tracker';

/* A beta build (6.1.0-beta.2) follows the beta folder and a release build the stable one, so
 * nobody lands on a beta without having installed one. */
const channelOf = (version) => (String(version || '').includes('-') ? 'beta' : 'stable');

const feedUrlFor = (version, base = UPDATE_FEED_BASE) => `${String(base).replace(/\/+$/, '')}/${channelOf(version)}/`;

module.exports = { UPDATE_FEED_BASE, channelOf, feedUrlFor };
