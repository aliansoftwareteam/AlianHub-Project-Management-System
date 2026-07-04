const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const { SCHEMA_TYPE } = require("../../Config/schemaType");
const { MongoDbCrudOpration } = require("../../utils/mongo-handler/mongoQueries");
const logger = require("../../Config/loggerConfig");
const { generateToken, hashToken, tokenPrefixOf } = require("../ApiTokens/helpers/apiTokenRules");

// AI dev-agent → per-task "Development" conversation. A simple chat thread:
// the user gives instructions (like chatting with Claude), a local Claude Code
// agent (the runner) polls for them, develops, and replies here with the PR.
// Ephemeral — the repo location travels on the conversation, nothing persisted
// as a project binding. Company-scoped (company = the Mongo database).

const actingUserId = (req) => {
    if (req.uid) return String(req.uid);
    const u = req.body && req.body.userData;
    return u && (u.id || u._id) ? String(u.id || u._id) : '';
};

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
        const doc = {
            taskId,
            projectId: String(b.projectId || ''),
            sprintId: String(b.sprintId || ''),
            role: 'user',
            text,
            repo: String(b.repo || '').trim(),
            base: String(b.base || 'main').trim() || 'main',
            status: 'pending',
            userId: actingUserId(req),
        };
        const saved = await MongoDbCrudOpration(companyId, { type: SCHEMA_TYPE.DEV_MESSAGES, data: doc }, 'save');
        return res.send({ status: true, statusText: 'Message sent.', data: mask(saved) });
    } catch (error) {
        logger.error(`ERROR in dev-agent postMessage: ${error.message}`);
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
        const rows = await MongoDbCrudOpration(companyId, {
            type: SCHEMA_TYPE.DEV_MESSAGES,
            data: [{ taskId }, null, { sort: { createdAt: 1 } }],
        }, 'find');
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
        const rows = await MongoDbCrudOpration(companyId, {
            type: SCHEMA_TYPE.DEV_MESSAGES,
            data: [{ role: 'user', status: 'pending' }, null, { sort: { createdAt: 1 }, limit: 20 }],
        }, 'find');
        return res.send({ status: true, statusText: 'Pending fetched.', data: (rows || []).map(mask) });
    } catch (error) {
        logger.error(`ERROR in dev-agent listPending: ${error.message}`);
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
        if (parentId && parentStatus) {
            await MongoDbCrudOpration(companyId, {
                type: SCHEMA_TYPE.DEV_MESSAGES,
                data: [{ _id: parentId }, { $set: { status: parentStatus } }, {}],
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
        await MongoDbCrudOpration(companyId, {
            type: SCHEMA_TYPE.DEV_MESSAGES,
            data: [{ _id: messageId }, { $set: { text: String(b.text || '') } }, {}],
        }, 'updateOne');
        return res.send({ status: true });
    } catch (error) {
        logger.error(`ERROR in dev-agent updateProgress: ${error.message}`);
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
        const code = `${crypto.randomBytes(2).toString('hex')}-${crypto.randomBytes(2).toString('hex')}`.toUpperCase();
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
        // Burn the code first (single-use), then mint the token.
        await MongoDbCrudOpration('global', {
            type: SCHEMA_TYPE.DEV_PAIRINGS,
            data: [{ code }, { $set: { used: true } }, {}],
        }, 'updateOne');
        const rawToken = generateToken();
        await MongoDbCrudOpration(pairing.companyId, {
            type: SCHEMA_TYPE.API_TOKENS,
            data: { name: 'dev-agent (paired)', tokenHash: hashToken(rawToken), prefix: tokenPrefixOf(rawToken), scopes: ['read', 'write'], userId: pairing.userId, active: true },
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
