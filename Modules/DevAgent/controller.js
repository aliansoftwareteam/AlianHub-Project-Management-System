const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const { SCHEMA_TYPE } = require("../../Config/schemaType");
const { MongoDbCrudOpration } = require("../../utils/mongo-handler/mongoQueries");
const logger = require("../../Config/loggerConfig");
const { generateToken, hashToken, tokenPrefixOf } = require("../ApiTokens/helpers/apiTokenRules");
const bot = require("./bot");

// AI dev-agent → per-task "Development" conversation. A simple chat thread:
// the user gives instructions (like chatting with Claude), a local Claude Code
// agent (the runner) polls for them, develops, and replies here with the PR.
// Ephemeral — the repo location travels on the conversation, nothing persisted
// as a project binding. Company-scoped (company = the Mongo database).

const mask = (d) => ({
    _id: d._id,
    taskId: d.taskId,
    projectId: d.projectId || '',
    sprintId: d.sprintId || '',
    role: d.role || 'user',
    text: d.text || '',
    repo: d.repo || '',
    base: d.base || 'main',
    status: d.status || '',
    prUrl: d.prUrl || '',
    parentId: d.parentId || '',
    userId: d.userId || '',
    createdAt: d.createdAt,
});

// ── Runner presence + "no connected computer" timeout ──────────────────
// A pending job is only picked up if a runner is polling. With NO runner
// connected it would sit 'pending' forever and the tab would spin "Starting…"
// indefinitely (even after reload). Track the last time a runner polled and,
// when none is online, fail long-pending jobs with a clear message so the UI
// stops and tells the user to connect a computer. Presence is in-memory
// (per-process): fine for a single app instance; a multi-instance deployment
// would move this to a shared store (Redis/DB).
const RUNNER_ONLINE_MS = 30 * 1000;   // a runner seen within this window = online
const PENDING_GRACE_MS = 45 * 1000;   // give a fresh job this long to be claimed first
const NO_RUNNER_TEXT = '⚠️ No connected computer is running the AI dev-agent, so this could not start. Open Settings → AI Developer and click "Connect Computer", then re-assign the AI Bot (or resend your message).';
const runnerSeen = new Map();          // companyId -> last-poll ms

function markRunnerSeen(companyId) {
    if (companyId) runnerSeen.set(String(companyId), Date.now());
}
function isRunnerOnline(companyId) {
    return (Date.now() - (runnerSeen.get(String(companyId)) || 0)) < RUNNER_ONLINE_MS;
}

// If no runner is online, fail any user message that has been 'pending' past the
// grace window (atomic flip → single winner) and post ONE explanatory agent
// reply. Returns true if anything changed (caller re-fetches). Best-effort.
// A live-but-busy runner keeps polling, so it stays "online" and its queued
// jobs are never wrongly failed — only a truly absent runner triggers this.
async function failStalePendingIfNoRunner(companyId, rows) {
    if (isRunnerOnline(companyId)) return false;
    const now = Date.now();
    // Only 'pending' (waiting to develop) is failed on "no runner". NOT 'pending_pr':
    // its branch is already developed + pushed, so failing it would dead-end a done job
    // (the fix is to open the PR, not re-develop). It simply waits for a runner. (C6)
    const stale = (rows || []).filter((r) => r && r.role === 'user' && r.status === 'pending'
        && r.createdAt && (now - new Date(r.createdAt).getTime()) > PENDING_GRACE_MS);
    let changed = false;
    for (const m of stale) {
        // eslint-disable-next-line no-await-in-loop
        const r = await MongoDbCrudOpration(companyId, {
            type: SCHEMA_TYPE.DEV_MESSAGES,
            data: [{ _id: m._id, role: 'user', status: 'pending' }, { $set: { status: 'error' } }, {}],
        }, 'updateOne').catch(() => null);
        if (r && r.matchedCount) {
            changed = true;
            // eslint-disable-next-line no-await-in-loop
            await MongoDbCrudOpration(companyId, {
                type: SCHEMA_TYPE.DEV_MESSAGES,
                data: { taskId: m.taskId, projectId: m.projectId || '', sprintId: m.sprintId || '', role: 'agent', text: NO_RUNNER_TEXT, parentId: String(m._id), userId: '' },
            }, 'save').catch(() => {});
        }
    }
    return changed;
}

