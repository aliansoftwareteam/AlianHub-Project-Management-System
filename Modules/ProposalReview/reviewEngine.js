/**
 * Proposal-review engine.
 *
 * For one project + sprint, walks every card in the "In Review - TL" status,
 * reads the freelancer's proposal (the latest text comment), matches the
 * card's Upwork job in Postgres, asks the configured LLM (DeepSeek) whether
 * the proposal is good, and — in apply mode — moves the card to "Approved"
 * or "Backlog" using AlianHub's OWN default status-update path
 * (taskMongo.updateStatus), so the board updates live + activity log +
 * notifications all fire exactly like a manual status change.
 *
 * Every reviewed card ends up Approved or Backlog — nothing is left sitting in
 * "In Review - TL". Mutations this engine performs: (1) the task status, and
 * (2) on EVERY Backlog move it adds ONE explanatory comment stating the reason
 * — whether the proposal was judged not good enough OR it simply could not be
 * reviewed (no Upwork link, no proposal comment, the job is missing from
 * Postgres, no proposal found in the thread, or a processing error). The
 * comment is added via AlianHub's OWN default comment-save path (save + socket
 * "insert"), authored by the user who triggered the review, so the team can see
 * WHY. Postgres is read-only; EXISTING comments are never modified; nothing
 * else is created. (If a Backlog move itself fails, the card is left untouched
 * and reported as skipped — never silently lost.)
 *
 * The job is cancellable: a reviewId-keyed registry holds a `cancelled` flag the
 * loop checks BEFORE touching each card, so an emergency stop halts before the
 * next card is changed.
 */
'use strict';

const mongoose = require('mongoose');
const logger = require('../../Config/loggerConfig');
const { dbCollections } = require('../../Config/collections');
const { MongoDbCrudOpration } = require('../../utils/mongo-handler/mongoQueries');
const { taskMongo } = require('../Tasks/helpers/task_class_Mongo');
const { getProvider, isAnyProviderConfigured } = require('../AIProjectGenerator/llmProvider');
const socketEmitter = require('../../event/socketEventEmitter');
const pgClient = require('./pgClient');
const sse = require('./sseEmitter');

// Status names this workflow expects in the project's taskStatusData. Their
// keys/colors are resolved from the project at runtime (statuses are dynamic).
const SOURCE_STATUS = 'In Review - TL';
const APPROVE_STATUS = 'Approved';
const BACKLOG_STATUS = 'Backlog';

// Appropriate Backlog reason text per "can't review" outcome. Every reviewed
// card ends up Approved or Backlog; when we cannot judge a proposal we STILL
// move it to Backlog and leave one of these as the reason so a human knows
// exactly what to fix (add the Upwork link, wait for the proposal, the job
// isn't scraped yet, etc.). The LLM "not good enough" rejection uses the
// model's own one-line reason instead of these.
const BACKLOG_REASON_TEXT = {
    no_token: 'No Upwork job link (~token) was found in the task name, so the proposal could not be reviewed automatically.',
    no_proposal: 'No proposal comment was found on this task to review.',
    job_not_found: 'The linked Upwork job was not found in the jobs database, so the proposal could not be reviewed automatically.',
    no_proposal_in_thread: 'No actual freelancer proposal was found in the task comments.',
    error: 'An error occurred while reviewing this proposal automatically.',
};

// In-memory registry of running jobs → cancellation flag.
const jobs = new Map();

function startJob(reviewId) { jobs.set(reviewId, { cancelled: false }); }
function cancelJob(reviewId) { const j = jobs.get(reviewId); if (j) j.cancelled = true; return Boolean(j); }
function isCancelled(reviewId) { const j = jobs.get(reviewId); return Boolean(j && j.cancelled); }
function endJob(reviewId) { jobs.delete(reviewId); }

function extractToken(name) {
    if (typeof name !== 'string') return null;
    const m = name.match(/~([0-9a-zA-Z]+)/);
    return m ? m[1] : null;
}

