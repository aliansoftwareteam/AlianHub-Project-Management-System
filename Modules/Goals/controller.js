const mongoose = require('mongoose');
const { SCHEMA_TYPE } = require('../../Config/schemaType');
const { MongoDbCrudOpration } = require('../../utils/mongo-handler/mongoQueries');
const { sessionTenantOf, TenantError } = require('../../Config/tenant');
const { ACTIVE_SEAT } = require('../../Config/seatStatus');
const { ROLE_GUEST, isPrivileged } = require('../../Config/roleTypes');
const { isNarrowed } = require('../../Config/tokenNarrowing');
const logger = require('../../Config/loggerConfig');
const { recordAuditFromReq } = require('../Audit/recorder');
const { openableTasks } = require('../Tasks/helpers/taskReadAccess');
const access = require('./helpers/goalAccess');
const rules = require('./helpers/goalRules');
const { withProgress } = require('./helpers/goalProgress');
const { LIVE, ARCHIVED, crud, announce, writeAtRevision } = require('./goalStore');
const sources = require('./goalSources');
const counts = require('./goalCounts');
const reached = require('./goalReached');

const { GoalRefused } = rules;

const OBJECT_ID = /^[a-f0-9]{24}$/i;
const WRITE_ATTEMPTS = 3;
const AUDIENCE_FIELDS = Object.freeze(['visibility', 'sharedWith', 'ownerUserId']);

const NOT_FOUND = 'Goal not found.';
const TARGET_NOT_FOUND = 'Target not found.';
const TASK_NOT_FOUND = 'Task not found.';
const FORBIDDEN = 'You do not have permission to perform this action.';
const NARROWED = 'A token limited to some projects cannot read or change goals.';
const IS_ARCHIVED = 'This goal is archived. Restore it to change it.';
const BUSY = 'This goal was changed at the same moment. Try again.';
const FAILED = 'Something went wrong with the goal.';

const refuse = (res, statusCode, statusText, message, extra = {}) => res.status(statusCode).json({ status: false, statusText, message, ...extra });
const stop = (statusCode, statusText) => Object.assign(new Error(statusText), { statusCode, stopped: true });

const plain = (doc) => (doc && typeof doc.toObject === 'function' ? doc.toObject() : doc);
const newId = () => new mongoose.Types.ObjectId().toString();
const sameId = (a, b) => String(a) === String(b);

/* A reader is given the sources the number is built from, which every reader can open. The ones left out
 * are named for those who can change them; a reader learns only how many there are. */
const presentCount = (target, { canEdit, live, now, timedOutAt }) => {
    const all = sources.sourcesOf(target);
    const counted = target.counted || {};
    const skipped = { ...sources.none(), ...(counted.skipped || {}) };
    const kept = (kind) => all[kind].filter((id) => !skipped[kind].map(String).includes(id));
    const due = live && counts.isDue(target, now);
    const timedOut = due && Boolean(timedOutAt);
    const stored = counted.failedAt ? { failedAt: counted.failedAt, failedCode: counted.failedCode || counts.COUNT_ERROR } : {};
    return {
        sources: canEdit ? all : { sprintIds: kept('sprintIds'), taskIds: kept('taskIds') },
        counted: {
            done: counted.done || 0,
            total: counted.total || 0,
            at: counted.at || null,
            ...(timedOut ? { failedAt: timedOutAt, failedCode: counts.TIMED_OUT } : stored),
        },
        notCounted: skipped.sprintIds.length + skipped.taskIds.length,
        ...(canEdit ? { notCountedSources: { sprintIds: skipped.sprintIds.map(String), taskIds: skipped.taskIds.map(String) } } : {}),
        dirty: target.dirty === true,
        updating: due && !timedOut,
    };
};

const VALUE_OF = Object.freeze({
    [rules.BOOLEAN]: (target) => ({ done: target.done === true }),
    [rules.TASKS]: presentCount,
});
const measuredValue = (target) => ({
    start: target.start,
    target: target.target,
    current: target.current,
    unit: target.unit || '',
    ...(target.kind === rules.CURRENCY ? { currencyCode: target.currencyCode } : {}),
});

const presentTarget = (target, view) => ({
    id: String(target.id),
    name: target.name,
    kind: target.kind,
    weight: target.weight || 1,
    progressPct: target.progressPct || 0,
    reachedAt: target.reachedAt || null,
    ...(VALUE_OF[target.kind] || measuredValue)(target, view),
    updatedBy: target.updatedBy || '',
    updatedAt: target.updatedAt || null,
});

