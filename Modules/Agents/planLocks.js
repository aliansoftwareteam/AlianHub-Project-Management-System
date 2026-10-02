const registry = require('./registry');
const permissions = require('./permissions');
const plans = require('./projectSetup');
const projects = require('./projectCreate');
const planWork = require('./planWork');
const planFiling = require('./planFiling');
const planChoice = require('./planChoice');
const { storedProject } = require('./taskRequests');

// The parts of a plan that one person may not approve, read from that person's own rights: a status the company
// does not have yet and an automation, which an owner or an admin approves, and any status, list, field, view,
// automation or first task that person's role may not make by hand. The card marks them for that person, who
// approves the plan without them, and an approval that keeps one is refused before anything is claimed: it would
// otherwise be spent on a part that comes back not made. What is left out this way stays waiting (./planFollowUp.js).

const SETUP = 'project.setup';
const WHY = Object.freeze({ OWNER_ADMIN: 'owner_admin', OWN_RIGHTS: 'own_rights' });
const held = (error, why) => Object.freeze({ error, status: 403, reason: 'not_permitted', why });
const REFUSAL = Object.freeze({
    [WHY.OWNER_ADMIN]: held('An owner or admin approves a part of this plan. Leave that part out, or ask an owner or admin to approve it.', WHY.OWNER_ADMIN),
    [WHY.OWN_RIGHTS]: held('Your role may not make a part of this plan. Leave that part out: it stays waiting for someone whose role may.', WHY.OWN_RIGHTS),
});

const listOf = (value) => (Array.isArray(value) ? value : []);
const { keyOf } = planChoice;
const itemsOf = (params, part) => listOf(params[plans.PLAN_KEY[part]]);
const human = (userId) => ({ kind: 'human', userId });

const personOf = async (companyId, uid) => {
    const { getRoleType, isPrivileged } = require('../../Config/permissionGuard');
    return { userId: String(uid), privileged: isPrivileged(await getRoleType(companyId, uid)) };
};

const needsOwnerOrAdmin = (action) => { const entry = registry.get(action); return Boolean(entry) && entry.gate === WHY.OWNER_ADMIN; };

/* Whether the person's role may make each task, asked once for each set of details the tasks carry. */
const taskRights = (companyId, userId, projectId) => {
    const asked = new Map();
    return (task) => {
        const fields = planWork.fieldsOf(task);
        const kind = Object.keys(fields).sort().join(',');
        if (!asked.has(kind)) asked.set(kind, permissions.holderMay(companyId, human(userId), planWork.TASK, { projectId, fields }).then((may) => may.allowed));
        return asked.get(kind);
    };
};

/* The locks on the statuses, lists, fields and views of a plan: each status that would be new to the company, and
 * a whole kind the person's role may not make (`lacked` answers that for a kind). */
const ownPartLocks = async (companyId, params, { lacked, heldStatuses }) => {
    const locks = [];
    for (const part of plans.PARTS.filter((kind) => itemsOf(params, kind).length)) {
        const fresh = part === 'statuses' ? await plans.newToCompany(companyId, heldStatuses, params.statuses) : [];
        const whole = await lacked(part) ? WHY.OWN_RIGHTS : '';
        itemsOf(params, part).forEach((item, at) => {
            const why = fresh[at] ? WHY.OWNER_ADMIN : whole;
            if (why) locks.push([keyOf(part, at), why]);
        });
    }
    return locks;
};

const ruleLocks = async (companyId, userId, params) => {
    const rules = itemsOf(params, 'rules').map((rule, at) => keyOf('rules', at));
    if (!rules.length) return [];
    if (needsOwnerOrAdmin(planWork.RULE)) return rules.map((key) => [key, WHY.OWNER_ADMIN]);
    const own = await permissions.holderMay(companyId, human(userId), planWork.RULE, { projectId: params.projectId });
    return own.allowed ? [] : rules.map((key) => [key, WHY.OWN_RIGHTS]);
};

const taskLocks = async (companyId, userId, params) => {
    const mayMake = taskRights(companyId, userId, params.projectId);
    const locks = [];
    for (const [at, task] of itemsOf(params, 'tasks').entries()) {
        if (!(await mayMake(task))) locks.push([keyOf('tasks', at), WHY.OWN_RIGHTS]);
    }
    return locks;
};

const setupLocks = async (companyId, userId, params) => {
    const projectId = String(params.projectId || '');
    const project = await storedProject(companyId, projectId).catch(() => null);
    const own = await ownPartLocks(companyId, params, {
        lacked: (part) => plans.whyNot(companyId, userId, projectId, part),
        heldStatuses: project ? planWork.statusNamesOf(project) : [],
    });
    return [...own, ...(await ruleLocks(companyId, userId, params)), ...(await taskLocks(companyId, userId, params))];
};

/* A project that is not there yet follows the company's rules. A person who may not create one is refused the
 * whole change elsewhere (./approverRights.js), so no part of it is marked for them. */
const createLocks = async (companyId, userId, params) => {
    const refused = await projects.refusedFor(companyId, userId, params);
    if (refused.project) return [];
    const lacking = refused.parts.map((entry) => entry.part);
    return ownPartLocks(companyId, params, { lacked: (part) => lacking.includes(part), heldStatuses: projects.startingStatuses() });
};

const LOCKS = Object.freeze({ [SETUP]: setupLocks, [projects.ACTION]: createLocks });

/* The parts of one change the person may not approve, each by its place in the stored plan ("rules:0"), with why:
 * an owner or an admin approves it, or the person's own role may not make it. An owner or an admin holds every right. */
const locksIn = async (companyId, { userId, privileged }, change) => {
    if (privileged || !change || !Object.hasOwn(LOCKS, change.action)) return new Map();
    return new Map(await LOCKS[change.action](companyId, String(userId), planFiling.storedParams(change.action, change.params)));
};

const lockedIn = async (companyId, person, change) => [...(await locksIn(companyId, person, change)).keys()];

const refusalFor = (whys) => (whys.includes(WHY.OWNER_ADMIN) ? REFUSAL[WHY.OWNER_ADMIN] : REFUSAL[WHY.OWN_RIGHTS]);

/* null where the person may approve every part these changes keep; otherwise the refusal the approval answers. */
const approveRefusal = async (companyId, person, changes) => {
    for (const change of listOf(changes)) {
        const locks = await locksIn(companyId, person, change);
        if (locks.size) return { ...refusalFor([...locks.values()]) };
    }
    return null;
};

/* { changes } with the parts the person may not approve left out, and with them the parts that cannot be made
 * without one of those; { refusal } where that leaves a plan with nothing to make. */
const withoutLocked = async (companyId, person, changes) => {
    const open = [];
    for (const change of listOf(changes)) {
        const locks = await locksIn(companyId, person, change);
        if (!locks.size) { open.push(change); continue; }
        const params = planFiling.storedParams(change.action, change.params);
        const out = planChoice.withDependents(params, [...locks.keys()]);
        const kept = planChoice.keysIn(params).filter((key) => !out.includes(key));
        if (!kept.length && !planChoice.mayBeEmpty(change.action)) return { refusal: { ...refusalFor([...locks.values()]) } };
        open.push({ ...change, params: planChoice.keep(params, kept) });
    }
    return { changes: open };
};

module.exports = { WHY, REFUSAL, personOf, locksIn, lockedIn, approveRefusal, withoutLocked };
