#!/usr/bin/env node
/* node scripts/knowledge-compare.js --questions <file> --company <companyId>
 *        [--mode lexical|hybrid|both] [--k 3] [--min-hit 0.8] [--json out.json] [--as <userId|email>] [--allow-dev-db]
 *
 * The held-out comparison of task 030 (Sprint 7, slice 11): asks every question in the owner's
 * private file through Modules/Knowledge's retrieval interface, the one Ask uses, and reports
 * where the expected source ranked, hit@k, MRR@k and any leak of a source an access row's user
 * must not see. The question file never enters the repository; it is read from the path given.
 * Read-only: nothing is written to the database. Exit 0 on PASS, 1 on FAIL, 2 when it cannot run. */
const fs = require('fs');
const path = require('path');

const MODES = ['lexical', 'hybrid'];
const DEFAULTS = { mode: 'both', k: 3, minHit: 0.8, json: null, as: null, allowDevDb: false };
const MAX_K = 50;
const DEV_DB_PORT = 27017;
// Ask reads twelve passages plus up to six more (Modules/AI/ask.js), so a leak anywhere in them reaches the model.
const ASK_WINDOW = 18;
const OBJECT_ID = /^[a-f0-9]{24}$/i;
const HEX_ID = /^[a-f0-9]{6,24}$/i;
const TASK_KEY = /^[a-z][a-z0-9]*-\d+$/i;
const TYPED = /^(page|comment|task|id):(.+)$/i;

const USAGE = 'usage: node scripts/knowledge-compare.js --questions <file> --company <companyId> [--mode lexical|hybrid|both] [--k 3] [--min-hit 0.8] [--json out.json] [--as <userId|email>] [--allow-dev-db]';

const parseArgs = (argv) => {
    const options = { ...DEFAULTS, questions: null, company: null };
    const valued = { '--questions': 'questions', '--company': 'company', '--mode': 'mode', '--k': 'k', '--min-hit': 'minHit', '--json': 'json', '--as': 'as' };
    for (let at = 0; at < argv.length; at += 1) {
        const [flag, inline] = String(argv[at]).split(/=(.*)/s);
        if (flag === '--allow-dev-db') { options.allowDevDb = true; continue; }
        if (!valued[flag]) throw new Error(`unknown option ${flag}`);
        const value = inline !== undefined ? inline : argv[(at += 1)];
        if (value === undefined || value === '') throw new Error(`${flag} needs a value`);
        options[valued[flag]] = value;
    }
    if (!options.questions) throw new Error('--questions <file> is required');
    if (!options.company || !OBJECT_ID.test(options.company)) throw new Error('--company must be the 24-character company id');
    if (![...MODES, 'both'].includes(options.mode)) throw new Error('--mode must be lexical, hybrid or both');
    const k = Number(options.k);
    if (!Number.isInteger(k) || k < 1 || k > MAX_K) throw new Error(`--k must be a whole number from 1 to ${MAX_K}`);
    const minHit = Number(options.minHit);
    if (!Number.isFinite(minHit) || minHit <= 0 || minHit > 1) throw new Error('--min-hit must be a fraction above 0 and at most 1');
    return { ...options, k, minHit };
};

const modesOf = (mode) => (mode === 'both' ? [...MODES] : [mode]);

const typedAlternative = (kind, value) => {
    if (kind === 'task') {
        if (!TASK_KEY.test(value)) throw new Error(`cannot read task key "${value}"`);
        return { taskKey: value.toUpperCase() };
    }
    if (!HEX_ID.test(value)) throw new Error(`cannot read ${kind} id "${value}"`);
    const id = value.toLowerCase();
    if (kind === 'page') return { pageId: id };
    if (kind === 'comment') return { commentId: id };
    return id.length === 24 ? { id } : { idSuffix: id };
};

