const mongoose = require('mongoose');
const { SCHEMA_TYPE } = require('../../Config/schemaType');
const { dbCollections } = require('../../Config/collections');
const { MongoDbCrudOpration } = require('../../utils/mongo-handler/mongoQueries');
const logger = require('../../Config/loggerConfig');
const rules = require('./helpers/chainRules');

const LOG = '[audit-chain]';
const COMPANY_HEAD_ID = 'head';
const PAGE_SIZE = 500;
const LIST_VERIFY_BUDGET = 5000;
const MIRROR_INTERVAL_MS = 60 * 1000;
const ERROR_LOG_INTERVAL_MS = 60 * 1000;
const APPEND_ATTEMPTS = 20;
const ANCHOR_LOOKBACK = 20;
const QUEUE_LIMIT = 1000;
const WRITE_TIMEOUT_MS = 15 * 1000;

const { AUDIT_LOGS, AUDIT_CHAIN_HEADS, AUDIT_CHAIN_ANCHORS, GOLBAL } = SCHEMA_TYPE;

const db = (database, type, data, method) => MongoDbCrudOpration(String(database), { type, data }, method);
const plain = (doc) => (doc && typeof doc.toObject === 'function' ? doc.toObject() : doc);
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

let lastErrorLoggedAt = 0;

const config = () => {
    const cfg = rules.chainConfig();
    if (cfg.error && Date.now() - lastErrorLoggedAt >= ERROR_LOG_INTERVAL_MS) {
        lastErrorLoggedAt = Date.now();
        logger.error(`${LOG} ${cfg.error}`);
    }
    return cfg;
};

const isOn = () => config().on;

const logBootState = () => {
    lastErrorLoggedAt = 0;
    const cfg = config();
    if (cfg.on) logger.info(`${LOG} on: new audit rows are chained per company`);
};

const tails = new Map();
const waiting = new Map();

/* Appends from one process queue per company, so the unique index only arbitrates between servers. */
const serially = (companyId, fn) => {
    const id = String(companyId);
    const queued = waiting.get(id) || 0;
    if (queued >= QUEUE_LIMIT) return Promise.reject(new Error(`${LOG} the write queue is full for company ${id} (${QUEUE_LIMIT} waiting)`));
    waiting.set(id, queued + 1);
    const run = (tails.get(id) || Promise.resolve()).then(fn);
    const settled = run.then(() => {}, () => {});
    tails.set(id, settled);
    settled.then(() => {
        const left = (waiting.get(id) || 1) - 1;
        if (left > 0) waiting.set(id, left); else waiting.delete(id);
        if (tails.get(id) === settled) tails.delete(id);
    });
    return run;
};

/* A hung call must not hold the company's queue; whatever it does later is settled by the unique index. */
const withTimeout = (promise, what) => {
    let timer;
    promise.catch(() => {});
    const timeout = new Promise((resolve, reject) => {
        timer = setTimeout(() => reject(new Error(`${LOG} ${what} timed out after ${WRITE_TIMEOUT_MS} ms`)), WRITE_TIMEOUT_MS);
    });
    return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
};

const isSeqConflict = (error) => Boolean(error && error.code === 11000
    && /chain\.seq/.test(`${error.message || ''} ${JSON.stringify(error.keyPattern || {})}`));

const headFilter = (database, companyId) => ({ _id: String(database) === GOLBAL ? String(companyId) : COMPANY_HEAD_ID });

const readHead = async (companyId, database = companyId) => plain(await db(database, AUDIT_CHAIN_HEADS, [headFilter(database, companyId)], 'findOne'));

const trusted = (key, kind, companyId, mark) => (rules.macMatches(key, kind, companyId, mark) ? { seq: mark.seq, hash: mark.hash, rowId: mark.rowId } : null);

/* Moves a head forward only; a duplicate key means another writer already holds a newer one. */
const advance = async (database, companyId, key, { seq, hash, rowId }) => {
    const mark = { seq, hash, rowId: String(rowId || ''), mac: rules.markMac(key, 'head', companyId, { seq, hash }), at: new Date() };
    try {
        await db(database, AUDIT_CHAIN_HEADS, [{ ...headFilter(database, companyId), seq: { $lt: seq } }, { $set: mark }, { upsert: true }], 'updateOne');
    } catch (error) {
        if (!(error && error.code === 11000)) throw error;
    }
};

/* The global copy is what makes truncating the newest rows detectable when the company head goes with them. */
const mirrorHead = async (companyId, key = config().key, mark = null) => {
    if (!key) return;
    const source = mark || trusted(key, 'head', companyId, await readHead(companyId));
    if (source) await advance(GOLBAL, companyId, key, source);
};

