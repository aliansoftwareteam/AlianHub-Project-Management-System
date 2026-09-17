const crypto = require('crypto');

const AMENDED_ACTION = 'audit.amended';
const MIN_KEY_LENGTH = 32;
const FORMAT_VERSION = 1;
const GENESIS = Object.freeze({ seq: 0, hash: '' });
const FLAG_ON = ['true', '1', 'on', 'yes'];

/* Outside the hash wherever they appear, so erasure can blank them and the chain still verifies. */
const PERSONAL_FIELDS = Object.freeze(['actorName', 'entityName', 'ip', 'email', 'userAgent']);
/* _id and createdAt are hashed as id and at; the rest are written by Mongoose or are the chain itself. */
const ENVELOPE_FIELDS = Object.freeze(['_id', 'createdAt', 'updatedAt', '__v', 'chain']);
const AMENDABLE_ROW_FIELDS = Object.freeze(['entityType', 'entityId', 'entityName']);

const INTEGRITY = Object.freeze({ VERIFIED: 'verified', BROKEN: 'broken', UNCHAINED: 'unchained', UNVERIFIED: 'unverified' });

/*
 * The only indexes the chain builds itself. Range and $exists filters, not $type: the planner only uses a
 * partial index for queries it can prove fall inside it.
 */
const CHAIN_INDEXES = Object.freeze([
    [{ 'chain.seq': 1 }, { unique: true, name: 'audit_chain_seq', partialFilterExpression: { 'chain.seq': { $gte: 0 } } }],
    [{ 'meta.amends': 1 }, { name: 'audit_amends', partialFilterExpression: { 'meta.amends': { $exists: true } } }],
]);

const chainConfig = (env = process.env) => {
    const requested = FLAG_ON.includes(String(env.AUDIT_CHAIN || '').trim().toLowerCase());
    const key = String(env.AUDIT_CHAIN_KEY || '');
    const keyValid = key.length >= MIN_KEY_LENGTH;
    let error = '';
    if (requested && !keyValid) {
        const problem = key ? `shorter than ${MIN_KEY_LENGTH} characters` : 'missing';
        error = `AUDIT_CHAIN is on but AUDIT_CHAIN_KEY is ${problem}, so the audit chain is off and new audit rows are written unchained`;
    }
    return { requested, on: requested && keyValid, keyValid, key: keyValid ? key : '', error };
};

const isObjectId = (v) => Boolean(v) && typeof v === 'object' && (v._bsontype === 'ObjectId' || v._bsontype === 'ObjectID');
const isPlainObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v) && !(v instanceof Date) && !isObjectId(v) && !Buffer.isBuffer(v);

const LONE_SURROGATE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g;

/* BSON writes strings as UTF-8, which has no encoding for a lone surrogate, so Mongo stores U+FFFD in its place. */
const wellFormed = (text) => text.replace(LONE_SURROGATE, '\uFFFD');

const isMongooseDocument = (v) => typeof v.toObject === 'function' && v.$__ !== undefined;

/*
 * The value as it is stored and hashed, with one defined encoding for everything JSON has no answer for, so the
 * row read back from Mongo hashes the same: undefined properties, functions, symbols and empty objects dropped;
 * array holes and undropped items as null; invalid dates as null; bytes as base64; BigInt, Decimal128 and
 * unsafe Longs as decimal strings; RegExps as their source text; Maps and Mongoose documents as plain objects.
 */
const clean = (value) => {
    if (value === undefined || typeof value === 'function' || typeof value === 'symbol') return undefined;
    if (typeof value === 'string') return wellFormed(value);
    if (typeof value === 'bigint') return value.toString();
    if (value === null || typeof value !== 'object') return value;
    if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
    if (isObjectId(value)) return value;
    if (Buffer.isBuffer(value) || value instanceof Uint8Array) return Buffer.from(value).toString('base64');
    if (value._bsontype === 'Binary') return Buffer.from(value.buffer).toString('base64');
    if (value._bsontype === 'Decimal128') return value.toString();
    if (value._bsontype === 'Long') return Number.isSafeInteger(value.toNumber()) ? value.toNumber() : value.toString();
    if (value._bsontype === 'Int32' || value._bsontype === 'Double') return value.valueOf();
    if (value instanceof RegExp) return String(value);
    if (value instanceof Map) return clean(Object.fromEntries(value));
    if (isMongooseDocument(value)) return clean(value.toObject());
    if (Array.isArray(value)) {
        return Array.from(value, (item) => {
            const c = clean(item);
            return c === undefined ? null : c;
        });
    }
    const out = {};
    Object.entries(value).forEach(([k, v]) => {
        const c = clean(v);
        if (c === undefined || (isPlainObject(c) && !Object.keys(c).length)) return;
        out[wellFormed(k)] = c;
    });
    return out;
};