/* POST /api/v2/dev-agent/message  body: { taskId, projectId?, sprintId?, text, repo?, base? }
   A user instruction (JWT). Queued as 'pending' for the runner to pick up. */
exports.postMessage = async (req, res) => {
    try {
        const companyId = req.headers['companyid'] || '';
        const b = req.body || {};
        const taskId = String(b.taskId || '').trim();
        const text = String(b.text || '').trim();
        if (!companyId || !taskId || !text) {
            return res.send({ status: false, statusText: 'companyId, taskId and text are required.' });
        }
        const repo = String(b.repo || '').trim();
        const base = String(b.base || 'main').trim() || 'main';
        // Reject option-shaped / control-char values that could be mis-read as git/gh flags (D3).
        if (repo && (repo.startsWith('-') || /[\n\r\0]/.test(repo))) return res.send({ status: false, statusText: 'Invalid repository value.' });
        if (base.startsWith('-') || !/^[A-Za-z0-9._/-]+$/.test(base)) return res.send({ status: false, statusText: 'Invalid base branch.' });
        const doc = {
            taskId,
            projectId: String(b.projectId || ''),
            sprintId: String(b.sprintId || ''),
            role: 'user',
            text,
            repo,
            base,
            status: 'pending',
            userId: String(req.uid || ''), // derive from the JWT/PAT, never the body
        };
        const saved = await MongoDbCrudOpration(companyId, { type: SCHEMA_TYPE.DEV_MESSAGES, data: doc }, 'save');
        // Remember this repo for the whole project (every task + the AI Bot inherit it)
        // and release any bot jobs that were parked waiting for a repo.
        if (doc.repo) {
            await saveProjectRepo(companyId, doc.projectId, doc.repo, doc.base, req.uid);
            await resumeAwaitingRepo(companyId, doc.projectId, doc.repo, doc.base);
        }
        return res.send({ status: true, statusText: 'Message sent.', data: mask(saved) });
    } catch (error) {
        logger.error(`ERROR in dev-agent postMessage: ${error.message}`);
        return res.send({ status: false, statusText: error.message });
    }
};

/* POST /api/v2/dev-agent/enqueue  body: { taskId, projectId?, sprintId?, text, repo?, base? }  (PAT)
   The runner queues a follow-up develop job — e.g. to address PR review feedback (B4).
   Gated as 'awaiting_approval' so a human approves before the bot acts (consistent with
   the bot-assign flow), and skipped if the task already has an open job. */
exports.enqueueFollowup = async (req, res) => {
    try {
        const companyId = req.headers['companyid'] || '';
        const b = req.body || {};
        const taskId = String(b.taskId || '').trim();
        const text = String(b.text || '').trim();
        if (!companyId || !taskId || !text) return res.send({ status: false, statusText: 'companyId, taskId and text are required.' });
        const repo = String(b.repo || '').trim();
        const base = String(b.base || 'main').trim() || 'main';
        if (repo && (repo.startsWith('-') || /[\n\r\0]/.test(repo))) return res.send({ status: false, statusText: 'Invalid repository value.' });
        if (base.startsWith('-') || !/^[A-Za-z0-9._/-]+$/.test(base)) return res.send({ status: false, statusText: 'Invalid base branch.' });
        const open = await MongoDbCrudOpration(companyId, {
            type: SCHEMA_TYPE.DEV_MESSAGES,
            data: [{ taskId, role: 'user', status: { $in: ['awaiting_repo', 'awaiting_approval', 'pending', 'working', 'working_pr', 'cancelling', 'awaiting_pr', 'pending_pr'] } }, { _id: 1 }, {}],
        }, 'findOne').catch(() => null);
        if (open) return res.send({ status: true, statusText: 'A job is already open for this task.', data: null });
        const botId = await require('./bot').getBotUserId().catch(() => '');
        const saved = await MongoDbCrudOpration(companyId, {
            type: SCHEMA_TYPE.DEV_MESSAGES,
            data: { taskId, projectId: String(b.projectId || ''), sprintId: String(b.sprintId || ''), role: 'user', text, repo, base, status: 'awaiting_approval', userId: botId || String(req.uid || '') },
        }, 'save');
        return res.send({ status: true, statusText: 'Follow-up queued for approval.', data: mask(saved) });
    } catch (error) {
        logger.error(`ERROR in dev-agent enqueueFollowup: ${error.message}`);
        return res.send({ status: false, statusText: error.message });
    }
};