const quietly = (what, promise) => promise.catch((error) => logger.error(`${LOG} ${what}: ${(error && error.message) || error}`));

const mirrors = new Map();

/* At most one global write a minute per company, and the newest head always lands by the end of that minute. */
const mirrorSoon = (companyId, key, mark = null) => {
    const id = String(companyId);
    const slot = mirrors.get(id) || { at: 0, timer: null, key };
    slot.key = key;
    mirrors.set(id, slot);
    const wait = slot.at + MIRROR_INTERVAL_MS - Date.now();
    if (slot.timer) return;
    if (wait <= 0) {
        slot.at = Date.now();
        quietly(`mirror ${id}`, mirrorHead(id, key, mark));
        return;
    }
    slot.timer = setTimeout(() => {
        slot.timer = null;
        slot.at = Date.now();
        quietly(`mirror ${id}`, mirrorHead(id, slot.key));
    }, wait);
    if (typeof slot.timer.unref === 'function') slot.timer.unref();
};

/* Writes every mirror still waiting for its minute; the cron calls it so none waits on a timer alone. */
const flushMirrors = async () => {
    const due = [...mirrors.entries()].filter(([, slot]) => slot.timer);
    await Promise.all(due.map(([id, slot]) => {
        clearTimeout(slot.timer);
        slot.timer = null;
        slot.at = Date.now();
        return quietly(`mirror ${id}`, mirrorHead(id, slot.key));
    }));
};

const newestChained = async (companyId) => {
    const [row] = (await db(companyId, AUDIT_LOGS, [{ 'chain.seq': { $gte: 0 } }, { chain: 1 }, { sort: { 'chain.seq': -1 }, limit: 1 }], 'find')) || [];
    return row ? plain(row).chain : null;
};

/* The furthest of the newest row and both heads, so a sweep or missing newest rows never hand out a used number. */
const tipOf = async (companyId, key) => {
    const [row, head, mirrored] = await Promise.all([newestChained(companyId), readHead(companyId), readHead(companyId, GOLBAL)]);
    const candidates = [row && { seq: row.seq, hash: row.hash }, trusted(key, 'head', companyId, head), trusted(key, 'head', companyId, mirrored)].filter(Boolean);
    return candidates.reduce((best, mark) => (mark.seq > best.seq ? mark : best), rules.GENESIS);
};

const indexed = new Map();

/* Mongoose builds indexes in the background; two servers could both write seq 1 before the unique one exists. */
const ensureIndexes = async (companyId) => {
    const id = String(companyId);
    if (!indexed.has(id)) indexed.set(id, db(id, AUDIT_LOGS, [], 'createIndexes'));
    try {
        await indexed.get(id);
    } catch (error) {
        indexed.delete(id);
        throw error;
    }
};

const appendOnce = async (companyId, key, entry, createdAt) => {
    const tip = await tipOf(companyId, key);
    const row = rules.clean({ ...entry, _id: new mongoose.Types.ObjectId(), createdAt });
    row.chain = { seq: tip.seq + 1, prevHash: tip.hash };
    row.chain.hash = rules.rowHash(key, companyId, row, tip.hash);
    const saved = await db(companyId, AUDIT_LOGS, row, 'save');
    const mark = { seq: row.chain.seq, hash: row.chain.hash, rowId: String(row._id) };
    await quietly(`head ${companyId}`, advance(companyId, companyId, key, mark));
    mirrorSoon(companyId, key, mark);
    return saved;
};

/* The insert is the reservation: a sequence number exists only once its row does, so a failed write leaves no gap. */
const append = (companyId, key, entry, createdAt = new Date()) => serially(companyId, async () => {
    await withTimeout(ensureIndexes(companyId), 'building the audit indexes');
    for (let attempt = 1; ; attempt += 1) {
        try {
            return await withTimeout(appendOnce(companyId, key, entry, createdAt), 'an audit write');
        } catch (error) {
            if (!isSeqConflict(error)) throw error;
            if (attempt >= APPEND_ATTEMPTS) {
                throw new Error(`${LOG} the ${entry.action} row was not written for company ${companyId} after ${APPEND_ATTEMPTS} sequence conflicts`);
            }
            await sleep(Math.floor(Math.random() * Math.min(50, attempt * 5)));
        }
    }
});

const saveAuditRow = (companyId, entry) => {
    const cfg = config();
    if (!cfg.on) return MongoDbCrudOpration(companyId, { type: AUDIT_LOGS, data: entry }, 'save');
    return append(companyId, cfg.key, entry);
};

