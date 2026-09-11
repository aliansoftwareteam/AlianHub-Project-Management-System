const net = require('net');

const ALLOWLIST_ENV = 'WEBHOOK_ALLOWED_PRIVATE_HOSTS';

const HOSTNAME = /^(?=.{1,253}$)[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)*$/;

const IPV4_MAPPED_BASE = 0xffffn << 32n;

const normalizeHost = (host) => String(host || '').trim().toLowerCase().replace(/^\[|\]$/g, '').replace(/\.$/, '');
const bareAddress = (ip) => normalizeHost(ip).replace(/%.*$/, '');

const v4Value = (ip) => ip.split('.').reduce((n, octet) => (n << 8n) + BigInt(octet), 0n);

function v6Value(ip) {
    const tail = ip.match(/^(.*:)(\d+\.\d+\.\d+\.\d+)$/);
    const text = tail ? `${tail[1]}${(v4Value(tail[2]) >> 16n).toString(16)}:${(v4Value(tail[2]) & 0xffffn).toString(16)}` : ip;
    const [head, rest] = text.split('::');
    const left = head ? head.split(':') : [];
    const right = rest ? rest.split(':') : [];
    const words = rest === undefined ? left : [...left, ...Array(8 - left.length - right.length).fill('0'), ...right];
    return words.reduce((n, word) => (n << 16n) + BigInt(parseInt(word, 16)), 0n);
}

/* IPv4 is placed inside ::ffff:0:0/96, so an IPv4-mapped spelling meets the same rules. */
const addressValue = (ip) => {
    const kind = net.isIP(ip);
    if (kind === 4) return IPV4_MAPPED_BASE + v4Value(ip);
    return kind === 6 ? v6Value(ip) : null;
};

const block = (address, prefix) => {
    const bits = net.isIP(address) === 4 ? prefix + 96 : prefix;
    const hostBits = BigInt(128 - bits);
    const start = (addressValue(address) >> hostBits) << hostBits;
    return { start, end: start + (1n << hostBits) - 1n, bits };
};

const contains = (outer, inner) => outer.start <= inner.start && inner.end <= outer.end;
const overlaps = (a, b) => a.start <= b.end && b.start <= a.end;
const sameBlock = (a, b) => a.start === b.start && a.end === b.end;

const IPV4_SPACE = block('::ffff:0:0', 96);

/* Cloud metadata and credential services: link-local holds the AWS, Azure, GCP and Oracle
 * metadata service, the ECS and EKS credential agents and Tencent's; the rest are AWS and
 * GCP over IPv6, Alibaba Cloud and Oracle over IPv6. Link-local goes whole because a URL
 * cannot carry a zone id, so no reachable receiver lives there. */
const NEVER_ALLOWED = [
    ['169.254.0.0', 16], ['fe80::', 10], ['fd00:ec2::', 64], ['100.100.100.200', 32], ['fd20:ce::254', 128], ['fd00:c1::a9fe:a9fe', 128],
].map(([address, prefix]) => block(address, prefix));

/* Listing one of these exactly is a deliberate choice; a wider range that swallows one is a typo
 * away from opening loopback or the host itself to every tenant. */
const WHOLE_BLOCK_ONLY = [['0.0.0.0', 8], ['127.0.0.0', 8], ['::', 128]].map(([address, prefix]) => block(address, prefix));
const MIN_PREFIX_BITS = { ipv4: 96 + 8, ipv6: 32 };

const isNeverAllowedAddress = (ip) => {
    const value = addressValue(bareAddress(ip));
    return value !== null && NEVER_ALLOWED.some((range) => range.start <= value && value <= range.end);
};

/* The URL parser rewrites numeric spellings such as 0x7f000001 or 127.1 to an address, so
 * a name it would change could never match a hostname entry. */
const isCanonicalHostname = (host) => {
    if (!HOSTNAME.test(host)) return false;
    try {
        return new URL(`http://${host}/`).hostname === host;
    } catch (e) {
        return false;
    }
};