const readToken = (token) => {
    const typed = token.match(TYPED);
    if (typed) return typedAlternative(typed[1].toLowerCase(), typed[2]);
    if (TASK_KEY.test(token)) return { taskKey: token.toUpperCase() };
    if (OBJECT_ID.test(token)) return { id: token.toLowerCase() };
    if (HEX_ID.test(token)) return { idSuffix: token.toLowerCase() };
    throw new Error(`cannot read "${token}" as a task key, an id or the trailing characters of one`);
};

/* "AP-18 · f4825e79" is a task key and the trailing characters of a comment on it; alternatives
 * are separated by ";", "," or "or", and any one of them counts as the expected source. */
const parseExpected = (text) => {
    const cleaned = String(text == null ? '' : text).replace(/`/g, '').trim();
    if (!cleaned) throw new Error('no expected source');
    return cleaned.split(/\s*[;,]\s*|\s+or\s+/i).filter(Boolean).map((alternative) => {
        const merged = {};
        alternative.split(/[\s·•/]+/).filter(Boolean).forEach((token) => {
            const part = readToken(token);
            Object.keys(part).forEach((key) => {
                if (merged[key] !== undefined) throw new Error(`cannot read "${alternative}": two values for ${key}`);
            });
            Object.assign(merged, part);
        });
        if (!Object.keys(merged).length) throw new Error(`cannot read "${alternative}"`);
        return merged;
    });
};

const expectationOf = (value, asUser) => {
    const raw = String(value == null ? '' : value).trim().toLowerCase();
    if (!raw) return asUser ? 'hidden' : 'found';
    if (['hidden', 'private', 'not returned', 'absent'].includes(raw)) return 'hidden';
    if (['found', 'visible', 'returned'].includes(raw)) return 'found';
    throw new Error(`cannot read the expectation "${value}" (use hidden or visible)`);
};

const cellsOf = (line) => line.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map((cell) => cell.trim());

const columnsOf = (header) => {
    const names = header.map((cell) => cell.replace(/[`*_]/g, '').trim().toLowerCase());
    const find = (test) => names.findIndex(test);
    const columns = {
        n: find((name) => ['#', 'n', 'no', 'no.'].includes(name)),
        question: find((name) => name === 'question'),
        expected: find((name) => name.startsWith('expected')),
        fact: find((name) => name === 'fact'),
        asUser: find((name) => /^as[ _-]?user$/.test(name)),
        expect: find((name) => name === 'expect'),
    };
    return columns.question >= 0 && columns.expected >= 0 ? columns : null;
};

const isSeparator = (cells) => cells.length > 0 && cells.every((cell) => /^:?-{2,}:?$/.test(cell));

const questionFromRow = ({ n, question, expected, fact, asUser, expect }) => {
    const who = asUser ? String(asUser).trim() : '';
    return {
        n: String(n),
        question: String(question).trim(),
        expected: Array.isArray(expected) ? expected : parseExpected(expected),
        fact: fact ? String(fact).trim() : '',
        asUser: who || null,
        expect: expectationOf(expect, who),
    };
};

const parseMarkdown = (text, file) => {
    const questions = [];
    let columns = null;
    let tables = 0;
    text.split(/\r?\n/).forEach((line) => {
        if (!line.trim().startsWith('|')) { columns = null; return; }
        const cells = cellsOf(line);
        if (!columns) {
            columns = columnsOf(cells);
            if (columns) tables += 1;
            return;
        }
        if (isSeparator(cells) || cells.every((cell) => !cell)) return;
        const cell = (index) => (index >= 0 ? cells[index] || '' : '');
        const n = cell(columns.n) || String(questions.length + 1);
        try {
            if (!cell(columns.question)) throw new Error('no question');
            questions.push(questionFromRow({
                n, question: cell(columns.question), expected: cell(columns.expected), fact: cell(columns.fact), asUser: cell(columns.asUser), expect: cell(columns.expect),
            }));
        } catch (error) {
            throw new Error(`${file}: row ${n}: ${error.message}`);
        }
    });
    if (!tables) throw new Error(`${file}: no table with "Question" and "Expected source" columns`);
    return questions;
};