/* The people a goal is shared with are listed for those who manage the list; a reader learns only whether they are on it. */
const present = (goal, caller, now = new Date()) => {
    const canEdit = access.canEdit(goal, caller);
    const view = { canEdit, live: goal.deletedStatusKey === LIVE, now, timedOutAt: counts.timedOutAt(caller.companyId, goal._id, now) };
    return {
        _id: String(goal._id),
        name: goal.name,
        description: goal.description || '',
        ownerUserId: String(goal.ownerUserId),
        periodStart: goal.periodStart || '',
        periodEnd: goal.periodEnd || '',
        visibility: goal.visibility,
        sharedWith: canEdit ? (goal.sharedWith || []).map(String) : [],
        sharedWithMe: access.isNamed(goal, caller),
        isOwner: access.isOwner(goal, caller),
        color: goal.color || '',
        progressPct: goal.progressPct || 0,
        targets: (goal.targets || []).map((target) => presentTarget(target, view)),
        archived: goal.deletedStatusKey === ARCHIVED,
        canEdit,
        canSetValue: access.canSetValue(goal, caller),
        createdBy: goal.createdBy || '',
        createdAt: goal.createdAt || null,
        updatedAt: goal.updatedAt || null,
    };
};

/* Each counted target is sent with the names of the sources this reader can open themselves. The names
 * are read once for everything in the answer, and an answer whose names could not be read goes out without them. */
const presentAll = async (goals, caller, now = new Date()) => {
    const shown = goals.map((goal) => present(goal, caller, now));
    const counted = (target) => target.kind === rules.TASKS;
    const linked = sources.merged(shown.flatMap((goal) => goal.targets).filter(counted).map((target) => target.sources));
    const names = await sources.namesFor(caller.companyId, caller.uid, linked).catch((error) => {
        logger.error(`goals source names: ${error.message || error}`);
        return sources.noNames();
    });
    return shown.map((goal) => ({
        ...goal,
        targets: goal.targets.map((target) => (counted(target) ? { ...target, sourceNames: sources.namesOf(names, target.sources) } : target)),
    }));
};

const sent = async (res, statusText, goal, caller) => res.status(200).json({
    status: true,
    statusText,
    data: goal && access.canSee(goal, caller) ? (await presentAll([goal], caller))[0] : null,
});

/* The audit log is read by owners and admins, so it records a goal only while the whole workspace can read that goal. */
const audit = (req, action, goal, { was, fields } = {}) => {
    const shown = [was, goal].find((state) => state && state.visibility === access.WORKSPACE);
    if (!shown) return;
    recordAuditFromReq(req, { action, entityType: 'goal', entityId: String(goal._id), entityName: shown.name, meta: fields ? { fields } : {} });
};

const callerOf = async (req, res) => {
    const companyId = sessionTenantOf(req);
    const uid = String(req.uid || '');
    if (!uid) {
        refuse(res, 401, 'Unauthorized', 'Sign in to use goals.');
        return null;
    }
    if (isNarrowed(req.apiToken)) {
        refuse(res, 403, 'Forbidden', NARROWED);
        return null;
    }
    const seat = await MongoDbCrudOpration(companyId, {
        type: SCHEMA_TYPE.COMPANY_USERS,
        data: [{ userId: uid, ...ACTIVE_SEAT }, { roleType: 1 }],
    }, 'findOne');
    if (!seat || typeof seat.roleType !== 'number') {
        refuse(res, 403, 'Forbidden', 'An active seat in this company is required.');
        return null;
    }
    return { companyId, uid, isGuest: seat.roleType === ROLE_GUEST, isPrivileged: isPrivileged(seat.roleType) };
};

const handled = (where, handler) => async (req, res) => {
    try {
        const caller = await callerOf(req, res);
        if (!caller) return undefined;
        return await handler(req, res, caller);
    } catch (error) {
        if (error instanceof GoalRefused) return refuse(res, 400, 'Request refused', error.message, { field: error.field, ...error.extra });
        if (error && error.stopped) return refuse(res, error.statusCode, error.message, error.message);
        if (error instanceof TenantError) return refuse(res, error.statusCode, 'Forbidden', error.message);
        logger.error(`goals ${where}: ${error.message || error}`);
        return refuse(res, 500, FAILED, FAILED);
    }
};

/* A goal the caller cannot read answers exactly as one that does not exist. */
const visibleGoal = async (caller, id) => {
    if (!OBJECT_ID.test(String(id || ''))) throw stop(404, NOT_FOUND);
    const goal = await crud(caller.companyId, [
        { _id: new mongoose.Types.ObjectId(String(id)), deletedStatusKey: { $in: [LIVE, ARCHIVED] }, ...access.visibleTo(caller) },
        null,
        { lean: true },
    ], 'findOne');
    if (!goal) throw stop(404, NOT_FOUND);
    return goal;
};

