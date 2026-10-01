/* Plain script, no imports: shellWorkerPlugin.js pastes this file into sw.js ahead of worker.js,
 * and the app and the tests load the same file as a CommonJS module. */

const SHELL_CACHE_PREFIX = 'ah-shell-';
const RUNTIME_CACHE = 'ah-runtime-v1';
const SHELL_DOCUMENT = '/index.html';
const SHELL_PATHS = ['/', SHELL_DOCUMENT];
const WORKER_PATH = '/sw.js';

const MESSAGE = Object.freeze({
    ACTIVATE: 'ah:activate-waiting',
    DROP_RUNTIME_CACHES: 'ah:drop-runtime-caches',
    DESCRIBE: 'ah:describe',
});

const ROUTE = Object.freeze({ NETWORK: 'network', SHELL: 'shell', PRECACHE: 'precache', RUNTIME: 'runtime' });

/* First path segments the server answers itself. The worker only ever handles what it lists (the shell
 * document, the precached files, hashed build images), so this list is a second lock: a later change to
 * what it handles cannot reach these. Express matches paths without regard to case. */
const RESERVED_SEGMENTS = Object.freeze(['api', 'apidocs', 'socket.io', 'mcp', 'scim', 'share', 'form', 'oauth', '.well-known', 'pickers', 'connections',
    'task-import', 'importuser', 'company-create', 'health', 'version', 'storage', 'wasabiuploadslocal', 'sw.js', 'firebase-messaging-sw.js']);

const CREDENTIAL_HEADERS = Object.freeze(['authorization', 'refresh-token', 'companyid', 'x-api-key', 'cookie', 'range']);

const SECRET_PARAM = /token|secret|signature|password|passwd|credential|session|jwt|auth|otp|apikey|api_key|^key$|^sig$|^code$|^state$|^x-amz-/i;

const BUILD_IMAGE = /^\/img\/[^/]+\.[0-9a-f]{8}\.(?:png|jpe?g|gif|svg|webp|avif|ico)$/i;

const PRECACHED_FOLDERS = /^(?:js|css|fonts|icons)\//;
const PRECACHED_FILES = ['index.html', 'manifest.webmanifest'];
const NOT_PRECACHED = /\.(?:map|txt)$/i;

const hasHeader = (headers, name) => {
    if (!headers) return false;
    if (typeof headers.has === 'function') return headers.has(name);
    return Object.keys(headers).some((key) => key.toLowerCase() === name);
};

const firstSegment = (pathname) => {
    const segment = String(pathname).split('/').filter(Boolean)[0] || '';
    try {
        return decodeURIComponent(segment).toLowerCase();
    } catch {
        return segment.toLowerCase();
    }
};

const isReservedPath = (pathname) => RESERVED_SEGMENTS.includes(firstSegment(pathname));

const carriesSecret = (url) => Boolean(url.username || url.password) || [...url.searchParams.keys()].some((name) => SECRET_PARAM.test(name));

const parse = (value) => {
    try {
        return new URL(value);
    } catch {
        return null;
    }
};

/* Why the worker leaves a request alone, or null when it may look further. */
const reasonToStayOut = (request, origin) => {
    if (String(request.method || 'GET').toUpperCase() !== 'GET') return 'method';
    const url = parse(request.url);
    if (!url) return 'unreadable';
    if (url.origin !== origin) return 'other-origin';
    if (CREDENTIAL_HEADERS.some((name) => hasHeader(request.headers, name))) return 'credentials';
    if (carriesSecret(url)) return 'secret-in-url';
    if (isReservedPath(url.pathname)) return 'reserved';
    return null;
};

const routeFor = (request, { origin, precached }) => {
    if (reasonToStayOut(request, origin)) return ROUTE.NETWORK;
    const url = new URL(request.url);
    if (url.search) return ROUTE.NETWORK;
    if (request.mode === 'navigate') return SHELL_PATHS.includes(url.pathname) ? ROUTE.SHELL : ROUTE.NETWORK;
    if (precached.has(url.pathname)) return ROUTE.PRECACHE;
    if (request.destination === 'image' && BUILD_IMAGE.test(url.pathname)) return ROUTE.RUNTIME;
    return ROUTE.NETWORK;
};

const isPrecachedAsset = (name) => !NOT_PRECACHED.test(name) && (PRECACHED_FILES.includes(name) || PRECACHED_FOLDERS.test(name));

/* Takes webpack's emitted assets as { name, immutable }. A file with a content hash in its name never
 * changes, so a new build copies it from the previous precache instead of downloading it again. */
const shellAssetsOf = (assets) => {
    const kept = assets.filter((asset) => isPrecachedAsset(asset.name)).sort((a, b) => (a.name < b.name ? -1 : 1));
    return {
        hashed: kept.filter((asset) => asset.immutable).map((asset) => `/${asset.name}`),
        plain: kept.filter((asset) => !asset.immutable).map((asset) => `/${asset.name}`),
    };
};

const isShellCache = (name) => String(name).startsWith(SHELL_CACHE_PREFIX);

const EXPECTED_TYPE = [[/\.js$/i, /javascript/i], [/\.css$/i, /css/i], [/\.html$/i, /html/i]];

/* A sign-in gateway in front of the instance answers an asset URL with its own page. Storing that
 * would hand the gateway's page to every later load. */
const isStorable = (path, response) => {
    if (!response || !response.ok || response.redirected || response.type !== 'basic') return false;
    const rule = EXPECTED_TYPE.find(([extension]) => extension.test(path));
    return !rule || rule[1].test((response.headers && response.headers.get('content-type')) || '');
};

if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
        SHELL_CACHE_PREFIX, RUNTIME_CACHE, SHELL_DOCUMENT, SHELL_PATHS, WORKER_PATH, MESSAGE, ROUTE, RESERVED_SEGMENTS, CREDENTIAL_HEADERS,
        reasonToStayOut, routeFor, isPrecachedAsset, shellAssetsOf, isShellCache, isStorable,
    };
}