const expectedFromJson = (expected) => {
    if (typeof expected === 'string') return parseExpected(expected);
    const alternatives = Array.isArray(expected) ? expected : [expected];
    if (!alternatives.length || alternatives.some((alt) => !alt)) throw new Error('no expected source');
    return alternatives.flatMap((alt) => {
        if (typeof alt === 'string') return parseExpected(alt);
        const merged = {};
        if (alt.taskKey) Object.assign(merged, typedAlternative('task', String(alt.taskKey)));
        if (alt.commentId) Object.assign(merged, typedAlternative('comment', String(alt.commentId)));
        if (alt.pageId) Object.assign(merged, typedAlternative('page', String(alt.pageId)));
        if (alt.id) Object.assign(merged, typedAlternative('id', String(alt.id)));
        if (!Object.keys(merged).length) throw new Error('no expected source');
        return [merged];
    });
};

const parseJson = (text, file) => {
    let rows;
    try {
        rows = JSON.parse(text);
    } catch (error) {
        throw new Error(`${file}: not valid JSON: ${error.message}`);
    }
    if (!Array.isArray(rows)) throw new Error(`${file}: expected a JSON array of questions`);
    return rows.map((row, at) => {
        const n = row && row.n ? String(row.n) : String(at + 1);
        try {
            if (!row || !String(row.question || '').trim()) throw new Error('no question');
            if (row.expected === undefined || row.expected === null) throw new Error('no expected source');
            return questionFromRow({ n, question: row.question, expected: expectedFromJson(row.expected), fact: row.fact, asUser: row.asUser, expect: row.expect });
        } catch (error) {
            throw new Error(`${file}: question ${n}: ${error.message}`);
        }
    });
};

const parseQuestions = (text, { file = 'questions' } = {}) => {
    const body = String(text || '');
    const questions = /\.json$/i.test(file) || body.trim().startsWith('[') ? parseJson(body, file) : parseMarkdown(body, file);
    if (!questions.length) throw new Error(`${file}: no questions`);
    return questions;
};

const idMatches = (sourceId, wanted) => {
    const id = String(sourceId || '').toLowerCase();
    return wanted.length === 24 ? id === wanted : id.endsWith(wanted);
};

/* A task key alone is the task, or a passage cut from something on it (a file, an indexed comment).
 * With an id beside it, the id decides, and a passage that names its task must name that one. */
const matchesAlternative = (passage, alt, taskIds) => {
    const taskId = alt.taskKey ? taskIds[alt.taskKey] : null;
    const onTask = !taskId || !passage.taskId || String(passage.taskId) === taskId;
    if (alt.pageId) return passage.sourceType === 'page' && idMatches(passage.sourceId, alt.pageId);
    if (alt.commentId) return passage.sourceType === 'comment' && idMatches(passage.sourceId, alt.commentId) && onTask;
    if (alt.id) return idMatches(passage.sourceId, alt.id) && onTask;
    if (alt.idSuffix) return idMatches(passage.sourceId, alt.idSuffix) && onTask;
    return (passage.sourceType === 'task' && String(passage.sourceId) === taskId) || String(passage.taskId || '') === taskId;
};

const rankOf = (passages, expected, taskIds) => {
    const at = passages.findIndex((p) => expected.some((alt) => matchesAlternative(p, alt, taskIds)));
    return at < 0 ? null : at + 1;
};

const passageId = (p) => p.id || `${p.sourceType}:${p.sourceId}`;

