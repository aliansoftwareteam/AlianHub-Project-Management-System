/* eslint-env serviceworker */
/* global SHELL, SHELL_CACHE_PREFIX, RUNTIME_CACHE, SHELL_DOCUMENT, MESSAGE, ROUTE, routeFor, isShellCache, isStorable */

/* The body of sw.js. shellWorkerPlugin.js puts the build's file list (SHELL) and rules.js above it.
 * It holds the files of the build and nothing a signed-in person was sent: every request it does not
 * list goes to the network without the worker touching it. */

const SHELL_CACHE = `${SHELL_CACHE_PREFIX}${SHELL.version}`;
const PRECACHED = new Set([...SHELL.hashed, ...SHELL.plain]);
const HASHED = new Set(SHELL.hashed);
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
    const earlier = await Promise.all(names.filter((name) => isShellCache(name) && name !== SHELL_CACHE).map((name) => caches.open(name)));
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

const buildFile = async (request) => (await held(new URL(request.url).pathname)) || fetch(request);

const buildImage = async (event) => {
    const cache = await caches.open(RUNTIME_CACHE);
    const kept = await cache.match(event.request, SAME_FILE);
    if (kept) return kept;
    const response = await fetch(event.request);
    if (isStorable(new URL(event.request.url).pathname, response)) event.waitUntil(cache.put(event.request, response.clone()));
    return response;
};

self.addEventListener('install', (event) => {
    event.waitUntil(precache());
});

self.addEventListener('activate', (event) => {
    event.waitUntil(dropCaches((name) => isShellCache(name) && name !== SHELL_CACHE));
});

self.addEventListener('fetch', (event) => {
    const route = routeFor(event.request, { origin: self.location.origin, precached: PRECACHED });
    if (route === ROUTE.SHELL) event.respondWith(shellDocument(event.request));
    else if (route === ROUTE.PRECACHE) event.respondWith(buildFile(event.request));
    else if (route === ROUTE.RUNTIME) event.respondWith(buildImage(event));
});

self.addEventListener('message', (event) => {
    const type = event.data && event.data.type;
    // Only a tab's request moves a waiting worker in: taking over on install would swap the build under an open tab.
    if (type === MESSAGE.ACTIVATE) event.waitUntil(self.skipWaiting());
    else if (type === MESSAGE.DROP_RUNTIME_CACHES) event.waitUntil(dropCaches((name) => !isShellCache(name)));
    else if (type === MESSAGE.DESCRIBE && event.ports && event.ports[0]) event.ports[0].postMessage({ version: SHELL.version, assets: [...PRECACHED] });
});