/* Every write names the revision it read, so it lands only on the goal the access decision was made on;
 * when another write got there first the goal is read and judged again. */
const mutate = async (caller, id, allowed, change, { archivedToo = false } = {}) => {
    for (let attempt = 0; attempt < WRITE_ATTEMPTS; attempt += 1) {
        const goal = await visibleGoal(caller, id);
        if (!allowed(goal, caller)) throw stop(403, FORBIDDEN);
        if (!archivedToo && goal.deletedStatusKey !== LIVE) throw stop(409, IS_ARCHIVED);
        const crossing = reached.stamped(goal, await change(goal));
        const saved = await writeAtRevision(caller.companyId, goal, { ...crossing.set, updatedBy: caller.uid });
        if (saved) {
            reached.tell(caller.companyId, saved, crossing.due, caller.uid);
            return { was: goal, saved };
        }
    }
    throw stop(409, BUSY);
};

const activeRoles = async (companyId, ids) => {
    if (!ids.length) return new Map();
    const seats = await MongoDbCrudOpration(companyId, {
        type: SCHEMA_TYPE.COMPANY_USERS,
        data: [{ userId: { $in: ids }, ...ACTIVE_SEAT }, { userId: 1, roleType: 1 }],
    }, 'find');
    return new Map((seats || []).map((seat) => [String(seat.userId), seat.roleType]));
};

const requireActiveMembers = async (companyId, ids) => {
    const roles = await activeRoles(companyId, ids);
    if (!ids.every((id) => roles.has(id))) throw new GoalRefused('sharedWith', 'names someone who is not an active member');
};

const requireOwnerSeat = async (companyId, id) => {
    const roleType = (await activeRoles(companyId, [id])).get(id);
    if (typeof roleType !== 'number' || roleType === ROLE_GUEST) throw new GoalRefused('ownerUserId', 'must be an active member who is not a guest');
};

const requireCurrencies = async (companyId, targets, fieldAt = () => 'currencyCode') => {
    const priced = (target) => target.kind === rules.CURRENCY;
    const codes = [...new Set(targets.filter(priced).map((target) => target.currencyCode))];
    if (!codes.length) return;
    const rows = await MongoDbCrudOpration(companyId, { type: SCHEMA_TYPE.CURRENCY_LIST, data: [{ code: { $in: codes } }, { code: 1 }] }, 'find');
    const known = new Set((rows || []).map((row) => row.code));
    const unknownAt = targets.findIndex((target) => priced(target) && !known.has(target.currencyCode));
    if (unknownAt !== -1) throw new GoalRefused(fieldAt(unknownAt), 'is not a currency of this workspace');
};

const requireNoBody = (body) => {
    if (body !== undefined && body !== null && (typeof body !== 'object' || Object.keys(body).length)) throw new GoalRefused('body', 'must be empty');
};

const requireUnsharedWhenPrivate = (goal, sharedWith) => {
    if (goal.visibility === access.PRIVATE && (sharedWith || []).length) throw new GoalRefused('sharedWith', 'must be empty for a private goal');
};

const valueStamp = (caller, now) => ({ updatedBy: caller.uid, updatedAt: now });

const targetOf = (goal, targetId) => {
    const target = (goal.targets || []).find((entry) => sameId(entry.id, targetId));
    if (!target) throw stop(404, TARGET_NOT_FOUND);
    return target;
};

const withTarget = (goal, target) => (goal.targets || []).map((entry) => (sameId(entry.id, target.id) ? target : entry));

const newTarget = (target, caller, now) => ({ id: newId(), ...target, ...(target.kind === rules.TASKS ? {} : valueStamp(caller, now)) });

/* A read answers with the stored numbers at once; a count that is due is made again behind it. */
const recountBehind = (companyId, goals, now) => goals
    .filter((goal) => counts.hasDue(goal, now))
    .forEach((goal) => counts.recountSoon(companyId, goal._id));

exports.listGoals = handled('list', async (req, res, caller) => {
    const archived = rules.flagQuery(req.query, 'archived');
    const mine = rules.flagQuery(req.query, 'mine');
    const goals = await crud(caller.companyId, [
        { deletedStatusKey: archived ? ARCHIVED : LIVE, ...access.visibleTo(caller) },
        null,
        { lean: true },
    ], 'find') || [];
    const now = new Date();
    const listed = goals.filter((goal) => !mine || access.isOwner(goal, caller) || access.isNamed(goal, caller));
    recountBehind(caller.companyId, listed, now);
    const data = (await presentAll(listed, caller, now)).sort((a, b) => a.name.localeCompare(b.name));
    return res.status(200).json({ status: true, statusText: 'Goals fetched successfully.', data });
});

