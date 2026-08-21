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

const attach = require('./helpers/attachments');
const { readStoredFile, removeStoredFile } = require('../../common-storage/putLocalFile');

// A message belongs to EXACTLY ONE scope:
//   taskId         — the task detail's "Development" tab
//   conversationId — a project-level chat, which has no task at all
// Resolved once, here, so no endpoint has to trust the string it was handed and
// none of them can disagree about what "scoped" means. Both-or-neither is refused:
// taskId is no longer required at the schema level, so this is what stops an
// unscoped message being written.
const ID_SHAPE = /^[A-Za-z0-9_-]{8,64}$/;

const scopeOf = (src) => {
    const taskId = String((src && src.taskId) || '').trim();
    const conversationId = String((src && src.conversationId) || '').trim();
    if (taskId && conversationId) {
        return { ok: false, reason: 'A message belongs to a task or a conversation, not both.' };
    }
    if (!taskId && !conversationId) {
        return { ok: false, reason: 'A taskId or a conversationId is required.' };
    }
    const key = taskId || conversationId;
    if (!ID_SHAPE.test(key)) return { ok: false, reason: 'Invalid task or conversation id.' };
    return {
        ok: true,
        taskId,
        conversationId,
        key,
        isTask: !!taskId,
        filter: taskId ? { taskId } : { conversationId },
        fields: taskId ? { taskId, conversationId: '' } : { taskId: '', conversationId },
    };
};

// A project chat is private to whoever started it. There is no conversation
// record to hold an owner, so ownership IS the first user message's userId —
// which every message has carried since the feature existed, so this applies
// retroactively to chats already stored.
//
// The runner is exempt: it authenticates with a PAT (req.apiToken) and acts on a
// job, not as a person. Without that exemption it could not reply into the chat
// it was asked to work on.
const isRunnerRequest = (req) => !!(req && req.apiToken);

const conversationOwner = async (companyId, conversationId) => {
    const row = await MongoDbCrudOpration(companyId, {
        type: SCHEMA_TYPE.DEV_MESSAGES,
        data: [{ conversationId, role: 'user' }, { userId: 1 }, { sort: { createdAt: 1 } }],
    }, 'findOne').catch(() => null);
    return row ? String(row.userId || '') : null;
};

/* Returns null when the caller may proceed, or a refusal string.
   A chat with no messages yet has no owner, so starting one is always allowed —
   the id was minted in the caller's own browser. */
const denyIfNotOwner = async (req, companyId, scope) => {
    if (!scope.conversationId) return null;      // task threads keep their existing behaviour
    if (isRunnerRequest(req)) return null;
    const owner = await conversationOwner(companyId, scope.conversationId);
    if (owner === null) return null;
    if (owner !== String(req.uid || '')) return 'This chat belongs to someone else.';
    return null;
};

/* Starting a chat against a project the caller cannot even see would let a
   non-member point the agent at that project's repository. Uses the same
   visibility rule as the project list rather than a second interpretation of it. */
const denyIfProjectHidden = async (companyId, uid, projectId) => {
    if (!projectId) return null;
    try {
        const { resolveVisibleProjectFilter } = require('../UserDashboard/controller');
        const filter = await resolveVisibleProjectFilter(companyId, uid);
        if (filter === null) return null;        // owner/admin
        const found = await MongoDbCrudOpration(companyId, {
            type: SCHEMA_TYPE.PROJECTS,
            data: [{ _id: projectId, ...filter }, { _id: 1 }, {}],
        }, 'findOne').catch(() => null);
        return found ? null : 'You do not have access to this project.';
    } catch (e) {
        logger.error(`dev-agent project access check failed: ${e.message}`);
        return 'Could not verify your access to this project.';   // fail closed
    }
};

