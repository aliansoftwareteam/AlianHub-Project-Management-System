const crypto = require('crypto');
const mongoose = require('mongoose');
const logger = require('../../Config/loggerConfig');
const { myCache } = require('../../Config/config');
const { dbCollections } = require('../../Config/collections');
const { MongoDbCrudOpration } = require('../../utils/mongo-handler/mongoQueries');

const multer = require('multer');

const { getProvider, isAnyProviderConfigured } = require('./llmProvider');
const { PlanSchema, ClarifyResponseSchema, sanitizeMemberIds, tryParseJson } = require('./schemaValidator');
const { buildSystemPrompt, buildUserMessage, buildRepairPrompt } = require('./promptTemplates');
const { briefUpload, extractFromFile, safeUnlink, MAX_BRIEF_BYTES } = require('./briefExtractor');
const sseEmitter = require('./sseEmitter');
const orchestrator = require('./orchestrator');
const { normalizePlanColors, forceDefaultStatusToDoName } = orchestrator;

const PLAN_TTL_SECONDS = 15 * 60;        // 15 min
const BRIEF_TTL_SECONDS = 30 * 60;       // 30 min
const OBJECT_ID_PATTERN = /^[a-f0-9]{24}$/i;

function token() {
    return crypto.randomBytes(12).toString('hex');
}

function cacheKey(kind, uid, id) {
    return `aipg:${kind}:${uid}:${id}`;
}

function audIncludes(aud, companyId) {
    if (!aud || !companyId) return false;
    const list = Array.isArray(aud) ? aud : String(aud).split(',');
    return list.some((entry) => String(entry).trim() === String(companyId).trim());
}

function sendError(res, status, message) {
    return res.status(status).send({ status: false, statusText: message });
}

function resolveCompanyId(req) {
    // Prefer the JWT-verified header (set by verifyJWTTokenWithCV2 upstream)
    // but accept body.companyId/CompanyId for flexibility. We always
    // cross-check against req.aud before trusting any of them.
    const candidates = [
        req.headers && req.headers.companyid,
        req.body && req.body.companyId,
        req.body && req.body.CompanyId,
    ].filter(Boolean);
    for (const c of candidates) {
        const s = String(c).trim();
        if (OBJECT_ID_PATTERN.test(s) && audIncludes(req.aud, s)) return s;
    }
    return null;
}

async function loadActiveMembers(companyId) {
    try {
        const result = await MongoDbCrudOpration(companyId, {
            type: dbCollections.COMPANY_USERS,
            data: [{ status: { $ne: 'inactive' } }, { _id: 1, userId: 1, Employee_Name: 1, email: 1, role: 1, designation: 1 }],
        }, 'find');
        return Array.isArray(result) ? result.map((m) => ({
            id: String(m.userId || m._id),
            name: m.Employee_Name || m.email || 'Unknown',
            role: m.role || m.designation || '',
        })) : [];
    } catch (e) {
        logger.error(`AIPG loadActiveMembers error: ${e && e.message ? e.message : e}`);
        return [];
    }
}

