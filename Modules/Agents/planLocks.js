const registry = require('./registry');
const permissions = require('./permissions');
const plans = require('./projectSetup');
const planWork = require('./planWork');
const planFiling = require('./planFiling');
const planChoice = require('./planChoice');

// The parts of a plan that one person may not approve: an automation, which an owner or an admin approves, and a
// first task that person's role may not make. The card marks them for that person, who approves the plan without
// them, and an approval that keeps one is refused before anything is claimed: it would otherwise be spent on a
// part that comes back not made, with no way to ask again.

const SETUP = 'project.setup';
const GATE_OWNER_ADMIN = 'owner_admin';
const REFUSAL = Object.freeze({
    error: 'An owner or admin approves a part of this plan. Leave that part out, or ask an owner or admin to approve it.',
    status: 403, reason: 'not_permitted', why: GATE_OWNER_ADMIN,
});

const listOf = (value) => (Array.isArray(value) ? value : []);
const { keyOf } = planChoice;
const itemsOf = (params, part) => listOf(params[plans.PLAN_KEY[part]]);

const personOf = async (companyId, uid) => {
    const { getRoleType, isPrivileged } = require('../../Config/permissionGuard');
    return { userId: String(uid), privileged: isPrivileged(await getRoleType(companyId, uid)) };
};

const needsOwnerOrAdmin = (action) => { const entry = registry.get(action); return Boolean(entry) && entry.gate === GATE_OWNER_ADMIN; };

/* Whether the person's role may make each task, asked once for each set of details the tasks carry. */
const taskRights = (companyId, userId, projectId) => {
    const asked = new Map();
    return (task) => {
        const fields = planWork.fieldsOf(task);
        const kind = Object.keys(fields).sort().join(',');
        if (!asked.has(kind)) asked.set(kind, permissions.holderMay(companyId, { kind: 'human', userId }, planWork.TASK, { projectId, fields }).then((held) => held.allowed));
        return asked.get(kind);
    };
};

/* The parts of one change the person may not approve, each by its place in the stored plan ("rules:0"). */
const lockedIn = async (companyId, { userId, privileged }, change) => {
    if (privileged || !change || change.action !== SETUP) return [];
    const params = planFiling.storedParams(change.action, change.params);
    const rules = needsOwnerOrAdmin(planWork.RULE) ? itemsOf(params, 'rules').map((rule, at) => keyOf('rules', at)) : [];
    const mayMake = taskRights(companyId, String(userId), params.projectId);
    const tasks = [];
    for (const [at, task] of itemsOf(params, 'tasks').entries()) {
        if (!(await mayMake(task))) tasks.push(keyOf('tasks', at));
    }
    return [...rules, ...tasks];
};

/* null where the person may approve every part these changes keep; otherwise the refusal the approval answers. */
const approveRefusal = async (companyId, person, changes) => {
    for (const change of listOf(changes)) {
        if ((await lockedIn(companyId, person, change)).length) return { ...REFUSAL };
    }
    return null;
};

const openPlaces = (params, locked) => Object.fromEntries(plans.ALL_PARTS
    .filter((part) => itemsOf(params, part).length)
    .map((part) => [part, itemsOf(params, part).map((item, at) => at).filter((at) => !locked.includes(keyOf(part, at)))]));

/* The changes with the parts the person may not approve left out; null where that leaves a plan with nothing to make. */
const withoutLocked = async (companyId, person, changes) => {
    const open = [];
    for (const change of listOf(changes)) {
        const locked = await lockedIn(companyId, person, change);
        const kept = locked.length ? planChoice.narrow([change], { 0: openPlaces(planFiling.storedParams(change.action, change.params), locked) }) : { changes: [change] };
        if (kept.error) return null;
        open.push(kept.changes[0]);
    }
    return open;
};

module.exports = { REFUSAL, personOf, lockedIn, approveRefusal, withoutLocked };