const serialise = (v) => {
    if (v === undefined || v === null) return 'null';
    if (v instanceof Date) return `{"$date":${JSON.stringify(Number.isNaN(v.getTime()) ? null : v.toISOString())}}`;
    if (isObjectId(v)) return `{"$oid":${JSON.stringify(String(v))}}`;
    if (Buffer.isBuffer(v)) return `{"$binary":${JSON.stringify(v.toString('base64'))}}`;
    if (Array.isArray(v)) return `[${v.map(serialise).join(',')}]`;
    if (typeof v === 'object') return `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${serialise(v[k])}`).join(',')}}`;
    if (typeof v === 'number' && !Number.isFinite(v)) return `{"$number":${JSON.stringify(String(v))}}`;
    if (typeof v === 'bigint') return `{"$bigint":${JSON.stringify(String(v))}}`;
    return JSON.stringify(v);
};

const canonical = (value) => serialise(clean(value));

const withoutPersonal = (value) => {
    if (Array.isArray(value)) return value.map(withoutPersonal);
    if (!isPlainObject(value)) return value;
    const out = {};
    Object.entries(value).forEach(([k, v]) => { if (!PERSONAL_FIELDS.includes(k)) out[k] = withoutPersonal(v); });
    return out;
};

const hashedContent = (companyId, row) => {
    const fields = {};
    Object.entries(row).forEach(([k, v]) => { if (!ENVELOPE_FIELDS.includes(k)) fields[k] = v; });
    return {
        v: FORMAT_VERSION,
        companyId: String(companyId),
        seq: Number(row.chain && row.chain.seq),
        id: String(row._id),
        at: new Date(row.createdAt),
        row: withoutPersonal(fields),
    };
};

const hmac = (key, message) => crypto.createHmac('sha256', key).update(message).digest('hex');

const sameHex = (a, b) => {
    const x = Buffer.from(String(a || ''), 'utf8');
    const y = Buffer.from(String(b || ''), 'utf8');
    return x.length === y.length && x.length > 0 && crypto.timingSafeEqual(x, y);
};

const rowHash = (key, companyId, row, prevHash) => hmac(key, `${canonical(hashedContent(companyId, row))}\n${prevHash || ''}`);

const isChained = (row) => Boolean(row && row.chain && typeof row.chain.seq === 'number');

const hashMatches = (key, companyId, row) => isChained(row) && sameHex(row.chain.hash, rowHash(key, companyId, row, row.chain.prevHash));

/* A head or an anchor names a (seq, hash) point in the chain; the mac stops it being moved without the key. */
const markMac = (key, kind, companyId, { seq, hash }) => hmac(key, canonical({ kind, companyId: String(companyId), seq: Number(seq), hash: String(hash || '') }));

const macMatches = (key, kind, companyId, mark) => Boolean(mark) && typeof mark.seq === 'number' && sameHex(mark.mac, markMac(key, kind, companyId, mark));

/* $set paths agentAudit writes: meta.<key>, or an entity field it learns once the action ran. */
const amendmentOf = (original, $set) => {
    const set = {};
    const setRow = {};
    Object.entries($set || {}).forEach(([path, value]) => {
        const metaKey = path.startsWith('meta.') ? path.slice(5) : '';
        if (metaKey && !metaKey.includes('.')) set[metaKey] = value;
        else if (AMENDABLE_ROW_FIELDS.includes(path)) setRow[path] = value;
        else throw new Error(`an audit amendment cannot set ${path}`);
    });
    return {
        actorId: '',
        action: AMENDED_ACTION,
        entityType: (original && original.entityType) || '',
        entityId: (original && original.entityId) || '',
        meta: { amends: String(original._id), set, ...(Object.keys(setRow).length ? { setRow } : {}) },
    };
};

const seqOf = (row) => (isChained(row) ? row.chain.seq : Number.MAX_SAFE_INTEGER);
const inChainOrder = (rows) => [...rows].sort((a, b) => (seqOf(a) - seqOf(b)) || (new Date(a.createdAt) - new Date(b.createdAt)));

/*
 * Only a change that is in the chain, and hashes under the key when there is one, may alter what a row reads
 * as. Without the key a chained change is still read, so an action it applied or undid is not run again.
 */
const trustedAmendments = (key, companyId, amendments = []) => amendments.filter((a) => (key ? hashMatches(key, companyId, a) : isChained(a)));

const applyAmendments = (row, amendments = []) => {
    if (!row || !amendments.length) return row;
    const out = { ...row, meta: { ...(row.meta || {}) } };
    inChainOrder(amendments).forEach((a) => {
        const m = a.meta || {};
        Object.assign(out.meta, m.set || {});
        AMENDABLE_ROW_FIELDS.forEach((field) => { if (m.setRow && m.setRow[field] !== undefined) out[field] = m.setRow[field]; });
    });
    return out;
};

const walkLinks = (key, companyId, last, rows) => {
    let prev = last;
    for (const row of rows) {
        const seq = row.chain.seq;
        if (seq !== prev.seq + 1) return { last: prev, brokenAt: prev.seq + 1 };
        if (row.chain.prevHash !== prev.hash || !hashMatches(key, companyId, row)) return { last: prev, brokenAt: seq };
        prev = { seq, hash: row.chain.hash };
    }
    return { last: prev, brokenAt: null };
};

/*
 * A row is only as sound as the chain below it, so a break at n marks every row from n on. A row that stands
 * outside the chain when it should not (written after the chain started, or carrying a change that is not a
 * valid part of it) is broken on its own, with no sequence number to name.
 */
const pageIntegrity = ({ key, companyId, report, chainStartedAt = null }, entries) => {
    const started = chainStartedAt ? new Date(chainStartedAt).getTime() : null;
    const chainedOf = ({ row, amendments = [] }) => [row, ...amendments].filter(isChained);
    const rowBroken = { state: INTEGRITY.BROKEN, brokenAt: null };
    let brokenAt = report && report.brokenAt != null ? report.brokenAt : null;
    if (key) {
        entries.forEach((entry) => {
            chainedOf(entry).forEach((r) => {
                if (!hashMatches(key, companyId, r)) brokenAt = brokenAt == null ? r.chain.seq : Math.min(brokenAt, r.chain.seq);
            });
        });
    }
    return entries.map((entry) => {
        const amendments = entry.amendments || [];
        const outside = amendments.some((a) => !isChained(a));
        if (!isChained(entry.row)) {
            const late = started != null && new Date(entry.row.createdAt).getTime() > started;
            const forged = Boolean(key) && amendments.some((a) => isChained(a) && !hashMatches(key, companyId, a));
            return outside || late || forged ? rowBroken : { state: INTEGRITY.UNCHAINED };
        }
        if (!key || !report) return outside ? rowBroken : { state: INTEGRITY.UNVERIFIED };
        const top = Math.max(...chainedOf(entry).map((r) => r.chain.seq));
        if (brokenAt != null && top >= brokenAt) return { state: INTEGRITY.BROKEN, brokenAt };
        if (outside) return rowBroken;
        if (report.verifiedThrough != null && top <= report.verifiedThrough) return { state: INTEGRITY.VERIFIED };
        return { state: INTEGRITY.UNVERIFIED };
    });
};

module.exports = {
    AMENDED_ACTION, MIN_KEY_LENGTH, PERSONAL_FIELDS, AMENDABLE_ROW_FIELDS, INTEGRITY, GENESIS, CHAIN_INDEXES,
    chainConfig, clean, canonical, hashedContent, rowHash, hashMatches, isChained, markMac, macMatches,
    amendmentOf, trustedAmendments, applyAmendments, inChainOrder, walkLinks, pageIntegrity,
};
