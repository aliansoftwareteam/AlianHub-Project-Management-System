const mongoose = require('mongoose');
const { SCHEMA_TYPE } = require('../../Config/schemaType');
const { dbCollections } = require('../../Config/collections');
const { MongoDbCrudOpration } = require('../../utils/mongo-handler/mongoQueries');
const logger = require('../../Config/loggerConfig');
const HandleHistoryref = require('../Tasks/helpers/helper');
const { addSprintFun } = require('./controller');
const rules = require('./scrumRules');

/**
 * Scrum sprint lifecycle — opt in, start, complete.
 *
 * A sprint doc is a plain container until someone opts it in. Chat channels
 * (mainChat) live in this same collection, so every handler here refuses one:
 * a channel has no time box and giving it a state machine would break chat.
 *
 * A Forms response list is NOT refused. It is an ordinary sprint the form owner
 * picked, carries no marker of its own, and running it as a sprint breaks
 * nothing — submissions still file into it.
 *
 * Mounted under /api/v2/sprints, which setMiddleware.js registers as a PREFIX,
 * so every route added here is behind a token by default. The lifecycle must
 * never live under an unregistered prefix — app.use only guards what it is
 * given, and an unauthenticated "close this sprint" is a very bad day.
 *
 * Completing a sprint deliberately does NOT touch `deletedStatusKey`.
 * That field stays the archive/delete lifecycle; `state` sits beside it and
 * describes the time box only. A completed sprint therefore stays visible in
 * the sprint list wearing a Closed chip, and archiving it remains a separate,
 * existing action.
 */

const OBJECT_ID_PATTERN = /^[0-9a-fA-F]{24}$/;
const MAX_GOAL_LENGTH = 500;
const BACKLOG_NAME = 'Backlog';

// Sprint scope, defined exactly as Modules/Sprints/burndown.js defines it, so
// the commitment snapshot and the chart can never disagree about what was in.
const SCOPE_FILTER = { deletedStatusKey: { $in: [0, 2, undefined] }, isParentTask: true };
const SCOPE_FIELDS = '_id TaskKey TaskName statusType points totalEstimatedTime ProjectID sprintId folderObjId';

const fail = (res, statusText) => res.send({ status: false, statusText });

const toDate = (value) => {
    if (value === null || value === undefined || value === '') return null;
    const d = new Date(value);
    return Number.isNaN(d.getTime()) ? undefined : d;   // undefined = supplied but unusable
};

const findSprint = (companyId, sprintObjId) => MongoDbCrudOpration(companyId, {
    type: SCHEMA_TYPE.SPRINTS,
    data: [{ _id: sprintObjId }],
}, 'findOne');

const scopeTasks = (companyId, sprintObjId) => MongoDbCrudOpration(companyId, {
    type: SCHEMA_TYPE.TASKS,
    data: [{ sprintId: sprintObjId, ...SCOPE_FILTER }, SCOPE_FIELDS],
}, 'find');

const patchSprint = (companyId, filter, set) => MongoDbCrudOpration(companyId, {
    type: SCHEMA_TYPE.SPRINTS,
    data: [filter, { $set: set }, { returnDocument: 'after' }],
}, 'findOneAndUpdate');

/* Resolve and vet the sprint every handler operates on. Returns { sprint } or
   { error } with a sentence the UI can show as-is. */
async function loadSprint(companyId, rawId, { allowBacklog = false } = {}) {
    if (!companyId) return { error: 'companyId is required.' };
    if (!OBJECT_ID_PATTERN.test(String(rawId || ''))) return { error: 'A valid sprintId is required.' };

    const sprint = await findSprint(companyId, new mongoose.Types.ObjectId(String(rawId)));
    if (!sprint) return { error: 'Sprint not found.' };
    if (sprint.deletedStatusKey === 1) return { error: 'That sprint has been deleted.' };
    if (sprint.mainChat === true) return { error: 'That is a chat channel, not a sprint.' };
    if (!allowBacklog && sprint.isBacklog === true) return { error: 'The backlog is not a time-boxed sprint.' };
    return { sprint };
}

