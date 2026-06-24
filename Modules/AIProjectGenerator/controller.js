const crypto = require('crypto');
const mongoose = require('mongoose');
const logger = require('../../Config/loggerConfig');
const { myCache } = require('../../Config/config');
const { dbCollections } = require('../../Config/collections');
const { MongoDbCrudOpration } = require('../../utils/mongo-handler/mongoQueries');

const multer = require('multer');

const { getProvider, isAnyProviderConfigured } = require('./llmProvider');
const { PlanSchema, ClarifyResponseSchema, TasksPlanSchema, TasksResponseSchema, sanitizeMemberIds, sanitizeTaskPlanMemberIds, tryParseJson } = require('./schemaValidator');
const { buildSystemPrompt, buildUserMessage, buildRepairPrompt, buildTasksSystemPrompt, buildTasksUserMessage } = require('./promptBuilder');
const { briefUpload, extractFromFile, safeUnlink, MAX_BRIEF_BYTES } = require('./briefExtractor');
const sseEmitter = require('./sseEmitter');
const orchestrator = require('./orchestrator');
const clarifier = require('./clarifier');
const { normalizePlanColors } = orchestrator;

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

/**
 * Maps LLM provider error codes to appropriate HTTP status codes so the
 * client receives a meaningful status rather than a generic 500.
 *
 * LLM_RATE_LIMITED   → 429  (client should back off and retry — resolves in ~60s)
 * LLM_QUOTA_EXCEEDED → 402  (account out of credits — owner must add balance)
 * LLM_AUTH_FAILED    → 503  (server config issue, not a client mistake)
 * LLM_UNAVAILABLE    → 503  (upstream temporarily down)
 * LLM_TIMEOUT        → 504  (gateway timeout)
 * LLM_BAD_REQUEST    → 400  (bad model config / invalid params)
 * LLM_INVALID_OUTPUT → 502  (model returned unparseable output)
 * anything else      → 500
 */
