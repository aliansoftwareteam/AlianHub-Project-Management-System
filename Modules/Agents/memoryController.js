const { SCHEMA_TYPE } = require('../../Config/schemaType');
const { MongoDbCrudOpration } = require('../../utils/mongo-handler/mongoQueries');
const { getRoleType, isPrivileged } = require('../../Config/permissionGuard');
const { tenantOf, TenantError } = require('../../Config/tenant');
const { removeCache } = require('../../utils/commonFunctions');
const logger = require('../../Config/loggerConfig');
const { resolveActor, isAgent } = require('./actor');
const scope = require('./scope');
const memory = require('./memory');

const OBJECT_ID = /^[0-9a-fA-F]{24}$/;
const ROW_STATUSES = [memory.STATUS.ACTIVE, memory.STATUS.RETIRED];
const fail = (res, statusText, code) => res.status(code || 200).send({ status: false, statusText, message: statusText });

/* Company, membership and role for the caller, or the error already sent. */
const authed = async (req, res) => {
    let companyId;
    try { companyId = tenantOf(req); } catch (e) {
        fail(res, e.message, e instanceof TenantError ? e.statusCode : 403);
        return null;
    }
    if (!req.uid) { fail(res, 'Unauthorized.', 401); return null; }
    const role = await getRoleType(companyId, req.uid);
    if (role === null || role === undefined) { fail(res, 'You are not a member of this company.', 403); return null; }
    const actor = req.agentActor || await resolveActor(req);
    return { companyId, uid: String(req.uid), role, privileged: isPrivileged(role), human: !isAgent(actor) && Boolean(actor.userId) };
};

const canSeeProject = async (companyId, uid, projectId) => (await scope.visibleProjectIds(companyId, uid)).map(String).includes(projectId);

const projectIdOf = (req) => { const id = String((req.params && req.params.projectId) || ''); return OBJECT_ID.test(id) ? id : null; };

const agentActivityOf = async (companyId, uid) => {
    try {
        const doc = await MongoDbCrudOpration(companyId, { type: SCHEMA_TYPE.NOTIFICATIONS_SETTINGS, data: [{ userId: String(uid) }, { agentActivity: 1 }] }, 'findOne');
        return doc ? doc.agentActivity !== false : true;
    } catch (e) { return true; }
};

/* The notify preference is the same switch as "agent activity" on the
 * Notifications page, so a change here shows up there too. */
const mirrorAgentActivity = async (companyId, uid, notify) => {
    try {
        await MongoDbCrudOpration(companyId, { type: SCHEMA_TYPE.NOTIFICATIONS_SETTINGS, data: [{ userId: String(uid) }, { $set: { agentActivity: notify } }] }, 'updateOne');
        removeCache(`notification:${uid}:${companyId}`);
    } catch (e) { logger.error(`agent preferences: agentActivity not mirrored for ${uid}: ${e.message}`); }
};

const preferencesPayload = async (companyId, uid) => {
    const out = await memory.listUser({ companyId, userId: uid });
    const notify = out.preferences.notify === null ? await agentActivityOf(companyId, uid) : out.preferences.notify === true;
    return { tone: out.preferences.tone, reviewDepth: out.preferences.reviewDepth, notify, candidates: out.candidates };
};

/* GET /api/v2/agents/memory/project/:projectId */
exports.getProjectMemory = async (req, res) => {
    try {
        const auth = await authed(req, res);
        if (!auth) return;
        const projectId = projectIdOf(req);
        if (!projectId) return fail(res, 'A valid projectId is required.', 400);
        if (!(await canSeeProject(auth.companyId, auth.uid, projectId))) return fail(res, 'Project not found.', 404);
        const data = await memory.listProject({ companyId: auth.companyId, projectId });
        return res.send({ status: true, statusText: 'OK', data: { ...data, canEdit: auth.privileged } });
    } catch (e) { logger.error(`getProjectMemory: ${e.message}`); return fail(res, e.message, e.status); }
};

/* POST /api/v2/agents/memory/project/:projectId  { kind, text } */
exports.addProjectMemory = async (req, res) => {
    try {
        const auth = await authed(req, res);
        if (!auth) return;
        if (!auth.human) return fail(res, 'Agents cannot edit memory — a person has to.', 403);
        if (!auth.privileged) return fail(res, 'Owner/admin only.', 403);
        const projectId = projectIdOf(req);
        if (!projectId) return fail(res, 'A valid projectId is required.', 400);
        if (!(await canSeeProject(auth.companyId, auth.uid, projectId))) return fail(res, 'Project not found.', 404);
        const body = req.body || {};
        if (!memory.PROJECT_KINDS.includes(body.kind)) return fail(res, `kind must be one of ${memory.PROJECT_KINDS.join(', ')}.`, 400);
        const text = memory.sanitise(body.text);
        if (!text) return fail(res, 'text is required.', 400);
        const existing = await memory.find({ companyId: auth.companyId, kind: body.kind, scopeId: projectId, key: memory.slug(text) });
        if (existing && existing.status === memory.STATUS.ACTIVE) return fail(res, 'This is already on record.', 409);
        const row = await memory.remember({ companyId: auth.companyId, kind: body.kind, scopeId: projectId, text, source: { origin: 'owner', userId: auth.uid } });
        return res.send({ status: true, statusText: 'Remembered.', data: row });
    } catch (e) { logger.error(`addProjectMemory: ${e.message}`); return fail(res, e.message, e.status); }
};

