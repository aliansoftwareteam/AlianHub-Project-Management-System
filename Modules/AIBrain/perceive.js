// AHE-3792 — the Brain's "Perceive" step.
//
// buildProjectContext() is a READ-ONLY, companyId-scoped snapshot of one
// project: task counts by status plus the actionable lists (overdue, stale,
// unassigned). Shared by the /perceive endpoint and by skills (the Think step),
// so there is a single source of truth for "what the Brain sees". Writes
// nothing.

const { SCHEMA_TYPE } = require('../../Config/schemaType');
const { MongoDbCrudOpration } = require('../../utils/mongo-handler/mongoQueries');
const mongoose = require('mongoose');

const MAX_TASKS = 1500;

async function buildProjectContext(companyId, opts = {}) {
    const projectId = String(opts.projectId || '');
    if (!mongoose.Types.ObjectId.isValid(projectId)) return null;
    const callerUserId = String(opts.callerUserId || '');
    const restrictToSelf = !!opts.restrictToSelf;
    const staleDays = Math.max(1, Number(opts.staleDays) || 7);

    const projects = await MongoDbCrudOpration(companyId, {
        type: SCHEMA_TYPE.PROJECTS,
        data: [{ _id: new mongoose.Types.ObjectId(projectId) }, { ProjectName: 1, ProjectCode: 1, statusType: 1, LeadUserId: 1 }],
    }, 'find').catch(() => []);
    const project = (projects && projects[0]) || null;
    if (!project) return null;

    const taskFilter = { ProjectID: new mongoose.Types.ObjectId(projectId), deletedStatusKey: 0 };
    // Non-admins perceive only their own tasks (AssigneeUserId is an array; an
    // equality match on the field matches when it contains the id).
    if (restrictToSelf && callerUserId) taskFilter.AssigneeUserId = callerUserId;
    const tasks = await MongoDbCrudOpration(companyId, {
        type: SCHEMA_TYPE.TASKS,
        data: [taskFilter, { TaskName: 1, TaskKey: 1, statusType: 1, DueDate: 1, AssigneeUserId: 1, updatedAt: 1, sprintArray: 1 }, { limit: MAX_TASKS }],
    }, 'find').catch(() => []);
    const list = tasks || [];

    const now = Date.now();
    const staleMs = staleDays * 24 * 60 * 60 * 1000;
    const isDone = (t) => t.statusType === 'done';
    const byStatus = {};
    const overdue = [], stale = [], unassigned = [];
    list.forEach((t) => {
        const st = t.statusType || 'unknown';
        byStatus[st] = (byStatus[st] || 0) + 1;
        if (isDone(t)) return;
        if (t.DueDate && new Date(t.DueDate).getTime() < now) overdue.push(t);
        const upd = t.updatedAt ? new Date(t.updatedAt).getTime() : 0;
        if (upd && (now - upd) > staleMs) stale.push(t);
        const assignees = Array.isArray(t.AssigneeUserId) ? t.AssigneeUserId : (t.AssigneeUserId ? [t.AssigneeUserId] : []);
        if (!assignees.length) unassigned.push(t);
    });
    overdue.sort((a, b) => new Date(a.DueDate) - new Date(b.DueDate));
    stale.sort((a, b) => new Date(a.updatedAt || 0) - new Date(b.updatedAt || 0));

    return { project, list, byStatus, overdue, stale, unassigned, staleDays, truncated: list.length >= MAX_TASKS };
}

module.exports = { buildProjectContext };