async function callLlmForPlan({ description, hints, briefText, members, conversation, clarifyRound }) {
    const provider = getProvider();
    const systemPrompt = buildSystemPrompt({ clarifyRound });
    const userMessage = buildUserMessage({ description, hints, briefText, members, conversation, clarifyRound });
    const maxTokens = Number(process.env.LLM_MAX_TOKENS_PLAN) || 8000;

    const firstAttempt = await provider.chat({
        systemPrompt,
        messages: [{ role: 'user', content: userMessage }],
        jsonMode: true,
        maxTokens,
        temperature: 0.4,
    });

    const tryValidate = (raw) => {
        const parsed = tryParseJson(raw);
        if (!parsed.ok) return { ok: false, error: `JSON parse failed: ${parsed.error}` };
        const result = ClarifyResponseSchema.safeParse(parsed.value);
        if (!result.success) {
            const issues = result.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('\n');
            return { ok: false, error: issues };
        }
        return { ok: true, value: result.data };
    };

    let validated = tryValidate(firstAttempt.content);
    let usedTokens = firstAttempt.totalTokens || 0;
    let repairAttempt = null;

    if (!validated.ok) {
        // One repair pass.
        repairAttempt = await provider.chat({
            systemPrompt,
            messages: [
                { role: 'user', content: userMessage },
                { role: 'assistant', content: firstAttempt.content },
                { role: 'user', content: buildRepairPrompt(firstAttempt.content, validated.error) },
            ],
            jsonMode: true,
            maxTokens,
            temperature: 0.2,
        });
        usedTokens += repairAttempt.totalTokens || 0;
        validated = tryValidate(repairAttempt.content);
        if (!validated.ok) {
            const err = new Error(`LLM output failed validation after repair: ${validated.error}`);
            err.code = 'LLM_INVALID_OUTPUT';
            err.details = validated.error;
            throw err;
        }
    }

    return { result: validated.value, tokens: usedTokens, model: (provider && provider.name) || 'unknown' };
}

// Wraps multer.single so multer's MulterError ('LIMIT_FILE_SIZE',
// 'LIMIT_UNEXPECTED_FILE', filter rejections, etc.) becomes a clean
// {status:false, statusText} response the frontend already knows how to
// surface — instead of falling through to Express's default handler and
// turning into the opaque "Request failed with status code 500" the user saw.
function briefUploadMiddleware(req, res, next) {
    briefUpload.single('file')(req, res, (err) => {
        if (!err) return next();
        if (err instanceof multer.MulterError) {
            if (err.code === 'LIMIT_FILE_SIZE') {
                const maxMb = Math.round(MAX_BRIEF_BYTES / (1024 * 1024));
                return sendError(res, 413, `File is too large. Maximum allowed size is ${maxMb} MB.`);
            }
            if (err.code === 'LIMIT_UNEXPECTED_FILE') {
                return sendError(res, 400, 'Unexpected file field. Use the "file" upload field.');
            }
            if (err.code === 'LIMIT_FILE_COUNT' || err.code === 'LIMIT_PART_COUNT') {
                return sendError(res, 400, 'Only one file is allowed per upload.');
            }
            return sendError(res, 400, err.message || 'File upload failed.');
        }
        // fileFilter rejection (unsupported mimetype) lands here as a plain Error.
        const msg = (err && err.message) || 'Unsupported file. Please upload a PDF, DOCX, TXT or MD file under 10 MB.';
        return sendError(res, 400, msg);
    });
}

exports.uploadBrief = [
    briefUploadMiddleware,
    async (req, res) => {
        if (!isAnyProviderConfigured()) {
            return sendError(res, 503, 'AI provider is not configured');
        }
        const uid = req.uid;
        if (!uid) return sendError(res, 401, 'Unauthorized');
        const companyId = resolveCompanyId(req);
        if (!companyId) return sendError(res, 403, 'Company access denied');
        if (!req.file) return sendError(res, 400, 'No file uploaded (field name: file)');

        try {
            const extracted = await extractFromFile(req.file);
            safeUnlink(req.file.path);

            const briefId = token();
            myCache.set(cacheKey('brief', uid, briefId), {
                text: extracted.text,
                companyId,
                uid,
                createdAt: Date.now(),
            }, BRIEF_TTL_SECONDS);

            return res.send({
                status: true,
                briefId,
                tokenEstimate: extracted.tokenEstimate,
                truncated: extracted.truncated,
                charCount: extracted.finalLength,
                mimetype: extracted.mimetype,
            });
        } catch (error) {
            if (req.file && req.file.path) safeUnlink(req.file.path);
            logger.error(`AIPG uploadBrief error: ${error && error.message ? error.message : error}`);
            return sendError(res, 400, error && error.message ? error.message : 'Failed to read brief');
        }
    },
];

