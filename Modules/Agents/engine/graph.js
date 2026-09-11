const { StateGraph, Annotation, START, END, interrupt, Command } = require('@langchain/langgraph');
const logger = require('../../../Config/loggerConfig');
const persistence = require('../../AICore/persistence');
const orchestrator = require('./orchestrator');
const findingMemory = require('./findingMemory');
const memory = require('../memory');
const skillIndex = require('../skills');
const policy = require('../policy');
const { rating: ratingOf } = require('../actions');
const runs = require('../runs');
const spendGuard = require('../spendGuard');
const { FEATURES } = require('../../AICore/features');

// The run engine as a LangGraph thread, one per run (thread_id = run id):
//
//   gather → analyse → review → act → propose → hold → remember
//
// A proposal is an interrupt at `hold`; approve/decline resume the thread with
// the decision and `remember` finishes the run. `propose` and `hold` are two
// nodes because a resumed node re-runs from its first line — filing the
// proposal next to the interrupt would file it twice.
//
// Terminal writes are conditioned on the run still being `running` (or
// `waiting_approval` once resumed), so a stop or pause-all that won the race is
// never overwritten: the node that notices marks the state abandoned and the
// graph ends without writing more.
//
// A finished thread is deleted from the checkpointer by the caller, never by a
// node: the checkpointer writes a node's own checkpoint after it returns.

const { STATUS } = runs;
const ABANDONED = Object.freeze({ status: 'abandoned', outcome: 'stopped before it finished' });
const MODEL_BUDGET = Object.freeze({ maxTokens: 4000 });
const LOG_PREFIX = '[agent-run]';

const field = (initial) => Annotation({ reducer: (_, next) => next, default: initial });
const State = Annotation.Root({
    run: field(() => null),
    agent: field(() => null),
    task: field(() => null),
    context: field(() => null),
    result: field(() => null),
    spend: field(() => null),
    changes: field(() => []),
    alreadyTracked: field(() => 0),
    decisions: field(() => []),
    toAct: field(() => []),
    toPropose: field(() => []),
    applied: field(() => 0),
    refusals: field(() => 0),
    proposalId: field(() => null),
    decision: field(() => null),
    outcome: field(() => null),
    finalStatus: field(() => null),
    episode: field(() => null),
    abandoned: field(() => false),
});

const plain = (doc) => (doc && typeof doc.toObject === 'function' ? doc.toObject() : doc);
const slugOf = (run) => run.skill || 'qa-review';
const titleOf = (task) => task.TaskKey || task.TaskName;
const wantsMemory = (slug) => { const skill = skillIndex.getSkill(slug); return !(skill && skill.usesMemory === false); };

/* Memory is an optimisation: losing it costs context, failing the run over it costs the run. */
const quietly = async (runId, what, fn) => {
    try { return await fn(); } catch (e) { logger.error(`${LOG_PREFIX} ${runId}: ${what}: ${e.message}`); return null; }
};

/* Renews the queue lock between nodes when the run executes inside a job, so a
 * run that is slow in every phase still holds its lock (see engine/timeouts). */
const renewLock = (state, config) => {
    const keepAlive = config.context.deps && config.context.deps.keepAlive;
    if (typeof keepAlive !== 'function') return Promise.resolve();
    return quietly(state.run._id, 'job lock not renewed', keepAlive);
};

async function gather(state, config) {
    const { companyId } = config.context;
    const { run, task } = state;
    const block = wantsMemory(slugOf(run))
        ? (await quietly(run._id, 'memory unavailable', () => memory.contextFor({ companyId, projectId: task.ProjectID, userId: run.startedBy }))) || ''
        : '';
    const gathered = await orchestrator.gather({ skillSlug: slugOf(run), task, companyId, memory: block });
    if (gathered.status === 'skipped') return { result: gathered };
    return { context: { ...gathered.context, memory: block } };
}

const statusAfter = (result) => {
    if (result.status === 'skipped') return STATUS.SKIPPED;
    if (result.status === 'refused') return STATUS.STOPPED;
    return STATUS.FAILED;
};

/* The guard prices the call before it is made; recordSpend books what it
 * actually cost afterwards, so the cap check below still catches an under-estimate. */