/* GET /api/v2/dev-agent/messages?taskId=...  — the conversation for a task (the tab polls this). */
exports.listMessages = async (req, res) => {
    try {
        const companyId = req.headers['companyid'] || '';
        const taskId = String(req.query.taskId || '').trim();
        if (!companyId || !taskId) {
            return res.send({ status: false, statusText: 'companyId and taskId are required.' });
        }
        const query = { type: SCHEMA_TYPE.DEV_MESSAGES, data: [{ taskId }, null, { sort: { createdAt: 1 } }] };
        let rows = await MongoDbCrudOpration(companyId, query, 'find');
        // Stop the "Starting…" spinner from hanging forever when no runner is
        // connected: fail long-pending jobs + explain. Persisted, so it also
        // resolves on reload. Re-fetch only when something actually changed.
        if (await failStalePendingIfNoRunner(companyId, rows)) {
            rows = await MongoDbCrudOpration(companyId, query, 'find');
        }
        return res.send({ status: true, statusText: 'Conversation fetched.', data: (rows || []).map(mask) });
    } catch (error) {
        logger.error(`ERROR in dev-agent listMessages: ${error.message}`);
        return res.send({ status: false, statusText: error.message });
    }
};

/* GET /api/v2/dev-agent/pending  — user instructions awaiting the agent. The runner (PAT) polls this. */
exports.listPending = async (req, res) => {
    try {
        const companyId = req.headers['companyid'] || '';
        if (!companyId) return res.send({ status: false, statusText: 'companyId is required.' });
        markRunnerSeen(companyId); // a runner is polling → mark it online (presence)
        const rows = await MongoDbCrudOpration(companyId, {
            type: SCHEMA_TYPE.DEV_MESSAGES,
            data: [{ role: 'user', $or: [{ status: 'pending' }, { status: 'pending_pr' }, { status: 'working', updatedAt: { $lt: new Date(Date.now() - 4 * 60 * 1000) } }, { status: 'working_pr', updatedAt: { $lt: new Date(Date.now() - 4 * 60 * 1000) } }] }, null, { sort: { createdAt: 1 }, limit: 20 }],
        }, 'find');
        return res.send({ status: true, statusText: 'Pending fetched.', data: (rows || []).map(mask) });
    } catch (error) {
        logger.error(`ERROR in dev-agent listPending: ${error.message}`);
        return res.send({ status: false, statusText: error.message });
    }
};

/* POST /api/v2/dev-agent/claim  body: { messageId } — atomically claim a task so
   two runners can't both process it. Grabs a 'pending' task, or a 'working' one
   gone stale (its runner died — no heartbeat for a few minutes). */
exports.claimMessage = async (req, res) => {
    try {
        const companyId = req.headers['companyid'] || '';
        const messageId = String((req.body || {}).messageId || '').trim();
        if (!companyId || !messageId) return res.send({ status: false, statusText: 'companyId and messageId are required.' });
        markRunnerSeen(companyId); // claiming runner is online (presence)
        const staleMs = new Date(Date.now() - 4 * 60 * 1000);
        // PR-open jobs get a DISTINCT claimed state ('working_pr') so a stale-recovery still
        // routes the runner to open-the-PR rather than re-develop from scratch (C5).
        let r = await MongoDbCrudOpration(companyId, {
            type: SCHEMA_TYPE.DEV_MESSAGES,
            data: [{ _id: messageId, role: 'user', $or: [{ status: 'pending_pr' }, { status: 'working_pr', updatedAt: { $lt: staleMs } }] }, { $set: { status: 'working_pr' } }, {}],
        }, 'updateOne');
        if (!(r && r.matchedCount)) {
            r = await MongoDbCrudOpration(companyId, {
                type: SCHEMA_TYPE.DEV_MESSAGES,
                data: [{ _id: messageId, role: 'user', $or: [{ status: 'pending' }, { status: 'working', updatedAt: { $lt: staleMs } }] }, { $set: { status: 'working' } }, {}],
            }, 'updateOne');
        }
        return res.send({ status: true, claimed: !!(r && r.matchedCount) });
    } catch (error) {
        logger.error(`ERROR in dev-agent claimMessage: ${error.message}`);
        return res.send({ status: false, statusText: error.message });
    }
};

/* POST /api/v2/dev-agent/heartbeat  body: { messageId } — keep-alive so a genuinely
   long task isn't seen as stale and re-claimed by another runner. */
