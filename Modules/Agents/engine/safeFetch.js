const dns = require('dns');
const net = require('net');
const axios = require('axios');
const egressContext = require('./egressContext');
const { hostMatches } = require('./egressRules');

/* Outbound fetches driven by task text. The URL is untrusted, so the rule is
 * applied to the RESOLVED address (which defeats numeric and alternate hostname
 * encodings), re-applied to every redirect hop, and the socket is pinned to the
 * address that passed so a DNS answer cannot change between check and connect. */

const DEFAULTS = Object.freeze({ timeoutMs: 10000, maxBytes: 1024 * 1024, maxRedirects: 5 });

const BLOCKED_SUFFIXES = ['.local', '.internal'];

const V4_RESERVED = [
    ['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8], ['169.254.0.0', 16],
    ['172.16.0.0', 12], ['192.168.0.0', 16], ['224.0.0.0', 4], ['240.0.0.0', 4],
];

const v4ToInt = (ip) => ip.split('.').reduce((n, o) => (n * 256) + Number(o), 0);
const inV4Block = (ip, [base, bits]) => (v4ToInt(ip) >>> (32 - bits)) === (v4ToInt(base) >>> (32 - bits));

const isPrivateV4 = (ip) => ip === '255.255.255.255' || V4_RESERVED.some((block) => inV4Block(ip, block));

const expandV6 = (ip) => {
    const [head, tail = ''] = ip.split('::');
    const left = head ? head.split(':') : [];
    const right = tail ? tail.split(':') : [];
    const fill = Array(8 - left.length - right.length).fill('0');
    return [...left, ...fill, ...right].map((h) => parseInt(h || '0', 16));
};

const mappedV4 = (ip) => {
    const m = ip.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/i);
    if (m) return m[1];
    const words = expandV6(ip);
    if (words.slice(0, 5).every((w) => w === 0) && words[5] === 0xffff) {
        return [words[6] >> 8, words[6] & 0xff, words[7] >> 8, words[7] & 0xff].join('.');
    }
    return null;
};

const dottedTailAsWords = (ip) => ip.replace(/(\d+)\.(\d+)\.(\d+)\.(\d+)$/, (m, a, b, c, d) => `${((Number(a) << 8) | Number(b)).toString(16)}:${((Number(c) << 8) | Number(d)).toString(16)}`);
const v4From = (hi, lo) => [hi >> 8, hi & 0xff, lo >> 8, lo & 0xff].join('.');

/* NAT64 (64:ff9b::/96), 6to4 (2002::/16) and IPv4-compatible (::/96) addresses are delivered to the IPv4
 * address they carry, so that address decides. Judging the whole range private instead would refuse every
 * IPv4-only site on a DNS64 network. */
const carriedV4 = (ip) => {
    const words = expandV6(dottedTailAsWords(ip));
    if (words[0] === 0x64 && words[1] === 0xff9b && words.slice(2, 6).every((w) => w === 0)) return v4From(words[6], words[7]);
    if (words[0] === 0x2002) return v4From(words[1], words[2]);
    if (words.slice(0, 6).every((w) => w === 0)) return v4From(words[6], words[7]);
    return null;
};

const isPrivateV6 = (ip) => {
    const bare = ip.replace(/%.*$/, '');
    const mapped = mappedV4(bare);
    if (mapped) return isPrivateV4(mapped);
    const words = expandV6(bare);
    if (words.every((w) => w === 0)) return true;
    if (words.slice(0, 7).every((w) => w === 0) && words[7] === 1) return true;
    // Flag off keeps the rule as it shipped: these ranges passed it, and closing them changes what is fetched today.
    const carried = egressContext.isOn() ? carriedV4(bare) : null;
    if (carried) return isPrivateV4(carried);
    const top = words[0];
    if ((top & 0xfe00) === 0xfc00) return true;
    if ((top & 0xffc0) === 0xfe80) return true;
    if ((top & 0xff00) === 0xff00) return true;
    return false;
};