async function analyse(state, config) {
    await renewLock(state, config);
    const { companyId, deps } = config.context;
    const { run, task } = state;
    const guard = spendGuard.forRun({ companyId, run, actor: deps && deps.actor });
    const spendContext = { feature: FEATURES.AGENT_RUN, companyId, runId: String(run._id), userId: run.startedBy || null, account: run.viaAccount || 'workspace' };
    const result = state.result || await orchestrator.analyse({ skillSlug: slugOf(run), task, context: state.context, budget: { ...MODEL_BUDGET, guard }, spend: spendContext });
    const spend = await runs.recordSpend(companyId, run, result.usage, result.model);
    if (result.status !== 'success') return { result, spend, outcome: result.reason || null, finalStatus: statusAfter(result) };
    const cap = Number(run.spendCapUsd) > 0 ? Number(run.spendCapUsd) : 0;
    if (cap && spend.usd >= cap) return { result, spend, outcome: `Run spend cap reached ($${spend.usd.toFixed(2)} of $${cap})`, finalStatus: STATUS.STOPPED };
    return { result, spend };
}

/* Below the review level every change is proposed and no decision is recorded,
 * as before; from it, the policy reviews each change and a refusal still goes
 * through perform() so it leaves the same audit row as a registry refusal. */
async function review(state, config) {
    await renewLock(state, config);
    const { companyId } = config.context;
    const { run, agent, task, result } = state;
    const { changes: found, alreadyTracked } = await runs.changesFor(companyId, task, result);
    if (!found.length) return { alreadyTracked, outcome: `nothing new to file — ${alreadyTracked} finding(s) already tracked`, finalStatus: STATUS.DONE };
    const changes = found.map((c) => ({ ...c, rating: ratingOf(c.action) }));
    if (Number(agent.autonomy) < policy.REVIEW_LEVEL) return { changes, alreadyTracked, toPropose: changes };

    const decisions = [];
    const toAct = [];
    const toPropose = [];
    for (const change of changes) {
        const verdict = policy.decide({ agent, action: change.action, params: change.params, rating: change.rating, run, task });
        decisions.push({ action: change.action, decision: verdict.decision, reason: verdict.reason, rating: verdict.rating, at: new Date() });
        if (verdict.decision === policy.DECISION.PROPOSE) toPropose.push(change); else toAct.push({ change, verdict });
    }
    await runs.patch(companyId, run._id, {}, { $push: { decisions: { $each: decisions } } });
    return { changes, alreadyTracked, decisions, toAct, toPropose };
}

async function act(state, config) {
    await renewLock(state, config);
    const { companyId, deps } = config.context;
    const { run, agent } = state;
    let applied = 0;
    let refusals = 0;
    for (const { change, verdict } of state.toAct) {
        // eslint-disable-next-line no-await-in-loop
        if (!(await runs.isRunning(companyId, run._id))) return { applied, refusals, abandoned: true };
        try {
            // eslint-disable-next-line no-await-in-loop
            const out = await deps.actions.perform({ companyId, actor: deps.actor, action: change.action, params: change.params, reason: `${run.skill} finding`, allowedActions: agent.allowedActions, decision: verdict, depth: runs.originDepth(run) });
            // eslint-disable-next-line no-await-in-loop
            await runs.patch(companyId, run._id, {}, { $push: { actions: { action: change.action, auditId: out.auditId, ok: true, at: new Date() } } });
            applied += 1;
            // eslint-disable-next-line no-await-in-loop
            if (change.remember) await findingMemory.record(companyId, { ...change.remember, subtaskId: out.result && out.result.subtaskId });
        } catch (e) {
            if (e.name !== 'RefusedError') {
                // eslint-disable-next-line no-await-in-loop
                await runs.patch(companyId, run._id, {}, { $push: { actions: { action: change.action, auditId: e.auditId || null, ok: false, error: e.message, at: new Date() } } });
                throw e;
            }
            refusals += 1;
            // eslint-disable-next-line no-await-in-loop
            await runs.patch(companyId, run._id, {}, { $inc: { refusals: 1 }, $push: { actions: { action: change.action, auditId: e.auditId || null, ok: false, refused: e.message, at: new Date() } } });
        }
    }
    const held = state.toPropose.length;
    const outcome = [`${applied} change(s) applied`, held ? `${held} proposed` : '', refusals ? `${refusals} refused` : '', state.alreadyTracked ? `${state.alreadyTracked} already tracked` : ''].filter(Boolean).join(', ');
    return { applied, refusals, outcome, ...(held ? {} : { finalStatus: applied ? STATUS.DONE : STATUS.FAILED }) };
}