exports.heartbeat = async (req, res) => {
    try {
        const companyId = req.headers['companyid'] || '';
        const messageId = String((req.body || {}).messageId || '').trim();
        if (!companyId || !messageId) return res.send({ status: false, statusText: 'companyId and messageId are required.' });
        markRunnerSeen(companyId); // heartbeating runner is online (presence)
        // Stop requested (Point 3)? Tell the runner to abort its running job.
        const doc = await MongoDbCrudOpration(companyId, {
            type: SCHEMA_TYPE.DEV_MESSAGES,
            data: [{ _id: messageId, role: 'user' }, { _id: 1, status: 1 }],
        }, 'findOne').catch(() => null);
        if (doc && (doc.status === 'cancelling' || doc.status === 'cancelled')) {
            return res.send({ status: true, cancel: true });
        }
        // Otherwise keep-alive: touch a still-'working' task so another runner doesn't
        // re-claim it as stale — never resurrect one already done/error/cancelled.
        await MongoDbCrudOpration(companyId, {
            type: SCHEMA_TYPE.DEV_MESSAGES,
            data: [{ _id: messageId, role: 'user', status: { $in: ['working', 'working_pr'] } }, { $set: { role: 'user' } }, {}],
        }, 'updateOne');
        return res.send({ status: true, cancel: false });
    } catch (error) {
        logger.error(`ERROR in dev-agent heartbeat: ${error.message}`);
        return res.send({ status: false, statusText: error.message });
    }
};

/* POST /api/v2/dev-agent/reply  body: { taskId, projectId?, sprintId?, parentId?, text, status?, prUrl? }
   The agent (runner, PAT) posts a reply, and can move the parent user message's
   status (working | done | error) so it isn't picked up twice. */
exports.postReply = async (req, res) => {
    try {
        const companyId = req.headers['companyid'] || '';
        const b = req.body || {};
        const taskId = String(b.taskId || '').trim();
        const text = String(b.text || '').trim();
        if (!companyId || !taskId || !text) {
            return res.send({ status: false, statusText: 'companyId, taskId and text are required.' });
        }
        const parentId = String(b.parentId || '').trim();
        const parentStatus = String(b.status || '').trim();
        // Dedup a retried reply (the runner re-POSTs on a transient blip) — same parent + text (C12).
        if (parentId) {
            const dup = await MongoDbCrudOpration(companyId, {
                type: SCHEMA_TYPE.DEV_MESSAGES,
                data: [{ taskId, parentId, role: 'agent', text }, { _id: 1 }, {}],
            }, 'findOne').catch(() => null);
            if (dup) return res.send({ status: true, statusText: 'Reply already recorded.', data: mask(dup) });
        }
        // Only a valid status, and only on the matching user message of THIS task.
        if (parentId && ['working', 'done', 'error', 'cancelled', 'awaiting_pr'].includes(parentStatus)) {
            await MongoDbCrudOpration(companyId, {
                type: SCHEMA_TYPE.DEV_MESSAGES,
                data: [{ _id: parentId, taskId, role: 'user' }, { $set: { status: parentStatus } }, {}],
            }, 'updateOne');
        }
        const doc = {
            taskId,
            projectId: String(b.projectId || ''),
            sprintId: String(b.sprintId || ''),
            role: 'agent',
            text,
            prUrl: String(b.prUrl || '').trim(),
            parentId,
            userId: String(req.uid || ''),
        };
        const saved = await MongoDbCrudOpration(companyId, { type: SCHEMA_TYPE.DEV_MESSAGES, data: doc }, 'save');
        // B1: when a PR is opened (done + prUrl), drop a comment on the task thread so the
        // work is visible on the TASK itself (not only in the Development tab), authored by
        // the AI Bot. Reuses the comments collection + the same socket event the Comments UI
        // listens on, so it renders live. Best-effort — never blocks the reply.
        if (parentStatus === 'done' && doc.prUrl && doc.projectId) {
            try {
                const botId = await require('./bot').getBotUserId();
                if (botId) {
                    const c = await MongoDbCrudOpration(companyId, {
                        type: SCHEMA_TYPE.COMMENTS,
                        data: {
                            type: 'text', project: false,
                            projectId: doc.projectId, taskId,
                            ...(doc.sprintId ? { sprintId: doc.sprintId } : {}),
                            userId: botId,
                            message: `✅ Done by AlianHub AI agent — PR: ${doc.prUrl}`,
                        },
                    }, 'save');
                    try { require('../../event/socketEventEmitter').emit('insert', { type: 'insert', data: c, updatedFields: {}, module: 'comments' }); } catch (e) { /* socket best-effort */ }
                }
            } catch (e) { logger.error(`dev-agent: task-comment write-back failed: ${e.message}`); }
        }
        return res.send({ status: true, statusText: 'Reply posted.', data: mask(saved) });
    } catch (error) {
        logger.error(`ERROR in dev-agent postReply: ${error.message}`);
        return res.send({ status: false, statusText: error.message });
    }
};

