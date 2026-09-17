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
const COUNT_WINDOW = 5000;
const MIRROR_INTERVAL_MS = 5 * 1000;
const SHUTDOWN_FLUSH_MS = 3 * 1000;
const INDEX_RETRY_MS = 5 * 60 * 1000;
const ERROR_LOG_INTERVAL_MS = 60 * 1000;
const HISTORY_RECHECK_MS = 5 * 60 * 1000;
const APPEND_ATTEMPTS = 20;
const ANCHOR_LOOKBACK = 20;
const QUEUE_LIMIT = 1000;
const WRITE_TIMEOUT_MS = 15 * 1000;
const INDEX_CONFLICT_CODES = [85, 86];

const { AUDIT_LOGS, AUDIT_CHAIN_HEADS, AUDIT_CHAIN_ANCHORS, GOLBAL } = SCHEMA_TYPE;

const db = (database, type, data, method) => MongoDbCrudOpration(String(database), { type, data }, method);
const plain = (doc) => (doc && typeof doc.toObject === 'function' ? doc.toObject() : doc);
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const quietly = (what, promise) => promise.catch((error) => logger.error(`${LOG} ${what}: ${(error && error.message) || error}`));

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

/* The newest row each company's chain has in this process: what it mirrors, and a floor for the next sequence number. */
const written = new Map();
const histories = new Map();

/* The global copy is what makes truncating the newest rows detectable, so it comes from what this process wrote. */
const mirrorHead = async (companyId, key = config().key, mark = null) => {
    if (!key) return;
    const id = String(companyId);
    const source = mark || written.get(id) || trusted(key, 'head', id, await readHead(id));
    if (source) await advance(GOLBAL, id, key, source);
};

const mirrors = new Map();

/* At most one global write every five seconds per company, and the newest head always lands by the end of that window. */
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
        quietly(`mirror ${id}`, mirrorHead(id, slot.key, written.get(id)));
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
        return quietly(`mirror ${id}`, mirrorHead(id, slot.key, written.get(id)));
    }));
};

/*
 * A crash can still lose the last window's mirror; a graceful stop or a fatal error flushes it first. The signal
 * then carries on as it would have without this listener.
 */
const installShutdownFlush = ({ onSignal = (signal) => process.kill(process.pid, signal) } = {}) => {
    const listeners = ['SIGTERM', 'SIGINT'].map((signal) => {
        const listener = () => {
            Promise.race([flushMirrors(), sleep(SHUTDOWN_FLUSH_MS)]).finally(() => onSignal(signal));
        };
        process.once(signal, listener);
        return [signal, listener];
    });
    const removeFatal = require('../../Config/processGuards').onFatal('audit-chain-mirror', () => flushMirrors());
    return () => {
        listeners.forEach(([signal, listener]) => process.removeListener(signal, listener));
        removeFatal();
    };
};

const newestChained = async (companyId) => {
    const [row] = (await db(companyId, AUDIT_LOGS, [{ 'chain.seq': { $gte: 0 } }, { chain: 1 }, { sort: { 'chain.seq': -1 }, limit: 1 }], 'find')) || [];
    return row ? plain(row).chain : null;
};

/* The furthest of the newest row, both heads and what this process wrote, so missing rows never hand out a used number. */
const tipOf = async (companyId, key) => {
    const id = String(companyId);
    const [row, head, mirrored] = await Promise.all([newestChained(id), readHead(id), readHead(id, GOLBAL)]);
    const candidates = [row && { seq: row.seq, hash: row.hash }, trusted(key, 'head', id, head), trusted(key, 'head', id, mirrored), written.get(id)].filter(Boolean);
    return candidates.reduce((best, mark) => (mark.seq > best.seq ? mark : best), rules.GENESIS);
};

const indexes = new Map();

/*
 * Builds only the chain's own indexes, and waits for them, since Mongoose builds in the background and two
 * servers could both write seq 1 first. An existing index that conflicts leaves the company unchained rather
 * than failing every audited action; it is never dropped here, and the build is tried again every few minutes.
 */
const chainIndexesReady = async (companyId) => {
    const id = String(companyId);
    const cached = indexes.get(id);
    if (!cached || (cached.conflict && Date.now() - cached.at >= INDEX_RETRY_MS)) {
        const build = { at: Date.now(), conflict: false };
        build.promise = (async () => {
            for (const [keys, options] of rules.CHAIN_INDEXES) {
                try {
                    await db(id, AUDIT_LOGS, [{ ...keys }, { ...options }], 'createIndex');
                } catch (error) {
                    if (!INDEX_CONFLICT_CODES.includes(error && error.code)) throw error;
                    build.conflict = true;
                    logger.error(`${LOG} company ${id} stays unchained: its ${options.name} index conflicts with an existing index (${error.message}). Drop or rename that index to chain this company's audit rows.`);
                    return false;
                }
            }
            return true;
        })();
        indexes.set(id, build);
    }
    try {
        return await withTimeout(indexes.get(id).promise, `building the audit chain indexes for company ${id}`);
    } catch (error) {
        indexes.delete(id);
        throw error;
    }
};

