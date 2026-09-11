const net = require('net');

const ALLOWLIST_ENV = 'WEBHOOK_ALLOWED_PRIVATE_HOSTS';

/* Reachable from any cloud VM and hands out instance credentials, so no allowlist
 * entry (a broad link-local range included) may open it. */
const METADATA = new net.BlockList();
METADATA.addAddress('169.254.169.254', 'ipv4');
METADATA.addAddress('fd00:ec2::254', 'ipv6');

const HOSTNAME = /^(?=.{1,253}$)[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)*$/;

const normalizeHost = (host) => String(host || '').trim().toLowerCase().replace(/^\[|\]$/g, '').replace(/\.$/, '');
const familyName = (kind) => (kind === 6 ? 'ipv6' : 'ipv4');

const isMetadataAddress = (ip) => {
    const bare = normalizeHost(ip);
    const kind = net.isIP(bare);
    return kind ? METADATA.check(bare, familyName(kind)) : false;
};

function parseEntry(raw) {
    const text = normalizeHost(raw);
    const [address, prefixText, extra] = text.split('/');
    const kind = net.isIP(address);
    if (kind) {
        if (extra !== undefined) return null;
        const max = kind === 6 ? 128 : 32;
        if (prefixText === undefined) return { kind: 'cidr', address, prefix: max, family: kind };
        if (!/^\d{1,3}$/.test(prefixText) || Number(prefixText) > max) return null;
        return { kind: 'cidr', address, prefix: Number(prefixText), family: kind };
    }
    if (prefixText === undefined && HOSTNAME.test(text) && !/^[\d.]+$/.test(text)) return { kind: 'host', host: text };
    return null;
}

function parseAllowlist(text) {
    const entries = [];
    const invalid = [];
    for (const raw of String(text || '').split(/[\s,]+/).filter(Boolean)) {
        const entry = parseEntry(raw);
        if (entry) entries.push(entry); else invalid.push(raw);
    }
    return { entries, invalid };
}

function compileAllowlist(text) {
    const { entries, invalid } = parseAllowlist(text);
    const hosts = new Set();
    const ranges = new net.BlockList();
    for (const entry of entries) {
        if (entry.kind === 'host') hosts.add(entry.host);
        else ranges.addSubnet(entry.address, entry.prefix, familyName(entry.family));
    }
    const inRange = (ip) => {
        const bare = normalizeHost(ip);
        const kind = net.isIP(bare);
        return Boolean(kind) && !METADATA.check(bare, familyName(kind)) && ranges.check(bare, familyName(kind));
    };
    return {
        size: entries.length,
        invalid,
        allowsHost: (host) => (net.isIP(normalizeHost(host)) ? inRange(host) : hosts.has(normalizeHost(host))),
        allowsAddress: (host, address) => !isMetadataAddress(address) && (hosts.has(normalizeHost(host)) || inRange(address)),
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

module.exports = { ALLOWLIST_ENV, parseAllowlist, compileAllowlist, isMetadataAddress, webhookAllowlist };