/* POST /api/v2/dev-agent/progress  body: { messageId, text } — the runner updates
   the live "working" message with its current activity, for a real-time view. */
exports.updateProgress = async (req, res) => {
    try {
        const companyId = req.headers['companyid'] || '';
        const b = req.body || {};
        const messageId = String(b.messageId || '').trim();
        if (!companyId || !messageId) return res.send({ status: false, statusText: 'companyId and messageId are required.' });
        // Progress only ever updates the agent's own 'working' message.
        await MongoDbCrudOpration(companyId, {
            type: SCHEMA_TYPE.DEV_MESSAGES,
            data: [{ _id: messageId, role: 'agent' }, { $set: { text: String(b.text || '') } }, {}],
        }, 'updateOne');
        return res.send({ status: true });
    } catch (error) {
        logger.error(`ERROR in dev-agent updateProgress: ${error.message}`);
        return res.send({ status: false, statusText: error.message });
    }
};

/* POST /api/v2/dev-agent/approve  body: { messageId }  (JWT)
   Approve a gated bot job so the runner may develop it: awaiting_approval → pending.
   (This same action will later also release an awaiting_pr job to create the PR.) */
exports.approveJob = async (req, res) => {
    try {
        const companyId = req.headers['companyid'] || '';
        const messageId = String((req.body || {}).messageId || '').trim();
        if (!companyId || !messageId) return res.send({ status: false, statusText: 'companyId and messageId are required.' });
        // Approve to START: awaiting_approval → pending (the runner then develops).
        let r = await MongoDbCrudOpration(companyId, {
            type: SCHEMA_TYPE.DEV_MESSAGES,
            data: [{ _id: messageId, role: 'user', status: 'awaiting_approval' }, { $set: { status: 'pending' } }, {}],
        }, 'updateOne');
        // Approve the PR STEP (Point 2): awaiting_pr → pending_pr (the runner opens the PR).
        if (!(r && r.matchedCount)) {
            r = await MongoDbCrudOpration(companyId, {
                type: SCHEMA_TYPE.DEV_MESSAGES,
                data: [{ _id: messageId, role: 'user', status: 'awaiting_pr' }, { $set: { status: 'pending_pr' } }, {}],
            }, 'updateOne');
        }
        return res.send({ status: true, approved: !!(r && r.matchedCount) });
    } catch (error) {
        logger.error(`ERROR in dev-agent approveJob: ${error.message}`);
        return res.send({ status: false, statusText: error.message });
    }
};

/* POST /api/v2/dev-agent/cancel  body: { messageId }  (JWT)
   Cancel/stop a job. A not-yet-running job (awaiting_approval | pending) flips
   straight to 'cancelled'. A 'working' job is marked 'cancelling' — the runner sees
   that on its next heartbeat, aborts the run, and sets 'cancelled' (Point 3). */
exports.cancelJob = async (req, res) => {
    try {
        const companyId = req.headers['companyid'] || '';
        const messageId = String((req.body || {}).messageId || '').trim();
        if (!companyId || !messageId) return res.send({ status: false, statusText: 'companyId and messageId are required.' });
        // Not started yet (any waiting/queued state) → cancel outright. (C7)
        const stopped = await MongoDbCrudOpration(companyId, {
            type: SCHEMA_TYPE.DEV_MESSAGES,
            data: [{ _id: messageId, role: 'user', status: { $in: ['awaiting_repo', 'awaiting_approval', 'pending', 'awaiting_pr', 'pending_pr'] } }, { $set: { status: 'cancelled' } }, {}],
        }, 'updateOne');
        if (stopped && stopped.matchedCount) return res.send({ status: true, cancelled: true, state: 'cancelled' });
        // Already running → signal the runner to abort (runner-side handling: Point 3).
        const signalled = await MongoDbCrudOpration(companyId, {
            type: SCHEMA_TYPE.DEV_MESSAGES,
            data: [{ _id: messageId, role: 'user', status: 'working' }, { $set: { status: 'cancelling' } }, {}],
        }, 'updateOne');
        return res.send({ status: true, cancelled: !!(signalled && signalled.matchedCount), state: (signalled && signalled.matchedCount) ? 'cancelling' : 'noop' });
    } catch (error) {
        logger.error(`ERROR in dev-agent cancelJob: ${error.message}`);
        return res.send({ status: false, statusText: error.message });
    }
};