/* Who is doing this, taken from the session rather than the request body.

   Two reasons it is not `req.body.userData`. It is forgeable, so history would
   be attributable to anyone. And HandleHistory writes `UserId: userData.id`
   into a schema where that field is REQUIRED — an absent id makes it reject,
   and moveTaskFunction fires one of those without a .catch, so an empty
   userData does not merely lose a history line, it takes the server down.

   Users live in the global database, not the company one. */
async function actingUser(req) {
    const uid = String((req && req.uid) || '');
    if (!/^[0-9a-fA-F]{24}$/.test(uid)) return null;

    const user = await MongoDbCrudOpration(dbCollections.GLOBAL, {
        type: SCHEMA_TYPE.USERS,
        data: [{ _id: new mongoose.Types.ObjectId(uid) }, { Employee_Name: 1, Employee_Email: 1 }],
    }, 'findOne').catch(() => null);

    return {
        id: uid,
        Employee_Name: (user && (user.Employee_Name || user.Employee_Email)) || 'Someone',
    };
}

const projectOf = (companyId, projectId) => MongoDbCrudOpration(companyId, {
    type: SCHEMA_TYPE.PROJECTS,
    data: [{ _id: new mongoose.Types.ObjectId(String(projectId)) }, '_id ProjectName ProjectCode sprintCadence'],
}, 'findOne');

/* Every sprint in this project currently running, other than `exceptId`. */
async function activeSprintsIn(companyId, projectId, exceptId) {
    const rows = await MongoDbCrudOpration(companyId, {
        type: SCHEMA_TYPE.SPRINTS,
        data: [{
            projectId: new mongoose.Types.ObjectId(String(projectId)),
            isScrum: true,
            state: rules.STATE_ACTIVE,
            deletedStatusKey: { $ne: 1 },
        }, '_id name'],
    }, 'find').catch(() => []);
    return (rows || []).filter((s) => String(s._id) !== String(exceptId));
}

const totals = (tasks) => {
    const snap = rules.summariseCommitment(tasks);
    return { tasks: snap.tasks, points: snap.points, minutes: snap.minutes };
};

const backlogsIn = (companyId, projectId) => MongoDbCrudOpration(companyId, {
    type: SCHEMA_TYPE.SPRINTS,
    data: [{
        projectId: new mongoose.Types.ObjectId(String(projectId)),
        isBacklog: true,
        deletedStatusKey: { $ne: 1 },
    }, '_id name folderId tasks'],
}, 'find').catch(() => []);

// An ObjectId leads with its creation time, so the smallest one is the original.
const oldest = (rows) => (rows || []).slice().sort((a, b) => String(a._id).localeCompare(String(b._id)))[0] || null;

/* The one container per project for work that is not in a sprint yet.

   It has to be a sprint doc: tasks.sprintId is required in a strict schema, so
   "no sprint" is not a state a task can be in. It is created on first use, never
   in a migration — a project that never touches Scrum never grows one.

   Not a Scrum sprint itself (isScrum stays false): it has no time box, so it can
   never be started, completed, or counted in velocity. */
async function ensureBacklog(companyId, projectId, userData) {
    if (!OBJECT_ID_PATTERN.test(String(projectId || ''))) return { error: 'A valid projectId is required.' };

    const found = oldest(await backlogsIn(companyId, projectId));
    if (found) return { backlog: found };

    const project = await projectOf(companyId, projectId).catch(() => null);
    if (!project) return { error: 'Project not found.' };

    const created = await addSprintFun({
        body: {
            companyId,
            projectId: String(projectId),
            sprintName: BACKLOG_NAME,
            projectName: project.ProjectName || '',
            userData: userData || {},
            mainChat: false,
        },
    }).catch((e) => ({ status: false, statusText: (e && e.statusText) || (e && e.message) || '' }));

    if (!created || created.status !== true || !created.data) {
        return { error: created && created.statusText ? String(created.statusText) : 'Could not create the backlog.' };
    }

    await patchSprint(companyId, { _id: created.data._id }, { isBacklog: true });

    // Two people opening the same project at once would each pass the check
    // above. Keep the first and retire the duplicate — it was created moments
    // ago and cannot hold any tasks yet.
    const all = await backlogsIn(companyId, projectId);
    const keep = oldest(all);
    if (keep && String(keep._id) !== String(created.data._id)) {
        await patchSprint(companyId, { _id: created.data._id }, { deletedStatusKey: 1, isBacklog: false });
        return { backlog: keep };
    }
    return { backlog: keep || { ...created.data, isBacklog: true } };
}