async function propose(state, config) {
    await renewLock(state, config);
    const { companyId, deps } = config.context;
    const { run, agent, task, result, spend, toPropose } = state;
    if (!(await runs.isRunning(companyId, run._id))) return { abandoned: true };
    const what = Number(agent.autonomy) < policy.REVIEW_LEVEL && !Array.isArray(result.changes)
        ? `File ${result.findings.length - state.alreadyTracked} QA finding(s) on ${titleOf(task)}`
        : `${run.skill}: ${toPropose.length} change(s) on ${titleOf(task)}`;
    // What the grounding check removed is part of the record a person reviews.
    const dropped = Array.isArray(result.dropped) && result.dropped.length
        ? `Dropped as unsupported by the data: ${result.dropped.map((d) => `"${String(d.text).slice(0, 80)}" (${d.reason})`).join('; ')}` : '';
    const proposal = await deps.proposals.create(companyId, {
        agent, runId: String(run._id), taskId: String(task._id), projectId: String(task.ProjectID),
        what,
        why: [result.summary, dropped].filter(Boolean).join('\n\n'),
        changes: toPropose,
        cost: { tokens: result.usage && result.usage.totalTokens, model: result.model, usd: spend && spend.usd },
    });
    const waiting = await runs.patch(companyId, run._id, { status: STATUS.WAITING, ...(state.outcome ? { outcome: state.outcome } : {}) }, { $push: { proposals: String(proposal._id) } }, { onlyIf: STATUS.RUNNING });
    return waiting ? { proposalId: String(proposal._id) } : { abandoned: true };
}

function hold(state) {
    return { decision: interrupt({ proposalId: state.proposalId, changes: state.toPropose }) };
}

const decidedOutcome = ({ decision, applied }) => {
    if (decision === 'declined') return 'declined by a person';
    const list = Array.isArray(applied) ? applied : [];
    return `${decision} by a person — ${list.filter((a) => a.ok).length} of ${list.length} change(s) applied`;
};

const episodeOf = (state) => {
    const { run, task, decision, spend } = state;
    const declined = Boolean(decision && decision.decision === 'declined');
    const applied = decision && Array.isArray(decision.applied) ? decision.applied : [];
    return {
        skill: run.skill || null, taskId: String(task._id), taskTitle: task.TaskName || null,
        proposed: state.toPropose.length, acted: state.applied,
        approved: declined ? 0 : applied.filter((a) => a.ok).length,
        declined: declined ? state.toPropose.length : 0,
        declinedReason: (decision && decision.reason) || null,
        reverted: false, spendUsd: Number((spend && spend.usd) || 0), at: new Date(),
    };
};

/* The run row is the record; the memory store is told afterwards, so a run
 * that was stopped meanwhile leaves no episode behind. */
async function remember(state, config) {
    const { companyId } = config.context;
    const { run, task, decision } = state;
    const episode = episodeOf(state);
    const saved = decision
        ? await runs.finish(companyId, run._id, { status: STATUS.DONE, outcome: decidedOutcome(decision), episode, onlyIf: STATUS.WAITING })
        : await runs.finish(companyId, run._id, { status: state.finalStatus, outcome: state.outcome, episode, onlyIf: STATUS.RUNNING });
    if (!saved) return { abandoned: true };
    await quietly(run._id, 'episode not remembered', () => memory.recordEpisode({ companyId, projectId: String(run.projectId || task.ProjectID || ''), runId: String(run._id), patch: episode }));
    return { episode, outcome: saved.outcome || null, refusals: Number(saved.refusals || 0), finalStatus: saved.status };
}

const afterAnalyse = (s) => (s.finalStatus ? 'remember' : 'review');
const afterReview = (s) => { if (s.finalStatus) return 'remember'; return s.toAct.length ? 'act' : 'propose'; };
const afterAct = (s) => { if (s.abandoned) return END; return s.toPropose.length ? 'propose' : 'remember'; };
const afterPropose = (s) => (s.abandoned ? END : 'hold');