const mask = (d) => ({
    _id: d._id,
    taskId: d.taskId || '',
    conversationId: d.conversationId || '',
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
    attachments: Array.isArray(d.attachments) ? d.attachments : [],
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
// 'cancelling' is only ever cleared by the runner that owned the job, on its next
// heartbeat (every 5s). If that runner died, restarted, or never really had the job,
// nothing else would ever move it — so the job spun as "stopping…" forever, and any
// check that treats it as active (deleting the chat, queuing a follow-up) was stuck
// behind a state that could not clear. A row untouched for this long is not coming
// back; finalise it.
const CANCEL_STRAND_MS = 60 * 1000;
// A claimed job whose runner never came back. Matches the window the stale-claim
// and delete checks use, so all three agree on when a runner is gone for good.
const WORK_STRAND_MS = 4 * 60 * 1000;
const STRANDED_WORK_TEXT = '⚠️ The computer running this stopped reporting, so the job was ended here. Check that the AI agent is still running on your machine, then resend.';
const STRANDED_CANCEL_TEXT = '⏹ Stopped. The computer running this job stopped reporting, so it was cancelled here.';

const NO_RUNNER_TEXT = '⚠️ No connected computer is running the AI dev-agent, so this could not start. Open Settings → AI Developer and click "Connect Computer", then re-assign the AI Bot (or resend your message).';
const OLD_RUNNER_TEXT = '⚠️ Your connected computer is running an older AI agent that does not understand project chats, so this could not start. Reconnect it from Settings → AI Developer (that downloads the current agent), then resend your message. Task Development chats still work in the meantime.';
const runnerSeen = new Map();          // companyId -> { at, protocol }

// The job shape a runner has to understand to take a project-chat job. A runner
// that predates conversations sends no protocol header at all, so it reads as 1.
const CHAT_PROTOCOL = 3;

/* Presence is tracked per company AND per developer.
 *
 * Company-level answers "can any machine run a task job", which is the right
 * question for a task: assigning the AI Bot is a team action and any paired
 * machine may take it.
 *
 * A chat job, though, only ever runs on its owner's machine (see listPending), so
 * company-level presence answers the wrong question for it: with a colleague's
 * runner online, your abandoned chat turn would be judged "a runner is online",
 * never re-offered (it is yours), and never failed — spinning forever while
 * somebody else works. */
function markRunnerSeen(companyId, protocol, uid) {
    if (!companyId) return;
    const n = Number(protocol);
    const seen = { at: Date.now(), protocol: Number.isFinite(n) && n > 0 ? n : 1 };
    runnerSeen.set(String(companyId), seen);
    if (uid) runnerSeen.set(`${companyId}:${uid}`, seen);
}
function runnerProtocol(companyId) {
    const seen = runnerSeen.get(String(companyId));
    return seen && (Date.now() - seen.at) < RUNNER_ONLINE_MS ? seen.protocol : 0;
}
function isRunnerOnlineFor(companyId, uid) {
    if (!uid) return isRunnerOnline(companyId);
    const seen = runnerSeen.get(`${companyId}:${uid}`);
    return !!seen && (Date.now() - seen.at) < RUNNER_ONLINE_MS;
}
function isRunnerOnline(companyId) {
    const seen = runnerSeen.get(String(companyId));
    return !!seen && (Date.now() - seen.at) < RUNNER_ONLINE_MS;
}

// If no runner is online, fail any user message that has been 'pending' past the
// grace window (atomic flip → single winner) and post ONE explanatory agent
// reply. Returns true if anything changed (caller re-fetches). Best-effort.
// A live-but-busy runner keeps polling, so it stays "online" and its queued
// jobs are never wrongly failed — only a truly absent runner triggers this.
async function failStalePendingIfNoRunner(companyId, rows) {
    // Two different dead ends, and they need different explanations: nothing is
    // connected at all, or something is connected but too old for this job.
    const online = isRunnerOnline(companyId);
    const chatCapable = runnerProtocol(companyId) >= CHAT_PROTOCOL;
    if (online && chatCapable) return false;
    const now = Date.now();
    // Only 'pending' (waiting to develop) is failed on "no runner". NOT 'pending_pr':
    // its branch is already developed + pushed, so failing it would dead-end a done job
    // (the fix is to open the PR, not re-develop). It simply waits for a runner. (C6)
    const stale = (rows || []).filter((r) => r && r.role === 'user' && r.status === 'pending'
        && r.createdAt && (now - new Date(r.createdAt).getTime()) > PENDING_GRACE_MS
        // A live-but-old runner is still perfectly able to take task jobs, so only
        // its chat jobs are dead-ended here.
        && (!online || !!String(r.conversationId || '').trim()));
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
                data: {
                    taskId: m.taskId || '',
                    conversationId: m.conversationId || '',
                    projectId: m.projectId || '',
                    sprintId: m.sprintId || '',
                    role: 'agent',
                    text: online ? OLD_RUNNER_TEXT : NO_RUNNER_TEXT,
                    parentId: String(m._id),
                    userId: '',
                },
            }, 'save').catch(() => {});
        }
    }
    return changed;
}

