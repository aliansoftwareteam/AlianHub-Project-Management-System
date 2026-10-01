const fs = require('fs');
const path = require('path');

const WORKER_ROUTE = '/sw.js';
const OFF = ['off', 'false', '0', 'no', 'disabled'];

/* A browser keeps a registered worker until a different one is served from the same URL; a 404 leaves
 * it in place. So withdrawing the app's worker means serving this one: it takes over at once, removes
 * every cache of the origin and unregisters itself, and it has no fetch handler. */
const WITHDRAWAL_WORKER = `self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil((async () => {
    for (const name of await caches.keys()) await caches.delete(name);
    await self.registration.unregister();
})()));
`;

/* no-cache makes the browser ask for the worker on every check instead of trusting a stored copy for up
 * to a day, so a new build and a withdrawal both arrive on the next page load. */
const WORKER_HEADERS = Object.freeze({
    'Content-Type': 'text/javascript; charset=utf-8',
    'Cache-Control': 'no-cache',
    'Service-Worker-Allowed': '/',
});

const isWithdrawn = (env = process.env) => OFF.includes(String(env.APP_SHELL_WORKER || '').trim().toLowerCase());

const workerRoute = (file, env = process.env) => (req, res, next) => {
    if (isWithdrawn(env)) {
        res.set(WORKER_HEADERS).send(WITHDRAWAL_WORKER);
        return;
    }
    fs.access(file, fs.constants.R_OK, (missing) => {
        if (missing) return next();
        return res.sendFile(file, { headers: WORKER_HEADERS, cacheControl: false });
    });
};

/* Register before express.static, which would serve the built file with its own headers. */
const install = (app, distDir, env = process.env) => {
    app.get(WORKER_ROUTE, workerRoute(path.join(distDir, 'sw.js'), env));
};

module.exports = { WORKER_ROUTE, WORKER_HEADERS, WITHDRAWAL_WORKER, isWithdrawn, workerRoute, install };