const afterWrite = async (companyId, key, link, rowId) => {
    const id = String(companyId);
    const mark = { seq: link.seq, hash: link.hash, rowId: String(rowId) };
    const previous = written.get(id);
    if (!previous || previous.seq < mark.seq) written.set(id, mark);
    histories.set(id, { value: true, at: Date.now() });
    await quietly(`head ${id}`, advance(id, id, key, mark));
    mirrorSoon(id, key, mark);
};

const appendOnce = async (companyId, key, entry, createdAt, _id) => {
    const tip = await tipOf(companyId, key);
    const row = rules.clean({ ...entry, _id, createdAt });
    row.chain = { seq: tip.seq + 1, prevHash: tip.hash };
    row.chain.hash = rules.rowHash(key, companyId, row, tip.hash);
    const saved = await db(companyId, AUDIT_LOGS, row, 'save');
    await afterWrite(companyId, key, row.chain, _id);
    return saved;
};

/* A write that failed or timed out may still have landed; if it did, it is written, and is not written again. */
const landed = async (companyId, key, _id) => {
    try {
        const row = plain(await withTimeout(db(companyId, AUDIT_LOGS, [{ _id }], 'findOne'), 'checking whether an audit write landed'));
        if (!rules.isChained(row)) return null;
        await afterWrite(companyId, key, row.chain, _id);
        return row;
    } catch (error) {
        return null;
    }
};

/* A write reported as failed that lands later is marked abandoned, so it never reads as pending work. */
const abandonIfItLands = (companyId, attempt, entry) => {
    attempt.then((saved) => {
        const row = plain(saved);
        const $set = { 'meta.abandoned': true };
        if (row.meta && row.meta.state === 'pending') Object.assign($set, { 'meta.state': 'failed', 'meta.failed': 'abandoned: the audit write landed after it was reported failed', 'meta.undoable': false });
        return amend(companyId, String(row._id), $set);
    }, () => null).catch((error) => logger.error(`${LOG} a late ${entry.action} row in company ${companyId} could not be marked abandoned: ${error.message}`));
};

/* The insert is the reservation: a sequence number exists only once its row does, so a failed write leaves no gap. */
const append = (companyId, key, entry, createdAt = new Date()) => serially(companyId, async () => {
    for (let attempt = 1; ; attempt += 1) {
        const _id = new mongoose.Types.ObjectId();
        const write = appendOnce(companyId, key, entry, createdAt, _id);
        try {
            return await withTimeout(write, 'an audit write');
        } catch (error) {
            if (!isSeqConflict(error)) {
                const row = await landed(companyId, key, _id);
                if (row) return row;
                abandonIfItLands(companyId, write, entry);
                throw error;
            }
            if (attempt >= APPEND_ATTEMPTS) {
                throw new Error(`${LOG} the ${entry.action} row was not written for company ${companyId} after ${APPEND_ATTEMPTS} sequence conflicts`);
            }
            await sleep(Math.floor(Math.random() * Math.min(50, attempt * 5)));
        }
    }
});

const saveUnchained = (companyId, entry) => MongoDbCrudOpration(companyId, { type: AUDIT_LOGS, data: entry }, 'save');

const saveAuditRow = async (companyId, entry) => {
    const cfg = config();
    if (!cfg.on) return saveUnchained(companyId, entry);
    const createdAt = new Date();
    if (!(await chainIndexesReady(companyId))) return saveUnchained(companyId, entry);
    return append(companyId, cfg.key, entry, createdAt);
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
    if (!(await chainIndexesReady(companyId))) {
        if (rules.isChained(original)) throw new Error(`audit row ${auditId} is chained, and company ${companyId} cannot append to its chain`);
        const r = await db(companyId, AUDIT_LOGS, [{ ...filter, chain: { $exists: false } }, { $set }], 'updateOne');
        if (!r || !(r.matchedCount > 0 || r.modifiedCount > 0)) throw Object.assign(new Error(`audit row ${auditId} not found`), { notFound: true });
        return null;
    }
    return append(companyId, cfg.key, rules.amendmentOf(original, $set), createdAt);
};