const scoreAnswer = ({ passages, backend }, question, taskIds, k) => {
    const rank = rankOf(passages || [], question.expected, taskIds);
    const top = (passages || []).slice(0, k).map(passageId);
    if (question.expect === 'hidden') return { status: rank === null ? 'hidden' : 'leak', rank, rr: 0, backend, top };
    const hit = rank !== null && rank <= k;
    return { status: hit ? 'hit' : 'miss', rank, rr: hit ? 1 / rank : 0, backend, top };
};

const pct = (fraction) => `${Math.round(fraction * 100)}%`;

const summarise = (questions, mode, k, minHit) => {
    const results = questions.map((q) => ({ q, r: q.results[mode] }));
    const findable = results.filter(({ q }) => q.expect === 'found');
    const hits = findable.filter(({ r }) => r.status === 'hit').length;
    const summary = {
        mode,
        found: findable.length,
        hits,
        hitAtK: findable.length ? hits / findable.length : 0,
        mrr: findable.length ? findable.reduce((sum, { r }) => sum + r.rr, 0) / findable.length : 0,
        hidden: results.filter(({ q }) => q.expect === 'hidden').length,
        leaks: results.filter(({ r }) => r.status === 'leak').length,
        errors: results.filter(({ r }) => r.status === 'error').length,
        backends: {},
    };
    results.forEach(({ r }) => { if (r.backend) summary.backends[r.backend] = (summary.backends[r.backend] || 0) + 1; });
    const reasons = [];
    if (summary.leaks) reasons.push(`${mode}: ${summary.leaks} leak(s) of a source the asking user must not see`);
    if (summary.errors) reasons.push(`${mode}: ${summary.errors} question(s) could not be asked`);
    if (!summary.found) reasons.push(`${mode}: no question with a source to find`);
    else if (summary.hitAtK < minHit) reasons.push(`${mode}: hit@${k} ${pct(summary.hitAtK)} is under the ${pct(minHit)} threshold`);
    return { summary: { ...summary, pass: !reasons.length }, reasons };
};

const resolveTaskIds = async (store, question, cache) => {
    const taskIds = {};
    for (const alt of question.expected) {
        if (!alt.taskKey) continue;
        if (!(alt.taskKey in cache)) cache[alt.taskKey] = (await store.taskIdForKey(alt.taskKey)) || null;
        if (!cache[alt.taskKey]) throw new Error(`task key ${alt.taskKey} is not in this company`);
        taskIds[alt.taskKey] = String(cache[alt.taskKey]);
    }
    return taskIds;
};

const callerFor = async (store, question, defaultUser, cache) => {
    if (!question.asUser) return defaultUser;
    if (!(question.asUser in cache)) cache[question.asUser] = (await store.userIdFor(question.asUser)) || null;
    if (!cache[question.asUser]) throw new Error(`user ${question.asUser} not found`);
    return String(cache[question.asUser]);
};

const runComparison = async ({ questions, companyId, modes, k, minHit, retrieve, store, as = null, blockedWrites = () => [] }) => {
    const asUser = as ? await store.userIdFor(as) : await store.ownerOf(companyId);
    if (!asUser) throw new Error(as ? `user ${as} not found` : `company ${companyId} has no owner on record; pass --as <userId|email>`);
    const taskCache = {};
    const userCache = {};
    const scored = [];
    for (const question of questions) {
        const results = {};
        let prepared;
        try {
            prepared = { taskIds: await resolveTaskIds(store, question, taskCache), userId: await callerFor(store, question, String(asUser), userCache) };
        } catch (error) {
            prepared = { error: error.message };
        }
        for (const mode of modes) {
            if (prepared.error) { results[mode] = { status: 'error', rank: null, rr: 0, backend: null, top: [], error: prepared.error }; continue; }
            try {
                const answer = await retrieve({ companyId, caller: { kind: 'user', userId: prepared.userId }, query: question.question, limit: Math.max(k, ASK_WINDOW), mode });
                results[mode] = scoreAnswer(answer || {}, question, prepared.taskIds, k);
            } catch (error) {
                results[mode] = { status: 'error', rank: null, rr: 0, backend: null, top: [], error: (error && error.message) || String(error) };
            }
        }
        scored.push({ ...question, results });
    }
    const summary = {};
    const reasons = [];
    modes.forEach((mode) => {
        const judged = summarise(scored, mode, k, minHit);
        summary[mode] = judged.summary;
        reasons.push(...judged.reasons);
    });
    const blocked = [...(blockedWrites() || [])];
    if (blocked.length) reasons.push(`the read-only guard stopped ${blocked.length} write(s), so the run is not what Ask would do`);
    return {
        companyId, k, minHit, modes, asUser: String(asUser), generatedAt: new Date().toISOString(),
        questions: scored, summary, blockedWrites: blocked, pass: !reasons.length, reasons,
    };
};