function llmErrorToHttpStatus(error) {
    const map = {
        LLM_RATE_LIMITED: 429,
        LLM_QUOTA_EXCEEDED: 402,
        LLM_AUTH_FAILED: 503,
        LLM_UNAVAILABLE: 503,
        LLM_TIMEOUT: 504,
        LLM_BAD_REQUEST: 400,
        LLM_INVALID_OUTPUT: 502,
    };
    return (error && error.code && map[error.code]) || 500;
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

async function callLlmForPlan({ description, additionalRequirements, briefText, members, clarifications }) {
    const provider = getProvider();
    const systemPrompt = buildSystemPrompt();
    const userMessage = buildUserMessage({ description, additionalRequirements, briefText, members, clarifications });
    // 32000 default: large plans (30+ tasks) with 5-block descriptions
    // routinely run 15-25K output tokens. Claude Sonnet 4.5 supports 64K
    // output and gpt-5 supports 128K, so 32K is well within bounds for
    // either provider while still bounding cost.
    const maxTokens = Number(process.env.LLM_MAX_TOKENS_PLAN) || 32000;

    const firstAttempt = await provider.chat({
        systemPrompt,
        messages: [{ role: 'user', content: userMessage }],
        jsonMode: true,
        maxTokens,
        temperature: 0.4,
    });

    // Truncation short-circuit: if the model hit max_tokens, the JSON is
    // physically incomplete and a repair pass with the same budget will
    // hit the same wall. Surface a clear "raise the budget" error
    // immediately instead of burning a second LLM call.
    if (firstAttempt.truncated) {
        const err = new Error(
            'The AI ran out of output token budget mid-plan. Raise LLM_MAX_TOKENS_PLAN '
            + `(currently ${maxTokens}) in your .env to give it more room, or describe a smaller project.`,
        );
        err.code = 'LLM_TRUNCATED';
        throw err;
    }

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
        // Same truncation guard on the repair pass.
        if (repairAttempt.truncated) {
            const err = new Error(
                'The AI ran out of output token budget on the repair attempt. Raise '
                + `LLM_MAX_TOKENS_PLAN (currently ${maxTokens}) in your .env, or describe a smaller project.`,
            );
            err.code = 'LLM_TRUNCATED';
            throw err;
        }
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

async function generatePlanForJob({ jobId, uid, companyId, description, additionalRequirements, briefText, isPrivateSpace, clarifications }) {
    const emit = (payload) => sseEmitter.emit(jobId, payload);

    try {
        emit({ event: 'progress', phase: 'plan', step: 'context', status: 'started' });
        const members = await loadActiveMembers(companyId);
        emit({ event: 'progress', phase: 'plan', step: 'context', status: 'done' });

        // Generate the full plan in the background; the HTTP request already
        // returned a job id, so slow LLM responses no longer trip the proxy.
        emit({ event: 'progress', phase: 'plan', step: 'ai', status: 'started' });
        const { result, tokens, model } = await callLlmForPlan({
            description, additionalRequirements, briefText, members, clarifications,
        });

        let { plan } = result;
        if (!plan) {
            throw new Error('The AI did not return a plan. Please try again.');
        }
        try {
            const allowed = new Set(members.map((m) => String(m.id)));
            const sanitized = sanitizeMemberIds(plan, allowed);
            plan = sanitized.plan;
        } catch (_e) { /* leave as-is */ }

        // The user's explicit public/private choice always wins over whatever
        // the LLM picked.
        if (plan && plan.project && typeof isPrivateSpace === 'boolean') {
            plan.project.isPrivateSpace = isPrivateSpace;
        }

        // Re-validate after sanitization, then normalize status colors so the
        // preview chips look identical to the saved project (same "bg = text + 35"
        // convention the orchestrator applies at save time). We deliberately
        // do NOT rename the first status to "To Do" — Phase A respects the
        // domain-specific name the model picked.
        const reCheck = PlanSchema.safeParse(plan);
        if (!reCheck.success) {
            const issues = reCheck.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('\n');
            throw new Error(`Plan failed final validation: ${issues}`);
        }
        plan = normalizePlanColors(reCheck.data);

        const planId = token();
        myCache.set(cacheKey('plan', uid, planId), {
            companyId,
            plan,
            createdAt: Date.now(),
        }, PLAN_TTL_SECONDS);

        emit({
            event: 'complete',
            phase: 'plan',
            status: true,
            needsClarification: false,
            planId,
            plan,
            tokensUsed: tokens,
            model,
        });
    } catch (error) {
        logger.error(`AIPG plan job error: ${error && error.message ? error.message : error}`);
        emit({
            event: 'error',
            phase: 'plan',
            error: error && error.message ? error.message : 'Plan generation failed. Please try again.',
            code: error && error.code ? error.code : undefined,
        });
    }
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

        // "Additional requirements" textarea from Step 1 of the wizard — the
        // single biggest "match my requirements" lever. Capped at 2000 chars
        // so a runaway paste can't dominate the prompt.
        const additionalRequirements = String((req.body && req.body.additionalRequirements) || '').trim().slice(0, 2000);
        let briefText = '';
        if (req.body && req.body.briefId) {
            const stash = myCache.get(cacheKey('brief', uid, req.body.briefId));
            if (stash && stash.companyId === companyId) briefText = stash.text;
        }

        // Optional clarifications from the new Clarify step. The frontend
        // sends an array of { id, question, category, type, answer, skipped }
        // objects — one entry per question that was asked. We sanitize
        // here so the prompt builder gets a clean shape regardless of
        // what the client posted.
        const clarifications = sanitizeClarifications(req.body && req.body.clarifications);

        const jobId = token();

        // Reply immediately so reverse proxies do not 504 while the LLM is
        // thinking. The client subscribes to /api/v1/ai-progress/:jobId for
        // the final plan payload, using the same bearer-style random job id
        // pattern as the execute flow.
        res.send({ status: true, jobId, queued: true });

        setTimeout(() => {
            generatePlanForJob({
                jobId,
                uid,
                companyId,
                description,
                additionalRequirements,
                briefText,
                isPrivateSpace: !!(req.body && req.body.isPrivateSpace),
                clarifications,
            }).catch((error) => {
                logger.error(`AIPG plan job outer error: ${error && error.message ? error.message : error}`);
                sseEmitter.emit(jobId, {
                    event: 'error',
                    phase: 'plan',
                    error: error && error.message ? error.message : 'Plan generation failed. Please try again.',
                });
            });
        }, 200);
        return;
    } catch (error) {
        logger.error(`AIPG plan error: ${error && error.message ? error.message : error}`);
        const httpCode = llmErrorToHttpStatus(error);
        return sendError(res, httpCode, error && error.message ? error.message : 'Plan generation failed. Please try again.');
    }
};

// /clarify generates a small set of clarifying questions tailored to the
// brief. The frontend renders them as a Q&A step BEFORE plan generation;
// the user's answers are then posted back with /plan so the model has
// authoritative context for the plan. Synchronous (small token budget,
// no SSE) — the request returns the questions JSON inline.
exports.clarify = async (req, res) => {
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

        const additionalRequirements = String((req.body && req.body.additionalRequirements) || '').trim().slice(0, 2000);
        let briefText = '';
        if (req.body && req.body.briefId) {
            const stash = myCache.get(cacheKey('brief', uid, req.body.briefId));
            if (stash && stash.companyId === companyId) briefText = stash.text;
        }

        const { understanding, questions, tokens, model } = await clarifier.generateClarifyingQuestions({
            description,
            additionalRequirements,
            briefText,
        });

        return res.send({
            status: true,
            understanding,
            questions,
            tokensUsed: tokens,
            model,
        });
    } catch (error) {
        logger.error(`AIPG clarify error: ${error && error.message ? error.message : error}`);
        // Non-fatal: a clarify failure should NOT block the user. The
        // frontend treats a non-OK response as "skip Q&A, go straight to
        // plan" — same fallback used when the brief is already complete.
        const httpCode = llmErrorToHttpStatus(error);
        return sendError(res, httpCode, error && error.message ? error.message : 'Could not generate clarifying questions. You can continue without them.');
    }
};

