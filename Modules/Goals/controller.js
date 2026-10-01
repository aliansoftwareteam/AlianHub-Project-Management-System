const mongoose = require('mongoose');
const { SCHEMA_TYPE } = require('../../Config/schemaType');
const { MongoDbCrudOpration } = require('../../utils/mongo-handler/mongoQueries');
const { sessionTenantOf, TenantError } = require('../../Config/tenant');
const { ACTIVE_SEAT } = require('../../Config/seatStatus');
const { ROLE_GUEST, isPrivileged } = require('../../Config/roleTypes');
const { isNarrowed } = require('../../Config/tokenNarrowing');
const logger = require('../../Config/loggerConfig');
const socketEmitter = require('../../event/socketEventEmitter');
const { recordAuditFromReq } = require('../Audit/recorder');
const access = require('./helpers/goalAccess');
const rules = require('./helpers/goalRules');
const { withProgress } = require('./helpers/goalProgress');

const { GoalRefused } = rules;

const OBJECT_ID = /^[a-f0-9]{24}$/i;
const LIVE = 0;
const ARCHIVED = 2;
const WRITE_ATTEMPTS = 3;
const SOCKET_MODULE = 'goals';

const NOT_FOUND = 'Goal not found.';
const TARGET_NOT_FOUND = 'Target not found.';
const FORBIDDEN = 'You do not have permission to perform this action.';
const NARROWED = 'A token limited to some projects cannot read or change goals.';
const IS_ARCHIVED = 'This goal is archived. Restore it to change it.';
const BUSY = 'This goal was changed at the same moment. Try again.';
const FAILED = 'Something went wrong with the goal.';

const refuse = (res, statusCode, statusText, message, extra = {}) => res.status(statusCode).json({ status: false, statusText, message, ...extra });
const stop = (statusCode, statusText) => Object.assign(new Error(statusText), { statusCode, stopped: true });

const crud = (companyId, data, method) => MongoDbCrudOpration(companyId, { type: SCHEMA_TYPE.GOALS, data }, method);
const plain = (doc) => (doc && typeof doc.toObject === 'function' ? doc.toObject() : doc);
const newId = () => new mongoose.Types.ObjectId().toString();
const sameId = (a, b) => String(a) === String(b);

const presentTarget = (target) => ({
    id: String(target.id),
    name: target.name,
    kind: target.kind,
    weight: target.weight || 1,
    progressPct: target.progressPct || 0,
    reachedAt: target.reachedAt || null,
    ...(target.kind === rules.BOOLEAN
        ? { done: target.done === true }
        : { start: target.start, target: target.target, current: target.current, unit: target.unit || '' }),
    ...(target.kind === rules.CURRENCY ? { currencyCode: target.currencyCode } : {}),
    updatedBy: target.updatedBy || '',
    updatedAt: target.updatedAt || null,
});

/* The people a goal is shared with are listed for those who manage the list; a reader learns only whether they are on it. */
const present = (goal, caller) => {
    const canEdit = access.canEdit(goal, caller);
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
        targets: (goal.targets || []).map(presentTarget),
        archived: goal.deletedStatusKey === ARCHIVED,
        canEdit,
        canSetValue: access.canSetValue(goal, caller),
        createdBy: goal.createdBy || '',
        createdAt: goal.createdAt || null,
        updatedAt: goal.updatedAt || null,
    };
};

const sent = (res, statusText, goal, caller) => res.status(200).json({
    status: true,
    statusText,
    data: goal && access.canSee(goal, caller) ? present(goal, caller) : null,
});

/* Only the fact of a change leaves the request: which goal it was would tell a member about goals they cannot read. */
const announce = (type, companyId) => socketEmitter.emit(type, { type, companyId, module: SOCKET_MODULE });

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
        if (error instanceof GoalRefused) return refuse(res, 400, 'Request refused', error.message, { field: error.field });
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
        const set = await change(goal);
        const saved = await crud(caller.companyId, [
            { _id: goal._id, revision: Number(goal.revision) || 0 },
            { $set: { ...set, updatedBy: caller.uid }, $inc: { revision: 1 } },
            { returnDocument: 'after', lean: true },
        ], 'findOneAndUpdate');
        if (saved) return { was: goal, saved };
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