const rowFilter = (auditId) => (/^[0-9a-fA-F]{24}$/.test(String(auditId)) ? { _id: new mongoose.Types.ObjectId(String(auditId)) } : null);

/* A chained row changes only by an appended row, whatever AUDIT_CHAIN says; without the key it cannot change at all. */
const amend = async (companyId, auditId, $set) => {
    const createdAt = new Date();
    const filter = rowFilter(auditId);
    if (!filter) throw new Error(`invalid audit id ${auditId}`);
    const original = plain(await db(companyId, AUDIT_LOGS, [filter], 'findOne'));
    if (!original) throw Object.assign(new Error(`audit row ${auditId} not found`), { notFound: true });
    const cfg = config();
    if (!cfg.keyValid) {
        logger.error(`${LOG} refused to change audit row ${auditId}: AUDIT_CHAIN_KEY is not set, and a chained row is never edited in place`);
        throw new Error(`audit row ${auditId} cannot change without AUDIT_CHAIN_KEY`);
    }
    return append(companyId, cfg.key, rules.amendmentOf(original, $set), createdAt);
};

const amendmentsFor = async (companyId, rows) => {
    const ids = [...new Set(rows.filter((r) => r && r.action !== rules.AMENDED_ACTION).map((r) => String(r._id)))];
    const byRow = new Map();
    if (!ids.length) return byRow;
    const found = (await db(companyId, AUDIT_LOGS, [{ action: rules.AMENDED_ACTION, 'meta.amends': { $in: ids } }, {}, { sort: { 'chain.seq': 1 } }], 'find')) || [];
    found.map(plain).forEach((a) => {
        const key = String(a.meta && a.meta.amends);
        byRow.set(key, [...(byRow.get(key) || []), a]);
    });
    return byRow;
};

/* With the chain off nothing is read; rows with no trusted appended changes come back as they were read. */
const foldRows = async (companyId, rows) => {
    const cfg = config();
    if (!cfg.on || !rows || !rows.length) return rows;
    const byRow = await amendmentsFor(companyId, rows);
    return rows.map((row) => {
        const amendments = row && rules.trustedAmendments(cfg.key, String(companyId), byRow.get(String(row._id)) || []);
        return amendments && amendments.length ? rules.applyAmendments(plain(row), amendments) : row;
    });
};

const foldOne = async (companyId, row) => (row ? (await foldRows(companyId, [row]))[0] : row);

const hasAmendments = async (companyId) => Boolean(await db(companyId, AUDIT_LOGS, [{ action: rules.AMENDED_ACTION }, { _id: 1 }], 'findOne'));

/* The same fold as applyAmendments, for filters that must see the current state before paging. */
const foldStages = () => {
    const rowField = (field) => ({ $reduce: { input: '$_amendments', initialValue: `$${field}`, in: { $ifNull: [`$$this.meta.setRow.${field}`, '$$value'] } } });
    return [
        { $set: { _auditId: { $toString: '$_id' } } },
        { $lookup: { from: dbCollections.AUDIT_LOGS, localField: '_auditId', foreignField: 'meta.amends', as: '_amendments', pipeline: [{ $match: { action: rules.AMENDED_ACTION, 'chain.seq': { $gte: 0 } } }] } },
        { $set: { _amendments: { $sortArray: { input: '$_amendments', sortBy: { 'chain.seq': 1 } } } } },
        { $set: {
            meta: { $reduce: { input: '$_amendments', initialValue: { $ifNull: ['$meta', {}] }, in: { $mergeObjects: ['$$value', { $ifNull: ['$$this.meta.set', {}] }] } } },
            ...Object.fromEntries(rules.AMENDABLE_ROW_FIELDS.map((field) => [field, rowField(field)])),
        } },
        { $unset: ['_auditId', '_amendments'] },
    ];
};

const newestAnchor = async (companyId, key) => {
    const found = (await db(companyId, AUDIT_CHAIN_ANCHORS, [{}, {}, { sort: { seq: -1 }, limit: ANCHOR_LOOKBACK }], 'find')) || [];
    const anchor = found.map(plain).find((a) => rules.macMatches(key, 'anchor', companyId, a));
    return anchor ? { seq: anchor.seq, hash: anchor.hash } : null;
};

const cursors = new Map();

/* A remembered position is trusted only while the row it names is unchanged and nothing below it is missing. */
const positionHolds = async (companyId, start, position) => {
    if (!position || position.seq <= start.seq) return false;
    const row = plain(await db(companyId, AUDIT_LOGS, [{ 'chain.seq': position.seq }], 'findOne'));
    if (!row || !row.chain || row.chain.hash !== position.hash) return false;
    const count = await db(companyId, AUDIT_LOGS, [{ 'chain.seq': { $gt: start.seq, $lte: position.seq } }], 'countDocuments');
    return count === position.seq - start.seq;
};