// Persist a project's repo binding (company-scoped, one row per project). Once set
// from any task's Development tab, every task in the project + the AI Bot resolve it.
async function saveProjectRepo(companyId, projectId, repo, base, userId) {
    const pid = String(projectId || '').trim();
    const url = String(repo || '').trim();
    if (!companyId || !pid || !url) return;
    await MongoDbCrudOpration(companyId, {
        type: SCHEMA_TYPE.DEV_PROJECT_REPOS,
        data: [
            { projectId: pid },
            { $set: { projectId: pid, repo: url, base: String(base || 'main').trim() || 'main', updatedBy: String(userId || '') } },
            { upsert: true },
        ],
    }, 'updateOne').catch(() => {});
}

// When a project's repo becomes known, release AI Bot jobs parked as 'awaiting_repo'
// for that project: stamp the repo + move them to 'awaiting_approval' (Point 1) so
// they show up for approval instead of sitting dead. Returns the count released.
async function resumeAwaitingRepo(companyId, projectId, repo, base) {
    if (!companyId || !String(projectId || '').trim() || !String(repo || '').trim()) return 0;
    const r = await MongoDbCrudOpration(companyId, {
        type: SCHEMA_TYPE.DEV_MESSAGES,
        data: [
            { projectId: String(projectId), role: 'user', status: 'awaiting_repo' },
            { $set: { repo: String(repo).trim(), base: String(base || 'main').trim() || 'main', status: 'awaiting_approval' } },
            {},
        ],
    }, 'updateMany').catch(() => null);
    return (r && (r.modifiedCount || r.nModified)) || 0;
}

/* GET /api/v2/dev-agent/project-repo?projectId=  (JWT) — a project's saved repo, so
   the Development tab can pre-fill it in every task of that project. */
exports.getProjectRepo = async (req, res) => {
    try {
        const companyId = req.headers['companyid'] || '';
        const projectId = String((req.query || {}).projectId || '').trim();
        if (!companyId || !projectId) return res.send({ status: false, statusText: 'companyId and projectId are required.' });
        const row = await MongoDbCrudOpration(companyId, {
            type: SCHEMA_TYPE.DEV_PROJECT_REPOS,
            data: [{ projectId }, { repo: 1, base: 1 }],
        }, 'findOne').catch(() => null);
        return res.send({ status: true, data: { repo: (row && row.repo) || '', base: (row && row.base) || 'main' } });
    } catch (error) {
        logger.error(`ERROR in dev-agent getProjectRepo: ${error.message}`);
        return res.send({ status: false, statusText: error.message });
    }
};

/* POST /api/v2/dev-agent/project-repo  body: { projectId, repo, base }  (JWT)
   Save/replace a project's repo binding, then release any AI Bot jobs parked waiting
   for a repo (awaiting_repo → awaiting_approval). */
exports.setProjectRepo = async (req, res) => {
    try {
        const companyId = req.headers['companyid'] || '';
        const b = req.body || {};
        const projectId = String(b.projectId || '').trim();
        const repo = String(b.repo || '').trim();
        const base = String(b.base || 'main').trim() || 'main';
        if (!companyId || !projectId || !repo) return res.send({ status: false, statusText: 'companyId, projectId and repo are required.' });
        if (repo.startsWith('-') || /[\n\r\0]/.test(repo)) return res.send({ status: false, statusText: 'Invalid repository value.' });
        if (base.startsWith('-') || !/^[A-Za-z0-9._/-]+$/.test(base)) return res.send({ status: false, statusText: 'Invalid base branch.' });
        await saveProjectRepo(companyId, projectId, repo, base, req.uid);
        const resumed = await resumeAwaitingRepo(companyId, projectId, repo, base);
        return res.send({ status: true, statusText: 'Project repository saved.', data: { repo, base, resumed } });
    } catch (error) {
        logger.error(`ERROR in dev-agent setProjectRepo: ${error.message}`);
        return res.send({ status: false, statusText: error.message });
    }
};