exports.ensureBacklog = ensureBacklog;

/* POST /api/v2/sprints/backlog   body: { projectId } */
exports.getBacklog = async (req, res) => {
    try {
        const companyId = req.headers['companyid'] || '';
        if (!companyId) return fail(res, 'companyId is required.');
        const body = req.body || {};
        const { backlog, error } = await ensureBacklog(companyId, body.projectId, await actingUser(req));
        if (error) return fail(res, error);
        return res.send({ status: true, statusText: 'Backlog ready.', data: backlog });
    } catch (err) {
        logger.error(`getBacklog: ${err.message}`);
        return fail(res, err.message);
    }
};

/* POST /api/v2/sprints/scrum
   body: { sprintId, isScrum, goal, startDate, endDate }

   Opts a list into Scrum, or edits the box on one that is already opted in. */
exports.setScrum = async (req, res) => {
    try {
        const companyId = req.headers['companyid'] || '';
        const body = req.body || {};
        const { sprint, error } = await loadSprint(companyId, body.sprintId);
        if (error) return fail(res, error);

        const state = rules.deriveState(sprint);

        if (body.isScrum === false) {
            if (state === rules.STATE_ACTIVE || state === rules.STATE_OVERDUE) {
                return fail(res, 'Complete the sprint before turning Scrum off for it.');
            }
            const off = await patchSprint(companyId, { _id: sprint._id }, {
                isScrum: false, state: '', startDate: null, endDate: null,
            });
            return res.send({ status: true, statusText: 'Scrum turned off for this list.', data: off });
        }

        if (state === rules.STATE_CLOSED) return fail(res, 'A completed sprint cannot be edited.');

        const startDate = toDate(body.startDate);
        const endDate = toDate(body.endDate);
        if (startDate === undefined || endDate === undefined) return fail(res, 'Those dates could not be read.');
        if (!!startDate !== !!endDate) return fail(res, 'A sprint needs both a start date and an end date.');
        if (startDate && endDate && endDate.getTime() <= startDate.getTime()) {
            return fail(res, 'The end date must be after the start date.');
        }

        const set = { isScrum: true };
        if (body.goal !== undefined) set.goal = String(body.goal || '').slice(0, MAX_GOAL_LENGTH);
        if (body.startDate !== undefined) set.startDate = startDate;
        if (body.endDate !== undefined) set.endDate = endDate;
        // The schema default is '' — stamp planned so nothing downstream has to
        // treat "opted in but blank" as a fourth state.
        if (state !== rules.STATE_ACTIVE && state !== rules.STATE_OVERDUE) set.state = rules.STATE_PLANNED;

        const saved = await patchSprint(companyId, { _id: sprint._id }, set);
        return res.send({ status: true, statusText: 'Sprint updated.', data: saved });
    } catch (err) {
        logger.error(`setScrum: ${err.message}`);
        return fail(res, err.message);
    }
};