exports.plan = async (req, res) => {
    if (!isAnyProviderConfigured()) {
        return sendError(res, 503, 'AI provider is not configured');
    }
    try {
        const uid = req.uid;
        if (!uid) return sendError(res, 401, 'Unauthorized');
        const companyId = resolveCompanyId(req);
        if (!companyId) return sendError(res, 403, 'Company access denied');

        const description = String((req.body && req.body.description) || '').trim();
        if (description.length < 20) return sendError(res, 400, 'Description must be at least 20 characters');

        const hints = (req.body && req.body.hints) || {};
        let briefText = '';
        if (req.body && req.body.briefId) {
            const stash = myCache.get(cacheKey('brief', uid, req.body.briefId));
            if (stash && stash.companyId === companyId) briefText = stash.text;
        }

        const members = await loadActiveMembers(companyId);

        // One-shot plan call. The /clarify endpoint and conversation cache
        // were removed (staging-app intermittently 504s on the proxy and the
        // cached conversation expired between retries, producing
        // "Conversation not found or expired" errors). The system prompt
        // forces needsClarification=false so the model commits to a plan
        // from whatever description the user gave — vague inputs get
        // reasonable defaults rather than a follow-up question.
        const { result, tokens, model } = await callLlmForPlan({
            description, hints, briefText, members,
            conversation: [],
            clarifyRound: 3, // force "final round" rules: must return a plan
        });

        let { plan } = result;
        if (!plan) {
            return sendError(res, 502, 'The AI did not return a plan. Please try again.');
        }
        try {
            const allowed = new Set(members.map((m) => String(m.id)));
            const sanitized = sanitizeMemberIds(plan, allowed);
            plan = sanitized.plan;
        } catch (_e) { /* leave as-is */ }

        // Honour the user's explicit public/private choice from step 1 — it
        // always wins over whatever the LLM picked.
        if (plan && plan.project && typeof req.body.isPrivateSpace === 'boolean') {
            plan.project.isPrivateSpace = req.body.isPrivateSpace;
        }

        // Re-validate after sanitization, then normalize status colors so the
        // preview chips look identical to the saved project (same "bg = text + 35"
        // convention the orchestrator applies at save time).
        const reCheck = PlanSchema.safeParse(plan);
        if (!reCheck.success) {
            const issues = reCheck.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('\n');
            return sendError(res, 502, `Plan failed final validation: ${issues}`);
        }
        plan = forceDefaultStatusToDoName(normalizePlanColors(reCheck.data));

        const planId = token();
        myCache.set(cacheKey('plan', uid, planId), {
            companyId,
            plan,
            createdAt: Date.now(),
        }, PLAN_TTL_SECONDS);

        return res.send({
            status: true,
            needsClarification: false,
            planId,
            plan,
            tokensUsed: tokens,
            model,
        });
    } catch (error) {
        logger.error(`AIPG plan error: ${error && error.message ? error.message : error}`);
        const code = error.code === 'LLM_INVALID_OUTPUT' ? 502 : 500;
        return sendError(res, code, error && error.message ? error.message : 'Plan generation failed. Please try again.');
    }
};

// /clarify was removed when we collapsed the wizard to one-shot. The route
// is no longer registered (see routes.js). This stub stays in case any
// frontend cache still POSTs to the old URL during a deploy roll-out — it
// returns a clear "endpoint removed, just retry /plan" response instead of
// 404'ing.
exports.clarify = async (req, res) => {
    return sendError(res, 410, 'Clarification flow was removed. Submit the same description to /plan again.');
};

