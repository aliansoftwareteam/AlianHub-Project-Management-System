/**
 * Write layer for proposal review.
 *
 * Takes the output of evaluator.evaluateOne() and turns it into the real
 * mutations on the task:
 *   - verdict APPROVE                → move to "Approved"
 *   - verdict BACKLOG                → move to "Backlog" + post a system
 *                                       comment with the agent's reason
 *   - verdict found:false            → move to "Backlog" + "no real proposal" comment
 *   - skipReason no_token            → move to "Backlog" + "no Upwork link" comment
 *   - skipReason no_comments         → move to "Backlog" + "no proposal comment yet" comment
 *   - skipReason job_not_found       → move to "Backlog" + "job not scraped yet" comment
 *
 * The status move goes through `taskMongo.updateStatus` — the SAME path a
 * human click uses — so socket broadcasts, activity history, and
 * notifications all fire the same as a manual move. The reason comment is
 * saved via the standard `comments` save path and a matching socket "insert"
 * is emitted so it shows up live in the task chat.
 *
 * Status keys are resolved by NAME from each project's `taskStatusData`
 * (status keys are per-project and dynamic — they are NEVER hardcoded).
 *
 * Dry-run mode (`dryRun: true`) returns the planned action without touching
 * anything — useful for verifying the wiring against a real task before
 * flipping the live switch.
 */
'use strict';

const mongoose = require('mongoose');
const logger = require('../../Config/loggerConfig');
const { dbCollections } = require('../../Config/collections');
const { MongoDbCrudOpration } = require('../../utils/mongo-handler/mongoQueries');
const { ALIANHUB_BOT_USER } = require('../../utils/commonFunctions');
const { taskMongo } = require('../Tasks/helpers/task_class_Mongo');
const socketEmitter = require('../../event/socketEventEmitter');

// Status NAMES expected on every proposal-review project. Status KEYS are
// per-project and resolved dynamically.
const SOURCE_STATUS_NAME = 'In Review - TL';
const APPROVE_STATUS_NAME = 'Approved';
const BACKLOG_STATUS_NAME = 'Backlog';

// Human-readable reason text for each "can't review" outcome. The LLM's own
// reason is used verbatim when the verdict is BACKLOG (a real quality call).
const SKIP_REASON_TEXT = {
    no_token: 'No Upwork job link (~token) was found in the task name, so the proposal could not be reviewed automatically.',
    no_comments: 'No proposal comment was found on this task to review.',
    job_not_found: 'The linked Upwork job was not found in the jobs database, so the proposal could not be reviewed automatically.',
    no_proposal_in_thread: 'No actual freelancer proposal was found in the task comments.',
    error: 'An error occurred while reviewing this proposal automatically.',
};

function getProject(companyId, projectId) {
    return MongoDbCrudOpration(companyId, {
        type: dbCollections.PROJECTS,
        data: [
            { _id: new mongoose.Types.ObjectId(projectId) },
            { ProjectName: 1, ProjectCode: 1, lastTaskId: 1, taskStatusData: 1, CompanyId: 1, apps: 1 },
        ],
    }, 'findOne');
}

function resolveStatus(project, name) {
    const arr = Array.isArray(project && project.taskStatusData) ? project.taskStatusData : [];
    return arr.find((s) => s && String(s.name).toLowerCase() === String(name).toLowerCase()) || null;
}

// Resolve the user to attribute the auto-action to. Uses the global static
// AlianHub AI Bot user defined in utils/commonFunctions.js — NOT a real DB user.
// Every auto-move and reason-comment is therefore attributed to "AlianHub AI Bot"
// in the activity history and task chat, regardless of company / project.
//
// Kept async so the call-site signature doesn't change. If you later want a
// real DB-backed bot account (for proper avatar resolution, etc.), swap this
// body back to a `MongoDbCrudOpration('global', { type: USERS, ... })` lookup
// — every consumer still just reads { id, Employee_Name, companyOwnerId }.
async function getActorUserData() {
    return {
        id: ALIANHUB_BOT_USER.id,
        Employee_Name: ALIANHUB_BOT_USER.Employee_Name,
        companyOwnerId: ALIANHUB_BOT_USER.companyOwnerId,
    };
}