/* Whether a change to this row can be recorded now: a chained row needs the key and the chain's indexes. */
const canRecordChange = async (companyId, row) => {
    const cfg = config();
    const chained = rules.isChained(row);
    if (!chained && !cfg.on) return true;
    if (!cfg.keyValid) return !chained;
    try {
        return (await chainIndexesReady(companyId)) || !chained;
    } catch (error) {
        return false;
    }
};

/* A company that has ever had a chained row keeps reading its appended changes, whatever AUDIT_CHAIN says now. */
const hasChainHistory = async (companyId) => {
    const id = String(companyId);
    const cached = histories.get(id);
    if (cached && (cached.value || Date.now() - cached.at < HISTORY_RECHECK_MS)) return cached.value;
    const [head, row] = await Promise.all([readHead(id), db(id, AUDIT_LOGS, [{ 'chain.seq': { $gte: 0 } }, { _id: 1 }], 'findOne')]);
    const value = Boolean(head || row);
    histories.set(id, { value, at: Date.now() });
    return value;
};

const folding = async (companyId) => config().on || hasChainHistory(companyId);

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

/* Rows with no trusted appended changes come back as they were read; a company with no chained history reads nothing more. */
const foldRows = async (companyId, rows) => {
    if (!rows || !rows.length || !(await folding(companyId))) return rows;
    const id = String(companyId);
    const { key } = config();
    const byRow = await amendmentsFor(id, rows);
    return rows.map((row) => {
        const amendments = row && rules.trustedAmendments(key, id, byRow.get(String(row._id)) || []);
        return amendments && amendments.length ? rules.applyAmendments(plain(row), amendments) : row;
    });
};

const foldOne = async (companyId, row) => (row ? (await foldRows(companyId, [row]))[0] : row);

const hasAmendments = async (companyId) => Boolean(await db(companyId, AUDIT_LOGS, [{ action: rules.AMENDED_ACTION }, { _id: 1 }], 'findOne'));

/*
 * Marks each row with the chained changes that set a filtered field, so a filter can take rows a change moved
 * into it. The lookup runs in the database, one indexed read per row; the caller re-checks what it returns.
 */
const touchingStages = ({ entityType, entityId, undone, term }) => {
    const or = [];
    if (entityType) or.push({ 'meta.setRow.entityType': entityType });
    if (entityId) or.push({ 'meta.setRow.entityId': entityId });
    if (undone) or.push({ 'meta.set.undoneAt': { $exists: true, $ne: null } });
    if (term) or.push({ 'meta.setRow.entityName': { $regex: term, $options: 'i' } });
    if (!or.length) return [];
    return [
        { $addFields: { _auditId: { $toString: '$_id' } } },
        { $lookup: {
            from: dbCollections.AUDIT_LOGS, localField: '_auditId', foreignField: 'meta.amends', as: '_touching',
            pipeline: [{ $match: { action: rules.AMENDED_ACTION, 'chain.seq': { $gte: 0 }, $or: or } }, { $project: { _id: 1 } }],
        } },
    ];
};

const newestAnchor = async (companyId, key) => {
    const found = (await db(companyId, AUDIT_CHAIN_ANCHORS, [{}, {}, { sort: { seq: -1 }, limit: ANCHOR_LOOKBACK }], 'find')) || [];
    const anchor = found.map(plain).find((a) => rules.macMatches(key, 'anchor', companyId, a));
    return anchor ? { seq: anchor.seq, hash: anchor.hash } : null;
};

const cursors = new Map();

/*
 * A remembered position is trusted only while the row it names is unchanged and nothing is missing from the
 * newest stretch below it; a gap further down is the re-walk's to find.
 */
