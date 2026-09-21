const crypto = require('crypto');
const { AsyncLocalStorage } = require('async_hooks');
const mongoose = require('mongoose');
const { SCHEMA_TYPE } = require('../../Config/schemaType');
const { MongoDbCrudOpration } = require('../../utils/mongo-handler/mongoQueries');

// A run is tainted once its context has taken in content from outside the
// workspace's own members: a fetched page, an email-in body, a form submission,
// a webhook payload, uploaded file text, a retrieved passage whose origin is
// external, or an instruction from an outside client holding an OAuth grant. The run keeps only where the content came from (a host, an id or a
// hash), never the content, and under AGENT_TAINT_ROUTING the policy proposes
// its risky writes instead of acting on them (docs/AI-PLATFORM-ARCHITECTURE.md §G).
//
// Origin contract for retrieval passages: `origin: 'member' | 'agent' | 'external'`.
// A passage without the field is not external.
//
// How content reports itself: every fetch goes through pageAudit.fetchPage, which
// notes its source into the collector of the run phase it happens in; a reader that
// returns rows from outside attaches `taint: [{ kind, ref }]` to its result, which
// the gathered context carries under `gather.<as>`; a skill may put `taint` or
// `passages` on the context itself; and a generic skill that declares an external
// read (EXTERNAL_READS) is marked from the url it read even if it attached nothing.

const KINDS = Object.freeze({ FETCH: 'fetch', EMAIL: 'email', FORM: 'form', WEBHOOK: 'webhook', FILE: 'file', PASSAGE: 'passage', CLIENT: 'client' });
const KIND_LIST = Object.freeze(Object.values(KINDS));
const ORIGIN = Object.freeze({ MEMBER: 'member', AGENT: 'agent', EXTERNAL: 'external' });
const TASK_ORIGIN_KINDS = Object.freeze([KINDS.EMAIL, KINDS.FORM, KINDS.WEBHOOK]);
// Skill inputs and reads that name content from outside the workspace.
const EXTERNAL_READS = Object.freeze(['pr_diff', 'page']);
const MAX_REF = 200;
const MAX_SOURCES = 50;
// An email-in task reaches a rule as task.created, and its origin is read from the stored row.
const EVENT_ORIGINS = Object.freeze({
    'form.submitted': (data) => [KINDS.FORM, data.submissionId || data.formId],
});

const collector = new AsyncLocalStorage();

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

const fromRows = (rows) => merge([], (Array.isArray(rows) ? rows : []).flatMap(fromTask));

/* The origin a domain event carries for the task it is about, when the event itself came from outside. */
const fromEvent = (envelope) => {
    const read = envelope && EVENT_ORIGINS[envelope.type];
    if (!read) return null;
    const [kind, ref] = read(envelope.data || {});
    const found = source(kind, ref);
    return found ? { kind: found.kind, ref: found.ref } : null;
};

/* Runs `fn` with a collector every fetch notes itself into, whatever code made it. */
const collect = async (fn) => {
    const found = [];
    const out = await collector.run(found, fn);
    return { out, found };
};

const note = (found) => {
    const active = collector.getStore();
    if (active && found) active.push(found);
    return found;
};

const passageRef = (p) => p.chunkId || p.id || p._id || p.sourceId;
const fromPassages = (passages) => (Array.isArray(passages) ? passages : [])
    .filter((p) => p && p.origin === ORIGIN.EXTERNAL)
    .map((p) => source(KINDS.PASSAGE, passageRef(p)))
    .filter(Boolean);

const declared = (list) => (Array.isArray(list) ? list : []).map((s) => source(s && s.kind, s && s.ref)).filter(Boolean);

const readsExternal = (skill) => Boolean(skill) && skill.kind === 'generic'
    && [...(Array.isArray(skill.reads) ? skill.reads : []), ...(Array.isArray(skill.inputs) ? skill.inputs : [])].some((key) => EXTERNAL_READS.includes(String(key)));

/* What a gathered context reports: `taint` and `passages` on the context itself,
 * the `taint` of every reader result under `gather`, and, for a generic skill
 * that declares an external read, the url it read when it attached nothing. */
const fromContext = (context, { skill } = {}) => {
    const gathered = context && context.gather && typeof context.gather === 'object' ? Object.values(context.gather) : [];
    const found = [
        ...declared(context && context.taint),
        ...fromPassages(context && context.passages),
        ...gathered.flatMap((value) => [...declared(value && value.taint), ...fromPassages(value && value.passages)]),
    ];
    if (!found.length && readsExternal(skill)) {
        const read = fetched((context && (context.target || context.url)) || '');
        if (read) found.push(read);
    }
    return found;
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

/* A rule-triggered run holds a trimmed task, a form event only its id; the origin is read from the row then. */
const originOf = async (companyId, task) => {
    if (task && task.origin) return task.origin;
    const taskId = task && (task._id || task.taskId);
    if (!enabled() || !oid(taskId)) return null;
    const row = await MongoDbCrudOpration(companyId, { type: SCHEMA_TYPE.TASKS, data: [{ _id: oid(taskId) }, { origin: 1 }] }, 'findOne').catch(() => null);
    return row && row.origin ? plain(row).origin : null;
};

/* The project of the task an action names, when that is not the run's own task. */
const targetProjectOf = async (companyId, taskId) => {
    if (!oid(taskId)) return null;
    const row = await MongoDbCrudOpration(companyId, { type: SCHEMA_TYPE.TASKS, data: [{ _id: oid(taskId) }, { ProjectID: 1 }] }, 'findOne').catch(() => null);
    return row && row.ProjectID ? String(row.ProjectID) : null;
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

module.exports = { KINDS, KIND_LIST, ORIGIN, TASK_ORIGIN_KINDS, EXTERNAL_READS, enabled, hashed, source, fetched, file, fromTask, fromRows, fromEvent, fromPassages, fromContext, readsExternal, collect, note, isTainted, sourcesOf, routes, merge, describe, reasonFor, originOf, targetProjectOf, mark, record, forProposal };