async function applyStatusMove({ companyId, project, fullTask, targetStatus, prevStatus, userData }) {
    const prev = {
        backColor: prevStatus && prevStatus.bgColor,
        color: prevStatus && prevStatus.textColor,
        statusName: prevStatus && prevStatus.name,
        taskName: fullTask.TaskName,
        bgColor: targetStatus.bgColor,
        textColor: targetStatus.textColor,
        taskId: String(fullTask._id),
        updatedTaskName: targetStatus.name,
    };
    const next = {
        status: { text: targetStatus.name, key: targetStatus.key, type: targetStatus.type },
        statusType: targetStatus.type,
        statusKey: targetStatus.key,
    };
    const projectData = {
        _id: String(project._id),
        CompanyId: companyId,
        lastTaskId: project.lastTaskId,
        ProjectName: project.ProjectName,
        ProjectCode: project.ProjectCode,
    };
    const taskForUpdate = {
        _id: String(fullTask._id),
        sprintId: String(fullTask.sprintId || ''),
        folderObjId: fullTask.folderObjId || '',
        TaskName: fullTask.TaskName,
        statusKey: fullTask.statusKey,
    };
    await taskMongo.updateStatus({
        newStatus: next, prevStatus: prev, projectData, task: taskForUpdate, userData, isUpdateTask: true,
    });
}

async function postReasonComment({ companyId, project, fullTask, reason, userData, statusName }) {
    try {
        const reasonText = (reason && String(reason).trim()) || 'The proposal did not sufficiently match the job requirements.';
        const message = `Moved to "${statusName}" by proposal review.\nReason: ${reasonText}`;
        const data = {
            message,
            type: 'text',
            userId: String((userData && userData.id) || ''),
            project: false,
            taskId: new mongoose.Types.ObjectId(String(fullTask._id)),
            sprintId: new mongoose.Types.ObjectId(String(fullTask.sprintId)),
            projectId: new mongoose.Types.ObjectId(String(project._id)),
            mentionIds: [],
        };
        if (fullTask.folderObjId) data.folderId = new mongoose.Types.ObjectId(String(fullTask.folderObjId));
        const saved = await MongoDbCrudOpration(companyId, { type: dbCollections.COMMENTS, data }, 'save');
        // Mirror the broadcast the default comment-save controller emits so
        // the team sees the reason in the live task chat.
        try { socketEmitter.emit('insert', { type: 'insert', data: saved, updatedFields: {}, module: 'comments' }); } catch (_e) { /* socket optional */ }
        return saved;
    } catch (e) {
        logger.error(`ProposalReview postReasonComment error (task ${fullTask && fullTask._id}): ${e && e.message ? e.message : e}`);
        return null;
    }
}

/**
 * Apply the result of an evaluateOne() to the task.
 *
 * @param {Object} input
 * @param {string} input.companyId
 * @param {Object} input.evaluation       Full output of evaluateOne().
 * @param {boolean} [input.dryRun=false]  If true, returns the plan; mutates nothing.
 *
 * @returns {Promise<{
 *   plan: { action: string, targetStatus: object|null, comment: string|null, userData: object|null, reason: string|null },
 *   applied: boolean,
 *   error?: string
 * }>}
 */