/* POST /api/v2/sprints/start   body: { sprintId } */
exports.startSprint = async (req, res) => {
    try {
        const companyId = req.headers['companyid'] || '';
        const { sprint, error } = await loadSprint(companyId, (req.body || {}).sprintId);
        if (error) return fail(res, error);

        if (sprint.isScrum !== true) return fail(res, 'Turn this list into a sprint before starting it.');
        const state = rules.deriveState(sprint);
        if (state === rules.STATE_ACTIVE || state === rules.STATE_OVERDUE) {
            return fail(res, 'This sprint is already running.');
        }
        if (state === rules.STATE_CLOSED) return fail(res, 'This sprint has already been completed.');
        if (!sprint.startDate || !sprint.endDate) return fail(res, 'Give the sprint a start and end date first.');
        if (new Date(sprint.endDate).getTime() <= new Date(sprint.startDate).getTime()) {
            return fail(res, 'The end date must be after the start date.');
        }

        const running = await activeSprintsIn(companyId, sprint.projectId, sprint._id);
        if (running.length) {
            return fail(res, `"${running[0].name || 'Another sprint'}" is still running. Complete it first — a project runs one sprint at a time.`);
        }

        const tasks = await scopeTasks(companyId, sprint._id);
        const commitment = { ...rules.summariseCommitment(tasks), at: new Date() };

        // Claim the transition on the state itself, so two tabs cannot both start it.
        const started = await patchSprint(companyId, {
            _id: sprint._id,
            state: { $in: ['', rules.STATE_PLANNED] },
        }, { state: rules.STATE_ACTIVE, commitment });
        if (!started) return fail(res, 'This sprint was just started somewhere else.');

        // Someone may have claimed a sibling in the same instant. Losing here is
        // rare and reversible; leaving two active sprints is neither.
        const raced = await activeSprintsIn(companyId, sprint.projectId, sprint._id);
        if (raced.length) {
            await patchSprint(companyId, { _id: sprint._id }, { state: rules.STATE_PLANNED, commitment: {} });
            return fail(res, `"${raced[0].name || 'Another sprint'}" started first. Complete it before starting this one.`);
        }

        const actor = await actingUser(req);
        if (actor) {
            HandleHistoryref.HandleHistory('project', companyId, String(sprint.projectId), null, {
                key: 'Sprint_Started',
                message: `<b>${actor.Employee_Name}</b> started sprint <b>${sprint.name || ''}</b> with <b>${commitment.tasks}</b> task(s) committed.`,
                sprintId: String(sprint._id),
            }, actor).catch((e) => logger.error(`Sprint_Started history: ${e && e.message}`));
        }

        return res.send({ status: true, statusText: 'Sprint started.', data: started });
    } catch (err) {
        logger.error(`startSprint: ${err.message}`);
        return fail(res, err.message);
    }
};

/* Gather what a completion would do, without doing any of it. Shared by the
   preview endpoint and the completion itself, so the dialog cannot promise one
   thing and the button do another. */
async function planCompletion(companyId, sprint) {
    const tasks = await scopeTasks(companyId, sprint._id);
    const { done, notDone } = rules.splitByDone(tasks);

    /* Unfinished subtasks sitting under a parent that IS finished.

       A subtask is not a sprint item — the parent is, exactly as burndown,
       velocity and CFD all treat it — so a done parent stays in the closed
       sprint and takes its subtasks with it. When one of those subtasks is
       still open, that work quietly ends up buried in a completed sprint.

       Deliberately NOT fixed by calling the parent unfinished: done-ness would
       then mean something different here than it does on every chart, and the
       dialog and the burndown would disagree about the same sprint. Deliberately
       NOT fixed by moving the subtasks on their own either: they render nested
       under their parent, so a subtask in a different sprint from its parent is
       invisible rather than rescued.

       So it is surfaced instead, and the person closing the sprint decides. */
    const doneParentIds = done.map((t) => t._id).filter(Boolean);
    let strandedSubtasks = [];
    if (doneParentIds.length) {
        strandedSubtasks = await MongoDbCrudOpration(companyId, {
            type: SCHEMA_TYPE.TASKS,
            data: [{
                sprintId: sprint._id,
                isParentTask: false,
                ParentTaskId: { $in: doneParentIds },
                statusType: { $ne: rules.DONE_STATUS_TYPE },
                deletedStatusKey: { $in: [0, 2, undefined] },
            }, `${SCOPE_FIELDS} ParentTaskId`],
        }, 'find').catch(() => []);
    }

    const committedIds = new Set(((sprint.commitment && sprint.commitment.taskIds) || []).map(String));
    const addedAfterStart = committedIds.size
        ? tasks.filter((t) => !committedIds.has(String(t._id))).length
        : 0;

    const project = await projectOf(companyId, sprint.projectId).catch(() => null);
    const cadence = rules.normaliseCadence((project && project.sprintCadence) || {});
    const window = rules.computeWindow(cadence, sprint.endDate ? new Date(new Date(sprint.endDate).getTime() + 1) : new Date());

    return {
        project,
        cadence,
        done,
        notDone,
        strandedSubtasks,
        addedAfterStart,
        suggestedNext: {
            name: rules.nextSprintName(sprint.name),
            startDate: window ? window.startDate : null,
            endDate: window ? window.endDate : null,
        },
    };
}

