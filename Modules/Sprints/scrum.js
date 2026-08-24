const mongoose = require('mongoose');
const { SCHEMA_TYPE } = require('../../Config/schemaType');
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

        HandleHistoryref.HandleHistory('project', companyId, String(sprint.projectId), null, {
            key: 'Sprint_Started',
            message: `<b>${(req.body && req.body.userData && req.body.userData.Employee_Name) || 'Someone'}</b> started sprint <b>${sprint.name || ''}</b> with <b>${commitment.tasks}</b> task(s) committed.`,
            sprintId: String(sprint._id),
        }, (req.body && req.body.userData) || {}).catch((e) => logger.error(`Sprint_Started history: ${e.message}`));

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
                suggestedNext: plan.suggestedNext,
            },
        });
    } catch (err) {
        logger.error(`completePreview: ${err.message}`);
        return fail(res, err.message);
    }
};

/* Where unfinished work goes. Returns { target } — a sprintObj bulkMove can use
   — or { error }, or { target: null } when there is nothing to move. */
async function resolveDestination(companyId, sprint, plan, body) {
    const wanted = String(body.incompleteDestination || 'next');

    if (wanted === 'backlog') {
        // Lands with the backlog sprint (AHE-3917). Saying so beats silently
        // routing the work somewhere the caller did not ask for.
        return { error: 'Moving unfinished work to the backlog is not available yet. Choose a sprint instead.' };
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
            userData: body.userData || {},
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

        let movedTo = null;
        let moveSummary = { updated: 0, skipped: 0, errors: 0 };

        if (plan.notDone.length) {
            const destination = await resolveDestination(companyId, sprint, plan, body);
            if (destination.error) return fail(res, destination.error);

            const target = destination.target;
            // Required here rather than at the top: a require cycle runs
            // Sprints -> Tasks -> Sprints, and pulling the task layer in at
            // module load would hand back a half-built export.
            const { taskMongo } = require('../Tasks/helpers/task_class_Mongo');

            // isSubTask: true so a moved parent takes its subtasks with it —
            // otherwise they orphan in the sprint that just closed.
            const result = await taskMongo.bulkMove({
                companyId,
                userData: body.userData || {},
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
                isSubTask: true,
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
            by: String(req.uid || ''),
            done: totals(plan.done),
            notDone: totals(plan.notDone),
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
            message: `<b>${(body.userData && body.userData.Employee_Name) || 'Someone'}</b> completed sprint <b>${sprint.name || ''}</b> — <b>${closeReport.done.tasks}</b> done, <b>${closeReport.notDone.tasks}</b> moved${movedTo ? ` to <b>${movedTo.name}</b>` : ''}.`,
            sprintId: String(sprint._id),
        }, body.userData || {}).catch((e) => logger.error(`Sprint_Completed history: ${e.message}`));

        return res.send({ status: true, statusText: 'Sprint completed.', data: closed });
    } catch (err) {
        logger.error(`completeSprint: ${err.message}`);
        return fail(res, err.message);
    }
};