const isPrivateAddress = (ip) => {
    const kind = net.isIP(ip);
    if (kind === 4) return isPrivateV4(ip);
    if (kind === 6) return isPrivateV6(ip);
    return true;
};

const stripBrackets = (host) => String(host || '').trim().toLowerCase().replace(/^\[|\]$/g, '');

/* Hostnames that never deserve a DNS round trip. Non-dotted-quad numeric forms
 * (`127.1`, `0x7f000001`, `2130706433`) are treated as literals too: the URL
 * parser normalises them, but a stray string reaching here should not pass. */
const isBlockedHostname = (hostname) => {
    const host = stripBrackets(hostname);
    if (!host) return true;
    if (host === 'localhost' || host.endsWith('.localhost')) return true;
    if (BLOCKED_SUFFIXES.some((s) => host.endsWith(s))) return true;
    if (net.isIP(host)) return isPrivateAddress(host);
    if (/^(0x[0-9a-f]+|\d+)(\.(0x[0-9a-f]+|\d+)){0,3}$/i.test(host)) {
        try { return isBlockedHostname(new URL(`http://${host}/`).hostname); } catch (e) { return true; }
    }
    return false;
};

const parseHttpUrl = (url) => {
    let u;
    try { u = new URL(String(url)); } catch (e) { throw new Error(`not a valid URL: ${url}`); }
    if (!/^https?:$/.test(u.protocol)) throw new Error(`only http and https URLs can be fetched (got ${u.protocol.replace(/:$/, '')})`);
    return u;
};

const RESOLVE_ERROR = Object.freeze({ PRIVATE_HOST: 'private_host', DNS_FAILED: 'dns_failed', PRIVATE_ADDRESS: 'private_address' });

// The messages carry the hostname, which can itself say "private", so a caller reads the code.
const resolveError = (code, message) => Object.assign(new Error(message), { code });

/* `allowlist` (Webhooks/helpers/privateHostAllowlist) re-admits private hosts an
 * instance owner chose; the resolved address is still checked and pinned. */
async function resolvePublic(url, { allowlist } = {}) {
    const u = parseHttpUrl(url);
    const host = stripBrackets(u.hostname);
    if (isBlockedHostname(host) && !(allowlist && allowlist.allowsHost(host))) throw resolveError(RESOLVE_ERROR.PRIVATE_HOST, `${u.hostname} is a private, local or internal host — agents do not fetch it`);
    let answers;
    try {
        answers = await dns.promises.lookup(host, { all: true, verbatim: true });
    } catch (e) {
        throw resolveError(RESOLVE_ERROR.DNS_FAILED, `could not resolve ${u.hostname}: ${e.code || e.message}`);
    }
    if (!answers || !answers.length) throw resolveError(RESOLVE_ERROR.DNS_FAILED, `could not resolve ${u.hostname}`);
    const bad = answers.find((a) => isPrivateAddress(a.address) && !(allowlist && allowlist.allowsAddress(host, a.address)));
    if (bad) throw resolveError(RESOLVE_ERROR.PRIVATE_ADDRESS, `${u.hostname} resolves to a private or reserved address (${bad.address}) — agents do not fetch it`);
    return { url: u, address: answers[0].address, family: answers[0].family || net.isIP(answers[0].address) };
}

const pinnedLookup = ({ address, family }) => (hostname, options, cb) => cb(null, address, family);

async function readCapped(stream, { maxBytes, remainingMs }) {
    return new Promise((resolve, reject) => {
        const chunks = [];
        let size = 0;
        let settled = false;
        const finish = (fn, value) => { if (settled) return; settled = true; clearTimeout(timer); fn(value); };
        const timer = setTimeout(() => { stream.destroy(); finish(reject, new Error('fetch exceeded its time budget')); }, remainingMs);
        stream.on('data', (chunk) => {
            size += chunk.length;
            if (size > maxBytes) { stream.destroy(); return finish(reject, new Error(`response is larger than the ${maxBytes} byte size cap`)); }
            chunks.push(chunk);
        });
        stream.on('end', () => finish(resolve, Buffer.concat(chunks)));
        stream.on('error', (e) => finish(reject, e));
    });
}