/* GET /api/v2/sprints/complete-preview?sprintId= */
exports.completePreview = async (req, res) => {
    try {
        const companyId = req.headers['companyid'] || '';
        const { sprint, error } = await loadSprint(companyId, (req.query || {}).sprintId);
        if (error) return fail(res, error);
        if (sprint.isScrum !== true) return fail(res, 'That list is not a sprint.');

        const plan = await planCompletion(companyId, sprint);
        return res.send({
            status: true,
            statusText: 'Sprint completion preview',
            data: {
                sprintId: String(sprint._id),
                sprintName: sprint.name || '',
                state: rules.deriveState(sprint),
                goal: sprint.goal || '',
                startDate: sprint.startDate || null,
                endDate: sprint.endDate || null,
                commitment: sprint.commitment || {},
                addedAfterStart: plan.addedAfterStart,
                done: totals(plan.done),
                notDone: {
                    ...totals(plan.notDone),
                    list: plan.notDone.map((t) => ({
                        _id: String(t._id), TaskKey: t.TaskKey || '', TaskName: t.TaskName || '',
                    })),
                },
                // Open work that will NOT move, because its parent is done.
                strandedSubtasks: {
                    ...totals(plan.strandedSubtasks),
                    list: plan.strandedSubtasks.map((t) => ({
                        _id: String(t._id), TaskKey: t.TaskKey || '', TaskName: t.TaskName || '',
                    })),
                },
                suggestedNext: plan.suggestedNext,
            },
        });
    } catch (err) {
        logger.error(`completePreview: ${err.message}`);
        return fail(res, err.message);
    }
};

/* GET /api/v2/sprints/report?sprintId=

   What the sprint committed to, what of it landed, what did not, and what was
   added after it started.

   Committed work is looked up by the id list in the snapshot, not by what is in
   the sprint now — a task moved out mid-sprint was still committed to, and
   dropping it would let a team make a bad sprint look good by moving the misses
   somewhere else. Done-ness is read from wherever the task lives now. */
exports.sprintReport = async (req, res) => {
    try {
        const companyId = req.headers['companyid'] || '';
        const { sprint, error } = await loadSprint(companyId, (req.query || {}).sprintId);
        if (error) return fail(res, error);
        if (sprint.isScrum !== true) return fail(res, 'That list is not a sprint.');

        const inSprint = await scopeTasks(companyId, sprint._id);
        const committedIds = ((sprint.commitment && sprint.commitment.taskIds) || []).map(String);

        let committedTasks;
        if (committedIds.length) {
            const objectIds = committedIds
                .filter((id) => OBJECT_ID_PATTERN.test(id))
                .map((id) => new mongoose.Types.ObjectId(id));
            committedTasks = await MongoDbCrudOpration(companyId, {
                type: SCHEMA_TYPE.TASKS,
                data: [{ _id: { $in: objectIds }, deletedStatusKey: { $in: [0, 2, undefined] } }, SCOPE_FIELDS],
            }, 'find').catch(() => []);
        } else {
            // Never started, or started before the snapshot existed. The best
            // available answer is what is in it now — flagged, not pretended.
            committedTasks = inSprint;
        }

        const committedSet = new Set(committedIds);
        const { done, notDone } = rules.splitByDone(committedTasks || []);
        const addedAfterStart = committedSet.size
            ? inSprint.filter((t) => !committedSet.has(String(t._id)))
            : [];

        // Committed work that is no longer in this sprint — moved on at the
        // close, or moved out by hand while the sprint was running.
        const movedOut = (committedTasks || []).filter((t) => String(t.sprintId) !== String(sprint._id));

        return res.send({
            status: true,
            statusText: 'Sprint report',
            data: {
                sprintId: String(sprint._id),
                sprintName: sprint.name || '',
                goal: sprint.goal || '',
                state: rules.deriveState(sprint),
                startDate: sprint.startDate || null,
                endDate: sprint.endDate || null,
                hasCommitment: committedSet.size > 0,
                committed: totals(committedTasks || []),
                completed: totals(done),
                unfinished: totals(notDone),
                addedAfterStart: totals(addedAfterStart),
                movedOut: totals(movedOut),
                closeReport: sprint.closeReport || null,
                unfinishedList: notDone.map((t) => ({
                    _id: String(t._id), TaskKey: t.TaskKey || '', TaskName: t.TaskName || '',
                    movedOut: String(t.sprintId) !== String(sprint._id),
                })),
                addedList: addedAfterStart.map((t) => ({
                    _id: String(t._id), TaskKey: t.TaskKey || '', TaskName: t.TaskName || '',
                })),
            },
        });
    } catch (err) {
        logger.error(`sprintReport: ${err.message}`);
        return fail(res, err.message);
    }
};

