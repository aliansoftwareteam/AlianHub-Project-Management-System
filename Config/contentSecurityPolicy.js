const OFF = 'off';
const REPORT = 'report';
const ENFORCE = 'enforce';
const MODES = [OFF, REPORT, ENFORCE];

const REPORT_PATH = '/api/v2/csp-report';
const REPORT_GROUP = 'csp-endpoint';
const ENFORCE_HEADER = 'Content-Security-Policy';
const REPORT_ONLY_HEADER = 'Content-Security-Policy-Report-Only';
const REPORTING_ENDPOINTS_HEADER = 'Reporting-Endpoints';

const SELF = "'self'";
const NONE = "'none'";
/* For styles only. Editor.js and each of its tools, SweetAlert2, grid-layout-plus and Google's sign-in script add
 * <style> elements as they load, with no nonce to give them, and rich text carries style attributes. */
const UNSAFE_INLINE = "'unsafe-inline'";

/* The sign-in providers are switched on from the instance console without a restart, and this policy is built
 * once, so their hosts are always listed: a provider switched on later must not meet a policy that blocks it.
 * frontend/public/index.html loads the Google script on every page in any case. */
const GOOGLE_SIGN_IN_SCRIPT = 'https://accounts.google.com/gsi/client';
const GOOGLE_SIGN_IN_STYLE = 'https://accounts.google.com/gsi/style';
const GOOGLE_SIGN_IN_CALLS = 'https://accounts.google.com/gsi/';
// api.js pulls the Drive picker's module from /_/scs/ on the same host.
const GOOGLE_PICKER_SCRIPTS = ['https://apis.google.com/js/api.js', 'https://apis.google.com/_/scs/'];
const DROPBOX_CHOOSER_SCRIPT = 'https://www.dropbox.com/static/api/2/dropins.js';
// PdfViewer.vue loads pdf.min.js and its worker from this folder.
const PDF_VIEWER_SCRIPTS = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/';
// firebase-messaging-sw.js imports the SDK from here, and a worker answers to the policy it was served with.
const FIREBASE_WORKER_SCRIPTS = 'https://www.gstatic.com/firebasejs/';
const FIREBASE_CALLS = ['https://firebaseinstallations.googleapis.com/v1/', 'https://fcmregistrations.googleapis.com/v1/'];
const GOOGLE_FONTS_STYLE = 'https://fonts.googleapis.com/css2';
const GOOGLE_FONTS_FILES = 'https://fonts.gstatic.com/s/';
const GITHUB_PROFILE_API = ['https://api.github.com/user', 'https://api.github.com/user/emails'];
const GITLAB_PROFILE_API = 'https://gitlab.com/api/v4/user';
const DEFAULT_STORAGE_ENDPOINT = 'https://s3.wasabisys.com';

const HOST = '[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)*(?::\\d{1,5})?';
const CONFIGURED_HOST = new RegExp(`^${HOST}$`, 'i');
const EXTRA_SOURCE = new RegExp(`^(https?|wss?)://(\\*\\.)?(${HOST})(/[A-Za-z0-9._~%@/-]*)?$`, 'i');
const SCRIPT_DIRECTIVES = ['script-src', 'worker-src'];
// Second-level labels under a country code that are public suffixes themselves, as in co.uk or com.au.
const PUBLIC_SECOND_LEVEL = new Set(['ac', 'co', 'com', 'edu', 'gob', 'gov', 'go', 'ltd', 'mil', 'ne', 'net', 'nic', 'or', 'org', 'plc', 'sch']);
// Domains where anyone can publish under a subdomain or a path.
const SHARED_HOSTING = ['github.io', 'gitlab.io', 'bitbucket.io', 'githubusercontent.com', 'googleusercontent.com', 'storage.googleapis.com',
    'appspot.com', 'web.app', 'firebaseapp.com', 'pages.dev', 'workers.dev', 'netlify.app', 'vercel.app', 'herokuapp.com', 'glitch.me',
    'blogspot.com', 'surge.sh', 'repl.co', 'codepen.io', 'jsfiddle.net', 's3.amazonaws.com', 'cloudfront.net', 'azurewebsites.net', 'onrender.com'];
// Package CDNs serve every published package, so a script source there must name one.
const PACKAGE_CDNS = ['cdn.jsdelivr.net', 'unpkg.com', 'cdnjs.cloudflare.com', 'esm.sh', 'esm.run', 'ga.jspm.io', 'cdn.skypack.dev'];
const IPV4 = /^\d{1,3}(?:\.\d{1,3}){3}(?::\d+)?$/;