/* POST /api/v2/dev-agent/pair  (JWT) — the signed-in developer authorizes their
   machine. Returns a short, single-use code; the runner exchanges it (public)
   for a fresh PAT, so nothing has to be configured by hand. */
exports.generatePairing = async (req, res) => {
    try {
        const companyId = req.headers['companyid'] || '';
        const userId = String(req.uid || '');
        if (!companyId || !userId) {
            return res.send({ status: false, statusText: 'companyId and a signed-in user are required.' });
        }
        const code = crypto.randomBytes(16).toString('hex').toUpperCase(); // 128-bit, unguessable
        await MongoDbCrudOpration('global', {
            type: SCHEMA_TYPE.DEV_PAIRINGS,
            data: { code, companyId, userId, used: false },
        }, 'save');
        return res.send({ status: true, statusText: 'Pairing code created.', data: { code } });
    } catch (error) {
        logger.error(`ERROR in dev-agent generatePairing: ${error.message}`);
        return res.send({ status: false, statusText: error.message });
    }
};

/* POST /api/v2/dev-pair  (PUBLIC) — the runner exchanges a pairing code for a
   fresh PAT + its company/user. Single-use, expires in 15 minutes. The code is
   an unguessable secret that only a signed-in user could have generated. */
exports.exchangePairing = async (req, res) => {
    try {
        const code = String((req.body || {}).code || '').trim().toUpperCase();
        if (!code) return res.send({ status: false, statusText: 'A pairing code is required.' });
        const pairing = await MongoDbCrudOpration('global', {
            type: SCHEMA_TYPE.DEV_PAIRINGS,
            data: [{ code }],
        }, 'findOne');
        if (!pairing || pairing.used) return res.send({ status: false, statusText: 'Invalid or already-used code — generate a new one.' });
        if (Date.now() - new Date(pairing.createdAt).getTime() > 15 * 60 * 1000) {
            return res.send({ status: false, statusText: 'Code expired — generate a new one.' });
        }
        // Atomically burn the code (single-use). Mint only if THIS request won the race.
        const burn = await MongoDbCrudOpration('global', {
            type: SCHEMA_TYPE.DEV_PAIRINGS,
            data: [{ code, used: false }, { $set: { used: true } }, {}],
        }, 'updateOne');
        if (!burn || !burn.matchedCount) return res.send({ status: false, statusText: 'Code already used — generate a new one.' });
        const rawToken = generateToken();
        await MongoDbCrudOpration(pairing.companyId, {
            type: SCHEMA_TYPE.API_TOKENS,
            data: { name: 'dev-agent (paired)', tokenHash: hashToken(rawToken), prefix: tokenPrefixOf(rawToken), scopes: ['read', 'write'], userId: pairing.userId, active: true, expiresAt: new Date(Date.now() + 90 * 24 * 60 * 60 * 1000) }, // expire in 90 days — re-pair to renew (D1)
        }, 'save');
        return res.send({ status: true, statusText: 'Paired.', data: { companyId: pairing.companyId, userId: pairing.userId, token: rawToken } });
    } catch (error) {
        logger.error(`ERROR in dev-agent exchangePairing: ${error.message}`);
        return res.send({ status: false, statusText: error.message });
    }
};

/* GET /api/v2/dev-agent-runner.js  (PUBLIC) — serves the self-contained runner
   so a developer can download it and run it anywhere, for any project, without
   cloning this repo. No secrets in the file (auth comes from pairing at runtime). */
exports.serveRunner = (req, res) => {
    try {
        const file = path.join(__dirname, '..', '..', 'scripts', 'dev-agent', 'dev-agent.js');
        const src = fs.readFileSync(file, 'utf8');
        res.setHeader('Content-Type', 'application/javascript; charset=utf-8');
        res.setHeader('Content-Disposition', 'attachment; filename="dev-agent.js"');
        return res.send(src);
    } catch (error) {
        logger.error(`ERROR serving dev-agent runner: ${error.message}`);
        return res.status(500).send('// dev-agent runner is unavailable on this server');
    }
};