async function applyVerdict({ companyId, evaluation, dryRun = false }) {
    const plan = { action: null, targetStatus: null, comment: null, userData: null, reason: null };

    if (!evaluation || !evaluation.task) {
        plan.action = 'noop'; plan.reason = 'no task in evaluation';
        return { plan, applied: false, error: 'no_task' };
    }

    const project = await getProject(companyId, evaluation.task.ProjectID);
    if (!project) {
        plan.action = 'noop'; plan.reason = 'project not found';
        return { plan, applied: false, error: 'project_not_found' };
    }

    const sourceStatus = resolveStatus(project, SOURCE_STATUS_NAME);
    const approveStatus = resolveStatus(project, APPROVE_STATUS_NAME);
    const backlogStatus = resolveStatus(project, BACKLOG_STATUS_NAME);
    if (!sourceStatus || !approveStatus || !backlogStatus) {
        plan.action = 'noop';
        plan.reason = `project missing one of: "${SOURCE_STATUS_NAME}", "${APPROVE_STATUS_NAME}", "${BACKLOG_STATUS_NAME}"`;
        return { plan, applied: false, error: 'missing_status' };
    }

    // Decide the action.
    const v = evaluation.verdict;
    if (v && v.verdict === 'APPROVE') {
        plan.action = 'approve';
        plan.targetStatus = { name: approveStatus.name, key: approveStatus.key };
    } else if (v && v.verdict === 'BACKLOG') {
        plan.action = 'backlog_rejected';
        plan.targetStatus = { name: backlogStatus.name, key: backlogStatus.key };
        plan.comment = (v.reason || '').trim() || 'The proposal did not sufficiently match the job requirements.';
    } else if (v && v.found === false) {
        plan.action = 'backlog_no_proposal_in_thread';
        plan.targetStatus = { name: backlogStatus.name, key: backlogStatus.key };
        plan.comment = SKIP_REASON_TEXT.no_proposal_in_thread;
    } else if (evaluation.skipReason) {
        plan.action = `backlog_${evaluation.skipReason}`;
        plan.targetStatus = { name: backlogStatus.name, key: backlogStatus.key };
        plan.comment = SKIP_REASON_TEXT[evaluation.skipReason] || SKIP_REASON_TEXT.error;
    } else {
        plan.action = 'noop';
        plan.reason = 'no verdict and no skipReason';
        return { plan, applied: false, error: 'no_action_inferable' };
    }

    const userData = await getActorUserData();
    plan.userData = userData ? { id: userData.id, Employee_Name: userData.Employee_Name } : null;

    if (dryRun) {
        return { plan, applied: false };
    }

    if (!userData) {
        plan.reason = 'PROPOSAL_REVIEW_USER_ID not set';
        return { plan, applied: false, error: 'no_actor' };
    }

    try {
        // Re-read the full task — we need fields like statusKey for the move.
        const fullTask = await MongoDbCrudOpration(companyId, {
            type: dbCollections.TASKS,
            data: [{ _id: new mongoose.Types.ObjectId(evaluation.task._id) }],
        }, 'findOne');
        if (!fullTask) {
            return { plan, applied: false, error: 'task_disappeared' };
        }
        // If the task has already left "In Review - TL" (e.g. a human moved it
        // while the agent was thinking), don't override that human decision.
        if (fullTask.statusKey !== sourceStatus.key) {
            plan.reason = `task is no longer in "${SOURCE_STATUS_NAME}" (statusKey=${fullTask.statusKey})`;
            plan.action = 'noop';
            return { plan, applied: false, error: 'status_changed_during_review' };
        }

        const targetStatusObj = plan.action === 'approve' ? approveStatus : backlogStatus;
        await applyStatusMove({
            companyId, project, fullTask, targetStatus: targetStatusObj, prevStatus: sourceStatus, userData,
        });

        if (plan.action !== 'approve') {
            await postReasonComment({
                companyId, project, fullTask, reason: plan.comment, userData, statusName: backlogStatus.name,
            });
        }
        return { plan, applied: true };
    } catch (e) {
        logger.error(`ProposalReview applyVerdict error (task ${evaluation.task && evaluation.task._id}): ${e && e.message ? e.message : e}`);
        return { plan, applied: false, error: (e && e.message) || 'apply_failed' };
    }
}

module.exports = { applyVerdict, SOURCE_STATUS_NAME, APPROVE_STATUS_NAME, BACKLOG_STATUS_NAME };