const readExtras = (env = process.env) => ({
    'script-src': env.CSP_EXTRA_SCRIPT_SRC,
    'style-src': env.CSP_EXTRA_STYLE_SRC,
    'img-src': env.CSP_EXTRA_IMG_SRC,
    'media-src': env.CSP_EXTRA_MEDIA_SRC,
    'font-src': env.CSP_EXTRA_FONT_SRC,
    'connect-src': env.CSP_EXTRA_CONNECT_SRC,
    'frame-src': env.CSP_EXTRA_FRAME_SRC,
    'worker-src': env.CSP_EXTRA_WORKER_SRC,
    'form-action': env.CSP_EXTRA_FORM_ACTION,
    'frame-ancestors': env.CSP_EXTRA_FRAME_ANCESTORS,
});

const extraKey = (directive) => `CSP_EXTRA_${directive.toUpperCase().replace(/-/g, '_')}`;
const EXTRA_ENV = Object.freeze(Object.fromEntries(Object.keys(readExtras({})).map((directive) => [directive, extraKey(directive)])));

const modeOf = (env = process.env) => {
    const value = String(env.CSP_MODE || '').trim().toLowerCase();
    if (!value) return OFF;
    if (!MODES.includes(value)) throw new Error(`CSP_MODE is "${value}"; it must be off, report or enforce.`);
    return value;
};

const within = (host, domain) => host === domain || host.endsWith(`.${domain}`);

const tooBroad = (base) => {
    const labels = base.split('.');
    return labels.length < 2 || (labels.length === 2 && PUBLIC_SECOND_LEVEL.has(labels[0])) || SHARED_HOSTING.some((domain) => within(domain, base));
};

const refusalOf = (directive, source) => {
    const match = EXTRA_SOURCE.exec(source);
    if (!match) return 'List hosts with their scheme, separated by spaces, such as https://cdn.example.com or wss://*.example.com. '
        + 'Keywords, quotes, semicolons, schemes on their own and a bare * are refused.';
    const [, scheme, wildcard, hostWithPort, pathPart] = match;
    const host = hostWithPort.toLowerCase().replace(/:\d+$/, '');
    if (wildcard && tooBroad(host)) return 'A wildcard may not cover a top-level domain, a public suffix or a shared hosting domain.';
    if (!SCRIPT_DIRECTIVES.includes(directive)) return null;
    if (scheme.toLowerCase() !== 'https') return 'Scripts load over https only.';
    if (SHARED_HOSTING.some((domain) => within(host, domain))) return 'Scripts may not come from a domain where anyone can publish.';
    if (PACKAGE_CDNS.some((domain) => within(host, domain)) && (!pathPart || pathPart === '/')) return 'Scripts from a package CDN must name the package path.';
    return null;
};

/* A value goes into a response header as it is, so it may only be a list of hosts: a quote would let a
 * keyword such as 'unsafe-eval' in, and a semicolon or a line break would start a directive or a header. */
/* A value goes into a response header as it is, so it may only be a list of hosts: a quote would let a
 * keyword such as 'unsafe-eval' in, and a semicolon or a line break would start a directive or a header. */
const extrasOf = (env = process.env) => Object.fromEntries(Object.entries(readExtras(env)).map(([directive, raw]) => {
    const sources = String(raw || '').split(/\s+/).filter(Boolean);
    for (const source of sources) {
        const reason = refusalOf(directive, source);
        if (reason) throw new Error(`${extraKey(directive)}: ${JSON.stringify(source)} is not allowed. ${reason}`);
    }
    return [directive, sources];
}));

const urlOf = (value) => {
    try {
        const url = new URL(String(value || '').trim());
        return /^https?:$/.test(url.protocol) && CONFIGURED_HOST.test(url.host) ? url : null;
    } catch {
        return null;
    }
};

/* The storage client signs virtual-hosted URLs, <bucket>.<endpoint>, and every company has its own bucket;
 * a bucket whose name cannot be a host label stays on the endpoint itself. */
const storageSources = (env) => {
    if ((env.STORAGE_TYPE || 'wasabi') === 'server') return [];
    const url = urlOf(env.WASABIENDPOINT) || new URL(DEFAULT_STORAGE_ENDPOINT);
    const origin = `${url.protocol}//${url.host}`;
    return IPV4.test(url.host) ? [origin] : [origin, `${url.protocol}//*.${url.host}`];
};

/* 'self' covers ws: and wss: in current browsers only, so the configured origins are named as well. */
const socketSources = (env) => [...new Set([env.WEBURL, env.APIURL].map(urlOf).filter(Boolean)
    .map((url) => `${url.protocol === 'https:' ? 'wss:' : 'ws:'}//${url.host}`))];