/* Flip 'cancelling' rows that nothing is coming back for to 'cancelled', with one
   explanatory reply. The update matches on the status, so a runner finalising the same
   row concurrently simply loses the race harmlessly. Returns true if anything changed
   (the caller re-fetches). Best-effort. */
async function finalizeStranded(companyId, rows) {
    const now = Date.now();
    const anyOnline = isRunnerOnline(companyId);
    // Two dead ends, same shape of rescue:
    //   cancelling — only the owning runner ever clears it, so if that runner is
    //                gone nothing will; a minute of silence is conclusive since a
    //                live one reacts within 5s.
    //   working    — claimed and then abandoned (laptop asleep, Ctrl+C, reply
    //                retries exhausted). Only rescued when NO runner is online,
    //                because listPending deliberately re-offers a stale claim for
    //                another runner to pick up while one is still there.
    const targets = [];
    for (const r of rows || []) {
        if (!r || r.role !== 'user' || !r.updatedAt) continue;
        const age = now - new Date(r.updatedAt).getTime();
        // A chat row is only ever run by its owner's machine, so its rescue turns
        // on whether THAT machine is online.
        const online = String(r.conversationId || '') ? isRunnerOnlineFor(companyId, r.userId) : anyOnline;
        if (r.status === 'cancelling' && age > CANCEL_STRAND_MS) {
            targets.push({ row: r, from: 'cancelling', to: 'cancelled', text: STRANDED_CANCEL_TEXT });
        } else if (!online && (r.status === 'working' || r.status === 'working_pr') && age > WORK_STRAND_MS) {
            targets.push({ row: r, from: r.status, to: 'error', text: STRANDED_WORK_TEXT });
        }
    }
    let changed = false;
    for (const t of targets) {
        const m = t.row;
        // eslint-disable-next-line no-await-in-loop
        const r = await MongoDbCrudOpration(companyId, {
            type: SCHEMA_TYPE.DEV_MESSAGES,
            data: [{ _id: m._id, role: 'user', status: t.from }, { $set: { status: t.to } }, {}],
        }, 'updateOne').catch(() => null);
        if (r && r.matchedCount) {
            changed = true;
            // eslint-disable-next-line no-await-in-loop
            await MongoDbCrudOpration(companyId, {
                type: SCHEMA_TYPE.DEV_MESSAGES,
                data: {
                    taskId: m.taskId || '',
                    conversationId: m.conversationId || '',
                    projectId: m.projectId || '',
                    sprintId: m.sprintId || '',
                    role: 'agent',
                    text: t.text,
                    parentId: String(m._id),
                    userId: '',
                },
            }, 'save').catch(() => {});
        }
    }
    return changed;
}

/* POST /api/v2/dev-agent/message
   body: { taskId | conversationId, projectId?, sprintId?, text, repo?, base? }
   A user instruction (JWT). Queued as 'pending' for the runner to pick up. */
