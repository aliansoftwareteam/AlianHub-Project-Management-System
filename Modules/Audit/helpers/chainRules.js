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

/* What Mongoose stores for a value: undefined properties and empty objects dropped, undefined array items as null. */
const clean = (value) => {
    if (Array.isArray(value)) return value.map((item) => (item === undefined ? null : clean(item)));
    if (!isPlainObject(value)) return value;
    const out = {};
    Object.entries(value).forEach(([k, v]) => {
        if (v === undefined) return;
        const c = clean(v);
        if (isPlainObject(c) && !Object.keys(c).length) return;
        out[k] = c;
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

/* A row is only as sound as the chain below it, so a break at n marks every row from n on. */
const pageIntegrity = ({ key, companyId, report }, entries) => {
    const chainedOf = ({ row, amendments = [] }) => [row, ...amendments].filter(isChained);
    let brokenAt = report && report.brokenAt != null ? report.brokenAt : null;
    entries.forEach((entry) => {
        if (!isChained(entry.row) || !key) return;
        chainedOf(entry).forEach((r) => {
            if (!hashMatches(key, companyId, r)) brokenAt = brokenAt == null ? r.chain.seq : Math.min(brokenAt, r.chain.seq);
        });
    });
    return entries.map((entry) => {
        if (!isChained(entry.row)) return { state: INTEGRITY.UNCHAINED };
        if (!key || !report) return { state: INTEGRITY.UNVERIFIED };
        const top = Math.max(...chainedOf(entry).map((r) => r.chain.seq));
        if (brokenAt != null && top >= brokenAt) return { state: INTEGRITY.BROKEN, brokenAt };
        if (report.verifiedThrough != null && top <= report.verifiedThrough) return { state: INTEGRITY.VERIFIED };
        return { state: INTEGRITY.UNVERIFIED };
    });
};

module.exports = {
    AMENDED_ACTION, MIN_KEY_LENGTH, PERSONAL_FIELDS, AMENDABLE_ROW_FIELDS, INTEGRITY, GENESIS,
    chainConfig, clean, canonical, hashedContent, rowHash, hashMatches, isChained, markMac, macMatches,
    amendmentOf, applyAmendments, inChainOrder, walkLinks, pageIntegrity,
};