exports.getGoal = handled('get', async (req, res, caller) => {
    const goal = await visibleGoal(caller, req.params.id);
    recountBehind(caller.companyId, [goal], new Date());
    return sent(res, 'Goal fetched successfully.', goal, caller);
});

/* A task the caller cannot open answers exactly as one that does not exist, and a goal they cannot read is never among the answers. */
exports.goalsForTask = handled('for task', async (req, res, caller) => {
    const taskId = String(req.params.taskId || '');
    const [task] = OBJECT_ID.test(taskId)
        ? await openableTasks(caller.companyId, caller.uid, [taskId], { projection: { sprintId: 1, isParentTask: 1 } })
        : [];
    if (!task) throw stop(404, TASK_NOT_FOUND);
    const goals = await crud(caller.companyId, [
        { deletedStatusKey: LIVE, $and: [access.visibleTo(caller), sources.namingTask(task)] },
        null,
        { lean: true },
    ], 'find') || [];
    const data = goals
        .filter((goal) => access.canSee(goal, caller))
        .flatMap((goal) => (goal.targets || []).map((target) => ({ goal, target, through: sources.countedThrough(target, task) })))
        .filter((entry) => entry.through)
        .map(({ goal, target, through }) => ({
            goalId: String(goal._id),
            goalName: goal.name,
            color: goal.color || '',
            progressPct: goal.progressPct || 0,
            targetId: String(target.id),
            targetName: target.name,
            targetProgressPct: target.progressPct || 0,
            through,
        }))
        .sort((a, b) => a.goalName.localeCompare(b.goalName) || a.targetName.localeCompare(b.targetName));
    return res.status(200).json({ status: true, statusText: 'Goals fetched successfully.', data });
});

/* `stamp` is stored beside the goal's own fields; the welcome project's seeder marks its goal with it. */
const saveGoal = async (caller, body, stamp = {}) => {
    const { targets: newTargets = [], ...fields } = rules.parseGoalBody(body, { creating: true });
    const goal = { description: '', periodStart: '', periodEnd: '', visibility: access.PRIVATE, sharedWith: [], color: '', ...fields, ownerUserId: caller.uid };
    rules.requirePeriodInOrder(goal);
    requireUnsharedWhenPrivate(goal, goal.sharedWith);
    await requireActiveMembers(caller.companyId, goal.sharedWith);
    await requireCurrencies(caller.companyId, newTargets, (index) => `targets.${index}.currencyCode`);
    if (Number(await crud(caller.companyId, [{ ownerUserId: caller.uid, deletedStatusKey: LIVE }], 'countDocuments')) >= rules.MAX_GOALS_PER_OWNER) {
        throw Object.assign(new GoalRefused('name', ''), { message: `A person can own at most ${rules.MAX_GOALS_PER_OWNER} goals.` });
    }
    const now = new Date();
    for (const [index, target] of newTargets.entries()) {
        if (target.kind === rules.TASKS) await sources.requireCountable(caller.companyId, caller.uid, goal, target.sources, `targets.${index}.sources`);
    }
    const targets = await counts.recounted(caller.companyId, { ...goal, targets: newTargets.map((target) => newTarget(target, caller, now)) }, { now });
    const crossing = reached.stamped(null, withProgress(targets, now), now);
    const saved = plain(await crud(caller.companyId, {
        ...goal,
        ...crossing.set,
        ...stamp,
        revision: 0,
        createdBy: caller.uid,
        updatedBy: caller.uid,
        deletedStatusKey: LIVE,
    }, 'save'));
    reached.tell(caller.companyId, saved, crossing.due, caller.uid);
    announce('insert', caller.companyId);
    return saved;
};

exports.saveGoal = saveGoal;

exports.createGoal = handled('create', async (req, res, caller) => {
    if (!access.canCreate(caller)) return refuse(res, 403, FORBIDDEN, FORBIDDEN);
    const saved = await saveGoal(caller, req.body);
    audit(req, 'goal.create', saved);
    return sent(res, 'Goal saved.', saved, caller);
});

