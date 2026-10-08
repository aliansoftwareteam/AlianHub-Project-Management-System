const tokenHash = require('./tokenHash');

// A client names itself, so its name is never shown alone: the host it answers from goes beside it, and the
// mark that it is an app, so a client calling itself "Claude Code" from another host, or a teammate's name,
// never reads as the real one or as a person. The label fits the shortest place it is kept (a history byline).

const LABEL_MAX = 60;
const HOST_MAX = 30;
const APP_MARK = 'app';

const hostOfUrl = (value) => {
    try { return new URL(String(value)).hostname.toLowerCase(); } catch (error) { return ''; }
};

/* A metadata document client is its document's URL, whatever its redirects; a registered one answers on its
 * redirects, an https one before a loopback one. */
const hostOfClient = (clientId, client = null) => {
    if (!tokenHash.CLIENT_ID.test(String(clientId))) return hostOfUrl(clientId);
    const hosts = ((client && client.redirectUris) || []).map((uri) => ({ host: hostOfUrl(uri), https: String(uri).startsWith('https:') })).filter((entry) => entry.host);
    const chosen = hosts.find((entry) => entry.https) || hosts[0];
    return chosen ? chosen.host : '';
};

const shortHost = (host) => (host.length > HOST_MAX ? `…${host.slice(-(HOST_MAX - 1))}` : host);

const appLabel = (name, host) => {
    const where = shortHost(String(host || '').toLowerCase());
    const longest = (suffix) => LABEL_MAX - suffix.length;
    const fitted = (suffix) => String(name || '').trim().slice(0, longest(suffix)).trim();
    const bare = fitted(` (${APP_MARK})`);
    if (!where || bare.toLowerCase().includes(where)) return `${bare || where || APP_MARK} (${APP_MARK})`;
    const suffix = ` (${APP_MARK} · ${where})`;
    return `${fitted(suffix) || where} ${suffix.trim()}`;
};

/* For a screen that marks an app in its own words (the audit log): the name with its host beside it. */
const withHost = (name, host) => {
    const where = String(host || '').toLowerCase();
    const bare = String(name || '').trim();
    return !where || bare.toLowerCase().includes(where) ? bare : `${bare} (${where})`;
};

module.exports = { appLabel, withHost, hostOfClient, LABEL_MAX };