/* 303 always becomes GET, and so do 301/302 for anything but GET/HEAD (stricter than the
 * Fetch standard, which converts only POST); 307/308 replay the original method and body. */
const methodAfterRedirect = (status, method) => (status === 303 || ((status === 301 || status === 302) && method !== 'get' && method !== 'head') ? 'get' : method);

const portOf = (u) => Number(u.port || (u.protocol === 'https:' ? 443 : 80));

const sameOrigin = (a, b) => a.protocol === b.protocol && a.hostname === b.hostname && portOf(a) === portOf(b);

const CREDENTIAL_HEADERS = Object.freeze(['authorization', 'proxy-authorization', 'cookie']);
const BODY_HEADERS = Object.freeze(['content-type', 'content-length', 'content-encoding', 'content-language', 'content-location']);

const withoutHeaders = (headers, names) => Object.fromEntries(Object.entries(headers || {}).filter(([name]) => !names.includes(name.toLowerCase())));

const hopOf = (u, status) => ({ host: u.host, path: u.pathname, status });

const REFUSAL = Object.freeze({ PRIVATE_HOST: 'private_host', UNLISTED: 'unlisted', PRIVATE_ADDRESS: 'private_address' });

/* The workspace egress gateway. Off, with no workspace behind the fetch, or
 * with an empty list, every rule above applies unchanged. With a list, each hop
 * must name a listed host, and the private-host and resolved-address rules still
 * run first and last: a listed private host is refused, and so is a listed name
 * that resolves to a private address. The store is required lazily so a fetch
 * outside the gateway loads nothing new. */
async function egressGate({ companyId, actor }) {
    const store = require('./egressAllowlist');
    const hosts = await store.hostsFor(companyId);
    if (!hosts.length) return null;
    const refuse = (u, hop, reason) => {
        const host = stripBrackets(u.hostname);
        store.recordRefusal(companyId, { actor, host, port: portOf(u), reason, hop });
        if (reason === REFUSAL.UNLISTED) throw new Error(`${host} is not on this workspace's egress allowlist — the instance owner can allow it under Instance > Egress`);
        throw new Error(`${host} is a private, local or internal host — agents do not fetch it, listed or not`);
    };
    return {
        check(url, hop) {
            const u = parseHttpUrl(url);
            if (isBlockedHostname(u.hostname)) refuse(u, hop, REFUSAL.PRIVATE_HOST);
            if (!hostMatches(hosts, u.hostname, portOf(u))) refuse(u, hop, REFUSAL.UNLISTED);
        },
        resolved(url, hop, error) {
            if (error.code !== RESOLVE_ERROR.PRIVATE_ADDRESS) return;
            let u;
            try { u = parseHttpUrl(url); } catch (e) { return; }
            store.recordRefusal(companyId, { actor, host: stripBrackets(u.hostname), port: portOf(u), reason: REFUSAL.PRIVATE_ADDRESS, hop });
        },
    };
}

const withinBudget = (promise, ms) => new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('fetch exceeded its time budget')), ms);
    promise.then((value) => { clearTimeout(timer); resolve(value); }, (error) => { clearTimeout(timer); reject(error); });
});

/* Follows redirects by hand so every hop is validated and pinned. `opts.resolve`
 * exists for tests that need a "public" name to land on a local server.
 *
 * Credentials (Authorization, Proxy-Authorization, Cookie and any `opts.sensitiveHeaders`)
 * are dropped for good at the first hop to another origin, and a request that carried
 * them is refused a hop from https to http. Only a credentialed request loses its body
 * on a cross-origin 307/308: an unauthenticated one (a webhook delivery) is replayed as
 * the Fetch standard does.
 *
 * `opts.beforeHop(url, hop)` may throw to refuse a hop before it is resolved; a declared read uses it to keep
 * every redirect on its declared hosts. */