/**
 * Defensive sanitization of the `clarifications` payload coming from the
 * client. Drops anything not shaped like a {id, question, …} entry and
 * caps the array length so a malicious or buggy client can't bloat the
 * prompt. Returns null if the input is missing/empty/invalid so callers
 * can treat "no clarifications" uniformly.
 */
function sanitizeClarifications(raw) {
    if (!Array.isArray(raw) || !raw.length) return null;
    const out = [];
    for (const entry of raw.slice(0, 12)) {
        if (!entry || typeof entry !== 'object') continue;
        const id = typeof entry.id === 'string' ? entry.id.slice(0, 60) : '';
        const question = typeof entry.question === 'string' ? entry.question.slice(0, 280) : '';
        if (!id || !question) continue;
        out.push({
            id,
            question,
            category: typeof entry.category === 'string' ? entry.category.slice(0, 40) : 'misc',
            type: typeof entry.type === 'string' ? entry.type.slice(0, 40) : 'text',
            answer: entry.answer === undefined ? null : entry.answer,
            skipped: !!entry.skipped,
        });
    }
    return out.length ? out : null;
}

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
        plan = normalizePlanColors(reCheck.data);

        // Re-sanitize assignee ids against the current company membership in
        // case roster changed since /plan was called. While the roster is
        // loaded, resolve the current user's display name from `uid` so every
        // AI-generated activity-log entry (project / task / estimate) is
        // attributed to the real person who triggered the run — matching the
        // manual flow — instead of a generic label.
        let currentUserName = '';
        try {
            const members = await loadActiveMembers(companyId);
            const allowed = new Set(members.map((m) => String(m.id)));
            const me = members.find((m) => String(m.id) === String(uid));
            if (me && me.name) currentUserName = me.name;
            const sanitized = sanitizeMemberIds(plan, allowed);
            plan = sanitized.plan;
        } catch (_e) { /* leave as-is */ }

        const userData = {
            id: String(uid),
            // Prefer the server-resolved roster name (authoritative current
            // user); fall back to a client-supplied name, then a generic label
            // only if the user genuinely can't be resolved.
            Employee_Name: currentUserName || (req.body && req.body.userName) || 'AlianHub AI',
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
    if (Array.isArray(edits.sprints) && Array.isArray(next.sprints)) {
        for (let i = 0; i < edits.sprints.length && i < next.sprints.length; i++) {
            const es = edits.sprints[i];
            if (!es) continue;
            if (typeof es.sprintName === 'string') next.sprints[i].sprintName = es.sprintName.slice(0, 80);
            if (Array.isArray(es.tasks)) {
                for (let k = 0; k < es.tasks.length && k < next.sprints[i].tasks.length; k++) {
                    const et = es.tasks[k];
                    if (!et) continue;
                    if (typeof et.TaskName === 'string') next.sprints[i].tasks[k].TaskName = et.TaskName.slice(0, 200);
                }
            }
        }
    }
    return next;
}

