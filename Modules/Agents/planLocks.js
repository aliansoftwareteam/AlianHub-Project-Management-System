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
//
// One kind of part nobody can approve: a status new to the company in a plan a connected agent filed for a person
// who is neither an owner nor an admin. The plan runs as that person, who cannot add one, so the card says so to
// every reader, the part never waits, and the rest of the plan is approved without it.

const SETUP = 'project.setup';
const SOURCE_MCP = 'mcp';
const WHY = Object.freeze({ OWNER_ADMIN: 'owner_admin', OWN_RIGHTS: 'own_rights', NOT_THIS_PLAN: 'not_this_plan' });
const held = (error, why) => Object.freeze({ error, status: 403, reason: 'not_permitted', why });
const REFUSAL = Object.freeze({
    [WHY.OWNER_ADMIN]: held('An owner or admin approves a part of this plan. Leave that part out, or ask an owner or admin to approve it.', WHY.OWNER_ADMIN),
    [WHY.OWN_RIGHTS]: held('Your role may not make a part of this plan. Leave that part out: it stays waiting for someone whose role may.', WHY.OWN_RIGHTS),
    [WHY.NOT_THIS_PLAN]: held('What this plan holds cannot be made through it: its status is new to the workspace. Decline it. An owner or admin can add the status in Settings, or ask their own AI.', WHY.NOT_THIS_PLAN),
});

const listOf = (value) => (Array.isArray(value) ? value : []);
const { keyOf } = planChoice;
const itemsOf = (params, part) => listOf(params[plans.PLAN_KEY[part]]);
const human = (userId) => ({ kind: 'human', userId });

const isPrivilegedIn = async (companyId, uid) => {
    const { getRoleType, isPrivileged } = require('../../Config/permissionGuard');
    return isPrivileged(await getRoleType(companyId, uid));
};

