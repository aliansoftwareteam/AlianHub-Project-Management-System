/* eslint-env serviceworker */
/* global SHELL, SHELL_CACHE_PREFIX, RUNTIME_CACHE, SHELL_DOCUMENT, MESSAGE, ROUTE, routeFor, isShellCache, isStorable */

/* The body of sw.js. shellWorkerPlugin.js puts the build's file list (SHELL) and rules.js above it.
 * It holds the files of the build and nothing a signed-in person was sent: every request it does not
 * list goes to the network without the worker touching it. */

const SHELL_CACHE = `${SHELL_CACHE_PREFIX}${SHELL.version}`;
const PRECACHED = new Set([...SHELL.hashed, ...SHELL.plain]);
const HASHED = new Set(SHELL.hashed);
const LAZY = new Set(SHELL.lazy);
// A build is over a hundred files, and a self-hosted server is one process: it is not asked for all of them at once.
const FETCHES_AT_ONCE = 4;
const SAME_FILE = { ignoreVary: true };

const copyFromEarlierBuild = async (path, earlier) => {
    if (!HASHED.has(path)) return null;
    for (const cache of earlier) {
        const held = await cache.match(path, SAME_FILE);
        if (held) return held;
    }
    return null;
};

const download = async (path) => {
    const response = await fetch(new Request(path, { cache: 'no-cache', credentials: 'same-origin', redirect: 'error' }));
    if (!isStorable(path, response)) throw new Error(`${path} did not come back as the file of the build (${response.status})`);
    return response;
};

const precache = async () => {
    const names = await caches.keys();
    // The runtime cache counts too: a file kept on first use under one build may be a first-paint file of the next.
    const earlier = await Promise.all(names.filter((name) => (isShellCache(name) && name !== SHELL_CACHE) || name === RUNTIME_CACHE).map((name) => caches.open(name)));
    const cache = await caches.open(SHELL_CACHE);
    const paths = [...PRECACHED];
    try {
        for (let at = 0; at < paths.length; at += FETCHES_AT_ONCE) {
            await Promise.all(paths.slice(at, at + FETCHES_AT_ONCE).map(async (path) => {
                await cache.put(path, (await copyFromEarlierBuild(path, earlier)) || (await download(path)));
            }));
        }
    } catch (error) {
        await caches.delete(SHELL_CACHE);
        throw error;
    }
};

const dropCaches = async (unwanted) => {
    const names = await caches.keys();
    await Promise.all(names.filter(unwanted).map((name) => caches.delete(name)));
};

const held = async (path) => (await caches.open(SHELL_CACHE)).match(path, SAME_FILE);

/* The network answers a page load whenever it can, so an online load always gets the current build
 * and the server's current headers. The held document is for when the network gives no answer at all. */
const shellDocument = async (request) => {
    try {
        return await fetch(request);
    } catch (error) {
        const document = await held(SHELL_DOCUMENT);
        if (document) return document;
        throw error;
    }
};

/* A worker that takes over while this one is still installing removes this one's half-filled cache. */
const refillIfEmptied = async () => {
    if (await held(SHELL_DOCUMENT)) return;
    await precache().catch(() => {});
};

const buildFile = async (request) => (await held(new URL(request.url).pathname)) || fetch(request);

const keptOnFirstUse = async (event) => {
    const path = new URL(event.request.url).pathname;
    const cache = await caches.open(RUNTIME_CACHE);
    const kept = await cache.match(path, SAME_FILE);
    if (kept) return kept;
    const response = await fetch(event.request);
    if (isStorable(path, response)) event.waitUntil(cache.put(path, response.clone()));
    return response;
};

/* A name that is unchanged in the new build stays, so nothing is fetched twice across builds. */
const dropFilesOfEarlierBuilds = async () => {
    const cache = await caches.open(RUNTIME_CACHE);
    const kept = await cache.keys();
    await Promise.all(kept.filter((request) => !LAZY.has(new URL(request.url).pathname)).map((request) => cache.delete(request)));
};

self.addEventListener('install', (event) => {
    event.waitUntil(precache());
});

/* Every other cache goes, not only earlier builds: a worker this app shipped before (alianhub-pwa-v1)
 * kept any same-origin answer outside /api, and its cache may still be in a browser. */
self.addEventListener('activate', (event) => {
    event.waitUntil(dropCaches((name) => name !== SHELL_CACHE && name !== RUNTIME_CACHE).then(dropFilesOfEarlierBuilds).then(refillIfEmptied));
});

self.addEventListener('fetch', (event) => {
    const route = routeFor(event.request, { origin: self.location.origin, precached: PRECACHED, lazy: LAZY });
    if (route === ROUTE.SHELL) event.respondWith(shellDocument(event.request));
    else if (route === ROUTE.PRECACHE) event.respondWith(buildFile(event.request));
    else if (route === ROUTE.RUNTIME) event.respondWith(keptOnFirstUse(event));
});

self.addEventListener('message', (event) => {
    const type = event.data && event.data.type;
    // Only a tab's request moves a waiting worker in: taking over on install would swap the build under an open tab.
    if (type === MESSAGE.ACTIVATE) event.waitUntil(self.skipWaiting());
    else if (type === MESSAGE.DROP_RUNTIME_CACHES) event.waitUntil(dropCaches((name) => !isShellCache(name)));
    else if (type === MESSAGE.DESCRIBE && event.ports && event.ports[0]) event.ports[0].postMessage({ version: SHELL.version, assets: [...PRECACHED, ...LAZY] });
});