// ─── Tasks into an existing project (AHE-3777) ─────────────────────────
//
// Same engine as the project-plan flow (LLM provider, JSON-mode, repair
// pass, SSE), but generates sprints + tasks ONLY and persists them into an
// EXISTING project via orchestrator.executeTasksIntoProject. Mirrors
// callLlmForPlan / generatePlanForJob / exports.plan / exports.execute.

async function callLlmForTasksPlan({ project, additionalRequirements, briefText, members, clarifications }) {
    const provider = getProvider();
    const systemPrompt = buildTasksSystemPrompt();
    const userMessage = buildTasksUserMessage({ project, additionalRequirements, briefText, members, clarifications });
    const maxTokens = Number(process.env.LLM_MAX_TOKENS_PLAN) || 32000;

    const firstAttempt = await provider.chat({
        systemPrompt,
        messages: [{ role: 'user', content: userMessage }],
        jsonMode: true,
        maxTokens,
        temperature: 0.4,
    });
    if (firstAttempt.truncated) {
        const err = new Error(
            'The AI ran out of output token budget mid-plan. Raise LLM_MAX_TOKENS_PLAN '
            + `(currently ${maxTokens}) in your .env, or ask for fewer tasks.`,
        );
        err.code = 'LLM_TRUNCATED';
        throw err;
    }

    const tryValidate = (raw) => {
        const parsed = tryParseJson(raw);
        if (!parsed.ok) return { ok: false, error: `JSON parse failed: ${parsed.error}` };
        const result = TasksResponseSchema.safeParse(parsed.value);
        if (!result.success) {
            const issues = result.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('\n');
            return { ok: false, error: issues };
        }
        return { ok: true, value: result.data };
    };

    let validated = tryValidate(firstAttempt.content);
    let usedTokens = firstAttempt.totalTokens || 0;

    if (!validated.ok) {
        const repairAttempt = await provider.chat({
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
        if (repairAttempt.truncated) {
            const err = new Error(
                'The AI ran out of output token budget on the repair attempt. Raise '
                + `LLM_MAX_TOKENS_PLAN (currently ${maxTokens}) in your .env, or ask for fewer tasks.`,
            );
            err.code = 'LLM_TRUNCATED';
            throw err;
        }
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

async function generateTasksPlanForJob({ jobId, uid, companyId, projectId, additionalRequirements, briefText, clarifications }) {
    const emit = (payload) => sseEmitter.emit(jobId, payload);
    try {
        emit({ event: 'progress', phase: 'plan', step: 'context', status: 'started' });
        const projectDoc = await orchestrator.loadProjectForTasks(companyId, projectId);
        if (!projectDoc) throw new Error('Project not found');

        const project = {
            ProjectName: projectDoc.ProjectName,
            description: projectDoc.description || '',
            taskStatusNames: (projectDoc.taskStatusData || []).map((s) => s.name).filter(Boolean),
            taskTypes: (projectDoc.taskTypeCounts || []).map((t) => ({ key: t.key, name: t.name })),
            sprintNames: Object.values(projectDoc.sprintsObj || {}).map((s) => s && s.name).filter(Boolean),
        };
        const members = await loadActiveMembers(companyId);
        emit({ event: 'progress', phase: 'plan', step: 'context', status: 'done' });

        emit({ event: 'progress', phase: 'plan', step: 'ai', status: 'started' });
        const { result, tokens, model } = await callLlmForTasksPlan({
            project, additionalRequirements, briefText, members, clarifications,
        });

        let plan = result.plan;
        if (!plan || !Array.isArray(plan.sprints)) {
            throw new Error('The AI did not return any tasks. Please try again.');
        }
        try {
            const allowed = new Set(members.map((m) => String(m.id)));
            plan = sanitizeTaskPlanMemberIds(plan, allowed).plan;
        } catch (_e) { /* leave as-is */ }

        const reCheck = TasksPlanSchema.safeParse(plan);
        if (!reCheck.success) {
            const issues = reCheck.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('\n');
            throw new Error(`Plan failed final validation: ${issues}`);
        }
        plan = reCheck.data;

        const planId = token();
        myCache.set(cacheKey('tasksplan', uid, planId), {
            companyId,
            projectId: String(projectId),
            plan,
            createdAt: Date.now(),
        }, PLAN_TTL_SECONDS);

        emit({
            event: 'complete',
            phase: 'plan',
            status: true,
            needsClarification: false,
            planId,
            projectId: String(projectId),
            plan,
            tokensUsed: tokens,
            model,
        });
    } catch (error) {
        logger.error(`AIPG tasks-plan job error: ${error && error.message ? error.message : error}`);
        emit({
            event: 'error',
            phase: 'plan',
            error: error && error.message ? error.message : 'Task generation failed. Please try again.',
            code: error && error.code ? error.code : undefined,
        });
    }
}

exports.tasksPlan = async (req, res) => {
    if (!isAnyProviderConfigured()) {
        return sendError(res, 503, 'AI provider is not configured');
    }
    try {
        const uid = req.uid;
        if (!uid) return sendError(res, 401, 'Unauthorized');
        const companyId = resolveCompanyId(req);
        if (!companyId) return sendError(res, 403, 'Company access denied');

        const projectId = String((req.params && req.params.projectId) || '').trim();
        if (!OBJECT_ID_PATTERN.test(projectId)) return sendError(res, 400, 'Valid projectId required');

        const additionalRequirements = String((req.body && req.body.additionalRequirements) || '').trim().slice(0, 2000);
        let briefText = '';
        if (req.body && req.body.briefId) {
            const stash = myCache.get(cacheKey('brief', uid, req.body.briefId));
            if (stash && stash.companyId === companyId) briefText = stash.text;
        }
        const clarifications = sanitizeClarifications(req.body && req.body.clarifications);

        const jobId = token();
        res.send({ status: true, jobId, queued: true });

        setTimeout(() => {
            generateTasksPlanForJob({
                jobId, uid, companyId, projectId, additionalRequirements, briefText, clarifications,
            }).catch((error) => {
                logger.error(`AIPG tasks-plan job outer error: ${error && error.message ? error.message : error}`);
                sseEmitter.emit(jobId, {
                    event: 'error',
                    phase: 'plan',
                    error: error && error.message ? error.message : 'Task generation failed. Please try again.',
                });
            });
        }, 200);
        return;
    } catch (error) {
        logger.error(`AIPG tasksPlan error: ${error && error.message ? error.message : error}`);
        const httpCode = llmErrorToHttpStatus(error);
        return sendError(res, httpCode, error && error.message ? error.message : 'Task generation failed. Please try again.');
    }
};

exports.tasksExecute = async (req, res) => {
    try {
        const uid = req.uid;
        if (!uid) return sendError(res, 401, 'Unauthorized');
        const companyId = resolveCompanyId(req);
        if (!companyId) return sendError(res, 403, 'Company access denied');

        const projectId = String((req.params && req.params.projectId) || '').trim();
        if (!OBJECT_ID_PATTERN.test(projectId)) return sendError(res, 400, 'Valid projectId required');

        let plan = req.body && req.body.plan;
        if (!plan || typeof plan !== 'object') return sendError(res, 400, 'plan required in request body');

        // Never trust a client-supplied plan — re-validate server-side.
        const reCheck = TasksPlanSchema.safeParse(plan);
        if (!reCheck.success) {
            const issues = reCheck.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('\n');
            return sendError(res, 400, `Plan failed validation: ${issues}`);
        }
        plan = reCheck.data;

        let currentUserName = '';
        try {
            const members = await loadActiveMembers(companyId);
            const allowed = new Set(members.map((m) => String(m.id)));
            const me = members.find((m) => String(m.id) === String(uid));
            if (me && me.name) currentUserName = me.name;
            plan = sanitizeTaskPlanMemberIds(plan, allowed).plan;
        } catch (_e) { /* leave as-is */ }

        const userData = {
            id: String(uid),
            Employee_Name: currentUserName || (req.body && req.body.userName) || 'AlianHub AI',
            companyOwnerId: companyId,
        };

        const jobId = token();
        res.send({ status: true, jobId });

        setTimeout(() => {
            orchestrator.executeTasksIntoProject({ tasksPlan: plan, projectId, companyId, uid: String(uid), userData, jobId })
                .catch((e) => {
                    logger.error(`AIPG tasksExecute error: ${e && e.message ? e.message : e}`);
                });
        }, 200);
    } catch (error) {
        logger.error(`AIPG tasksExecute outer error: ${error && error.message ? error.message : error}`);
        return sendError(res, 500, error && error.message ? error.message : 'Execute failed');
    }
};

exports.events = (req, res) => sseEmitter.handleEvents(req, res);