const headBreak = async (companyId, key, start, last, head) => {
    if (!head) return null;
    if (!rules.macMatches(key, 'head', companyId, head) || head.seq > last.seq) return last.seq + 1;
    if (head.seq <= start.seq) return null;
    const hash = head.seq === last.seq
        ? last.hash
        : ((plain(await db(companyId, AUDIT_LOGS, [{ 'chain.seq': head.seq }], 'findOne')) || {}).chain || {}).hash;
    return hash === head.hash ? null : head.seq;
};

const walkFrom = async (companyId, key, from, { budget, pageSize, until = Infinity }) => {
    let last = from;
    let checked = 0;
    while (checked < budget && last.seq < until) {
        const want = Math.min(pageSize, budget - checked);
        const range = until === Infinity ? { $gt: last.seq } : { $gt: last.seq, $lte: until };
        const rows = ((await db(companyId, AUDIT_LOGS, [{ 'chain.seq': range }, {}, { sort: { 'chain.seq': 1 }, limit: want }], 'find')) || []).map(plain);
        const step = rules.walkLinks(key, companyId, last, rows);
        checked += rows.length;
        last = step.last;
        if (step.brokenAt != null) return { last, checked, brokenAt: step.brokenAt, complete: false };
        if (rows.length < want) {
            return { last, checked, brokenAt: until !== Infinity && last.seq < until ? last.seq + 1 : null, complete: true };
        }
    }
    return { last, checked, brokenAt: null, complete: last.seq >= until };
};

const report = (start, last, complete, brokenAt, checked) => ({
    state: brokenAt != null ? 'broken' : (complete ? 'verified' : 'partial'),
    brokenAt,
    verifiedThrough: brokenAt != null ? Math.min(brokenAt - 1, last.seq) : last.seq,
    anchorSeq: start.seq,
    checked,
});

/*
 * Resuming keeps two positions per company in memory: the tip, verified once and then only extended, so new
 * rows cost one step each; and a re-walk that re-checks the stretch up to the tip a budget at a time, starting
 * over each time it reaches it. Nothing held in the database can move either of them.
 */
const walk = async (companyId, key, { budget, pageSize, resume }) => {
    const [companyHead, globalHead] = await Promise.all([readHead(companyId), readHead(companyId, GOLBAL)]);
    const anchor = await newestAnchor(companyId, key);
    const start = anchor || rules.GENESIS;
    const headsBreak = async (last) => (await headBreak(companyId, key, start, last, companyHead)) || headBreak(companyId, key, start, last, globalHead);

    if (!resume) {
        const full = await walkFrom(companyId, key, start, { budget, pageSize });
        const brokenAt = full.brokenAt != null ? full.brokenAt : (full.complete ? await headsBreak(full.last) : null);
        return report(start, full.last, full.complete, brokenAt, full.checked);
    }

    const saved = cursors.get(companyId);
    const cursor = saved && saved.anchorSeq === start.seq && await positionHolds(companyId, start, saved.tip)
        ? saved
        : { anchorSeq: start.seq, tip: start, rewalk: null };
    const ahead = await walkFrom(companyId, key, cursor.tip, { budget: Math.ceil(budget / 2), pageSize });
    let brokenAt = ahead.brokenAt != null ? ahead.brokenAt : (ahead.complete ? await headsBreak(ahead.last) : null);
    let checked = ahead.checked;
    let rewalk = cursor.rewalk;
    if (brokenAt == null && cursor.tip.seq > start.seq) {
        const again = await walkFrom(companyId, key, rewalk || start, { budget: Math.max(1, budget - checked), pageSize, until: cursor.tip.seq });
        checked += again.checked;
        brokenAt = again.brokenAt;
        rewalk = again.complete ? null : again.last;
    }
    if (brokenAt == null) cursors.set(companyId, { anchorSeq: start.seq, tip: ahead.last, rewalk });
    return report(start, ahead.last, ahead.complete, brokenAt, checked);
};

const verifyChain = async (companyId, { budget = Infinity, pageSize = PAGE_SIZE, resume = false } = {}) => {
    const cfg = config();
    if (!cfg.keyValid) return { state: 'unavailable', brokenAt: null, verifiedThrough: null, anchorSeq: null, checked: 0 };
    const id = String(companyId);
    const report = await walk(id, cfg.key, { budget, pageSize, resume });
    if (report.brokenAt == null) return report;
    const anchor = await newestAnchor(id, cfg.key);
    // A sweep that anchored and deleted while this walk ran looks like a gap at its start.
    return anchor && anchor.seq > report.anchorSeq ? walk(id, cfg.key, { budget, pageSize, resume }) : report;
};