const builder = new StateGraph(State)
    .addNode('gather', gather)
    .addNode('analyse', analyse)
    .addNode('review', review)
    .addNode('act', act)
    .addNode('propose', propose)
    .addNode('hold', hold)
    .addNode('remember', remember)
    .addEdge(START, 'gather')
    .addEdge('gather', 'analyse')
    .addConditionalEdges('analyse', afterAnalyse, ['review', 'remember'])
    .addConditionalEdges('review', afterReview, ['act', 'propose', 'remember'])
    .addConditionalEdges('act', afterAct, ['propose', 'remember', END])
    .addConditionalEdges('propose', afterPropose, ['hold', END])
    .addEdge('hold', 'remember')
    .addEdge('remember', END);

/* Compiled per company because the checkpointer and store are; recompiled when
 * persistence hands out new instances (tests reset, connections closed). */
const compiled = new Map();
const graphFor = (companyId) => {
    const key = String(companyId);
    const saver = persistence.saverFor(companyId);
    const store = persistence.storeFor(companyId);
    const hit = compiled.get(key);
    if (hit && hit.saver === saver && hit.store === store) return hit.graph;
    const graph = builder.compile({ checkpointer: saver, store });
    compiled.set(key, { saver, store, graph });
    return graph;
};

const configFor = (companyId, runId, context) => ({ configurable: { thread_id: String(runId) }, context: { companyId, ...context }, durability: 'sync' });

const interrupted = (out) => Array.isArray(out.__interrupt__) && out.__interrupt__.length > 0;

const forget = (companyId, runId) => quietly(runId, 'thread not deleted', () => persistence.saverFor(companyId).deleteThread(String(runId)));

/* What the row can still tell memory when the graph itself threw. */
const episodeFromRow = (run, task, error) => ({
    skill: run.skill || null, taskId: String(task._id), taskTitle: task.TaskName || null,
    proposed: 0, acted: (Array.isArray(run.actions) ? run.actions : []).filter((a) => a.ok).length,
    approved: 0, declined: 0, declinedReason: null, reverted: false,
    spendUsd: Number((run.spend && run.spend.usd) || 0), outcome: error, at: new Date(),
});

const runGraph = async ({ companyId, run, agent, task, deps }) => {
    try {
        await persistence.ready(companyId);
        const graph = graphFor(companyId);
        await runs.patch(companyId, run._id, { threadId: String(run._id) });
        const out = await graph.invoke({ run: plain(run), agent: plain(agent), task: plain(task) }, configFor(companyId, run._id, { deps }));
        if (interrupted(out)) {
            return { status: STATUS.WAITING, proposalId: out.proposalId, refusals: out.refusals, ...(out.outcome ? { outcome: out.outcome } : {}) };
        }
        await forget(companyId, run._id);
        if (out.abandoned) return ABANDONED;
        return { status: out.finalStatus, outcome: out.outcome, refusals: out.refusals };
    } catch (e) {
        logger.error(`${LOG_PREFIX} ${run._id}: ${e.message}`);
        const row = (await quietly(run._id, 'run row unavailable', () => runs.get(companyId, run._id))) || plain(run);
        const episode = episodeFromRow(row, task, e.message);
        const saved = await runs.finish(companyId, run._id, { status: STATUS.FAILED, error: e.message, episode, onlyIf: STATUS.RUNNING });
        if (!saved) return ABANDONED;
        await quietly(run._id, 'episode not remembered', () => memory.recordEpisode({ companyId, projectId: String(row.projectId || task.ProjectID || ''), runId: String(run._id), patch: episode }));
        return { status: STATUS.FAILED, error: e.message };
    }
};

/* Resolves { resumed: false } when the thread holds no interrupt — a run from
 * before the graph, or one that already finished — so the caller can close the
 * run the old way. A thread parked after the interrupt (remember threw last
 * time) is driven on without a new decision. */
const resumeGraph = async ({ companyId, runId, resume }) => {
    await persistence.ready(companyId);
    const graph = graphFor(companyId);
    const config = configFor(companyId, runId, {});
    const snapshot = await graph.getState(config);
    const waiting = (snapshot.tasks || []).some((t) => Array.isArray(t.interrupts) && t.interrupts.length);
    const parked = !waiting && Array.isArray(snapshot.next) && snapshot.next.length > 0;
    if (!waiting && !parked) return { resumed: false };
    const out = await graph.invoke(waiting ? new Command({ resume }) : null, config);
    if (!interrupted(out)) await forget(companyId, runId);
    return { resumed: true, status: out.finalStatus, outcome: out.outcome, episode: out.episode, ...(out.abandoned ? { abandoned: true } : {}) };
};

module.exports = { State, ABANDONED, builder, graphFor, runGraph, resumeGraph };