const buildDirectives = (env = process.env, { reportingApi = false } = {}) => {
    const storage = storageSources(env);
    const pushOn = Boolean(env.APIKEY) && env.APIKEY !== 'placeholder';

    const directives = {
        'default-src': [SELF],
        'script-src': [SELF, GOOGLE_SIGN_IN_SCRIPT, ...GOOGLE_PICKER_SCRIPTS, DROPBOX_CHOOSER_SCRIPT, PDF_VIEWER_SCRIPTS, ...(pushOn ? [FIREBASE_WORKER_SCRIPTS] : [])],
        'style-src': [SELF, UNSAFE_INLINE, GOOGLE_FONTS_STYLE, GOOGLE_SIGN_IN_STYLE],
        'img-src': [SELF, 'data:', 'blob:', 'https:', ...storage],
        'media-src': [SELF, 'blob:', ...storage],
        'font-src': [SELF, 'data:', GOOGLE_FONTS_FILES],
        'connect-src': [SELF, ...socketSources(env), ...storage, GOOGLE_SIGN_IN_CALLS, ...GITHUB_PROFILE_API, GITLAB_PROFILE_API, ...(pushOn ? FIREBASE_CALLS : [])],
        'frame-src': [SELF, 'https:'],
        'worker-src': [SELF, 'blob:'],
        'manifest-src': [SELF],
        'frame-ancestors': [SELF],
        'base-uri': [SELF],
        'form-action': [SELF],
        'object-src': [NONE],
    };
    for (const [directive, sources] of Object.entries(extrasOf(env))) directives[directive] = [...new Set([...directives[directive], ...sources])];
    return { ...directives, 'report-uri': [REPORT_PATH], ...(reportingApi ? { 'report-to': [REPORT_GROUP] } : {}) };
};

const DIRECTIVE_NAMES = Object.freeze(Object.keys(buildDirectives({})).filter((name) => !name.startsWith('report-')));

const policyOf = (env = process.env, options) => Object.entries(buildDirectives(env, options)).map(([name, sources]) => `${name} ${sources.join(' ')}`).join('; ');

const headerNameOf = (mode) => ({ [REPORT]: REPORT_ONLY_HEADER, [ENFORCE]: ENFORCE_HEADER })[mode] || null;

const headerOf = (env = process.env) => {
    const name = headerNameOf(modeOf(env));
    return name ? { name, value: policyOf(env) } : null;
};

/* The public share and form pages send a stricter policy of their own. In enforce mode theirs replaces this
 * one under the same header name; in report mode the two names differ, and ours would report their inline styles. */
const yieldToRoutePolicy = (res) => {
    const setHeader = res.setHeader;
    res.setHeader = function setHeaderYielding(name, ...rest) {
        if (String(name).toLowerCase() === ENFORCE_HEADER.toLowerCase()) res.removeHeader(REPORT_ONLY_HEADER);
        return setHeader.call(this, name, ...rest);
    };
};

/* The restart-only settings (storage, push, extras) are read on the first request, not at registration: index.js
 * registers this before it applies the instance settings saved in the database. WEBURL and APIURL change from the
 * console without a restart, so the cached policy is rebuilt when they do. */
const LIVE_KEYS = ['WEBURL', 'APIURL'];

const policySource = (env) => {
    let frozen = null;
    let live = null;
    let values = {};
    return (reportingApi) => {
        if (!frozen) frozen = { ...env };
        const current = LIVE_KEYS.map((key) => env[key] || '').join('\n');
        if (current !== live) {
            live = current;
            values = {};
        }
        if (values[reportingApi] === undefined) {
            values[reportingApi] = policyOf({ ...frozen, ...Object.fromEntries(LIVE_KEYS.map((key) => [key, env[key]])) }, { reportingApi });
        }
        return values[reportingApi];
    };
};

let active = null;

/* What the server sends for this environment, from the middleware's own cache once it runs. */
const sentPolicy = (env = process.env, { reportingApi = false } = {}) => (active && active.env === env
    ? active.valueFor(reportingApi)
    : policyOf(env, { reportingApi }));

/* report-to goes out over https only. Chrome stops using report-uri once report-to is named, and accepts
 * a reporting endpoint only over https, so naming it on a plain http install would silence every report. */
const middleware = (env = process.env) => {
    const mode = modeOf(env);
    extrasOf(env);
    if (mode === OFF) {
        if (active && active.env === env) active = null;
        return null;
    }
    const name = headerNameOf(mode);
    const valueFor = policySource(env);
    active = { env, valueFor };
    return (req, res, next) => {
        const reportingApi = Boolean(req.secure);
        res.setHeader(name, valueFor(reportingApi));
        if (reportingApi) res.setHeader(REPORTING_ENDPOINTS_HEADER, `${REPORT_GROUP}="${REPORT_PATH}"`);
        if (mode === REPORT) yieldToRoutePolicy(res);
        next();
    };
};

module.exports = { OFF, REPORT, ENFORCE, MODES, REPORT_PATH, EXTRA_ENV, DIRECTIVE_NAMES, modeOf, extrasOf, buildDirectives, policyOf, headerOf, sentPolicy, middleware };
