const dns = require('dns');
const net = require('net');
const axios = require('axios');

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

const isPrivateV6 = (ip) => {
    const bare = ip.replace(/%.*$/, '');
    const mapped = mappedV4(bare);
    if (mapped) return isPrivateV4(mapped);
    const words = expandV6(bare);
    if (words.every((w) => w === 0)) return true;
    if (words.slice(0, 7).every((w) => w === 0) && words[7] === 1) return true;
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

/* `allowlist` (Webhooks/helpers/privateHostAllowlist) re-admits private hosts an
 * instance owner chose; the resolved address is still checked and pinned. */
async function resolvePublic(url, { allowlist } = {}) {
    const u = parseHttpUrl(url);
    const host = stripBrackets(u.hostname);
    if (isBlockedHostname(host) && !(allowlist && allowlist.allowsHost(host))) throw new Error(`${u.hostname} is a private, local or internal host — agents do not fetch it`);
    let answers;
    try {
        answers = await dns.promises.lookup(host, { all: true, verbatim: true });
    } catch (e) {
        throw new Error(`could not resolve ${u.hostname}: ${e.code || e.message}`);
    }
    if (!answers || !answers.length) throw new Error(`could not resolve ${u.hostname}`);
    const bad = answers.find((a) => isPrivateAddress(a.address) && !(allowlist && allowlist.allowsAddress(host, a.address)));
    if (bad) throw new Error(`${u.hostname} resolves to a private or reserved address (${bad.address}) — agents do not fetch it`);
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

/* Redirect method rules follow the Fetch spec: 303 always becomes GET, and so do
 * 301/302 for anything but GET/HEAD; 307/308 replay the original method and body. */
const methodAfterRedirect = (status, method) => (status === 303 || ((status === 301 || status === 302) && method !== 'get' && method !== 'head') ? 'get' : method);

/* Follows redirects by hand so every hop is validated and pinned. `opts.resolve`
 * exists for tests that need a "public" name to land on a local server. */
async function safeFetch(url, opts = {}) {
    const { timeoutMs, maxBytes, maxRedirects } = { ...DEFAULTS, ...opts };
    const resolve = opts.resolve || ((target) => resolvePublic(target, { allowlist: opts.allowlist }));
    const deadline = Date.now() + timeoutMs;
    const remaining = () => {
        const left = deadline - Date.now();
        if (left <= 0) throw new Error('fetch exceeded its time budget');
        return left;
    };

    let current = String(url);
    let method = String(opts.method || 'get').toLowerCase();
    let data = opts.data;
    for (let hop = 0; ; hop += 1) {
        const target = await resolve(current);
        const controller = new AbortController();
        const abortTimer = setTimeout(() => controller.abort(), remaining());
        let res;
        try {
            res = await axios.request({
                url: target.url.toString(),
                method,
                data,
                headers: opts.headers,
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

        const location = res.headers && res.headers.location;
        if (res.status >= 300 && res.status < 400 && location) {
            res.data.destroy();
            if (hop >= maxRedirects) throw new Error(`too many redirects (more than ${maxRedirects})`);
            const next = methodAfterRedirect(res.status, method);
            if (next !== method) data = undefined;
            method = next;
            current = new URL(String(location), target.url).toString();
            continue;
        }

        const body = await readCapped(res.data, { maxBytes, remainingMs: remaining() });
        return { status: res.status, headers: res.headers, body: body.toString('utf8'), bytes: body.length, url: target.url.toString() };
    }
}

module.exports = { safeFetch, resolvePublic, isBlockedHostname, isPrivateAddress, DEFAULTS };