exports.execute = async (req, res) => {
    try {
        const uid = req.uid;
        if (!uid) return sendError(res, 401, 'Unauthorized');
        const companyId = resolveCompanyId(req);
        if (!companyId) return sendError(res, 403, 'Company access denied');

        // The plan travels in the request body. We deliberately do NOT rely
        // on an in-memory cache here — a nodemon restart between /plan and
        // /execute would otherwise lose it. The client always has the full
        // plan (it was returned from /plan and shown in the preview), so
        // it just sends it back.
        let plan = req.body && req.body.plan;
        if (!plan || typeof plan !== 'object') return sendError(res, 400, 'plan required in request body');

        // Apply optional inline edits (renames the user made in the preview).
        const editsRaw = req.body && req.body.edits;
        if (editsRaw && typeof editsRaw === 'object') {
            plan = applyEdits(plan, editsRaw);
        }

        // Honour the privacy choice from step 1 once more, in case the user
        // toggled it after the plan was generated but before execute.
        if (plan && plan.project && typeof req.body.isPrivateSpace === 'boolean') {
            plan.project.isPrivateSpace = req.body.isPrivateSpace;
        }

        // Always re-validate server-side — never trust a client-supplied plan.
        const reCheck = PlanSchema.safeParse(plan);
        if (!reCheck.success) {
            const issues = reCheck.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('\n');
            return sendError(res, 400, `Plan failed validation: ${issues}`);
        }
        plan = forceDefaultStatusToDoName(normalizePlanColors(reCheck.data));

        // Re-sanitize assignee ids against the current company membership in
        // case roster changed since /plan was called.
        try {
            const members = await loadActiveMembers(companyId);
            const allowed = new Set(members.map((m) => String(m.id)));
            const sanitized = sanitizeMemberIds(plan, allowed);
            plan = sanitized.plan;
        } catch (_e) { /* leave as-is */ }

        const userData = {
            id: String(uid),
            Employee_Name: (req.body && req.body.userName) || 'AlainHub AI ',
            companyOwnerId: companyId,
        };

        const jobId = token();

        // Reply right away with the jobId; client opens SSE on /execute/events/:jobId.
        res.send({ status: true, jobId });

        // Tiny delay so the client has time to attach the SSE listener before
        // we start emitting (otherwise an instant-success run can race).
        setTimeout(() => {
            orchestrator.executePlan({ plan, companyId, uid: String(uid), userData, jobId })
                .catch((e) => {
                    logger.error(`AIPG execute error: ${e && e.message ? e.message : e}`);
                });
        }, 200);
    } catch (error) {
        logger.error(`AIPG execute outer error: ${error && error.message ? error.message : error}`);
        return sendError(res, 500, error && error.message ? error.message : 'Execute failed');
    }
};

function applyEdits(plan, edits) {
    const next = JSON.parse(JSON.stringify(plan));
    if (edits.project) {
        if (typeof edits.project.ProjectName === 'string') next.project.ProjectName = edits.project.ProjectName.slice(0, 80);
        if (typeof edits.project.ProjectCode === 'string') next.project.ProjectCode = edits.project.ProjectCode.toUpperCase().slice(0, 6);
        if (typeof edits.project.description === 'string') next.project.description = edits.project.description.slice(0, 2000);
    }
    if (Array.isArray(edits.folders)) {
        for (let i = 0; i < edits.folders.length && i < next.folders.length; i++) {
            const ef = edits.folders[i];
            if (!ef) continue;
            if (typeof ef.folderName === 'string') next.folders[i].folderName = ef.folderName.slice(0, 80);
            if (Array.isArray(ef.sprints)) {
                for (let j = 0; j < ef.sprints.length && j < next.folders[i].sprints.length; j++) {
                    const es = ef.sprints[j];
                    if (!es) continue;
                    if (typeof es.sprintName === 'string') next.folders[i].sprints[j].sprintName = es.sprintName.slice(0, 80);
                    if (Array.isArray(es.tasks)) {
                        for (let k = 0; k < es.tasks.length && k < next.folders[i].sprints[j].tasks.length; k++) {
                            const et = es.tasks[k];
                            if (!et) continue;
                            if (typeof et.TaskName === 'string') next.folders[i].sprints[j].tasks[k].TaskName = et.TaskName.slice(0, 200);
                        }
                    }
                }
            }
        }
    }
    return next;
}

exports.events = (req, res) => sseEmitter.handleEvents(req, res);