/* The oldest chained row still kept, or the oldest anchor's cutoff once the sweep has taken them all. */
const chainStart = async (companyId) => {
    const [first] = (await db(companyId, AUDIT_LOGS, [{ 'chain.seq': { $gte: 0 } }, { createdAt: 1 }, { sort: { 'chain.seq': 1 }, limit: 1 }], 'find')) || [];
    if (first) return plain(first).createdAt;
    const [anchor] = (await db(companyId, AUDIT_CHAIN_ANCHORS, [{}, {}, { sort: { seq: 1 }, limit: 1 }], 'find')) || [];
    return anchor ? plain(anchor).cutoff || null : null;
};

const annotateIntegrity = async (companyId, entries, { budget = LIST_VERIFY_BUDGET } = {}) => {
    const cfg = config();
    const chainedOnPage = entries.some((e) => rules.isChained(e.row));
    const chainStartedAt = entries.some((e) => !rules.isChained(e.row)) ? await chainStart(companyId) : null;
    if (cfg.keyValid) mirrorSoon(companyId, cfg.key);
    const report = chainedOnPage && cfg.keyValid ? await verifyChain(companyId, { budget, resume: true }) : null;
    return rules.pageIntegrity({ key: cfg.key, companyId: String(companyId), report, chainStartedAt }, entries);
};

const readForList = async (companyId, ids) => {
    if (!ids.length) return [];
    const cfg = config();
    const found = ((await db(companyId, AUDIT_LOGS, [{ _id: { $in: ids.map((id) => new mongoose.Types.ObjectId(String(id))) } }], 'find')) || []).map(plain);
    const byId = new Map(found.map((r) => [String(r._id), r]));
    const rows = ids.map((id) => byId.get(String(id))).filter(Boolean);
    const amendments = await amendmentsFor(companyId, rows);
    const entries = rows.map((row) => ({ row, amendments: amendments.get(String(row._id)) || [] }));
    const integrity = await annotateIntegrity(companyId, entries);
    return entries.map((e, i) => ({ ...rules.applyAmendments(e.row, rules.trustedAmendments(cfg.key, String(companyId), e.amendments)), integrity: integrity[i] }));
};

/*
 * Before a sweep deletes chained rows, record the last one it will delete so verification can start after it.
 * Without the key no anchor can be written, so the chained rows stay and the sweep says so.
 */
const anchorBeforePrune = async (companyId, cutoff) => {
    const cfg = config();
    if (!cfg.keyValid) {
        const kept = await db(companyId, AUDIT_LOGS, [{ 'chain.seq': { $gte: 0 }, createdAt: { $lt: cutoff } }], 'countDocuments');
        if (kept) logger.error(`${LOG} audit prune ${companyId}: kept ${kept} chained rows older than the cutoff, since no anchor can be written without AUDIT_CHAIN_KEY`);
        return null;
    }
    const [row] = (await db(companyId, AUDIT_LOGS, [{ 'chain.seq': { $gte: 0 }, createdAt: { $lt: cutoff } }, { chain: 1 }, { sort: { createdAt: -1, 'chain.seq': -1 }, limit: 1 }], 'find')) || [];
    if (!row) return null;
    const { _id, chain: link } = plain(row);
    const mark = { seq: link.seq, hash: link.hash };
    try {
        await db(companyId, AUDIT_CHAIN_ANCHORS, { ...mark, rowId: String(_id), cutoff, mac: rules.markMac(cfg.key, 'anchor', companyId, mark) }, 'save');
    } catch (error) {
        if (!(error && error.code === 11000)) throw error;
    }
    await advance(companyId, companyId, cfg.key, { ...mark, rowId: _id });
    return mark;
};

/* Chained rows go only up to the anchor, so what stays is an unbroken run after it; with no anchor none go. */
const pruneFilter = (anchor, cutoff) => (anchor
    ? { createdAt: { $lt: cutoff }, $or: [{ 'chain.seq': { $lte: anchor.seq } }, { 'chain.seq': { $exists: false } }] }
    : { createdAt: { $lt: cutoff }, 'chain.seq': { $exists: false } });

module.exports = {
    QUEUE_LIMIT, WRITE_TIMEOUT_MS,
    isOn, config, logBootState, saveAuditRow, amend, foldRows, foldOne, hasAmendments, foldStages,
    verifyChain, annotateIntegrity, readForList, mirrorHead, flushMirrors, anchorBeforePrune, pruneFilter,
};