/* GET /api/v2/dev-agent-launcher?code=<code>&os=<win|mac|linux>&base=<origin>  (PUBLIC)
   One-click "Connect Computer": serves a ready-to-run launcher pre-filled with the
   pairing code + this server's URL. The developer just opens the downloaded file —
   it fetches the runner into ~/.alianhub and starts the paired agent (`--pair` both
   pairs AND begins polling). `code` and `base` are templated into a shell script, so
   both are STRICTLY validated (exact 32-hex code; clean http(s) origin) — anything
   else is rejected, so there is no shell-injection surface. */
exports.serveLauncher = (req, res) => {
    try {
        const code = String((req.query && req.query.code) || '').trim().toUpperCase();
        const os = String((req.query && req.query.os) || 'win').trim().toLowerCase();
        // Pairing codes are exactly 32 hex chars (crypto.randomBytes(16) hex upper).
        if (!/^[0-9A-F]{32}$/.test(code)) return res.status(400).send('Invalid pairing code');
        // Base origin: prefer the browser-supplied public origin (validated to a
        // clean http(s) origin), else reconstruct from the request headers.
        let base = String((req.query && req.query.base) || '').trim();
        if (!/^https?:\/\/[A-Za-z0-9.\-:]+$/.test(base)) {
            const proto = String(req.headers['x-forwarded-proto'] || req.protocol || 'https').split(',')[0];
            base = `${proto}://${req.get('host')}`;
        }
        base = base.replace(/\/+$/, '');
        // Re-validate after header reconstruction — the Host header is attacker-influenceable (D3).
        if (!/^https?:\/\/[A-Za-z0-9.\-:]+$/.test(base)) return res.status(400).send('Invalid host');
        const runnerUrl = `${base}/api/v2/dev-agent-runner.js`;

        let filename; let contentType; let script;
        if (os === 'mac' || os === 'linux') {
            filename = os === 'mac' ? 'connect-alianhub.command' : 'connect-alianhub.sh';
            contentType = 'text/x-shellscript; charset=utf-8';
            script = [
                '#!/usr/bin/env bash',
                'set -e',
                'echo "Setting up the AlianHub AI dev-agent..."',
                'DIR="$HOME/.alianhub"; mkdir -p "$DIR"',
                'if ! command -v node >/dev/null 2>&1; then echo "Node.js 18+ is required - install it from https://nodejs.org, then open this file again."; read -n 1 -s -r; exit 1; fi',
                `curl -fsSL "${runnerUrl}" -o "$DIR/dev-agent.js"`,
                `exec node "$DIR/dev-agent.js" --pair ${code} --url ${base}`,
                '',
            ].join('\n');
        } else {
            filename = 'connect-alianhub.cmd';
            contentType = 'application/octet-stream';
            script = [
                '@echo off',
                'echo Setting up the AlianHub AI dev-agent...',
                'set "DIR=%USERPROFILE%\\.alianhub"',
                'if not exist "%DIR%" mkdir "%DIR%"',
                'where node >nul 2>nul || (echo Node.js 18+ is required - install it from https://nodejs.org, then run this file again. & pause & exit /b 1)',
                `curl -fsSL "${runnerUrl}" -o "%DIR%\\dev-agent.js" || (echo Download failed - check your connection and try again. & pause & exit /b 1)`,
                `node "%DIR%\\dev-agent.js" --pair ${code} --url ${base}`,
                'pause',
                '',
            ].join('\r\n');
        }
        res.setHeader('Content-Type', contentType);
        res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
        return res.send(script);
    } catch (error) {
        logger.error(`ERROR serving dev-agent launcher: ${error.message}`);
        return res.status(500).send('dev-agent launcher is unavailable on this server');
    }
};

/* POST /api/v2/dev-agent/bot  (JWT) — create/ensure the assignable "AI Bot" user
   for this company. Assigning it to a task then auto-enqueues a Development job. */
exports.ensureBot = async (req, res) => {
    try {
        const companyId = req.headers['companyid'] || '';
        if (!companyId || !req.uid) return res.send({ status: false, statusText: 'companyId and a signed-in user are required.' });
        const info = await bot.ensureBotUser(companyId);
        return res.send({ status: true, statusText: 'AI Bot is ready — assign it to a task to auto-develop.', data: info });
    } catch (error) {
        logger.error(`ERROR in dev-agent ensureBot: ${error.message}`);
        return res.send({ status: false, statusText: error.message });
    }
};
