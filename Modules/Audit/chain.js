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
const CHECKPOINT_TTL_MS = 10 * 60 * 1000;
const MIRROR_INTERVAL_MS = 60 * 1000;
const ERROR_LOG_INTERVAL_MS = 60 * 1000;
const APPEND_ATTEMPTS = 100;
const ANCHOR_LOOKBACK = 20;

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

/* Appends from one process queue per company, so the unique index only arbitrates between servers. */
const serially = (companyId, fn) => {
    const id = String(companyId);
    const run = (tails.get(id) || Promise.resolve()).then(fn);
    const settled = run.then(() => {}, () => {});
    tails.set(id, settled);
    settled.then(() => { if (tails.get(id) === settled) tails.delete(id); });
    return run;
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

const mirroredAt = new Map();

const quietly = (what, promise) => promise.catch((error) => logger.error(`${LOG} ${what}: ${(error && error.message) || error}`));

const mirrorAtMostOncePerInterval = (companyId, key, mark = null) => {
    const id = String(companyId);
    if (Date.now() - (mirroredAt.get(id) || 0) < MIRROR_INTERVAL_MS) return;
    mirroredAt.set(id, Date.now());
    quietly(`mirror ${id}`, mirrorHead(id, key, mark));
};

const newestChained = async (companyId) => {
    const [row] = (await db(companyId, AUDIT_LOGS, [{ 'chain.seq': { $type: 'number' } }, { chain: 1 }, { sort: { 'chain.seq': -1 }, limit: 1 }], 'find')) || [];
    return row ? plain(row).chain : null;
};

/* The newest row, unless the head is further on: after a sweep took every row, or after the newest rows went missing. */
const tipOf = async (companyId, key) => {
    const [row, head] = await Promise.all([newestChained(companyId), readHead(companyId)]);
    const mark = trusted(key, 'head', companyId, head);
    if (row && (!mark || row.seq >= mark.seq)) return { seq: row.seq, hash: row.hash };
    return mark || rules.GENESIS;
};

const appendOnce = async (companyId, key, entry) => {
    const tip = await tipOf(companyId, key);
    const row = rules.clean({ ...entry, _id: new mongoose.Types.ObjectId(), createdAt: new Date() });
    row.chain = { seq: tip.seq + 1, prevHash: tip.hash };
    row.chain.hash = rules.rowHash(key, companyId, row, tip.hash);
    const saved = await db(companyId, AUDIT_LOGS, row, 'save');
    const mark = { seq: row.chain.seq, hash: row.chain.hash, rowId: String(row._id) };
    await quietly(`head ${companyId}`, advance(companyId, companyId, key, mark));
    mirrorAtMostOncePerInterval(companyId, key, mark);
    return saved;
};

/* The insert is the reservation: a sequence number exists only once its row does, so a failed write leaves no gap. */
const append = (companyId, key, entry) => serially(companyId, async () => {
    for (let attempt = 1; ; attempt += 1) {
        try {
            return await appendOnce(companyId, key, entry);
        } catch (error) {
            if (!isSeqConflict(error) || attempt >= APPEND_ATTEMPTS) throw error;
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

const amend = async (companyId, auditId, $set) => {
    const cfg = config();
    if (!cfg.on) throw new Error('the audit chain is off');
    const filter = rowFilter(auditId);
    if (!filter) throw new Error(`invalid audit id ${auditId}`);
    const original = plain(await db(companyId, AUDIT_LOGS, [filter], 'findOne'));
    if (!original) throw new Error(`audit row ${auditId} not found`);
    return append(companyId, cfg.key, rules.amendmentOf(original, $set));
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

/* Rows with no appended changes come back as they were read. */
const foldRows = async (companyId, rows) => {
    const list = rows || [];
    const byRow = await amendmentsFor(companyId, list);
    return list.map((row) => {
        const amendments = row && byRow.get(String(row._id));
        return amendments ? rules.applyAmendments(plain(row), amendments) : row;
    });
};

const foldOne = async (companyId, row) => (row ? (await foldRows(companyId, [row]))[0] : row);

const hasAmendments = async (companyId) => Boolean(await db(companyId, AUDIT_LOGS, [{ action: rules.AMENDED_ACTION }, { _id: 1 }], 'findOne'));

/* The same fold as applyAmendments, for filters that must see the current state before paging. */
const foldStages = () => {
    const rowField = (field) => ({ $reduce: { input: '$_amendments', initialValue: `$${field}`, in: { $ifNull: [`$$this.meta.setRow.${field}`, '$$value'] } } });
    return [
        { $set: { _auditId: { $toString: '$_id' } } },
        { $lookup: { from: dbCollections.AUDIT_LOGS, localField: '_auditId', foreignField: 'meta.amends', as: '_amendments', pipeline: [{ $match: { action: rules.AMENDED_ACTION } }] } },
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

const checkpoints = new Map();

/* An in-memory checkpoint is trusted only while the row it names is unchanged and nothing below it is missing. */
const checkpointHolds = async (companyId, start, point) => {
    const row = plain(await db(companyId, AUDIT_LOGS, [{ 'chain.seq': point.seq }], 'findOne'));
    if (!row || !row.chain || row.chain.hash !== point.hash) return false;
    const count = await db(companyId, AUDIT_LOGS, [{ 'chain.seq': { $gt: start.seq, $lte: point.seq } }], 'countDocuments');
    return count === point.seq - start.seq;
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

const walk = async (companyId, key, { budget, pageSize, resume }) => {
    const [companyHead, globalHead] = await Promise.all([readHead(companyId), readHead(companyId, GOLBAL)]);
    const anchor = await newestAnchor(companyId, key);
    const start = anchor || rules.GENESIS;
    let last = start;
    let point = null;
    if (resume) {
        const saved = checkpoints.get(companyId);
        if (saved && saved.anchorSeq === start.seq && Date.now() - saved.at < CHECKPOINT_TTL_MS && await checkpointHolds(companyId, start, saved)) {
            point = saved;
            last = { seq: saved.seq, hash: saved.hash };
        }
    }
    let checked = 0;
    let brokenAt = null;
    let complete = false;
    while (checked < budget) {
        const want = Math.min(pageSize, budget - checked);
        const rows = ((await db(companyId, AUDIT_LOGS, [{ 'chain.seq': { $gt: last.seq } }, {}, { sort: { 'chain.seq': 1 }, limit: want }], 'find')) || []).map(plain);
        const step = rules.walkLinks(key, companyId, last, rows);
        checked += rows.length;
        last = step.last;
        if (step.brokenAt != null) { brokenAt = step.brokenAt; break; }
        if (rows.length < want) { complete = true; break; }
    }
    if (complete) {
        brokenAt = await headBreak(companyId, key, start, last, companyHead) || await headBreak(companyId, key, start, last, globalHead);
    }
    if (brokenAt == null && last.seq > start.seq && resume) {
        checkpoints.set(companyId, { seq: last.seq, hash: last.hash, anchorSeq: start.seq, at: point ? point.at : Date.now() });
    }
    return {
        state: brokenAt != null ? 'broken' : (complete ? 'verified' : 'partial'),
        brokenAt,
        verifiedThrough: brokenAt != null ? Math.min(brokenAt - 1, last.seq) : last.seq,
        anchorSeq: start.seq,
        checked,
    };
};

/* Verifies a company's chain from its newest anchor, a page at a time, up to `budget` rows. */
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

const annotateIntegrity = async (companyId, entries) => {
    if (!entries.some((e) => rules.isChained(e.row))) return entries.map(() => ({ state: rules.INTEGRITY.UNCHAINED }));
    const cfg = config();
    if (cfg.keyValid) mirrorAtMostOncePerInterval(companyId, cfg.key);
    const report = cfg.keyValid ? await verifyChain(companyId, { budget: LIST_VERIFY_BUDGET, resume: true }) : null;
    return rules.pageIntegrity({ key: cfg.key, companyId: String(companyId), report }, entries);
};

/* Reads rows by id in the given order, with their integrity, folded to their current state. */
const readForList = async (companyId, ids) => {
    if (!ids.length) return [];
    const found = ((await db(companyId, AUDIT_LOGS, [{ _id: { $in: ids.map((id) => new mongoose.Types.ObjectId(String(id))) } }], 'find')) || []).map(plain);
    const byId = new Map(found.map((r) => [String(r._id), r]));
    const rows = ids.map((id) => byId.get(String(id))).filter(Boolean);
    const amendments = await amendmentsFor(companyId, rows);
    const entries = rows.map((row) => ({ row, amendments: amendments.get(String(row._id)) || [] }));
    const integrity = await annotateIntegrity(companyId, entries);
    return entries.map((e, i) => ({ ...rules.applyAmendments(e.row, e.amendments), integrity: integrity[i] }));
};

/* Before a sweep deletes chained rows, record the last one it will delete so verification can start after it. */
const anchorBeforePrune = async (companyId, cutoff) => {
    const cfg = config();
    if (!cfg.keyValid) return null;
    const [row] = (await db(companyId, AUDIT_LOGS, [{ 'chain.seq': { $type: 'number' }, createdAt: { $lt: cutoff } }, { chain: 1 }, { sort: { createdAt: -1, 'chain.seq': -1 }, limit: 1 }], 'find')) || [];
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

/* Chained rows go only up to the anchor, so what stays is an unbroken run after it. */
const pruneFilter = (anchor, cutoff) => (anchor
    ? { createdAt: { $lt: cutoff }, $or: [{ 'chain.seq': { $lte: anchor.seq } }, { 'chain.seq': { $exists: false } }] }
    : { createdAt: { $lt: cutoff } });

module.exports = {
    isOn, config, logBootState, saveAuditRow, amend, foldRows, foldOne, hasAmendments, foldStages,
    verifyChain, annotateIntegrity, readForList, mirrorHead, anchorBeforePrune, pruneFilter,
};