/* PUT /api/v2/agents/memory/:id  { scopeId, text?, status? } — :id is kind:key */
exports.updateMemory = async (req, res) => {
    try {
        const auth = await authed(req, res);
        if (!auth) return;
        if (!auth.human) return fail(res, 'Agents cannot edit memory — a person has to.', 403);
        let id = String((req.params && req.params.id) || '');
        try { id = decodeURIComponent(id); } catch (e) { /* keep as sent */ }
        const parsed = memory.parseId(id);
        if (!parsed) return fail(res, 'A valid memory id (kind:key) is required.', 400);
        const body = req.body || {};
        const scopeId = String(body.scopeId || '');
        if (memory.PROJECT_KINDS.includes(parsed.kind)) {
            if (!OBJECT_ID.test(scopeId)) return fail(res, 'scopeId must be the projectId.', 400);
            if (!auth.privileged) return fail(res, 'Owner/admin only.', 403);
            if (!(await canSeeProject(auth.companyId, auth.uid, scopeId))) return fail(res, 'Memory row not found.', 404);
        } else if (scopeId !== auth.uid) {
            return fail(res, 'Memory row not found.', 404);
        }
        const patch = {};
        if (body.text !== undefined) {
            patch.text = memory.sanitise(body.text);
            if (!patch.text) return fail(res, 'text must not be empty.', 400);
        }
        if (body.status !== undefined) {
            if (!ROW_STATUSES.includes(body.status)) return fail(res, `status must be one of ${ROW_STATUSES.join(', ')}.`, 400);
            patch.status = body.status;
        }
        if (!Object.keys(patch).length) return fail(res, 'Nothing to update.', 400);
        const row = await memory.update({ companyId: auth.companyId, id, scopeId, ...patch });
        if (!row) return fail(res, 'Memory row not found.', 404);
        return res.send({ status: true, statusText: 'Memory updated.', data: row });
    } catch (e) { logger.error(`updateMemory: ${e.message}`); return fail(res, e.message, e.status); }
};

/* GET /api/v2/agents/preferences — the caller's own */
exports.getPreferences = async (req, res) => {
    try {
        const auth = await authed(req, res);
        if (!auth) return;
        return res.send({ status: true, statusText: 'OK', data: await preferencesPayload(auth.companyId, auth.uid) });
    } catch (e) { logger.error(`getPreferences: ${e.message}`); return fail(res, e.message, e.status); }
};

/* PUT /api/v2/agents/preferences  { tone?, reviewDepth?, notify? } */
exports.putPreferences = async (req, res) => {
    try {
        const auth = await authed(req, res);
        if (!auth) return;
        if (!auth.human) return fail(res, 'Agents cannot edit preferences — a person has to.', 403);
        const body = req.body || {};
        const writes = [];
        if (body.tone !== undefined) {
            if (body.tone !== null && !memory.TONES.includes(body.tone)) return fail(res, `tone must be one of ${memory.TONES.join(', ')} or null.`, 400);
            writes.push({ key: memory.PREFERENCE_KEY.TONE, value: body.tone });
        }
        if (body.reviewDepth !== undefined) {
            if (body.reviewDepth !== null && !memory.REVIEW_DEPTHS.includes(body.reviewDepth)) return fail(res, `reviewDepth must be one of ${memory.REVIEW_DEPTHS.join(', ')} or null.`, 400);
            writes.push({ key: memory.PREFERENCE_KEY.REVIEW_DEPTH, value: body.reviewDepth });
        }
        if (body.notify !== undefined) {
            if (typeof body.notify !== 'boolean') return fail(res, 'notify must be true or false.', 400);
            writes.push({ key: memory.PREFERENCE_KEY.NOTIFY, value: body.notify });
        }
        if (!writes.length) return fail(res, 'Nothing to update.', 400);
        for (const w of writes) {
            // eslint-disable-next-line no-await-in-loop
            await memory.setPreference({ companyId: auth.companyId, userId: auth.uid, key: w.key, value: w.value });
            // eslint-disable-next-line no-await-in-loop
            if (w.key === memory.PREFERENCE_KEY.NOTIFY) await mirrorAgentActivity(auth.companyId, auth.uid, w.value);
        }
        return res.send({ status: true, statusText: 'Preferences updated.', data: await preferencesPayload(auth.companyId, auth.uid) });
    } catch (e) { logger.error(`putPreferences: ${e.message}`); return fail(res, e.message, e.status); }
};
