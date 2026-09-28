const mongoose = require('mongoose');
const { SCHEMA_TYPE } = require('../../../Config/schemaType');
const { MongoDbCrudOpration } = require('../../../utils/mongo-handler/mongoQueries');
const { nonMembersOf } = require('../../../Config/companyMembers');
const { ACTIVE_SEAT } = require('../../../Config/seatStatus');
const { canReadProject } = require('../../../Config/projectAccess');
const { namesOf } = require('../../Workflows/people');

const MODES = ['add', 'replace', 'remove', 'clear'];
const TASK_CREATOR = 'task_creator';
const FORM_SUBMITTER = 'form_submitter';
const ROLES = [TASK_CREATOR, FORM_SUBMITTER];
const ROTATING_MODES = ['add', 'replace'];
const OBJECT_ID = /^[0-9a-fA-F]{24}$/;
const PLACEHOLDER = /^\{\{[^{}]+\}\}$/;
const STEP_KEY = /^[\w-]{1,40}$/;

const listed = (config = {}) => [...new Set((Array.isArray(config.userIds) ? config.userIds : [config.userIds])
    .filter((v) => v !== undefined && v !== null)
    .map((v) => String(v).trim())
    .filter(Boolean))];

const rotates = (config = {}) => config.roundRobin === true && ROTATING_MODES.includes(config.mode);

const configErrors = (config = {}, { trigger } = {}) => {
    const errors = [];
    const entries = listed(config);
    if (config.mode !== 'clear' && !entries.length) errors.push('userIds: name at least one person unless the mode is clear');
    entries.filter((e) => !OBJECT_ID.test(e) && !ROLES.includes(e) && !PLACEHOLDER.test(e))
        .forEach((e) => errors.push(`userIds: "${e}" is not a person of this workspace`));
    if (entries.includes(FORM_SUBMITTER) && trigger && trigger !== 'form.submitted') {
        errors.push('userIds: only a form rule has a form submitter');
    }
    if (config.roundRobin === true && !ROTATING_MODES.includes(config.mode)) errors.push('roundRobin: only adding or replacing can take turns');
    if (config.roundRobin === true && entries.length < 2) errors.push('roundRobin: taking turns needs two or more people');
    return errors;
};

const agentsAmong = async (companyId, ids) => {
    const candidates = ids.filter((id) => OBJECT_ID.test(id));
    if (!candidates.length) return new Map();
    const rows = await MongoDbCrudOpration(companyId, {
        type: SCHEMA_TYPE.AGENTS,
        data: [{ _id: { $in: candidates.map((id) => new mongoose.Types.ObjectId(id)) } }, { name: 1 }],
    }, 'find');
    return new Map((rows || []).map((row) => [String(row._id), row.name || null]));
};

/* Why each id may not be assigned on `projectId`, or null. Agents are never assignees (their runs are started, not
 * assigned), a person needs a live seat, and a person who cannot open the project would gain access by being named. */
const refusals = async (companyId, ids, projectId) => {
    const agents = await agentsAmong(companyId, ids);
    const people = ids.filter((id) => !agents.has(id));
    const outsiders = new Set(await nonMembersOf(companyId, people));
    const verdicts = {};
    for (const id of ids) {
        if (agents.has(id)) verdicts[id] = 'agent';
        else if (outsiders.has(id)) verdicts[id] = 'not_a_member';
        // eslint-disable-next-line no-await-in-loop
        else verdicts[id] = projectId && !(await canReadProject(companyId, id, projectId)).allowed ? 'no_project_access' : null;
    }
    return { verdicts, agents };
};

const resolveRole = (entry, { task = {}, context = {} }) => {
    if (entry === TASK_CREATOR) return task.Task_Leader ? { id: String(task.Task_Leader) } : { reason: 'no_creator' };
    if (entry === FORM_SUBMITTER) {
        const actor = context.actor || {};
        const signedIn = context.eventType === 'form.submitted' && actor.kind === 'user' && actor.userId;
        return signedIn ? { id: String(actor.userId) } : { reason: 'no_submitter' };
    }
    return OBJECT_ID.test(entry) ? { id: entry } : { reason: 'not_a_member' };
};

const nameLookup = async (ids, agents = new Map()) => {
    const names = await namesOf(ids.filter((id) => OBJECT_ID.test(id) && !agents.has(id)));
    return (id) => agents.get(id) || names[id] || null;
};

const withNames = async (entries, agents) => {
    const nameOf = await nameLookup(entries.map((e) => e.userId), agents);
    return entries.map((e) => ({ ...e, name: nameOf(e.userId) }));
};

/* The turn a rotation lands on: the first assignable person at or after the cursor. Everyone passed over is reported. */
const takeTurn = (ids, verdicts, cursor) => {
    const passed = [];
    for (let i = 0; i < ids.length; i++) {
        const id = ids[(Number(cursor) + i) % ids.length];
        if (!verdicts[id]) return { picked: id, passed };
        passed.push(id);
    }
    return { picked: null, passed };
};

const nextAssignees = (mode, current, targets) => {
    if (mode === 'add') return [...current, ...targets.filter((id) => !current.includes(id))];
    if (mode === 'remove') return current.filter((id) => !targets.includes(id));
    if (mode === 'clear') return [];
    return targets.length ? targets : current;
};

