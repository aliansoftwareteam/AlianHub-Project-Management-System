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
// api.js pulls the Drive picker's modules from its own host.
const GOOGLE_PICKER_SCRIPTS = 'https://apis.google.com';
const DROPBOX_CHOOSER_SCRIPT = 'https://www.dropbox.com/static/api/2/dropins.js';
// PdfViewer.vue loads pdf.min.js and its worker from this folder.
const PDF_VIEWER_SCRIPTS = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/';
// firebase-messaging-sw.js imports the SDK from here, and a worker answers to the policy it was served with.
const FIREBASE_WORKER_SCRIPTS = 'https://www.gstatic.com/firebasejs/';
const FIREBASE_CALLS = ['https://firebaseinstallations.googleapis.com', 'https://fcmregistrations.googleapis.com'];
const GOOGLE_FONTS_STYLE = 'https://fonts.googleapis.com';
const GOOGLE_FONTS_FILES = 'https://fonts.gstatic.com';
const GITHUB_PROFILE_API = 'https://api.github.com';
const GITLAB_PROFILE_API = 'https://gitlab.com';
const DEFAULT_STORAGE_ENDPOINT = 'https://s3.wasabisys.com';

const HOST = '[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)*(?::\\d{1,5})?';
const CONFIGURED_HOST = new RegExp(`^${HOST}$`, 'i');
const EXTRA_SOURCE = new RegExp(`^(?:https?|wss?)://(?:\\*\\.)?${HOST}(?:/[A-Za-z0-9._~%/-]*)?$`, 'i');
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

/* A value goes into a response header as it is, so it may only be a list of hosts: a quote would let a
 * keyword such as 'unsafe-eval' in, and a semicolon or a line break would start a directive or a header. */
const extrasOf = (env = process.env) => Object.fromEntries(Object.entries(readExtras(env)).map(([directive, raw]) => {
    const value = String(raw || '');
    const sources = value.split(/\s+/).filter(Boolean);
    const refused = /[;,'"\r\n]/.test(value) ? value.trim() : sources.find((source) => !EXTRA_SOURCE.test(source));
    if (refused !== undefined) {
        throw new Error(`${extraKey(directive)}: ${JSON.stringify(refused)} is not allowed. List hosts with their scheme, separated by spaces, `
            + 'such as https://cdn.example.com or wss://*.example.com. Keywords, quotes, semicolons, schemes on their own and a bare * are refused.');
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
        'script-src': [SELF, GOOGLE_SIGN_IN_SCRIPT, GOOGLE_PICKER_SCRIPTS, DROPBOX_CHOOSER_SCRIPT, PDF_VIEWER_SCRIPTS, ...(pushOn ? [FIREBASE_WORKER_SCRIPTS] : [])],
        'style-src': [SELF, UNSAFE_INLINE, GOOGLE_FONTS_STYLE, GOOGLE_SIGN_IN_STYLE],
        'img-src': [SELF, 'data:', 'blob:', 'https:', ...storage],
        'media-src': [SELF, 'blob:', ...storage],
        'font-src': [SELF, 'data:', GOOGLE_FONTS_FILES],
        'connect-src': [SELF, ...socketSources(env), ...storage, GOOGLE_SIGN_IN_CALLS, GITHUB_PROFILE_API, GITLAB_PROFILE_API, ...(pushOn ? FIREBASE_CALLS : [])],
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

/* The header is built on the first request, not here: index.js registers this before it applies the
 * instance settings saved in the database, and the storage endpoint is one of them.
 *
 * report-to goes out over https only. Chrome stops using report-uri once report-to is named, and accepts
 * a reporting endpoint only over https, so naming it on a plain http install would silence every report. */
const middleware = (env = process.env) => {
    const mode = modeOf(env);
    extrasOf(env);
    if (mode === OFF) return null;
    const name = headerNameOf(mode);
    const values = {};
    return (req, res, next) => {
        const reportingApi = Boolean(req.secure);
        if (values[reportingApi] === undefined) values[reportingApi] = policyOf(env, { reportingApi });
        res.setHeader(name, values[reportingApi]);
        if (reportingApi) res.setHeader(REPORTING_ENDPOINTS_HEADER, `${REPORT_GROUP}="${REPORT_PATH}"`);
        if (mode === REPORT) yieldToRoutePolicy(res);
        next();
    };
};

module.exports = { OFF, REPORT, ENFORCE, MODES, REPORT_PATH, EXTRA_ENV, DIRECTIVE_NAMES, modeOf, extrasOf, buildDirectives, policyOf, headerOf, middleware };
