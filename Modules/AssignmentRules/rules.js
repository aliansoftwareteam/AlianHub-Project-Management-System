const { SCHEMA_TYPE } = require('../../Config/schemaType');
const { MongoDbCrudOpration } = require('../../utils/mongo-handler/mongoQueries');
const { myCache } = require('../../Config/config');
const { removeCache } = require('../../utils/commonFunctions');
const socketEmitter = require('../../event/socketEventEmitter');
const { nonMembersOf } = require('../../Config/companyMembers');
const { canReadProject } = require('../../Config/projectAccess');
const { canReadTask } = require('../Tasks/helpers/taskReadAccess');
const { memberProfiles } = require('../../utils/companyMembers');

const MODES = Object.freeze(['suggest', 'apply']);
const MAX_ENTRIES = 50;
const MAX_WHEN = 300;
/* Short, because a second node only learns of a save when this runs out. */
const CACHE_TTL_SECONDS = 60;
const OBJECT_ID = /^[a-f0-9]{24}$/i;

class RuleError extends Error {
    constructor(message, statusCode = 400) {
        super(message);
        this.statusCode = statusCode;
    }
}

const cacheKey = (companyId, projectId) => `assignmentRules:${companyId}:${projectId}`;

const plain = (doc) => (doc && typeof doc.toObject === 'function' ? doc.toObject() : doc);

const view = (row) => (row ? {
    projectId: String(row.projectId),
    entries: (row.entries || []).map((entry) => ({ userId: String(entry.userId), when: String(entry.when || '') })),
    fallbackUserId: row.fallbackUserId ? String(row.fallbackUserId) : null,
    onCreate: row.onCreate !== false,
    onChange: row.onChange === true,
    mode: MODES.includes(row.mode) ? row.mode : 'suggest',
    revision: Number(row.revision) || 1,
    updatedBy: row.updatedBy ? String(row.updatedBy) : '',
    updatedAt: row.updatedAt || null,
    dispatcher: row.dispatcher || null,
} : null);

const readRow = async (companyId, projectId) => plain(await MongoDbCrudOpration(companyId, {
    type: SCHEMA_TYPE.ASSIGNMENT_RULES,
    data: [{ projectId: String(projectId) }],
}, 'findOne'));

async function loadRules(companyId, projectId) {
    const key = cacheKey(companyId, projectId);
    const hit = myCache.get(key);
    if (hit !== undefined) return hit;
    const rules = view(await readRow(companyId, projectId));
    myCache.set(key, rules, CACHE_TTL_SECONDS);
    return rules;
}

const idOf = (value) => {
    const id = String(value === undefined || value === null ? '' : value).trim().toLowerCase();
    return OBJECT_ID.test(id) ? id : null;
};

function validate(body = {}) {
    const raw = Array.isArray(body.entries) ? body.entries : null;
    if (!raw) throw new RuleError('entries must be a list.');
    if (raw.length > MAX_ENTRIES) throw new RuleError(`At most ${MAX_ENTRIES} people can have a rule.`);
    const seen = new Set();
    const entries = raw.map((entry) => {
        const userId = idOf(entry && entry.userId);
        if (!userId) throw new RuleError('Every rule needs a person.');
        if (seen.has(userId)) throw new RuleError('A person can have only one rule.');
        seen.add(userId);
        const when = String((entry && entry.when) || '').replace(/\s+/g, ' ').trim();
        if (!when) throw new RuleError('Every rule needs a sentence saying when that person gets a task.');
        if (when.length > MAX_WHEN) throw new RuleError(`A rule sentence can be at most ${MAX_WHEN} characters.`);
        return { userId, when };
    });
    const fallbackGiven = body.fallbackUserId !== undefined && body.fallbackUserId !== null && body.fallbackUserId !== '';
    const fallbackUserId = fallbackGiven ? idOf(body.fallbackUserId) : null;
    if (fallbackGiven && !fallbackUserId) throw new RuleError('The fallback must be a person or no assignee.');
    const mode = body.mode === undefined ? 'suggest' : body.mode;
    if (!MODES.includes(mode)) throw new RuleError('mode must be suggest or apply.');
    for (const field of ['onCreate', 'onChange']) {
        if (body[field] !== undefined && typeof body[field] !== 'boolean') throw new RuleError(`${field} must be true or false.`);
    }
    return { entries, fallbackUserId, onCreate: body.onCreate !== false, onChange: body.onChange === true, mode };
}

const namesOf = async (companyId, ids) => {
    const profiles = await memberProfiles(companyId, ids, { Employee_Name: 1, Employee_Email: 1 }).catch(() => []);
    return new Map((profiles || []).map((user) => [String(user._id), user.Employee_Name || user.Employee_Email || '']));
};

/* Rules may only name people who hold a live seat and can open the project today. */
async function assertEligible(companyId, projectId, ids) {
    if (!ids.length) return;
    const names = await namesOf(companyId, ids);
    const label = (id) => names.get(id) || 'This person';
    const outsiders = await nonMembersOf(companyId, ids);
    if (outsiders.length) throw new RuleError(`${label(outsiders[0])} is not an active member of this workspace.`);
    for (const id of ids) {
        const access = await canReadProject(companyId, id, projectId);
        if (!access.allowed) throw new RuleError(`${label(id)} cannot open this project.`);
    }
}

/* Whether the rules may hand this task to this person right now: a live seat, and the task is theirs to open. */
async function canTake(companyId, userId, task) {
    if (!idOf(userId)) return false;
    if ((await nonMembersOf(companyId, [userId])).length) return false;
    return canReadTask(companyId, userId, task);
}

async function saveRules(companyId, projectId, body, actorId) {
    const input = validate(body);
    const ids = [...new Set([...input.entries.map((entry) => entry.userId), ...(input.fallbackUserId ? [input.fallbackUserId] : [])])];
    await assertEligible(companyId, projectId, ids);

    const existing = await readRow(companyId, projectId);
    const set = { ...input, updatedBy: String(actorId), updatedAt: new Date() };
    if (existing) {
        await MongoDbCrudOpration(companyId, {
            type: SCHEMA_TYPE.ASSIGNMENT_RULES,
            data: [{ projectId: String(projectId) }, { $set: set, $inc: { revision: 1 } }],
        }, 'updateOne');
    } else {
        await MongoDbCrudOpration(companyId, {
            type: SCHEMA_TYPE.ASSIGNMENT_RULES,
            data: { projectId: String(projectId), ...set, revision: 1 },
        }, 'save');
    }
    removeCache(cacheKey(companyId, projectId));
    const saved = view(await readRow(companyId, projectId));
    socketEmitter.emit('update', {
        type: existing ? 'update' : 'insert',
        module: 'assignmentRules',
        companyId: String(companyId),
        data: { projectId: String(projectId), revision: saved ? saved.revision : 1 },
    });
    return saved;
}

module.exports = { MODES, MAX_ENTRIES, MAX_WHEN, RuleError, cacheKey, loadRules, validate, saveRules, canTake, namesOf, idOf, plain };