const toJson = (result) => ({
    companyId: result.companyId,
    k: result.k,
    minHit: result.minHit,
    modes: result.modes,
    asUser: result.asUser,
    generatedAt: result.generatedAt,
    questions: result.questions.map((q) => ({ n: q.n, question: q.question, fact: q.fact, expect: q.expect, asUser: q.asUser, expected: q.expected, results: q.results })),
    summary: result.summary,
    blockedWrites: result.blockedWrites,
    pass: result.pass,
    reasons: result.reasons,
});

const cellOf = (r, k) => {
    if (r.status === 'hit') return String(r.rank);
    if (r.status === 'miss') return r.rank ? `miss (${r.rank})` : 'miss';
    if (r.status === 'leak') return `LEAK @${r.rank}`;
    if (r.status === 'hidden') return 'hidden';
    return r.status === 'error' ? 'error' : `? (k=${k})`;
};

const pad = (text, width) => {
    const s = String(text);
    return s.length > width ? `${s.slice(0, width - 1)}~` : s.padEnd(width);
};

const formatReport = (result) => {
    const { k, minHit, modes } = result;
    const lines = [
        `Knowledge comparison: company ${result.companyId}, asked as ${result.asUser}, k=${k}, threshold hit@${k} >= ${pct(minHit)}`,
        '',
        [pad('#', 4), pad('Question', 48), pad('Expect', 8), ...modes.map((m) => pad(m, 14))].join(' '),
    ];
    result.questions.forEach((q) => {
        lines.push([pad(q.n, 4), pad(q.question, 48), pad(q.expect, 8), ...modes.map((m) => pad(cellOf(q.results[m], k), 14))].join(' '));
    });
    const errors = result.questions.flatMap((q) => modes.filter((m) => q.results[m].error).map((m) => `  #${q.n} ${m}: ${q.results[m].error}`));
    if (errors.length) lines.push('', 'Errors:', ...[...new Set(errors)]);
    lines.push('');
    modes.forEach((m) => {
        const s = result.summary[m];
        const backends = Object.entries(s.backends).map(([name, n]) => `${name} x${n}`).join(', ') || 'none';
        lines.push(`${pad(m, 8)} hit@${k} ${s.hits}/${s.found} ${pct(s.hitAtK)}  MRR@${k} ${s.mrr.toFixed(3)}  access ${s.hidden - s.leaks}/${s.hidden} hidden  leaks ${s.leaks}  errors ${s.errors}  ${s.pass ? 'PASS' : 'FAIL'}`);
        lines.push(`${pad('', 8)} backends: ${backends}`);
    });
    if (modes.includes('hybrid') && !Object.keys(result.summary.hybrid.backends).some((name) => name.includes('+'))) {
        lines.push('', 'Note: no hybrid question used the vector side (no embedding key, the indexer off, or every embed failed), so hybrid measured lexical.');
    }
    if (result.blockedWrites.length) lines.push('', 'Writes stopped by the read-only guard:', ...result.blockedWrites.map((w) => `  ${w}`));
    lines.push('', result.pass ? `Verdict: PASS (hit@${k} >= ${pct(minHit)} in every mode, no leaks, no errors, nothing written)` : `Verdict: FAIL\n${result.reasons.map((r) => `  - ${r}`).join('\n')}`);
    return lines.join('\n');
};