const positionHolds = async (companyId, start, position, countWindow) => {
    if (!position || position.seq <= start.seq) return false;
    const row = plain(await db(companyId, AUDIT_LOGS, [{ 'chain.seq': position.seq }], 'findOne'));
    if (!row || !row.chain || row.chain.hash !== position.hash) return false;
    const lower = Math.max(start.seq, position.seq - countWindow);
    const count = await db(companyId, AUDIT_LOGS, [{ 'chain.seq': { $gt: lower, $lte: position.seq } }], 'countDocuments');
    return count === position.seq - lower;
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
const walk = async (companyId, key, { budget, pageSize, resume, countWindow }) => {
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
    const cursor = saved && saved.anchorSeq === start.seq && await positionHolds(companyId, start, saved.tip, countWindow)
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

const verifyChain = async (companyId, { budget = Infinity, pageSize = PAGE_SIZE, resume = false, countWindow = COUNT_WINDOW } = {}) => {
    const cfg = config();
    if (!cfg.keyValid) return { state: 'unavailable', brokenAt: null, verifiedThrough: null, anchorSeq: null, checked: 0 };
    const id = String(companyId);
    const found = await walk(id, cfg.key, { budget, pageSize, resume, countWindow });
    if (found.brokenAt == null) return found;
    const anchor = await newestAnchor(id, cfg.key);
    // A sweep that anchored and deleted while this walk ran looks like a gap at its start.
    return anchor && anchor.seq > found.anchorSeq ? walk(id, cfg.key, { budget, pageSize, resume, countWindow }) : found;
};

/* The oldest chained row still kept, or the oldest anchor's cutoff once the sweep has taken them all. */
const chainStart = async (companyId) => {
    const [first] = (await db(companyId, AUDIT_LOGS, [{ 'chain.seq': { $gte: 0 } }, { createdAt: 1 }, { sort: { 'chain.seq': 1 }, limit: 1 }], 'find')) || [];
    if (first) return plain(first).createdAt;
    const [anchor] = (await db(companyId, AUDIT_CHAIN_ANCHORS, [{}, {}, { sort: { seq: 1 }, limit: 1 }], 'find')) || [];
    return anchor ? plain(anchor).cutoff || null : null;
};

const annotateIntegrity = async (companyId, entries, { budget = LIST_VERIFY_BUDGET, countWindow = COUNT_WINDOW } = {}) => {
    const cfg = config();
    const chainedOnPage = entries.some((e) => rules.isChained(e.row));
    const chainStartedAt = entries.some((e) => !rules.isChained(e.row)) ? await chainStart(companyId) : null;
    if (cfg.keyValid) mirrorSoon(companyId, cfg.key, written.get(String(companyId)));
    const found = chainedOnPage && cfg.keyValid ? await verifyChain(companyId, { budget, resume: true, countWindow }) : null;
    return rules.pageIntegrity({ key: cfg.key, companyId: String(companyId), report: found, chainStartedAt }, entries);
};

/* Rows folded from their verified changes, each with its integrity state when asked for. */
const annotateRows = async (companyId, rows, { integrity = false } = {}) => {
    if (!rows || !rows.length || !(await folding(companyId))) return rows || [];
    const id = String(companyId);
    const { key } = config();
    const plainRows = rows.map(plain);
    const amendments = await amendmentsFor(id, plainRows);
    const entries = plainRows.map((row) => ({ row, amendments: amendments.get(String(row._id)) || [] }));
    const states = integrity ? await annotateIntegrity(id, entries) : null;
    return entries.map((e, i) => {
        const folded = rules.applyAmendments(e.row, rules.trustedAmendments(key, id, e.amendments));
        return states ? { ...folded, integrity: states[i] } : folded;
    });
};

const readForList = async (companyId, ids, { integrity = isOn() } = {}) => {
    if (!ids.length) return [];
    const found = ((await db(companyId, AUDIT_LOGS, [{ _id: { $in: ids.map((id) => new mongoose.Types.ObjectId(String(id))) } }], 'find')) || []).map(plain);
    const byId = new Map(found.map((r) => [String(r._id), r]));
    return annotateRows(companyId, ids.map((id) => byId.get(String(id))).filter(Boolean), { integrity });
};

const countKept = (companyId, cutoff) => db(companyId, AUDIT_LOGS, [{ 'chain.seq': { $gte: 0 }, createdAt: { $lt: cutoff } }], 'countDocuments');

const keptMessage = (companyId, kept, because) => `${LOG} audit prune ${companyId}: kept ${kept} chained row${kept === 1 ? '' : 's'} older than the cutoff, because ${because}`;

/* With AUDIT_CHAIN off the sweep deletes no chained row, and says how many it left. */
const reportKeptWhileOff = async (companyId, cutoff) => {
    const kept = await countKept(companyId, cutoff);
    if (kept) logger.warn(keptMessage(companyId, kept, 'AUDIT_CHAIN is off and chained rows are only swept behind an anchor'));
};

/*
 * Before a sweep deletes chained rows, record the last one it will delete so verification can start after it.
 * Without the key no anchor can be written, so the chained rows stay and the sweep says so.
 */
const anchorBeforePrune = async (companyId, cutoff) => {
    const cfg = config();
    if (!cfg.keyValid) {
        const kept = await countKept(companyId, cutoff);
        if (kept) logger.error(keptMessage(companyId, kept, 'no anchor can be written without AUDIT_CHAIN_KEY'));
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
    isOn, config, logBootState, saveAuditRow, amend, canRecordChange, folding, hasChainHistory, foldRows, foldOne, hasAmendments, touchingStages,
    verifyChain, annotateIntegrity, annotateRows, readForList, mirrorHead, flushMirrors, installShutdownFlush, reportKeptWhileOff, anchorBeforePrune, pruneFilter,
};
