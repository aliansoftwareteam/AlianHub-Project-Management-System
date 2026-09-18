const crypto = require('crypto');
const mongoose = require('mongoose');
const { SCHEMA_TYPE } = require('../../Config/schemaType');
const { MongoDbCrudOpration } = require('../../utils/mongo-handler/mongoQueries');

// A run is tainted once its context has taken in content from outside the
// workspace's own members: a fetched page, an email-in body, a form submission,
// a webhook payload, uploaded file text or a retrieved passage whose origin is
// external. The run keeps only where the content came from (a host, an id or a
// hash), never the content, and under AGENT_TAINT_ROUTING the policy proposes
// its risky writes instead of acting on them (docs/AI-PLATFORM-ARCHITECTURE.md §G).
//
// Origin contract for retrieval passages: `origin: 'member' | 'agent' | 'external'`.
// A passage without the field is not external.

const KINDS = Object.freeze({ FETCH: 'fetch', EMAIL: 'email', FORM: 'form', WEBHOOK: 'webhook', FILE: 'file', PASSAGE: 'passage' });
const KIND_LIST = Object.freeze(Object.values(KINDS));
const ORIGIN = Object.freeze({ MEMBER: 'member', AGENT: 'agent', EXTERNAL: 'external' });
const TASK_ORIGIN_KINDS = Object.freeze([KINDS.EMAIL, KINDS.FORM, KINDS.WEBHOOK]);
const MAX_REF = 200;
const MAX_SOURCES = 50;

const enabled = () => /^(true|on|1)$/i.test(String(process.env.AGENT_TAINT_ROUTING || '').trim());

const oid = (id) => { try { return new mongoose.Types.ObjectId(String(id)); } catch (e) { return null; } };
const plain = (doc) => (doc && typeof doc.toObject === 'function' ? doc.toObject() : doc);

const hashed = (value) => crypto.createHash('sha256').update(String(value)).digest('hex').slice(0, 16);

const source = (kind, ref) => {
    const key = String(kind || '');
    const text = ref === undefined || ref === null ? '' : String(ref).trim();
    if (!KIND_LIST.includes(key) || !text) return null;
    return { kind: key, ref: text.slice(0, MAX_REF), at: new Date() };
};

const hostOf = (url) => { try { return new URL(String(url)).hostname.toLowerCase(); } catch (e) { return ''; } };

const fetched = (url) => source(KINDS.FETCH, hostOf(url));
const file = (fileId) => source(KINDS.FILE, fileId);

const fromTask = (task) => {
    const origin = task && task.origin;
    if (!origin || !TASK_ORIGIN_KINDS.includes(String(origin.kind))) return [];
    const found = source(origin.kind, origin.ref);
    return found ? [found] : [];
};

const passageRef = (p) => p.chunkId || p.id || p._id || p.sourceId;
const fromPassages = (passages) => (Array.isArray(passages) ? passages : [])
    .filter((p) => p && p.origin === ORIGIN.EXTERNAL)
    .map((p) => source(KINDS.PASSAGE, passageRef(p)))
    .filter(Boolean);

/* What a gathered context reports: readers name their external sources under
 * `taint`, and retrieved passages carry the origin contract above. */
const fromContext = (context) => {
    const declared = context && Array.isArray(context.taint) ? context.taint : [];
    return [...declared.map((s) => source(s && s.kind, s && s.ref)).filter(Boolean), ...fromPassages(context && context.passages)];
};

const isTainted = (run) => Boolean(run && run.tainted);
const sourcesOf = (run) => (run && Array.isArray(run.taintSources) ? run.taintSources : []);
const routes = (run) => enabled() && isTainted(run);

const merge = (existing, added) => {
    const seen = new Set(existing.map((s) => `${s.kind}:${s.ref}`));
    const out = [...existing];
    added.forEach((s) => {
        const key = `${s.kind}:${s.ref}`;
        if (!s || seen.has(key) || out.length >= MAX_SOURCES) return;
        seen.add(key);
        out.push(s);
    });
    return out;
};

const describe = (sources) => `the run read external content (${sources.map((s) => `${s.kind} ${s.ref}`).join(', ')})`;
const reasonFor = (run) => describe(sourcesOf(run));

/* A rule-triggered run holds a trimmed task; the origin is read from the row then. */
const originOf = async (companyId, task) => {
    if (task && task.origin) return task.origin;
    if (!enabled() || !task || !oid(task._id)) return null;
    const row = await MongoDbCrudOpration(companyId, { type: SCHEMA_TYPE.TASKS, data: [{ _id: oid(task._id) }, { origin: 1 }] }, 'findOne').catch(() => null);
    return row && row.origin ? plain(row).origin : null;
};

/* Writes the taint onto the run row and returns the run as it now reads. A
 * source already on the run is not written again. */
const mark = async (companyId, run, sources) => {
    const added = (sources || []).filter(Boolean);
    if (!enabled() || !added.length) return run;
    const merged = merge(sourcesOf(run), added);
    if (isTainted(run) && merged.length === sourcesOf(run).length) return run;
    const updated = await require('./runs').patch(companyId, run._id, { tainted: true, taintSources: merged });
    return updated ? plain(updated) : { ...run, tainted: true, taintSources: merged };
};

/* The marker as replay rows, audit rows and the spend context carry it: nothing when the run is clean. */
const record = (run) => (isTainted(run) ? { tainted: true, taintSources: sourcesOf(run).map(({ kind, ref, at }) => ({ kind, ref, at })) } : null);

const forProposal = (run) => (isTainted(run) ? { sources: sourcesOf(run).map(({ kind, ref, at }) => ({ kind, ref, at })), reason: reasonFor(run) } : null);

module.exports = { KINDS, KIND_LIST, ORIGIN, TASK_ORIGIN_KINDS, enabled, hashed, source, fetched, file, fromTask, fromPassages, fromContext, isTainted, sourcesOf, routes, merge, describe, reasonFor, originOf, mark, record, forProposal };
