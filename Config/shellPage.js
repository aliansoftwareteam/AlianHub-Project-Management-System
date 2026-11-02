const fs = require('fs');

/* Link previews (WhatsApp, Slack, LinkedIn, X) need absolute og:url and og:image, and one build
 * serves every domain, so index.html carries a token the server swaps for the address asked for. */
const ORIGIN_TOKEN = /__APP_ORIGIN__/g;
const SAFE_HOST = /^[a-z0-9.-]+(:\d{1,5})?$/i;

const configuredOrigin = (env) => {
    try {
        return new URL(env.APIURL).origin;
    } catch {
        return '';
    }
};

/* APIURL knows the public scheme when no trusted proxy reports it, so it wins for its own host. */
const originFor = (req, env = process.env) => {
    const host = req.get('host') || '';
    const configured = configuredOrigin(env);
    if (!SAFE_HOST.test(host)) return configured;
    if (configured && new URL(configured).host === host.toLowerCase()) return configured;
    return `${req.protocol}://${host}`;
};

const cache = new Map();

const readShell = (indexFile) => {
    const { mtimeMs } = fs.statSync(indexFile);
    const held = cache.get(indexFile);
    if (held && held.mtimeMs === mtimeMs) return held.html;
    const html = fs.readFileSync(indexFile, 'utf8');
    cache.set(indexFile, { mtimeMs, html });
    return html;
};

const sendShell = (req, res, indexFile, next) => {
    let html;
    try {
        html = readShell(indexFile);
    } catch {
        return next ? next() : res.status(503).type('text/plain').send('The web app is not built on this server.');
    }
    return res.type('html').send(html.replace(ORIGIN_TOKEN, originFor(req)));
};

const shellPage = (indexFile) => (req, res, next) => sendShell(req, res, indexFile, next);

module.exports = { originFor, sendShell, shellPage };
