const mongoose = require('mongoose');
const { SCHEMA_TYPE } = require('../../Config/schemaType');
const { MongoDbCrudOpration } = require('../../utils/mongo-handler/mongoQueries');
const { isNarrowed } = require('../../Config/tokenNarrowing');
const logger = require('../../Config/loggerConfig');
const { pageVisibilityFilter } = require('../Pages/helpers/pageRules');
const { hiddenSprintFilter } = require('../Sprints/helpers/sprintVisibility');
const { openProjects } = require('./ask');

/* Threads are private to the person who asked, admins included. A turn stores only the ids of what it
 * cited; reading a thread back resolves each one under the reader's access of the day. */

const LIMITS = Object.freeze({ THREADS: 50, TURNS: 30, CONTEXT_TURNS: 6, CONTEXT_CHARS: 2000, TITLE: 120 });

const OBJECT_ID = /^[a-f0-9]{24}$/i;
const UNAUTHENTICATED = 'companyId and an authenticated user are required.';
/* A thread spans every project its owner could open when they asked, so no project list can hold it. */
const TOKEN_REFUSED = 'This token is limited to some projects, and Ask threads cannot be held to them. Use a token that is not limited to projects.';
const NOT_FOUND = 'That thread does not exist, or it is not yours.';

const store = (companyId, data, method) => MongoDbCrudOpration(String(companyId), { type: SCHEMA_TYPE.ASK_THREADS, data }, method);

const titleOf = (text) => String(text == null ? '' : text).replace(/\s+/g, ' ').trim().slice(0, LIMITS.TITLE);

const refuse = (res, statusCode, code, statusText) => res.status(statusCode).send({ status: false, statusText, code });

const refuseThread = (res) => refuse(res, 404, 'thread_not_found', NOT_FOUND);

/* Every refusal is sent here; a null means the caller already answered. */
const callerOf = (req, res) => {
    const companyId = String(req.headers['companyid'] || '');
    const uid = req.uid ? String(req.uid) : '';
    if (!companyId || !uid) {
        refuse(res, 401, 'unauthenticated', UNAUTHENTICATED);
        return null;
    }
    if (isNarrowed(req.apiToken)) {
        refuse(res, 403, 'token_limited_to_projects', TOKEN_REFUSED);
        return null;
    }
    return { companyId, uid };
};

const ownFilter = (id, uid) => (OBJECT_ID.test(String(id || '')) ? { _id: new mongoose.Types.ObjectId(String(id)), ownerId: String(uid) } : null);

const findThread = async (companyId, uid, id) => {
    const where = ownFilter(id, uid);
    return where ? store(companyId, [where, null, { lean: true }], 'findOne') : null;
};

const historyOf = (thread) => (thread && Array.isArray(thread.turns) ? thread.turns : [])
    .filter((turn) => turn && turn.question && turn.answer)
    .slice(-LIMITS.CONTEXT_TURNS)
    .flatMap((turn) => [
        { role: 'user', content: String(turn.question) },
        { role: 'assistant', content: String(turn.answer).slice(0, LIMITS.CONTEXT_CHARS) },
    ]);

const lastQuestionOf = (thread) => {
    const turns = (thread && thread.turns) || [];
    return turns.length ? String(turns[turns.length - 1].question || '') : '';
};

const pruneThreads = async (companyId, uid) => {
    const extra = await store(companyId, [{ ownerId: uid }, '_id', { sort: { lastTurnAt: -1 }, skip: LIMITS.THREADS, lean: true }], 'find');
    if (!extra || !extra.length) return;
    await store(companyId, [{ _id: { $in: extra.map((t) => t._id) }, ownerId: uid }], 'deleteMany');
};

/* Appends to `thread`, or starts one; answers the thread id. */
const appendTurn = async (companyId, uid, thread, turn) => {
    const owner = String(uid);
    if (thread) {
        const turns = [...(thread.turns || []), turn].slice(-LIMITS.TURNS);
        await store(companyId, [{ _id: thread._id, ownerId: owner }, { $set: { turns, turnCount: turns.length, lastTurnAt: turn.createdAt } }], 'updateOne');
        return String(thread._id);
    }
    const saved = await store(companyId, { ownerId: owner, title: titleOf(turn.question), turns: [turn], turnCount: 1, lastTurnAt: turn.createdAt }, 'save');
    await pruneThreads(companyId, owner).catch((error) => logger.error(`ask threads prune for ${owner}: ${error.message}`));
    return String(saved._id);
};

const objectIds = (ids) => ids.map((id) => new mongoose.Types.ObjectId(id));

const idsOfKind = (cites, kind) => [...new Set(cites.filter((c) => c.kind === kind).map((c) => String(c.sourceId)).filter((id) => OBJECT_ID.test(id)))];