const personOf = async (companyId, uid) => ({ userId: String(uid), privileged: await isPrivilegedIn(companyId, uid) });

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
const ownPartLocks = async (companyId, params, { lacked, heldStatuses, reader }) => {
    const locks = [];
    const newStatus = reader.stuck ? WHY.NOT_THIS_PLAN : WHY.OWNER_ADMIN;
    for (const part of plans.PARTS.filter((kind) => itemsOf(params, kind).length)) {
        const fresh = part === 'statuses' ? await plans.newToCompany(companyId, heldStatuses, params.statuses) : [];
        const whole = !reader.privileged && await lacked(part) ? WHY.OWN_RIGHTS : '';
        itemsOf(params, part).forEach((item, at) => {
            const why = fresh[at] ? newStatus : whole;
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

const setupLocks = async (companyId, reader, params) => {
    const projectId = String(params.projectId || '');
    const project = await storedProject(companyId, projectId).catch(() => null);
    const own = await ownPartLocks(companyId, params, {
        reader, lacked: (part) => plans.whyNot(companyId, reader.userId, projectId, part), heldStatuses: project ? planWork.statusNamesOf(project) : [],
    });
    if (reader.privileged) return own;
    return [...own, ...(await ruleLocks(companyId, reader.userId, params)), ...(await taskLocks(companyId, reader.userId, params))];
};

/* A project that is not there yet follows the company's rules. A person who may not create one is refused the
 * whole change elsewhere (./approverRights.js), so no part of it is marked for them. */
const createLocks = async (companyId, reader, params) => {
    const refused = reader.privileged ? { project: '', parts: [] } : await projects.refusedFor(companyId, reader.userId, params);
    if (refused.project) return [];
    const lacking = refused.parts.map((entry) => entry.part);
    return ownPartLocks(companyId, params, { reader, lacked: (part) => lacking.includes(part), heldStatuses: projects.startingStatuses() });
};

const LOCKS = Object.freeze({ [SETUP]: setupLocks, [projects.ACTION]: createLocks });

/* Whether the plan runs as a person who cannot add a status to the company: the one a connected agent filed it for. */
const runsAsOneWhoCannotAdd = async (companyId, filed) => Boolean(filed) && filed.source === SOURCE_MCP && Boolean(filed.requestedBy)
    && !(await isPrivilegedIn(companyId, filed.requestedBy));

const readLocks = async (companyId, { userId, privileged }, action, params, filed) => {
    const stuck = itemsOf(params, 'statuses').length > 0 && await runsAsOneWhoCannotAdd(companyId, filed);
    if (privileged && !stuck) return new Map();
    return new Map(await LOCKS[action](companyId, { userId: String(userId), privileged: Boolean(privileged), stuck }, params));
};

/* The parts of one change the person may not approve, each by its place in the stored plan ("rules:0"), with why:
 * an owner or an admin approves it, the person's own role may not make it, or this plan cannot make it for anyone.
 * An owner or an admin holds every right. `filed` is the proposal the change belongs to. `seen`, when given, is one
 * request's own memory, so the rights behind a plan are read once for a reader however many times they are asked for. */
const locksIn = (companyId, person, change, filed = null, seen = null) => {
    if (!change || !Object.hasOwn(LOCKS, change.action)) return Promise.resolve(new Map());
    const params = planFiling.storedParams(change.action, change.params);
    const read = () => readLocks(companyId, person, change.action, params, filed);
    if (!seen) return read();
    const key = JSON.stringify([String(person.userId), Boolean(person.privileged), (filed && filed.source) || '', String((filed && filed.requestedBy) || ''), change.action, params]);
    if (!seen.has(key)) seen.set(key, read());
    return seen.get(key);
};

const lockedIn = async (companyId, person, change, filed, seen) => [...(await locksIn(companyId, person, change, filed, seen)).keys()];

const keysLocked = (locks, kinds) => [...locks].filter(([, why]) => kinds.includes(why)).map(([key]) => key);
const RIGHTS = Object.freeze([WHY.OWNER_ADMIN, WHY.OWN_RIGHTS]);
const refusalFor = (whys) => REFUSAL[[WHY.OWNER_ADMIN, WHY.OWN_RIGHTS, WHY.NOT_THIS_PLAN].find((why) => whys.includes(why))];

/* The parts of a plan it cannot make for anyone, and with them every part that cannot be made without one. */
const neverMadeIn = (params, locks) => planChoice.withDependents(params, keysLocked(locks, [WHY.NOT_THIS_PLAN]));

/* The parts of the plan that are still someone's to approve once `locks` are taken out with what needs them. */
const openIn = (params, locks) => {
    const out = planChoice.withDependents(params, [...locks.keys()]);
    return planChoice.keysIn(params).filter((key) => !out.includes(key));
};

/* null where the person may approve every part these changes keep; otherwise the refusal the approval answers.
 * A part this plan cannot make for anyone does not stop the approval of the rest: it comes back not made, with
 * why. A plan that keeps nothing else is refused, so its approval is not spent on nothing. */
const approveRefusal = async (companyId, person, changes, filed = null) => {
    for (const change of listOf(changes)) {
        const locks = await locksIn(companyId, person, change, filed);
        const byRights = keysLocked(locks, RIGHTS);
        if (byRights.length) return { ...refusalFor(byRights.map((key) => locks.get(key))) };
        const params = planFiling.storedParams(change.action, change.params);
        if (locks.size && !openIn(params, locks).length && !planChoice.mayBeEmpty(change.action)) return { ...REFUSAL[WHY.NOT_THIS_PLAN] };
    }
    return null;
};

/* { changes } with the parts the person may not approve left out, and with them the parts that cannot be made
 * without one of those; { refusal } where that leaves a plan with nothing to make. */
const withoutLocked = async (companyId, person, changes, filed = null, seen = null) => {
    const open = [];
    for (const change of listOf(changes)) {
        const locks = await locksIn(companyId, person, change, filed, seen);
        if (!locks.size) { open.push(change); continue; }
        const params = planFiling.storedParams(change.action, change.params);
        const kept = openIn(params, locks);
        if (!kept.length && !planChoice.mayBeEmpty(change.action)) return { refusal: { ...refusalFor([...locks.values()]) } };
        open.push({ ...change, params: planChoice.keep(params, kept) });
    }
    return { changes: open };
};

module.exports = { WHY, RIGHTS, REFUSAL, personOf, locksIn, lockedIn, keysLocked, neverMadeIn, approveRefusal, withoutLocked };