/* Every host in the string; a host without a port is on 27017. An SRV string names no port. */
const mongoPorts = (url) => {
    const text = String(url || '').trim();
    if (/^mongodb\+srv:\/\//i.test(text)) return [];
    const hosts = text.replace(/^mongodb:\/\//i, '').split('/')[0].split('?')[0].split('@').pop();
    return hosts.split(',').filter(Boolean).map((host) => {
        const port = host.match(/:(\d+)$/);
        return port ? Number(port[1]) : DEV_DB_PORT;
    });
};

const refuseDevDb = (url, allowDevDb) => {
    if (!String(url || '').trim()) throw new Error('MONGODB_URL is not set');
    if (!allowDevDb && mongoPorts(url).includes(DEV_DB_PORT)) {
        throw new Error(`MONGODB_URL points at port ${DEV_DB_PORT}, the local dev database; pass --allow-dev-db to run against it deliberately`);
    }
};

const COLLECTION_WRITES = [
    'insertOne', 'insertMany', 'updateOne', 'updateMany', 'replaceOne', 'deleteOne', 'deleteMany',
    'findOneAndUpdate', 'findOneAndReplace', 'findOneAndDelete', 'bulkWrite',
    'createIndex', 'createIndexes', 'dropIndex', 'dropIndexes', 'drop', 'rename',
];
const BULK_BUILDERS = ['initializeOrderedBulkOp', 'initializeUnorderedBulkOp'];
const DB_WRITES = ['createCollection', 'dropCollection', 'dropDatabase', 'renameCollection', 'createIndex'];

/* Patched on the driver's prototypes, below Mongoose and MongoDbCrudOpration alike, so a write from
 * any path the retrieval takes fails loudly instead of landing in the owner's database. */
const installWriteGuard = ({ Collection, Db }) => {
    const attempts = [];
    const refuse = (label) => new Error(`knowledge-compare is read-only: ${label} refused`);
    const patch = (proto, methods, labelOf, sync) => methods.forEach((method) => {
        if (!proto || typeof proto[method] !== 'function') return;
        proto[method] = function guarded() {
            const label = labelOf(this, method);
            attempts.push(label);
            if (sync) throw refuse(label);
            return Promise.reject(refuse(label));
        };
    });
    const onCollection = (collection, method) => `${method} on ${collection && collection.collectionName}`;
    patch(Collection && Collection.prototype, COLLECTION_WRITES, onCollection, false);
    patch(Collection && Collection.prototype, BULK_BUILDERS, onCollection, true);
    patch(Db && Db.prototype, DB_WRITES, (db, method) => method, false);
    return { attempts: () => [...attempts] };
};

/* The app's own modules, with the three side effects a question has turned off: the indexer's
 * heartbeat and stale-chunk resync, and the spend ledger row for embedding the question, which
 * is asked of the embedding adapter directly (about thirty short strings, not booked). */
const connectLive = async ({ companyId }) => {
    const mongoose = require('mongoose');
    mongoose.set('autoIndex', false);
    mongoose.set('autoCreate', false);
    const guard = installWriteGuard(mongoose.mongo);

    const { SCHEMA_TYPE } = require('../Config/schemaType');
    const { MongoDbCrudOpration } = require('../utils/mongo-handler/mongoQueries');
    const { escapeRegex } = require('../utils/escapeRegex');
    const flag = require('../Modules/Knowledge/flag');
    const events = require('../Modules/Knowledge/ingest/events');
    const embeddings = require('../Modules/Knowledge/embeddings');
    const registry = require('../Modules/AICore/llmProvider/registry');
    const providerContext = require('../Modules/AICore/providerContext');
    const { retrieve } = require('../Modules/Knowledge/retrieval');
    const { connections } = require('../middlewares/mongoConnector/helper');

    events.keepAlive = () => {};
    events.requestSync = () => {};
    embeddings.embedQuery = async (companyId, query) => {
        const model = embeddings.model();
        const result = await providerContext.run({ companyId: String(companyId) }, () => registry.ADAPTERS.openai.embed({ texts: [String(query)], model, timeoutMs: embeddings.queryTimeoutMs() }));
        return { vector: (result.embeddings || [])[0] || [], model };
    };

    const findOne = (db, type, filter, projection) => MongoDbCrudOpration(db, { type, data: [filter, projection, { lean: true }] }, 'findOne');
    const store = {
        ownerOf: async () => {
            const company = await findOne(SCHEMA_TYPE.GOLBAL, SCHEMA_TYPE.COMPANIES, { _id: new mongoose.Types.ObjectId(companyId) }, 'userId');
            return company && company.userId ? String(company.userId) : null;
        },
        userIdFor: async (who) => {
            if (OBJECT_ID.test(String(who))) return String(who).toLowerCase();
            const user = await findOne(SCHEMA_TYPE.GOLBAL, SCHEMA_TYPE.USERS, { Employee_Email: { $regex: `^${escapeRegex(String(who).trim())}$`, $options: 'i' } }, '_id');
            return user ? String(user._id) : null;
        },
        taskIdForKey: async (key) => {
            const task = await findOne(companyId, SCHEMA_TYPE.TASKS, { TaskKey: key, deletedStatusKey: { $ne: 1 } }, '_id');
            return task ? String(task._id) : null;
        },
    };

    return {
        store,
        retrieve: async ({ mode, ...request }) => {
            flag.hybridFor = async () => mode === 'hybrid';
            return retrieve(request);
        },
        blockedWrites: guard.attempts,
        close: async () => { await Promise.all(connections.map((c) => c.connection && c.connection.close().catch(() => {}))); },
    };
};

const main = async (argv, { env = process.env, connect = connectLive, log = console.log, error = console.error } = {}) => {
    let options;
    let questions;
    try {
        options = parseArgs(argv);
        refuseDevDb(env.MONGODB_URL, options.allowDevDb);
        const file = path.resolve(options.questions);
        questions = parseQuestions(fs.readFileSync(file, 'utf8'), { file: path.basename(file) });
    } catch (e) {
        error(`knowledge-compare: ${e.message}\n${USAGE}`);
        return 2;
    }
    let deps;
    try {
        deps = await connect({ companyId: options.company });
        const result = await runComparison({
            questions, companyId: options.company, modes: modesOf(options.mode), k: options.k, minHit: options.minHit,
            retrieve: deps.retrieve, store: deps.store, as: options.as, blockedWrites: deps.blockedWrites,
        });
        log(formatReport(result));
        if (options.json) {
            fs.writeFileSync(path.resolve(options.json), `${JSON.stringify(toJson(result), null, 2)}\n`, { mode: 0o600 });
            log(`\nJSON written to ${options.json}`);
        }
        return result.pass ? 0 : 1;
    } catch (e) {
        error(`knowledge-compare: ${e.message}`);
        return 2;
    } finally {
        if (deps && deps.close) await deps.close();
    }
};

module.exports = {
    ASK_WINDOW, parseArgs, parseExpected, parseQuestions, runComparison, formatReport, toJson, mongoPorts, refuseDevDb, installWriteGuard, main,
};

if (require.main === module) {
    const major = Number(process.versions.node.split('.')[0]);
    if (major < 20) {
        console.error(`knowledge-compare needs Node 20 or later (this is ${process.version})`);
        process.exit(2);
    }
    require('../Config/applyEnv').loadDotEnv(path.join(__dirname, '..', '.env'));
    main(process.argv.slice(2)).then((code) => process.exit(code));
}