/* Where unfinished work goes. Returns { target } — a sprintObj bulkMove can use
   — or { error }, or { target: null } when there is nothing to move. */
async function resolveDestination(companyId, sprint, plan, body) {
    const wanted = String(body.incompleteDestination || 'next');

    if (wanted === 'backlog') {
        const { backlog, error } = await ensureBacklog(companyId, sprint.projectId, body.actor || body.userData);
        if (error) return { error };
        return { target: backlog, created: false };
    }

    if (OBJECT_ID_PATTERN.test(wanted)) {
        if (String(wanted) === String(sprint._id)) return { error: 'Unfinished work cannot move into the sprint being completed.' };
        const { sprint: target, error } = await loadSprint(companyId, wanted, { allowBacklog: true });
        if (error) return { error };
        if (String(target.projectId) !== String(sprint.projectId)) {
            return { error: 'That sprint belongs to a different project.' };
        }
        if (rules.deriveState(target) === rules.STATE_CLOSED) {
            return { error: 'That sprint is already completed. Pick one that is still open.' };
        }
        return { target, created: false };
    }

    if (wanted !== 'next') return { error: 'Choose where the unfinished work should go.' };

    // The earliest planned sprint in this project, if the team already made one.
    const planned = await MongoDbCrudOpration(companyId, {
        type: SCHEMA_TYPE.SPRINTS,
        data: [{
            projectId: new mongoose.Types.ObjectId(String(sprint.projectId)),
            isScrum: true,
            state: rules.STATE_PLANNED,
            deletedStatusKey: { $ne: 1 },
            _id: { $ne: sprint._id },
        }, '_id name folderId startDate'],
    }, 'find').catch(() => []);

    if (planned && planned.length) {
        const earliest = planned.slice().sort((a, b) => {
            const at = a.startDate ? new Date(a.startDate).getTime() : Infinity;
            const bt = b.startDate ? new Date(b.startDate).getTime() : Infinity;
            return at - bt;
        })[0];
        return { target: earliest, created: false };
    }

    if (body.createNext === false) return { error: 'There is no next sprint to move the work into.' };

    // The new sprint lands in the same bucket as the one being closed. The name
    // is only for addSprintFun's history line — sprints do not store it — so it
    // is looked up rather than left blank in "created ... in <b></b> folder".
    let folder;
    if (sprint.folderId) {
        const bucket = await MongoDbCrudOpration(companyId, {
            type: SCHEMA_TYPE.FOLDERS,
            data: [{ _id: sprint.folderId }, 'name'],
        }, 'findOne').catch(() => null);
        folder = { folderId: String(sprint.folderId), folderName: (bucket && bucket.name) || '' };
    }

    // Reuse the existing create path rather than writing a second one: it holds
    // the per-project plan limit, the history entry and the folder handling.
    const created = await addSprintFun({
        body: {
            companyId,
            projectId: String(sprint.projectId),
            sprintName: plan.suggestedNext.name,
            projectName: (plan.project && plan.project.ProjectName) || '',
            userData: body.actor || body.userData || {},
            folder,
            mainChat: false,
        },
    }).catch((e) => ({ status: false, statusText: (e && e.statusText) || (e && e.message) || 'Could not create the next sprint.' }));

    if (!created || created.status !== true || !created.data) {
        return { error: (created && created.statusText) || 'Could not create the next sprint.' };
    }

    const stamped = await patchSprint(companyId, { _id: created.data._id }, {
        isScrum: true,
        state: rules.STATE_PLANNED,
        goal: '',
        startDate: plan.suggestedNext.startDate,
        endDate: plan.suggestedNext.endDate,
        rolledFrom: sprint._id,
    });
    return { target: stamped || created.data, created: true };
}

/* POST /api/v2/sprints/complete
   body: { sprintId, incompleteDestination: 'next' | '<sprintId>', createNext?, userData? } */