async function safeFetch(url, opts = {}) {
    const { timeoutMs, maxBytes, maxRedirects } = { ...DEFAULTS, ...opts };
    const resolve = opts.resolve || ((target) => resolvePublic(target, { allowlist: opts.allowlist }));
    const deadline = Date.now() + timeoutMs;
    const remaining = () => {
        const left = deadline - Date.now();
        if (left <= 0) throw new Error('fetch exceeded its time budget');
        return left;
    };
    const workspace = { ...(egressContext.get() || {}), ...(opts.companyId ? { companyId: opts.companyId, actor: opts.actor } : {}) };
    const gate = egressContext.isOn() && workspace.companyId ? await withinBudget(egressGate(workspace), remaining()) : null;

    const sensitive = [...CREDENTIAL_HEADERS, ...(opts.sensitiveHeaders || []).map((name) => String(name).toLowerCase())];
    let headers = opts.headers;
    const credentialed = Object.keys(headers || {}).some((name) => sensitive.includes(name.toLowerCase()));
    const hops = [];
    let current = String(url);
    let method = String(opts.method || 'get').toLowerCase();
    let data = opts.data;
    for (let hop = 0; ; hop += 1) {
        if (opts.beforeHop) opts.beforeHop(current, hop);
        if (gate) gate.check(current, hop);
        let target;
        try {
            target = await resolve(current);
        } catch (error) {
            if (gate) gate.resolved(current, hop, error);
            throw error;
        }
        const controller = new AbortController();
        const abortTimer = setTimeout(() => controller.abort(), remaining());
        let res;
        try {
            res = await axios.request({
                url: target.url.toString(),
                method,
                data,
                headers,
                timeout: remaining(),
                signal: controller.signal,
                maxRedirects: 0,
                maxContentLength: maxBytes,
                lookup: pinnedLookup(target),
                validateStatus: () => true,
                responseType: 'stream',
            });
        } catch (e) {
            clearTimeout(abortTimer);
            if (controller.signal.aborted || e.code === 'ECONNABORTED' || e.code === 'ERR_CANCELED') throw new Error('fetch exceeded its time budget');
            throw e;
        }
        clearTimeout(abortTimer);

        hops.push(hopOf(target.url, res.status));
        const location = res.headers && res.headers.location;
        if (res.status >= 300 && res.status < 400 && location) {
            res.data.destroy();
            if (hop >= maxRedirects) throw new Error(`too many redirects (more than ${maxRedirects})`);
            const nextUrl = new URL(String(location), target.url);
            if (credentialed && target.url.protocol === 'https:' && nextUrl.protocol === 'http:') {
                throw new Error(`refused a redirect from https to http (${nextUrl.host}) on a request that carries credentials`);
            }
            const crossOrigin = !sameOrigin(target.url, nextUrl);
            let next = methodAfterRedirect(res.status, method);
            if (crossOrigin && credentialed && next !== 'head') next = 'get';
            if (next !== method || (crossOrigin && credentialed)) {
                data = undefined;
                headers = withoutHeaders(headers, BODY_HEADERS);
            }
            if (crossOrigin) headers = withoutHeaders(headers, sensitive);
            method = next;
            current = nextUrl.toString();
            continue;
        }

        const body = await readCapped(res.data, { maxBytes, remainingMs: remaining() });
        const finalUrl = `${target.url.protocol}//${target.url.host}${target.url.pathname}`;
        return { status: res.status, headers: res.headers, body: body.toString('utf8'), bytes: body.length, url: target.url.toString(), finalUrl, hops };
    }
}

module.exports = { safeFetch, resolvePublic, isBlockedHostname, isPrivateAddress, DEFAULTS };