exports.postMessage = async (req, res) => {
    try {
        const companyId = req.headers['companyid'] || '';
        const b = req.body || {};
        const scope = scopeOf(b);
        const text = String(b.text || '').trim();
        const attachments = attach.normalizeAttachments(b.attachments);
        if (!companyId) return res.send({ status: false, statusText: 'companyId is required.' });
        if (!scope.ok) return res.send({ status: false, statusText: scope.reason });
        // A file on its own is a legitimate instruction ("look at this screenshot"),
        // so text is only required when nothing is attached.
        if (!text && !attachments.length) {
            return res.send({ status: false, statusText: 'Either text or an attachment is required.' });
        }
        const notOwner = await denyIfNotOwner(req, companyId, scope);
        if (notOwner) return res.send({ status: false, statusText: notOwner });
        // One turn at a time in a thread. Two pending rows in the same chat become
        // two headless Claude runs in the SAME working folder, racing on the same
        // files — so a second message is refused rather than silently corrupting
        // the first turn's work. enqueueFollowup already guards this way.
        if (!isRunnerRequest(req)) {
            const open = await MongoDbCrudOpration(companyId, {
                type: SCHEMA_TYPE.DEV_MESSAGES,
                data: [{ ...scope.filter, role: 'user', status: { $in: RUNNER_BUSY_STATUSES } }, { _id: 1, status: 1 }, {}],
            }, 'findOne').catch(() => null);
            if (open) {
                return res.send({
                    status: false,
                    statusText: 'The AI is still working on your last message here. Wait for it to finish, or press Stop first.',
                });
            }
        }
        if (scope.conversationId && !isRunnerRequest(req)) {
            const noProject = await denyIfProjectHidden(companyId, req.uid, String(b.projectId || ''));
            if (noProject) return res.send({ status: false, statusText: noProject });
        }
        const repo = String(b.repo || '').trim();
        const base = String(b.base || 'main').trim() || 'main';
        // Reject option-shaped / control-char values that could be mis-read as git/gh flags (D3).
        if (repo && (repo.startsWith('-') || /[\n\r\0]/.test(repo))) return res.send({ status: false, statusText: 'Invalid repository value.' });
        if (base.startsWith('-') || !/^[A-Za-z0-9._/-]+$/.test(base)) return res.send({ status: false, statusText: 'Invalid base branch.' });
        const doc = {
            ...scope.fields,
            projectId: String(b.projectId || ''),
            sprintId: String(b.sprintId || ''),
            role: 'user',
            text,
            repo,
            base,
            status: 'pending',
            userId: String(req.uid || ''), // derive from the JWT/PAT, never the body
            // Re-checked rather than trusted: the browser sends back descriptors
            // it was given, and a key outside this module's own prefix would let a
            // message point the runner at any object in the company's bucket.
            attachments,
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

/* POST /api/v2/dev-agent/enqueue  body: { taskId | conversationId, projectId?, sprintId?, text, repo?, base? }  (PAT)
   The runner queues a follow-up develop job — e.g. to address PR review feedback (B4).
   Gated as 'awaiting_approval' so a human approves before the bot acts (consistent with
   the bot-assign flow), and skipped if that thread already has an open job. */
/* POST /api/v2/dev-agent/attachment  (multipart, field "file", JWT)
   Stores one file and returns its descriptor for the message about to be sent.
   Separate from postMessage so the composer can show the file before sending,
   and so the JSON path every other caller uses is left alone. */
exports.uploadAttachment = async (req, res) => {
    try {
        const companyId = req.headers['companyid'] || '';
        const scope = scopeOf(req.body);
        if (!companyId) return res.send({ status: false, statusText: 'companyId is required.' });
        if (!scope.ok) return res.send({ status: false, statusText: scope.reason });
        const notMine = await denyIfNotOwner(req, companyId, scope);
        if (notMine) return res.send({ status: false, statusText: notMine });
        if (!req.file) return res.send({ status: false, statusText: 'No file was received.' });

        const stored = await attach.storeAttachment({ companyId, scope: scope.key, file: req.file });
        if (!stored.ok) return res.send({ status: false, statusText: stored.reason });
        return res.send({ status: true, statusText: 'Attached.', data: stored.attachment });
    } catch (error) {
        logger.error(`ERROR in dev-agent uploadAttachment: ${error.message}`);
        return res.send({ status: false, statusText: error.message });
    }
};

/* GET /api/v2/dev-agent/attachment?taskId=|conversationId=&id=  (JWT or the runner's PAT)
   Streams one attachment's bytes.
   The id is looked up on the messages of that scope in that company rather than
   trusting a path from the caller — which is what stops this becoming a way to
   read any object in the company's bucket. */
exports.downloadAttachment = async (req, res) => {
    try {
        const companyId = req.headers['companyid'] || '';
        const scope = scopeOf(req.query);
        const id = String(req.query.id || '').trim();
        if (!companyId || !id) return res.status(400).send('A scope and an id are required');
        if (!scope.ok) return res.status(400).send(scope.reason);
        const refused = await denyIfNotOwner(req, companyId, scope);
        if (refused) return res.status(403).send(refused);

        const rows = await MongoDbCrudOpration(companyId, {
            type: SCHEMA_TYPE.DEV_MESSAGES, data: [scope.filter, 'attachments'],
        }, 'find').catch(() => []);
        let found = null;
        for (const row of rows || []) {
            for (const a of (Array.isArray(row.attachments) ? row.attachments : [])) {
                if (a && String(a.id) === id) { found = a; break; }
            }
            if (found) break;
        }
        if (!found) return res.status(404).send('Not found');

        const { buffer, contentType } = await readStoredFile({ companyId, storagePath: found.url });
        // Never inline: these bytes were chosen by a user, and this response comes
        // from the app's own origin.
        res.setHeader('Content-Type', contentType || 'application/octet-stream');
        res.setHeader('X-Content-Type-Options', 'nosniff');
        res.setHeader('Content-Disposition', `attachment; filename="${attach.safeName(found.filename)}"`);
        return res.send(buffer);
    } catch (error) {
        logger.error(`ERROR in dev-agent downloadAttachment: ${error.message}`);
        return res.status(500).send('Failed');
    }
};

exports.enqueueFollowup = async (req, res) => {
    try {
        const companyId = req.headers['companyid'] || '';
        const b = req.body || {};
        const scope = scopeOf(b);
        const text = String(b.text || '').trim();
        if (!companyId || !text) return res.send({ status: false, statusText: 'companyId and text are required.' });
        if (!scope.ok) return res.send({ status: false, statusText: scope.reason });
        const repo = String(b.repo || '').trim();
        const base = String(b.base || 'main').trim() || 'main';
        if (repo && (repo.startsWith('-') || /[\n\r\0]/.test(repo))) return res.send({ status: false, statusText: 'Invalid repository value.' });
        if (base.startsWith('-') || !/^[A-Za-z0-9._/-]+$/.test(base)) return res.send({ status: false, statusText: 'Invalid base branch.' });
        const open = await MongoDbCrudOpration(companyId, {
            type: SCHEMA_TYPE.DEV_MESSAGES,
            data: [{ ...scope.filter, role: 'user', status: { $in: ['awaiting_repo', 'awaiting_approval', 'pending', 'working', 'working_pr', 'cancelling', 'awaiting_pr', 'pending_pr'] } }, { _id: 1 }, {}],
        }, 'findOne').catch(() => null);
        if (open) return res.send({ status: true, statusText: 'A job is already open here.', data: null });
        const botId = await require('./bot').getBotUserId().catch(() => '');
        const saved = await MongoDbCrudOpration(companyId, {
            type: SCHEMA_TYPE.DEV_MESSAGES,
            data: { ...scope.fields, projectId: String(b.projectId || ''), sprintId: String(b.sprintId || ''), role: 'user', text, repo, base, status: 'awaiting_approval', userId: botId || String(req.uid || '') },
        }, 'save');
        return res.send({ status: true, statusText: 'Follow-up queued for approval.', data: mask(saved) });
    } catch (error) {
        logger.error(`ERROR in dev-agent enqueueFollowup: ${error.message}`);
        return res.send({ status: false, statusText: error.message });
    }
};

/* GET /api/v2/dev-agent/messages?taskId=|conversationId=  — one thread (polled). */
exports.listMessages = async (req, res) => {
    try {
        const companyId = req.headers['companyid'] || '';
        const scope = scopeOf(req.query);
        if (!companyId) return res.send({ status: false, statusText: 'companyId is required.' });
        if (!scope.ok) return res.send({ status: false, statusText: scope.reason });
        const denied = await denyIfNotOwner(req, companyId, scope);
        if (denied) return res.send({ status: false, statusText: denied });
        const query = { type: SCHEMA_TYPE.DEV_MESSAGES, data: [scope.filter, null, { sort: { createdAt: 1 } }] };
        let rows = await MongoDbCrudOpration(companyId, query, 'find');
        // Stop the "Starting…" spinner from hanging forever when no runner is
        // connected: fail long-pending jobs + explain. Persisted, so it also
        // resolves on reload. Re-fetch only when something actually changed.
        const rescued = await failStalePendingIfNoRunner(companyId, rows);
        const finalized = await finalizeStranded(companyId, rows);
        if (rescued || finalized) {
            rows = await MongoDbCrudOpration(companyId, query, 'find');
        }
        return res.send({ status: true, statusText: 'Conversation fetched.', data: (rows || []).map(mask) });
    } catch (error) {
        logger.error(`ERROR in dev-agent listMessages: ${error.message}`);
        return res.send({ status: false, statusText: error.message });
    }
};

/* GET /api/v2/dev-agent/conversations?projectId=...  — MY chats in this project,
   newest activity first. Backs the chat window's rail.

   Private per user: the scan is filtered by the caller's own user messages, so a
   colleague's chats are not listed, and listMessages refuses a chat you do not own
   so knowing an id is not enough either.

   A chat is a conversationId and nothing more: no separate collection, no title to
   keep in sync. Its title is its first instruction, the way a desktop chat client
   names a chat. It exists from its first message — "New chat" in the UI mints an id
   locally and nothing is stored until something is actually sent. */
const ACTIVE_STATUSES = ['awaiting_repo', 'awaiting_approval', 'pending', 'pending_pr', 'working', 'working_pr', 'cancelling', 'awaiting_pr'];
const CONVERSATION_LIMIT = 200;
const STATUS_WINDOW = 1000;

exports.listConversations = async (req, res) => {
    try {
        const companyId = req.headers['companyid'] || '';
        const projectId = String(req.query.projectId || '').trim();
        if (!companyId || !projectId) {
            return res.send({ status: false, statusText: 'companyId and projectId are required.' });
        }
        if (!req.uid) return res.send({ status: false, statusText: 'A signed-in user is required.' });

        // Shape-checked in JS rather than with a `$ne: ''` filter: $ne also matches a
        // document where the field is absent, which is every task-tab message written
        // before conversationId existed.
        const ids = (await MongoDbCrudOpration(companyId, {
            type: SCHEMA_TYPE.DEV_MESSAGES,
            data: ['conversationId', { projectId, role: 'user', userId: String(req.uid) }],
        }, 'distinct') || []).map((v) => String(v || '').trim()).filter((v) => ID_SHAPE.test(v));
        if (!ids.length) {
            return res.send({ status: true, statusText: 'Conversations fetched.', data: [] });
        }

        // Scoped by the ids gathered above, so agent replies count towards the summary
        // even though the runner may post one without a projectId.
        const rows = await MongoDbCrudOpration(companyId, {
            type: SCHEMA_TYPE.DEV_MESSAGES,
            data: [[
                { $match: { conversationId: { $in: ids } } },
                { $sort: { createdAt: 1 } },
                {
                    $group: {
                        _id: '$conversationId',
                        title: { $first: '$text' },
                        // A chat can be opened with just a file and no words, and then
                        // there is nothing to title it with. Carry the first
                        // attachment's name so the rail can fall back to it.
                        firstAttachments: { $first: '$attachments' },
                        lastText: { $last: '$text' },
                        lastRole: { $last: '$role' },
                        lastAt: { $last: '$createdAt' },
                        count: { $sum: 1 },
                    },
                },
                { $sort: { lastAt: -1 } },
                { $limit: CONVERSATION_LIMIT },
            ]],
        }, 'aggregate') || [];

        // The newest user message per chat carries the status worth showing and the repo
        // it last ran against. Bounded, so a long-lived project cannot make this
        // unbounded; a chat outside the window simply shows no status chip.
        const userRows = await MongoDbCrudOpration(companyId, {
            type: SCHEMA_TYPE.DEV_MESSAGES,
            data: [{ conversationId: { $in: ids }, role: 'user' }, { conversationId: 1, status: 1, repo: 1 }, { sort: { createdAt: -1 }, limit: STATUS_WINDOW }],
        }, 'find') || [];
        const newest = new Map();
        for (const r of userRows) {
            const k = String(r.conversationId);
            if (!newest.has(k)) newest.set(k, r);
        }

        const data = rows.map((r) => {
            const last = newest.get(String(r._id)) || {};
            const status = String(last.status || '');
            const firstFile = Array.isArray(r.firstAttachments) && r.firstAttachments[0]
                ? String(r.firstAttachments[0].filename || '')
                : '';
            return {
                conversationId: String(r._id),
                title: String(r.title || ''),
                firstAttachment: firstFile,
                repo: String(last.repo || ''),
                lastText: String(r.lastText || ''),
                lastRole: r.lastRole || 'user',
                lastAt: r.lastAt,
                count: r.count || 0,
                status,
                isActive: ACTIVE_STATUSES.includes(status),
            };
        });
        return res.send({ status: true, statusText: 'Conversations fetched.', data });
    } catch (error) {
        logger.error(`ERROR in dev-agent listConversations: ${error.message}`);
        return res.send({ status: false, statusText: error.message });
    }
};

/* POST /api/v2/dev-agent/conversation/delete  body: { conversationId }  (JWT)
   Removes one of my chats: every message in it, plus the files those messages
   carried, so deleting a chat does not leave objects behind in the company's
   bucket forever.

   Refused only while a job is GENUINELY in flight — a runner-owned state that was
   updated recently. Deleting under a working runner would leave it developing against
   a thread that no longer exists, so that case says why instead.

   What it deliberately does NOT block on:
     • awaiting_approval / awaiting_pr — those wait on a human, and discarding a chat
       you were asked to approve is a legitimate answer, not an error.
     • a stale runner-owned state — if nothing has touched it in minutes, no runner is
       coming back, and refusing would make the chat permanently undeletable. */
const RUNNER_BUSY_STATUSES = ['pending', 'pending_pr', 'working', 'working_pr', 'cancelling'];
const LIVE_JOB_MS = 4 * 60 * 1000;   // the same window the stale-claim logic uses
exports.deleteConversation = async (req, res) => {
    try {
        const companyId = req.headers['companyid'] || '';
        const conversationId = String((req.body || {}).conversationId || '').trim();
        if (!companyId || !conversationId) {
            return res.send({ status: false, statusText: 'companyId and conversationId are required.' });
        }
        if (!req.uid) return res.send({ status: false, statusText: 'A signed-in user is required.' });
        if (!ID_SHAPE.test(conversationId)) return res.send({ status: false, statusText: 'Invalid conversation id.' });

        const owner = await conversationOwner(companyId, conversationId);
        if (owner === null) return res.send({ status: false, statusText: 'That chat no longer exists.' });
        if (owner !== String(req.uid)) return res.send({ status: false, statusText: 'This chat belongs to someone else.' });

        const rows = await MongoDbCrudOpration(companyId, {
            type: SCHEMA_TYPE.DEV_MESSAGES,
            data: [{ conversationId }, { role: 1, status: 1, attachments: 1, updatedAt: 1 }, {}],
        }, 'find').catch(() => []);

        const now = Date.now();
        const busy = (rows || []).find((r) => r.role === 'user'
            && RUNNER_BUSY_STATUSES.includes(String(r.status || ''))
            && r.updatedAt && (now - new Date(r.updatedAt).getTime()) < LIVE_JOB_MS);
        if (busy) {
            return res.send({
                status: false,
                statusText: busy.status === 'cancelling'
                    ? 'This chat is still stopping. Give it a moment, then delete it.'
                    : 'The AI is working in this chat right now. Stop it, then delete the chat.',
            });
        }

        // Files first: if this half-fails the messages are still there, so the user
        // can retry. Doing it the other way round would orphan the objects with no
        // record left pointing at them.
        const keys = [];
        for (const r of rows || []) {
            for (const a of (Array.isArray(r.attachments) ? r.attachments : [])) {
                if (a && a.url) keys.push(String(a.url));
            }
        }
        let filesRemoved = 0;
        for (const key of keys) {
            // eslint-disable-next-line no-await-in-loop
            const gone = await removeStoredFile({ companyId, storagePath: key }).catch(() => false);
            if (gone) filesRemoved += 1;
        }

        const del = await MongoDbCrudOpration(companyId, {
            type: SCHEMA_TYPE.DEV_MESSAGES,
            data: [{ conversationId }],
        }, 'deleteMany');

        return res.send({
            status: true,
            statusText: 'Chat deleted.',
            data: {
                messagesDeleted: (del && del.deletedCount) || 0,
                filesRemoved,
                filesFound: keys.length,
            },
        });
    } catch (error) {
        logger.error(`ERROR in dev-agent deleteConversation: ${error.message}`);
        return res.send({ status: false, statusText: error.message });
    }
};

/* GET /api/v2/dev-agent/pending  — user instructions awaiting the agent. The runner (PAT) polls this. */
exports.listPending = async (req, res) => {
    try {
        const companyId = req.headers['companyid'] || '';
        if (!companyId) return res.send({ status: false, statusText: 'companyId is required.' });
        markRunnerSeen(companyId, req.headers['x-dev-agent-protocol'], req.uid); // a runner is polling → mark it online (presence)
        // A CHAT job may only run on its own developer's machine.
        //
        // /pending was company-wide, so with two people paired, whichever runner
        // polled first took the work: your chat would be developed on a colleague's
        // laptop, under their Claude account, against their checkout, with your
        // attachments landing in their folder. The chat is private in the browser —
        // it has to be private in execution too, or "private" means nothing.
        //
        // req.uid is the PAT owner, so this needs no runner change. Task jobs stay
        // company-wide on purpose: assigning the AI Bot to a task is a team action,
        // and any paired machine is a legitimate place to run it.
        const mine = String(req.uid || '');
        const rows = await MongoDbCrudOpration(companyId, {
            type: SCHEMA_TYPE.DEV_MESSAGES,
            data: [{
                role: 'user',
                $and: [
                    { $or: [{ status: 'pending' }, { status: 'pending_pr' }, { status: 'working', updatedAt: { $lt: new Date(Date.now() - 4 * 60 * 1000) } }, { status: 'working_pr', updatedAt: { $lt: new Date(Date.now() - 4 * 60 * 1000) } }] },
                    { $or: [{ conversationId: '' }, { conversationId: { $exists: false } }, { userId: mine }] },
                ],
            }, null, { sort: { createdAt: 1 }, limit: 20 }],
        }, 'find');
        // Withhold chat jobs from a runner too old to understand them. It would
        // otherwise claim one and fetch a task by an empty id. The job stays queued
        // and failStalePendingIfNoRunner explains why.
        const canChat = Number(req.headers['x-dev-agent-protocol'] || 1) >= CHAT_PROTOCOL;
        const deliverable = (rows || []).filter((r) => canChat || !String(r.conversationId || '').trim());
        return res.send({ status: true, statusText: 'Pending fetched.', data: deliverable.map(mask) });
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
        markRunnerSeen(companyId, req.headers['x-dev-agent-protocol'], req.uid); // claiming runner is online (presence)
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
        markRunnerSeen(companyId, req.headers['x-dev-agent-protocol'], req.uid); // heartbeating runner is online (presence)
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

/* POST /api/v2/dev-agent/reply  body: { taskId | conversationId, projectId?, sprintId?, parentId?, text, status?, prUrl? }
   The agent (runner, PAT) posts a reply, and can move the parent user message's
   status (working | done | error) so it isn't picked up twice. */
exports.postReply = async (req, res) => {
    try {
        const companyId = req.headers['companyid'] || '';
        const b = req.body || {};
        const scope = scopeOf(b);
        const text = String(b.text || '').trim();
        if (!companyId || !text) {
            return res.send({ status: false, statusText: 'companyId and text are required.' });
        }
        if (!scope.ok) return res.send({ status: false, statusText: scope.reason });
        const parentId = String(b.parentId || '').trim();
        const parentStatus = String(b.status || '').trim();
        // Dedup a retried reply (the runner re-POSTs on a transient blip) — same parent + text (C12).
        if (parentId) {
            const dup = await MongoDbCrudOpration(companyId, {
                type: SCHEMA_TYPE.DEV_MESSAGES,
                data: [{ ...scope.filter, parentId, role: 'agent', text }, { _id: 1 }, {}],
            }, 'findOne').catch(() => null);
            if (dup) return res.send({ status: true, statusText: 'Reply already recorded.', data: mask(dup) });
        }
        // Only a valid status, and only on the matching user message of THIS thread.
        if (parentId && ['working', 'done', 'error', 'cancelled', 'awaiting_pr'].includes(parentStatus)) {
            await MongoDbCrudOpration(companyId, {
                type: SCHEMA_TYPE.DEV_MESSAGES,
                data: [{ _id: parentId, ...scope.filter, role: 'user' }, { $set: { status: parentStatus } }, {}],
            }, 'updateOne');
        }
        const doc = {
            ...scope.fields,
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
        // Only for a task-scoped reply: a project chat has no task to comment on.
        if (scope.isTask && parentStatus === 'done' && doc.prUrl && doc.projectId) {
            try {
                const botId = await require('./bot').getBotUserId();
                if (botId) {
                    const c = await MongoDbCrudOpration(companyId, {
                        type: SCHEMA_TYPE.COMMENTS,
                        data: {
                            type: 'text', project: false,
                            projectId: doc.projectId, taskId: scope.taskId,
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