exports.completeSprint = async (req, res) => {
    try {
        const companyId = req.headers['companyid'] || '';
        const body = req.body || {};
        const { sprint, error } = await loadSprint(companyId, body.sprintId);
        if (error) return fail(res, error);
        if (sprint.isScrum !== true) return fail(res, 'That list is not a sprint.');

        const state = rules.deriveState(sprint);
        // Idempotent on purpose: a double-submit, a retry or the cron arriving
        // behind a human must move nothing and still read as success.
        if (state === rules.STATE_CLOSED) {
            return res.send({ status: true, statusText: 'This sprint was already completed.', data: sprint });
        }
        if (state !== rules.STATE_ACTIVE && state !== rules.STATE_OVERDUE) {
            return fail(res, 'Only a running sprint can be completed.');
        }

        const plan = await planCompletion(companyId, sprint);
        if (!plan.project) return fail(res, 'The project this sprint belongs to could not be read.');

        // Resolved before anything moves. bulkMove writes a per-task history
        // entry through a call that has no .catch on it, so handing it a user
        // without an id crashes the process rather than losing a log line.
        const actor = await actingUser(req);
        if (!actor) return fail(res, 'Could not identify who is completing this sprint. Sign in again and retry.');

        let movedTo = null;
        let moveSummary = { updated: 0, skipped: 0, errors: 0 };

        if (plan.notDone.length) {
            const destination = await resolveDestination(companyId, sprint, plan, { ...body, actor });
            if (destination.error) return fail(res, destination.error);

            const target = destination.target;
            // Required here rather than at the top: a require cycle runs
            // Sprints -> Tasks -> Sprints, and pulling the task layer in at
            // module load would hand back a half-built export.
            const { taskMongo } = require('../Tasks/helpers/task_class_Mongo');

            // bulkMove carries a parent's subtasks with it, so nothing orphans in
            // the sprint that just closed. It used to need isSubTask: true here;
            // bulk move now does it unconditionally, because a subtask in a
            // different sprint from its parent renders in neither.
            const result = await taskMongo.bulkMove({
                companyId,
                userData: actor,
                taskIds: plan.notDone.map((t) => String(t._id)),
                sprintObj: {
                    id: String(target._id),
                    name: target.name || '',
                    folderId: target.folderId ? String(target.folderId) : null,
                    folderName: '',
                },
                projectData: {
                    id: String(plan.project._id),
                    ProjectName: plan.project.ProjectName || '',
                    ProjectCode: plan.project.ProjectCode || '',
                },
            });

            moveSummary = (result && result.totals) || moveSummary;
            movedTo = { sprintId: String(target._id), name: target.name || '', created: destination.created === true };

            // Report what actually happened. bulkMove reports per-task failures
            // rather than throwing, and a close that quietly loses tasks is worse
            // than one that refuses.
            if (moveSummary.errors) {
                return fail(res, `${moveSummary.errors} task(s) could not be moved, so the sprint was left open. Nothing was closed.`);
            }
        }

        const closeReport = {
            at: new Date(),
            by: actor.id,
            done: totals(plan.done),
            notDone: totals(plan.notDone),
            strandedSubtasks: totals(plan.strandedSubtasks),
            addedAfterStart: plan.addedAfterStart,
            movedTo,
            moved: moveSummary,
        };

        const closed = await patchSprint(companyId, {
            _id: sprint._id,
            state: rules.STATE_ACTIVE,
        }, { state: rules.STATE_CLOSED, closeReport });
        if (!closed) return fail(res, 'This sprint was just completed somewhere else.');

        HandleHistoryref.HandleHistory('project', companyId, String(sprint.projectId), null, {
            key: 'Sprint_Completed',
            message: `<b>${actor.Employee_Name}</b> completed sprint <b>${sprint.name || ''}</b> — <b>${closeReport.done.tasks}</b> done, <b>${closeReport.notDone.tasks}</b> moved${movedTo ? ` to <b>${movedTo.name}</b>` : ''}.`,
            sprintId: String(sprint._id),
        }, actor).catch((e) => logger.error(`Sprint_Completed history: ${e && e.message}`));

        return res.send({ status: true, statusText: 'Sprint completed.', data: closed });
    } catch (err) {
        logger.error(`completeSprint: ${err.message}`);
        return fail(res, err.message);
    }
};
