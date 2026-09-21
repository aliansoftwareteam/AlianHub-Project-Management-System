const { DIRECTIVE_NAMES } = require('../../Config/contentSecurityPolicy');

const MAX_REPORTS_PER_BODY = 20;
const MAX_PATH_SEGMENTS = 8;
const UNKNOWN = 'unknown';
const ID_SEGMENT = ':id';

// Browsers report the -elem and -attr halves of script-src and style-src, which the policy never names.
const REPORTED_DIRECTIVES = new Set([...DIRECTIVE_NAMES, 'script-src-elem', 'script-src-attr', 'style-src-elem']);
const BLOCKED_KEYWORDS = new Set(['inline', 'eval', 'wasm-eval', 'self', 'trusted-types-policy', 'trusted-types-sink']);
const HOST = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)*(?::\d{1,5})?$/;
const SCHEME = /^([a-z][a-z0-9+.-]{0,31}):/i;
const HOSTED_SCHEMES = ['http', 'https', 'ws', 'wss'];
// A route word such as "project" or "two-factor-auth". Ids, share tokens and reset tokens carry a digit,
// a capital or an underscore, so they never pass.
const ROUTE_WORD = /^[a-z][a-z-]{0,23}$/;

const utcDay = (date) => new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));

const text = (value) => (typeof value === 'string' ? value.trim() : '');

const directiveOf = (report) => {
    const [name] = (text(report.effective) || text(report.violated)).toLowerCase().split(/\s+/);
    return REPORTED_DIRECTIVES.has(name) ? name : null;
};

const blockedHostOf = (raw) => {
    if (raw !== undefined && raw !== null && typeof raw !== 'string') return null;
    const value = text(raw);
    if (!value) return UNKNOWN;
    if (BLOCKED_KEYWORDS.has(value.toLowerCase())) return value.toLowerCase();
    const scheme = (SCHEME.exec(value) || [])[1];
    // Firefox and old Chrome name a data: or blob: source by its bare scheme.
    if (!scheme) return /^[a-z][a-z0-9+.-]{0,31}$/i.test(value) ? `${value.toLowerCase()}:` : null;
    if (!HOSTED_SCHEMES.includes(scheme.toLowerCase())) return `${scheme.toLowerCase()}:`;
    try {
        const host = new URL(value).host.toLowerCase();
        return HOST.test(host) ? host : null;
    } catch {
        return null;
    }
};

const documentPathOf = (raw) => {
    let pathname;
    try {
        pathname = new URL(text(raw)).pathname;
    } catch {
        return UNKNOWN;
    }
    const segments = pathname.split('/').filter(Boolean).slice(0, MAX_PATH_SEGMENTS);
    return `/${segments.map((segment) => (ROUTE_WORD.test(segment) ? segment : ID_SEGMENT)).join('/')}`;
};

const fieldsOf = (body) => {
    if (!body || typeof body !== 'object') return [];
    if (Array.isArray(body)) {
        return body.filter((entry) => entry && entry.type === 'csp-violation' && entry.body && typeof entry.body === 'object')
            .map(({ body: b }) => ({ effective: b.effectiveDirective, violated: b.violatedDirective, blocked: b.blockedURL, document: b.documentURL }));
    }
    const legacy = body['csp-report'];
    if (!legacy || typeof legacy !== 'object') return [];
    return [{ effective: legacy['effective-directive'], violated: legacy['violated-directive'], blocked: legacy['blocked-uri'], document: legacy['document-uri'] }];
};

/* What a report may leave behind: the day, the directive, the blocked host and the shape of the page's path.
 * The URLs, the referrer, the sample, the source file and the policy are read here and go no further. */
const keysOf = (body, at = new Date()) => fieldsOf(body).slice(0, MAX_REPORTS_PER_BODY).map((report) => {
    const directive = directiveOf(report);
    const blockedHost = directive && blockedHostOf(report.blocked);
    return blockedHost ? { day: utcDay(at), directive, blockedHost, documentPath: documentPathOf(report.document) } : null;
}).filter(Boolean);

module.exports = { MAX_REPORTS_PER_BODY, utcDay, blockedHostOf, documentPathOf, keysOf };