exports.updateGoal = handled('update', async (req, res, caller) => {
    const fields = rules.parseGoalBody(req.body);
    const { was, saved } = await mutate(caller, req.params.id, access.canEdit, async (goal) => {
        const next = { ...goal, ...fields };
        rules.requirePeriodInOrder(next);
        requireUnsharedWhenPrivate(next, fields.sharedWith);
        if (fields.sharedWith) await requireActiveMembers(caller.companyId, fields.sharedWith);
        if (fields.ownerUserId && !sameId(fields.ownerUserId, goal.ownerUserId)) await requireOwnerSeat(caller.companyId, fields.ownerUserId);
        const set = next.visibility === access.PRIVATE ? { ...fields, sharedWith: [] } : fields;
        const reshaped = AUDIENCE_FIELDS.find((key) => fields[key] !== undefined);
        if (!reshaped || !(goal.targets || []).some(sources.holdsSources)) return set;
        const reshapedGoal = { ...goal, ...set };
        const dropped = await sources.wouldDrop(caller.companyId, goal, reshapedGoal);
        if (dropped.sprintIds.length || dropped.taskIds.length) {
            throw new GoalRefused(reshaped, 'cannot change while the goal counts tasks that not everyone who would read it can open. Remove those sources first', { code: 'sources_would_drop', sources: dropped });
        }
        const now = new Date();
        return { ...set, ...withProgress(await counts.recounted(caller.companyId, reshapedGoal, { now }), now) };
    });
    announce('update', caller.companyId);
    audit(req, 'goal.update', saved, { was, fields: Object.keys(fields) });
    return sent(res, 'Goal saved.', saved, caller);
});

const archiveState = (where, deletedStatusKey, action, statusText) => handled(where, async (req, res, caller) => {
    requireNoBody(req.body);
    const { was, saved } = await mutate(caller, req.params.id, access.canEdit, () => ({ deletedStatusKey }), { archivedToo: true });
    announce('update', caller.companyId);
    audit(req, action, saved, { was });
    return sent(res, statusText, saved, caller);
});

exports.archiveGoal = archiveState('archive', ARCHIVED, 'goal.archive', 'Goal archived.');
exports.restoreGoal = archiveState('restore', LIVE, 'goal.restore', 'Goal restored.');

exports.addTarget = handled('add target', async (req, res, caller) => {
    const target = rules.parseNewTarget(req.body);
    const { saved } = await mutate(caller, req.params.id, access.canEdit, async (goal) => {
        if ((goal.targets || []).length >= rules.MAX_TARGETS) throw new GoalRefused('targets', `holds at most ${rules.MAX_TARGETS} targets`);
        await requireCurrencies(caller.companyId, [target]);
        if (target.kind === rules.TASKS) await sources.requireCountable(caller.companyId, caller.uid, goal, target.sources);
        const now = new Date();
        const added = newTarget(target, caller, now);
        const targets = await counts.recounted(caller.companyId, { ...goal, targets: [...(goal.targets || []), added] }, { now, only: (entry) => entry.id === added.id });
        return withProgress(targets, now);
    });
    announce('update', caller.companyId);
    return sent(res, 'Target added.', saved, caller);
});

exports.editTarget = handled('edit target', async (req, res, caller) => {
    const { saved } = await mutate(caller, req.params.id, access.canEdit, async (goal) => {
        const stored = targetOf(goal, req.params.targetId);
        const edited = rules.parseTargetEdit(req.body, stored);
        if (edited.currencyCode !== stored.currencyCode) await requireCurrencies(caller.companyId, [edited]);
        const relinked = stored.kind === rules.TASKS && edited.sources !== stored.sources;
        if (relinked) await sources.requireCountable(caller.companyId, caller.uid, goal, edited.sources);
        const now = new Date();
        const targets = await counts.recounted(caller.companyId, { ...goal, targets: withTarget(goal, edited) }, { now, only: (entry) => relinked && sameId(entry.id, edited.id) });
        return withProgress(targets, now);
    });
    announce('update', caller.companyId);
    return sent(res, 'Target saved.', saved, caller);
});

exports.removeTarget = handled('remove target', async (req, res, caller) => {
    requireNoBody(req.body);
    const { saved } = await mutate(caller, req.params.id, access.canEdit, (goal) => {
        const stored = targetOf(goal, req.params.targetId);
        return withProgress(goal.targets.filter((entry) => !sameId(entry.id, stored.id)));
    });
    announce('update', caller.companyId);
    return sent(res, 'Target removed.', saved, caller);
});

exports.setTargetValue = handled('set target value', async (req, res, caller) => {
    const { saved } = await mutate(caller, req.params.id, access.canSetValue, (goal) => {
        const stored = targetOf(goal, req.params.targetId);
        const now = new Date();
        return withProgress(withTarget(goal, { ...stored, ...rules.parseTargetValue(req.body, stored), ...valueStamp(caller, now) }), now);
    });
    announce('update', caller.companyId);
    return sent(res, 'Target updated.', saved, caller);
});