// Minimal HTML-entity decode — comment text is stored HTML-escaped.
function decodeEntities(s) {
    if (typeof s !== 'string') return '';
    return s
        .replace(/&#0?39;/g, "'").replace(/&apos;/g, "'")
        .replace(/&quot;/g, '"').replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<').replace(/&gt;/g, '>')
        .replace(/&nbsp;/g, ' ');
}

// How many recent comments to feed the model, and a per-comment char cap.
const MAX_COMMENTS = 8;
const MAX_COMMENT_CHARS = 2500;

// Return this task's recent comment thread (oldest → newest). We do NOT filter
// by `type` (a proposal containing a URL is stored as "link", not "text"; the
// text always lives in `message`) and we do NOT assume the proposal is the
// last comment — a thread can hold revisions by different people plus status
// notes ("Task has been done"), review remarks, and chit-chat in ANY order.
// We hand the whole recent thread to the model and let IT pick the real
// proposal. Pure-media comments have an empty `message`, so they drop out.
// taskId is an ObjectId; we also match a string form for any legacy data.
async function getTaskComments(companyId, taskId) {
    const oid = new mongoose.Types.ObjectId(taskId);
    const comments = await MongoDbCrudOpration(companyId, {
        type: dbCollections.COMMENTS,
        data: [
            { taskId: { $in: [oid, String(taskId)] }, isDeleted: { $ne: true }, message: { $nin: ['', null] } },
            { message: 1, userId: 1, createdAt: 1 },
        ],
    }, 'find').catch(() => []);
    const list = (Array.isArray(comments) ? comments : [])
        .filter((c) => c && typeof c.message === 'string' && c.message.trim())
        .sort((a, b) => new Date(a.createdAt || 0) - new Date(b.createdAt || 0)); // oldest → newest
    // Keep the most recent MAX_COMMENTS, preserving chronological order.
    return list.slice(-MAX_COMMENTS).map((c) => ({
        userId: String(c.userId || ''),
        text: decodeEntities(c.message).trim().slice(0, MAX_COMMENT_CHARS),
    }));
}

// Hand the model the job + the task's comment thread and let it (1) identify
// the ACTUAL current proposal among the comments — wherever it sits, ignoring
// status notes / review remarks / chit-chat, using the most recent version if
// there are several — then (2) judge it. Returns { found, verdict, reason };
// found=false means there is no real proposal in the thread → caller skips.
async function evaluate(job, comments) {
    const provider = getProvider();
    const sysPrompt = 'You are a senior Upwork proposal reviewer. You receive a job and the COMMENT THREAD '
        + 'on a task (comments from one or more people, oldest first). FIRST identify the ACTUAL freelancer '
        + 'PROPOSAL in the thread — the bid / cover-letter answer the team would submit for this job. It can be '
        + 'at ANY position, not necessarily the last comment. IGNORE status notes (e.g. "Task has been done"), '
        + 'review remarks (e.g. "fix this"), approvals, and chit-chat. If several proposal versions exist, use '
        + 'the MOST RECENT one. THEN decide whether that proposal is a good, specific, requirement-matching, '
        + 'professional response (and answers any screening questions). Respond with ONLY a JSON object: '
        + '{"found": true|false, "verdict": "APPROVE" or "BACKLOG", "reason": "<one short sentence>"}. '
        + 'Set "found": false (and omit verdict) if the thread contains no real proposal.';
    const thread = comments
        .map((c, i) => `--- Comment ${i + 1} (user ${c.userId || 'unknown'}) ---\n${c.text}`)
        .join('\n\n');
    const userMsg = `JOB TITLE: ${job.title || ''}\n\nJOB DESCRIPTION:\n${String(job.description || '').slice(0, 3000)}`
        + `\n\nSCREENING QUESTIONS: ${JSON.stringify(job.questions || [])}`
        + `\n\nTASK COMMENT THREAD (oldest first):\n${thread}`;
    const result = await provider.chat({
        systemPrompt: sysPrompt,
        messages: [{ role: 'user', content: userMsg }],
        jsonMode: true,
        temperature: 0.2,
        maxTokens: 700,
    });
    let parsed = {};
    try { parsed = JSON.parse(result && result.content ? result.content : '{}'); } catch (_e) { parsed = {}; }
    const v = String(parsed.verdict || '').toUpperCase();
    return {
        found: parsed.found === true,
        verdict: v === 'APPROVE' ? 'APPROVE' : (v === 'BACKLOG' ? 'BACKLOG' : null),
        reason: parsed.reason || '',
    };
}

// Apply the status change through AlianHub's default status-update path —
// identical payload shape to the manual flow (frontend helper.js:499), so
// history + socket + notifications behave exactly the same.
async function applyStatus({ companyId, project, task, targetStatus, prevStatusValue, userData }) {
    const prevStatus = {
        backColor: prevStatusValue && prevStatusValue.bgColor,
        color: prevStatusValue && prevStatusValue.textColor,
        statusName: prevStatusValue && prevStatusValue.name,
        taskName: task.TaskName,
        bgColor: targetStatus.bgColor,
        textColor: targetStatus.textColor,
        taskId: String(task._id),
        updatedTaskName: targetStatus.name,
    };
    const newStatus = {
        status: { text: targetStatus.name, key: targetStatus.key, type: targetStatus.type },
        statusType: targetStatus.type,
        statusKey: targetStatus.key,
    };
    const projectData = {
        _id: String(project._id),
        CompanyId: companyId,
        lastTaskId: project.lastTaskId,
        ProjectName: project.ProjectName,
        ProjectCode: project.ProjectCode,
    };
    const taskForUpdate = {
        _id: String(task._id),
        sprintId: String(task.sprintId || ''),
        folderObjId: task.folderObjId || '',
        TaskName: task.TaskName,
        statusKey: task.statusKey,
    };
    await taskMongo.updateStatus({ newStatus, prevStatus, projectData, task: taskForUpdate, userData, isUpdateTask: true });
}

// Add a Backlog-reason comment on a card, using AlianHub's DEFAULT comment-save
// path: build a normal comment document (same shape as a user-typed text
// comment), persist it with the generic Mongo "save" op, then emit the same
// socket "insert" event the comment controller emits — so it shows up live in
// the task chat. Authored by the triggering user (userData.id), exactly like a
// manual comment. The reason is either the LLM's "not good enough" sentence or
// a fixed "can't review" message. Best-effort: a comment failure is logged and
// NEVER undoes the (already-applied) status move — returns null instead.
async function addBacklogComment({ companyId, project, task, reason, userData }) {
    try {
        const userId = String((userData && userData.id) || '');
        const reasonText = (reason && String(reason).trim()) || 'The proposal did not sufficiently match the job requirements.';
        const message = `Moved to "${BACKLOG_STATUS}" by proposal review.\nReason: ${reasonText}`;
        const data = {
            message,
            type: 'text',
            userId,
            project: false,
            taskId: new mongoose.Types.ObjectId(String(task._id)),
            sprintId: new mongoose.Types.ObjectId(String(task.sprintId)),
            projectId: new mongoose.Types.ObjectId(String(project._id)),
            mentionIds: [],
        };
        if (task.folderObjId) data.folderId = new mongoose.Types.ObjectId(String(task.folderObjId));
        const saved = await MongoDbCrudOpration(companyId, { type: dbCollections.COMMENTS, data }, 'save');
        // Same broadcast the default comment "save" controller fires (module
        // 'comments' because this comment has projectId + sprintId + taskId).
        try { socketEmitter.emit('insert', { type: 'insert', data: saved, updatedFields: {}, module: 'comments' }); } catch (_e) { /* socket optional */ }
        return saved;
    } catch (e) {
        logger.error(`ProposalReview addBacklogComment error (task ${task && task._id}): ${e && e.message ? e.message : e}`);
        return null;
    }
}

/**
 * Run the review for one project+sprint. Fire-and-forget; reports over SSE.
 * @param {object} p { reviewId, companyId, projectId, sprintId, userData, dryRun }
 */
async function runReview({ reviewId, companyId, projectId, sprintId, userData, dryRun = false }) {
    const emit = (payload) => sse.emit(reviewId, payload);
    const summary = {
        approved: 0, backlog: 0, skipped: 0, total: 0, stopped: false, dryRun: !!dryRun,
        // Why each card landed in Backlog (every non-approved card is backlogged):
        //   rejected              → the LLM judged the proposal not good enough
        //   no_token              → no ~token / Upwork link in the task name
        //   no_proposal           → no comment on the task to review
        //   job_not_found         → the Upwork job is not in Postgres
        //   no_proposal_in_thread → comments exist but none is a real proposal
        //   error                 → a processing error
        // `skipped` counts only cards whose Backlog move itself FAILED (left as-is).
        backlogReasons: { rejected: 0, no_token: 0, no_proposal: 0, job_not_found: 0, no_proposal_in_thread: 0, error: 0 },
    };
    try {
        if (!isAnyProviderConfigured()) {
            emit({ event: 'error', error: 'No AI provider configured.' }); endJob(reviewId); return;
        }
        if (!pgClient.isConfigured()) {
            emit({ event: 'error', error: 'Postgres (PROPOSAL_PG_URL) is not configured on the server.' }); endJob(reviewId); return;
        }

        const project = await MongoDbCrudOpration(companyId, {
            type: dbCollections.PROJECTS,
            data: [{ _id: new mongoose.Types.ObjectId(projectId) }, { ProjectName: 1, ProjectCode: 1, lastTaskId: 1, taskStatusData: 1 }],
        }, 'findOne');
        if (!project) { emit({ event: 'error', error: 'Project not found.' }); endJob(reviewId); return; }

        const statuses = Array.isArray(project.taskStatusData) ? project.taskStatusData : [];
        const byName = (n) => statuses.find((s) => String(s.name).toLowerCase() === n.toLowerCase());
        const source = byName(SOURCE_STATUS);
        const approveStatus = byName(APPROVE_STATUS);
        const backlogStatus = byName(BACKLOG_STATUS);
        if (!source || !approveStatus || !backlogStatus) {
            emit({ event: 'error', error: `This project is missing one of the required statuses: "${SOURCE_STATUS}", "${APPROVE_STATUS}", "${BACKLOG_STATUS}".` });
            endJob(reviewId); return;
        }

        const tasks = await MongoDbCrudOpration(companyId, {
            type: dbCollections.TASKS,
            data: [
                {
                    ProjectID: new mongoose.Types.ObjectId(projectId),
                    sprintId: { $in: [sprintId, new mongoose.Types.ObjectId(sprintId)] },
                    statusKey: source.key,
                    deletedStatusKey: 0,
                },
                { TaskName: 1, statusKey: 1, sprintId: 1, folderObjId: 1 },
            ],
        }, 'find').catch(() => []);
        summary.total = Array.isArray(tasks) ? tasks.length : 0;
        emit({ event: 'progress', processed: 0, total: summary.total });

        let processed = 0;
        // Move a card to Backlog with a reason comment via AlianHub's default
        // status-update path, then record WHY and stream progress. Used for BOTH
        // a quality rejection (LLM verdict BACKLOG) and every "can't review"
        // outcome. The status move is the primary mutation; the comment is
        // best-effort. If the status move itself fails, the card is left
        // untouched and counted as `skipped` (reported, never silently lost).
        const moveToBacklog = async (task, reasonKey, reasonText) => {
            try {
                if (!dryRun) {
                    await applyStatus({ companyId, project, task, targetStatus: backlogStatus, prevStatusValue: source, userData });
                    await addBacklogComment({ companyId, project, task, reason: reasonText, userData });
                }
                summary.backlog += 1;
                if (Object.prototype.hasOwnProperty.call(summary.backlogReasons, reasonKey)) summary.backlogReasons[reasonKey] += 1;
                emit({ event: 'progress', processed, total: summary.total, taskName: task && task.TaskName, verdict: 'BACKLOG', reason: reasonKey });
            } catch (e) {
                logger.error(`ProposalReview backlog move failed (task ${task && task._id}, ${reasonKey}): ${e && e.message ? e.message : e}`);
                summary.skipped += 1;
                emit({ event: 'progress', processed, total: summary.total, taskName: task && task.TaskName, verdict: 'SKIP', reason: reasonKey });
            }
        };
        for (const task of (tasks || [])) {
            if (isCancelled(reviewId)) { summary.stopped = true; break; }
            processed += 1;
            try {
                // Each guard is checked separately so we record the exact reason.
                // EVERY "can't review" outcome moves the card to Backlog (with a
                // reason), so nothing is left stuck in "In Review - TL".
                const token = extractToken(task.TaskName);
                if (!token) { await moveToBacklog(task, 'no_token', BACKLOG_REASON_TEXT.no_token); continue; }

                const comments = await getTaskComments(companyId, task._id);
                if (!comments.length) { await moveToBacklog(task, 'no_proposal', BACKLOG_REASON_TEXT.no_proposal); continue; }

                const job = await pgClient.findJobByToken(token);
                if (!job) { await moveToBacklog(task, 'job_not_found', BACKLOG_REASON_TEXT.job_not_found); continue; }

                if (isCancelled(reviewId)) { summary.stopped = true; break; }

                const { found, verdict, reason } = await evaluate(job, comments);
                if (!found || (verdict !== 'APPROVE' && verdict !== 'BACKLOG')) {
                    // found=false → no real proposal in the thread; found but no
                    // usable verdict → treat as a processing error. Both → Backlog.
                    const key = found ? 'error' : 'no_proposal_in_thread';
                    await moveToBacklog(task, key, BACKLOG_REASON_TEXT[key]);
                    continue;
                }
                // Re-check cancel right before the mutation.
                if (isCancelled(reviewId)) { summary.stopped = true; break; }

                if (verdict === 'APPROVE') {
                    if (!dryRun) {
                        await applyStatus({ companyId, project, task, targetStatus: approveStatus, prevStatusValue: source, userData });
                    }
                    summary.approved += 1;
                    emit({ event: 'progress', processed, total: summary.total, taskName: task.TaskName, verdict: 'APPROVE' });
                } else {
                    // LLM judged the proposal not good enough → Backlog with its reason.
                    await moveToBacklog(task, 'rejected', reason);
                }
            } catch (e) {
                logger.error(`ProposalReview task error (${task && task._id}): ${e && e.message ? e.message : e}`);
                await moveToBacklog(task, 'error', BACKLOG_REASON_TEXT.error);
            }
        }

        emit({ event: 'complete', summary });
    } catch (error) {
        logger.error(`ProposalReview runReview error: ${error && error.message ? error.message : error}`);
        emit({ event: 'error', error: (error && error.message) || 'Review failed' });
    } finally {
        endJob(reviewId);
    }
}

module.exports = { runReview, startJob, cancelJob, isCancelled };