const requireCurrency = async (companyId, target, at = '') => {
    if (target.kind !== rules.CURRENCY) return;
    const known = await MongoDbCrudOpration(companyId, { type: SCHEMA_TYPE.CURRENCY_LIST, data: [{ code: target.currencyCode }, { _id: 1 }] }, 'findOne');
    if (!known) throw new GoalRefused(`${at}currencyCode`, 'is not a currency of this workspace');
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

exports.listGoals = handled('list', async (req, res, caller) => {
    const archived = rules.flagQuery(req.query, 'archived');
    const mine = rules.flagQuery(req.query, 'mine');
    const goals = await crud(caller.companyId, [
        { deletedStatusKey: archived ? ARCHIVED : LIVE, ...access.visibleTo(caller) },
        null,
        { lean: true },
    ], 'find') || [];
    const data = goals
        .filter((goal) => !mine || access.isOwner(goal, caller) || access.isNamed(goal, caller))
        .map((goal) => present(goal, caller))
        .sort((a, b) => a.name.localeCompare(b.name));
    return res.status(200).json({ status: true, statusText: 'Goals fetched successfully.', data });
});

exports.getGoal = handled('get', async (req, res, caller) => sent(res, 'Goal fetched successfully.', await visibleGoal(caller, req.params.id), caller));

exports.createGoal = handled('create', async (req, res, caller) => {
    if (!access.canCreate(caller)) return refuse(res, 403, FORBIDDEN, FORBIDDEN);
    const { targets: newTargets = [], ...fields } = rules.parseGoalBody(req.body, { creating: true });
    const goal = { description: '', periodStart: '', periodEnd: '', visibility: access.PRIVATE, sharedWith: [], color: '', ...fields, ownerUserId: caller.uid };
    rules.requirePeriodInOrder(goal);
    requireUnsharedWhenPrivate(goal, goal.sharedWith);
    await requireActiveMembers(caller.companyId, goal.sharedWith);
    for (const [index, target] of newTargets.entries()) await requireCurrency(caller.companyId, target, `targets.${index}.`);
    if (Number(await crud(caller.companyId, [{ ownerUserId: caller.uid, deletedStatusKey: LIVE }], 'countDocuments')) >= rules.MAX_GOALS_PER_OWNER) {
        return refuse(res, 400, 'Request refused', `A person can own at most ${rules.MAX_GOALS_PER_OWNER} goals.`, { field: 'name' });
    }
    const now = new Date();
    const targets = newTargets.map((target) => ({ id: newId(), ...target, ...valueStamp(caller, now) }));
    const saved = plain(await crud(caller.companyId, {
        ...goal,
        ...withProgress(targets, now),
        revision: 0,
        createdBy: caller.uid,
        updatedBy: caller.uid,
        deletedStatusKey: LIVE,
    }, 'save'));
    announce('insert', caller.companyId);
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
        return next.visibility === access.PRIVATE ? { ...fields, sharedWith: [] } : fields;
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
        await requireCurrency(caller.companyId, target);
        const now = new Date();
        return withProgress([...(goal.targets || []), { id: newId(), ...target, ...valueStamp(caller, now) }], now);
    });
    announce('update', caller.companyId);
    return sent(res, 'Target added.', saved, caller);
});

exports.editTarget = handled('edit target', async (req, res, caller) => {
    const { saved } = await mutate(caller, req.params.id, access.canEdit, async (goal) => {
        const stored = targetOf(goal, req.params.targetId);
        const edited = rules.parseTargetEdit(req.body, stored);
        if (edited.currencyCode !== stored.currencyCode) await requireCurrency(caller.companyId, edited);
        return withProgress(withTarget(goal, edited));
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