const dottedQuad = (value) => [24n, 16n, 8n, 0n].map((shift) => (value >> shift) & 0xffn).join('.');

function parseEntry(raw) {
    const text = normalizeHost(raw);
    const [address, prefixText, extra] = text.split('/');
    const kind = net.isIP(address);
    if (!kind) return prefixText === undefined && isCanonicalHostname(text) ? { entry: { kind: 'host', host: text } } : { reason: 'invalid' };
    const max = kind === 6 ? 128 : 32;
    if (extra !== undefined || (prefixText !== undefined && !/^\d{1,3}$/.test(prefixText))) return { reason: 'invalid' };
    const prefix = prefixText === undefined ? max : Number(prefixText);
    if (prefix > max) return { reason: 'invalid' };

    const range = block(address, prefix);
    const isIpv4 = contains(IPV4_SPACE, range);
    if (NEVER_ALLOWED.some((never) => contains(never, range))) return { reason: 'reserved' };
    if (range.bits < (isIpv4 ? MIN_PREFIX_BITS.ipv4 : MIN_PREFIX_BITS.ipv6)) return { reason: 'broad' };
    if (WHOLE_BLOCK_ONLY.some((whole) => contains(range, whole) && !sameBlock(range, whole))) return { reason: 'broad' };
    if (NEVER_ALLOWED.some((never) => overlaps(range, never))) return { reason: 'reserved' };

    if (!isIpv4) return { entry: { kind: 'cidr', address, prefix, family: 6 } };
    const v4Address = kind === 4 ? address : dottedQuad(addressValue(address) - IPV4_MAPPED_BASE);
    return { entry: { kind: 'cidr', address: v4Address, prefix: range.bits - 96, family: 4 } };
}

const splitEntries = (text) => String(text || '').split(/[\s,]+/).filter(Boolean);

function parseAllowlist(text) {
    const entries = [];
    const invalid = [];
    const refused = [];
    for (const raw of splitEntries(text)) {
        const { entry, reason } = parseEntry(raw);
        if (entry) entries.push(entry);
        else if (reason === 'invalid') invalid.push(raw);
        else refused.push({ entry: raw, reason });
    }
    return { entries, invalid, refused };
}

const SETTING_ERROR = { invalid: 'allowlist', broad: 'allowlist_broad', reserved: 'allowlist_reserved' };

function allowlistError(text) {
    for (const raw of splitEntries(text)) {
        const { reason } = parseEntry(raw);
        if (reason) return SETTING_ERROR[reason];
    }
    return null;
}

/* The environment can hold a value the settings page never validated, so a refused entry is dropped here too. */
function compileAllowlist(text) {
    const { entries, invalid, refused } = parseAllowlist(text);
    const hosts = new Set(entries.filter((entry) => entry.kind === 'host').map((entry) => entry.host));
    const ranges = entries.filter((entry) => entry.kind === 'cidr').map((entry) => block(entry.address, entry.prefix));
    const inRange = (ip) => {
        const value = addressValue(bareAddress(ip));
        return value !== null && !isNeverAllowedAddress(ip) && ranges.some((range) => range.start <= value && value <= range.end);
    };
    return {
        size: entries.length,
        invalid,
        refused,
        allowsHost: (host) => (net.isIP(bareAddress(host)) ? inRange(host) : hosts.has(normalizeHost(host))),
        allowsAddress: (host, address) => !isNeverAllowedAddress(address) && (hosts.has(normalizeHost(host)) || inRange(address)),
    };
}

let cached = { text: null, allowlist: null };

/* Read on every save and every delivery, so removing an entry stops deliveries
 * that were saved while it was listed. */
function webhookAllowlist() {
    const text = process.env.WEBHOOK_ALLOWED_PRIVATE_HOSTS || '';
    if (cached.text !== text) cached = { text, allowlist: compileAllowlist(text) };
    return cached.allowlist;
}

module.exports = { ALLOWLIST_ENV, parseAllowlist, compileAllowlist, allowlistError, isNeverAllowedAddress, webhookAllowlist };