/* What an assign step does to `task`: who is added, removed and skipped, and the list it leaves. Reads only. */
const planAssignment = async ({ companyId, task = {}, config = {}, context = {}, cursor = 0 }) => {
    const mode = config.mode;
    const current = (Array.isArray(task.AssigneeUserId) ? task.AssigneeUserId : []).map(String);
    const skipped = [];
    const resolved = [];
    listed(config).forEach((entry) => {
        const role = resolveRole(entry, { task, context });
        if (role.reason) skipped.push({ userId: entry, reason: role.reason });
        else if (!resolved.includes(role.id)) resolved.push(role.id);
    });

    let targets = resolved;
    let agents = new Map();
    let passedOver = 0;
    if (mode === 'add' || mode === 'replace') {
        const checked = await refusals(companyId, resolved, task.ProjectID);
        agents = checked.agents;
        if (rotates(config)) {
            const turn = takeTurn(resolved, checked.verdicts, cursor);
            passedOver = turn.passed.length;
            turn.passed.forEach((id) => skipped.push({ userId: id, reason: checked.verdicts[id] }));
            targets = turn.picked ? [turn.picked] : [];
        } else {
            resolved.filter((id) => checked.verdicts[id]).forEach((id) => skipped.push({ userId: id, reason: checked.verdicts[id] }));
            targets = resolved.filter((id) => !checked.verdicts[id]);
        }
    }

    const next = nextAssignees(mode, current, targets);
    const added = next.filter((id) => !current.includes(id));
    const removed = current.filter((id) => !next.includes(id));
    const nameOf = await nameLookup([...added, ...removed, ...targets, ...skipped.map((s) => s.userId)], agents);
    const named = (ids) => ids.map((userId) => ({ userId, name: nameOf(userId) }));
    const byKind = (s) => (OBJECT_ID.test(s.userId) ? 0 : 1);
    return {
        mode,
        roundRobin: rotates(config),
        current,
        next,
        targets: named(targets),
        added: named(added),
        removed: named(removed),
        skipped: [...skipped].sort((a, b) => byKind(a) - byKind(b)).map((s) => ({ userId: s.userId, name: nameOf(s.userId), reason: s.reason })),
        passedOver,
        changed: added.length > 0 || removed.length > 0,
    };
};

const cursorKey = (stepId) => (STEP_KEY.test(String(stepId || '')) ? String(stepId) : 'default');

const storedCursor = (rule, stepId) => Number(((rule && rule.assignCursors) || {})[cursorKey(stepId)]) || 0;

/* One turn per run, claimed atomically so two runs at once never share a slot. */
const claimTurn = async (companyId, ruleId, stepId, by = 1) => {
    if (!OBJECT_ID.test(String(ruleId || ''))) return 0;
    const path = `assignCursors.${cursorKey(stepId)}`;
    const rule = await MongoDbCrudOpration(companyId, {
        type: SCHEMA_TYPE.AUTOMATION_RULES,
        data: [{ _id: new mongoose.Types.ObjectId(String(ruleId)) }, { $inc: { [path]: by } }, { returnDocument: 'after' }],
    }, 'findOneAndUpdate');
    return (Number(((rule && rule.assignCursors) || {})[cursorKey(stepId)]) || by) - by;
};

/* The people a rule names, without a task: who is a live member and who is not. For the backtest. */
const describePeople = async (companyId, config = {}) => {
    const entries = listed(config);
    const ids = entries.filter((e) => OBJECT_ID.test(e));
    const { verdicts, agents } = await refusals(companyId, ids, null);
    const people = await withNames(ids.filter((id) => !verdicts[id]).map((userId) => ({ userId })), agents);
    const skipped = await withNames(ids.filter((id) => verdicts[id]).map((userId) => ({ userId, reason: verdicts[userId] })), agents);
    const roles = entries.filter((e) => ROLES.includes(e)).map((role) => ({ userId: role, name: null }));
    return {
        people: [...people.map(({ userId, name }) => ({ userId, name })), ...roles],
        skipped: skipped.map(({ userId, name, reason }) => ({ userId, name, reason })),
    };
};

/* Everyone a sentence may name: the company's live members, with their names. */
const activePeople = async (companyId) => {
    const seats = await MongoDbCrudOpration(companyId, { type: SCHEMA_TYPE.COMPANY_USERS, data: [{ ...ACTIVE_SEAT }, { userId: 1 }] }, 'find');
    const ids = [...new Set((seats || []).map((seat) => String(seat.userId)))];
    const names = await namesOf(ids);
    return ids.filter((id) => names[id]).map((id) => ({ id, name: names[id] }));
};

const assignStepsOf = (rule = {}) => (Array.isArray(rule.steps) ? rule.steps : []).filter((step) => step && step.action === 'assign');

/* Names for the people the assign steps of `rules` hold, so their sentences read with names. */
const peopleNamedIn = async (rules = []) => {
    const ids = [...new Set(rules.flatMap((rule) => assignStepsOf(rule).flatMap((step) => listed(step.config || {}))).filter((id) => OBJECT_ID.test(id)))];
    if (!ids.length) return [];
    const names = await namesOf(ids);
    return ids.filter((id) => names[id]).map((id) => ({ id, name: names[id] }));
};

module.exports = {
    MODES, ROLES, TASK_CREATOR, FORM_SUBMITTER,
    listed, rotates, configErrors, planAssignment, claimTurn, storedCursor, cursorKey, describePeople, activePeople, assignStepsOf, peopleNamedIn,
};