/* Tasks and pages the reader can open today, by `kind:id`. Other kinds have no page of their own to open. */
const openSources = async (companyId, uid, cites) => {
    const taskIds = idsOfKind(cites, 'task');
    const pageIds = idsOfKind(cites, 'page');
    const found = new Map();
    if (!taskIds.length && !pageIds.length) return found;
    const projects = await openProjects(companyId, uid);
    const projectIds = projects.map((p) => String(p._id));
    if (!projectIds.length) return found;
    const nameById = Object.fromEntries(projects.map((p) => [String(p._id), p.ProjectName || '']));
    const [tasks, pages] = await Promise.all([
        taskIds.length ? MongoDbCrudOpration(companyId, {
            type: SCHEMA_TYPE.TASKS,
            data: [{ _id: { $in: objectIds(taskIds) }, deletedStatusKey: { $ne: 1 }, ProjectID: { $in: projectIds }, ...(await hiddenSprintFilter(companyId, uid, projectIds)) }, 'TaskName ProjectID', { lean: true }],
        }, 'find') : [],
        pageIds.length ? MongoDbCrudOpration(companyId, {
            type: SCHEMA_TYPE.PAGES,
            data: [{ _id: { $in: objectIds(pageIds) }, deletedStatusKey: { $ne: 1 }, ProjectID: { $in: projectIds }, $and: [pageVisibilityFilter(uid)] }, 'title ProjectID', { lean: true }],
        }, 'find') : [],
    ]);
    const add = (kind, row, title) => found.set(`${kind}:${String(row._id)}`, { title: String(title || ''), projectId: String(row.ProjectID || ''), project: nameById[String(row.ProjectID)] || '' });
    (tasks || []).forEach((t) => add('task', t, t.TaskName));
    (pages || []).forEach((p) => add('page', p, p.title));
    return found;
};

const citedView = (cite, found) => {
    const open = found.get(`${cite.kind}:${String(cite.sourceId)}`);
    return {
        kind: cite.kind,
        id: String(cite.sourceId),
        ref: cite.ref || '',
        title: open ? open.title : '',
        project: open ? open.project : '',
        projectId: open ? open.projectId : '',
        available: Boolean(open),
    };
};

/* GET /api/v1/ai/ask/threads */
const listThreads = async (req, res) => {
    try {
        const caller = callerOf(req, res);
        if (!caller) return undefined;
        const rows = await store(caller.companyId, [{ ownerId: caller.uid }, 'title turnCount lastTurnAt', { sort: { lastTurnAt: -1 }, limit: LIMITS.THREADS, lean: true }], 'find');
        return res.send({
            status: true,
            data: {
                threads: (rows || []).map((t) => ({ id: String(t._id), title: t.title || '', turns: Number(t.turnCount) || 0, lastTurnAt: t.lastTurnAt || null })),
                limits: { threads: LIMITS.THREADS, turns: LIMITS.TURNS },
            },
        });
    } catch (error) {
        logger.error(`ask threads list: ${error.message}`);
        return res.status(500).send({ status: false, statusText: error.message });
    }
};

/* GET /api/v1/ai/ask/threads/:id */
const getThread = async (req, res) => {
    try {
        const caller = callerOf(req, res);
        if (!caller) return undefined;
        const thread = await findThread(caller.companyId, caller.uid, req.params && req.params.id);
        if (!thread) return refuseThread(res);
        const turns = thread.turns || [];
        const found = await openSources(caller.companyId, caller.uid, turns.flatMap((turn) => turn.cited || []));
        return res.send({
            status: true,
            data: {
                id: String(thread._id),
                title: thread.title || '',
                turns: turns.map((turn) => ({
                    turnId: turn.turnId,
                    question: turn.question,
                    answer: turn.answer || '',
                    mode: turn.mode || 'ask',
                    model: turn.model || '',
                    createdAt: turn.createdAt,
                    cited: (turn.cited || []).map((cite) => citedView(cite, found)),
                })),
            },
        });
    } catch (error) {
        logger.error(`ask thread read: ${error.message}`);
        return res.status(500).send({ status: false, statusText: error.message });
    }
};

/* PUT /api/v1/ai/ask/threads/:id  body: { title } */
const renameThread = async (req, res) => {
    try {
        const caller = callerOf(req, res);
        if (!caller) return undefined;
        const where = ownFilter(req.params && req.params.id, caller.uid);
        if (!where) return refuseThread(res);
        const title = titleOf(req.body && req.body.title);
        if (!title) return refuse(res, 400, 'title_required', 'Name the thread first.');
        const result = await store(caller.companyId, [where, { $set: { title } }], 'updateOne');
        if (!result || !result.matchedCount) return refuseThread(res);
        return res.send({ status: true, statusText: 'Renamed.', data: { id: String(req.params.id), title } });
    } catch (error) {
        logger.error(`ask thread rename: ${error.message}`);
        return res.status(500).send({ status: false, statusText: error.message });
    }
};

/* DELETE /api/v1/ai/ask/threads/:id */
const deleteThread = async (req, res) => {
    try {
        const caller = callerOf(req, res);
        if (!caller) return undefined;
        const where = ownFilter(req.params && req.params.id, caller.uid);
        if (!where) return refuseThread(res);
        const result = await store(caller.companyId, [where], 'deleteOne');
        if (!result || !result.deletedCount) return refuseThread(res);
        return res.send({ status: true, statusText: 'Deleted.', data: { id: String(req.params.id) } });
    } catch (error) {
        logger.error(`ask thread delete: ${error.message}`);
        return res.status(500).send({ status: false, statusText: error.message });
    }
};

const validOwner = (userId) => {
    const id = String(userId || '').trim();
    if (!OBJECT_ID.test(id)) throw new Error('Erasing Ask threads needs a valid user id.');
    return id;
};

/* Erasure by person (Knowledge/controls): answers how many threads went. */
const eraseOwner = async (companyId, userId) => {
    const result = await store(companyId, [{ ownerId: validOwner(userId) }], 'deleteMany');
    return (result && result.deletedCount) || 0;
};

const hasThreads = async (companyId, userId) => Boolean(await store(companyId, [{ ownerId: validOwner(userId) }, '_id', { lean: true }], 'findOne'));

module.exports = {
    LIMITS, callerOf, findThread, historyOf, lastQuestionOf, appendTurn, listThreads, getThread, renameThread, deleteThread, eraseOwner, hasThreads,
};
