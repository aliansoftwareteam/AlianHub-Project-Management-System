const mongoose = require('mongoose');
const { randomFor } = require('./random');
const {
    SHARES, DAY_MS, CREATED_SPAN_DAYS, CREATED_STEP_MS, DUE_WINDOW_DAYS, PRIORITIES, STATUS_WEIGHTS, ASSIGNEE_COUNTS, TAG_COUNTS,
    SUBTASK_COUNTS, COMMENT_COUNTS, ESTIMATE_MINUTES, POINTS, GROUP_INDEX_STEP,
} = require('./shape');

const { ObjectId } = mongoose.Types;

const VERBS = ['Fix', 'Add', 'Review', 'Refactor', 'Document', 'Test', 'Investigate', 'Migrate', 'Design', 'Remove', 'Speed up', 'Audit'];
const SUBJECTS = ['login redirect', 'invoice export', 'board drag and drop', 'notification digest', 'search ranking', 'timesheet approval', 'sprint burndown', 'file preview', 'custom field picker', 'webhook retries', 'role permissions', 'onboarding checklist', 'calendar sync', 'comment mentions', 'report scheduler', 'API rate limit'];
const CONTEXTS = ['on Safari', 'for guests', 'in dark mode', 'on mobile', 'for large projects', 'after an import', 'when offline', 'for admins', 'in the task panel', 'during a sprint close'];
const STEPS = ['Write the failing test', 'Reproduce and record the cause', 'Ship behind a flag', 'Update the help page', 'Ask QA to verify', 'Clean up the old path'];
const REMARKS = ['Picked this up, will post an update tomorrow.', 'Reproduced on staging. The cause is in the request handler.', 'Blocked until the design is signed off.', 'Fix is in review.', 'Verified on the latest build.', 'Moving this to the next sprint, it needs more discovery.', 'Can someone confirm the expected behaviour here?', 'Customer reported this again today.'];

// timestamp (4 bytes), a fixed marker and the document kind (5 bytes), a counter (3 bytes): a valid ObjectId that is the same on every run.
const ID_KINDS = { task: '0', subtask: '1', comment: '2' };
const objectIdFor = (kind, at, counter) => new ObjectId(
    Math.floor(at.getTime() / 1000).toString(16).padStart(8, '0') + `5ca1e5eed${ID_KINDS[kind]}` + counter.toString(16).padStart(6, '0'),
);

const MAX_SUBTASKS = Math.max(...SUBTASK_COUNTS.map(([count]) => count));
const MAX_COMMENTS = Math.max(...COMMENT_COUNTS.map(([count]) => count));

const statusesOf = (project) => (project.taskStatusData || [])
    .map((status) => (status && status.convertStatus ? status.convertStatus : status))
    .filter(Boolean)
    .map(({ name, key, type }) => ({ name, key, type }));

const taskTypesOf = (project) => {
    const types = (project.taskTypeCounts || []).map((type) => ({ value: type.value || type.name, key: type.key, isDefault: type.default === true }));
    const subtask = types.find((type) => type.value === 'sub_task');
    const parents = types.filter((type) => type !== subtask);
    const main = parents.find((type) => type.isDefault) || parents[0];
    return { main, others: parents.filter((type) => type !== main), subtask: subtask || main };
};

const startOfDay = (date) => new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));

const fieldValue = (field, rng, due) => {
    switch (field.fieldType) {
        case 'dropdown': return [rng.pick(field.fieldOptions).id];
        case 'number': return String(1 + rng.int(100));
        case 'date': return new Date(due.getTime() + rng.int(30) * DAY_MS).toISOString();
        case 'checkbox': return rng.chance(0.5);
        default: return `REF-${1000 + rng.int(9000)}`;
    }
};

const customFieldValues = (fields, rng, due) => {
    const chosen = fields.filter(() => rng.chance(0.8));
    return Object.fromEntries((chosen.length ? chosen : [rng.pick(fields)]).map((field) => {
        const id = String(field._id);
        return [id, { fieldValue: fieldValue(field, rng, due), _id: id }];
    }));
};

const planContext = ({ companyId, project, lists, memberIds, ownerId, fields, anchor }) => {
    const statuses = statusesOf(project);
    return {
        companyId: new ObjectId(String(companyId)),
        projectId: new ObjectId(String(project._id)),
        projectCode: project.ProjectCode,
        statuses,
        statusWeights: statuses.map((status) => [status, STATUS_WEIGHTS[status.type] || 0.1]),
        types: taskTypesOf(project),
        // Earlier lists hold more tasks, the way a project's first sprints do.
        listWeights: lists.map((list, n) => [{ id: new ObjectId(String(list._id)), name: list.name }, 1 + (lists.length - n) / lists.length]),
        memberIds: memberIds.map(String),
        ownerId: String(ownerId),
        tagIds: (project.tagsArray || []).map((tag) => tag.uid),
        fields,
        anchorDay: startOfDay(anchor),
        firstCreatedAt: new Date(startOfDay(anchor).getTime() - CREATED_SPAN_DAYS * DAY_MS),
    };
};

const baseTask = ({ plan, rng, name, key, type, list, createdAt, parentId }) => {
    const status = rng.weighted(plan.statusWeights);
    const assignees = rng.sample(plan.memberIds, rng.weighted(ASSIGNEE_COUNTS));
    const leader = rng.chance(0.5) ? plan.ownerId : rng.pick(plan.memberIds);
    const due = rng.chance(SHARES.dueDate)
        ? new Date(plan.anchorDay.getTime() + (rng.int(DUE_WINDOW_DAYS.before + DUE_WINDOW_DAYS.after) - DUE_WINDOW_DAYS.before) * DAY_MS)
        : null;
    const task = {
        TaskName: name,
        TaskKey: key,
        AssigneeUserId: assignees,
        watchers: [...new Set([leader, ...assignees])],
        DueDate: due,
        dueDateDeadLine: due ? [due] : [],
        TaskType: type.value,
        TaskTypeKey: type.key,
        ParentTaskId: parentId ? String(parentId) : '',
        ProjectID: plan.projectId,
        CompanyId: plan.companyId,
        status: { text: status.name, key: status.key, type: status.type },
        isParentTask: !parentId,
        Task_Leader: leader,
        sprintArray: { id: list.id, name: list.name },
        Task_Priority: rng.weighted(PRIORITIES),
        deletedStatusKey: 0,
        sprintId: list.id,
        statusType: status.type,
        statusKey: status.key,
        createdAt,
        updatedAt: createdAt,
    };
    if (due && rng.chance(SHARES.startDate)) task.startDate = new Date(due.getTime() - (1 + rng.int(14)) * DAY_MS);
    return task;
};

const commentsFor = ({ plan, rng, index, task }) => Array.from({ length: rng.weighted(COMMENT_COUNTS) }, (_, n) => {
    const createdAt = new Date(task.createdAt.getTime() + (n + 1) * 3 * 60 * 60 * 1000);
    return {
        _id: objectIdFor('comment', createdAt, index * (MAX_COMMENTS + 1) + n),
        message: rng.pick(REMARKS),
        type: 'text',
        userId: rng.pick(plan.memberIds),
        project: false,
        projectId: plan.projectId,
        sprintId: task.sprintId,
        taskId: task._id,
        mentionIds: [],
        createdAt,
        updatedAt: createdAt,
    };
});

/* Yields { index, task, subtasks, comments } in key order. Keys and status indexes are the ones the app's create path
 * would have left after creating the same tasks one by one, each parent followed by its subtasks. */
function* generateTasks(context, count) {
    const plan = planContext(context);
    const perStatus = new Map();
    let sequence = 0;
    const nextKey = () => { sequence += 1; return `${plan.projectCode}-${sequence}`; };

    for (let index = 0; index < count; index += 1) {
        const rng = randomFor(index);
        const createdAt = new Date(plan.firstCreatedAt.getTime() + index * CREATED_STEP_MS);
        const list = rng.weighted(plan.listWeights);
        const type = plan.types.others.length && rng.chance(0.2) ? rng.pick(plan.types.others) : plan.types.main;
        const task = {
            _id: objectIdFor('task', createdAt, index),
            ...baseTask({ plan, rng, name: `${rng.pick(VERBS)} ${rng.pick(SUBJECTS)} ${rng.pick(CONTEXTS)}`, key: nextKey(), type, list, createdAt }),
        };

        const placed = perStatus.get(task.statusKey) || 0;
        task.groupByStatusIndex = placed === 0 ? 0 : -GROUP_INDEX_STEP * placed;
        perStatus.set(task.statusKey, placed + 1);

        const tags = rng.sample(plan.tagIds, rng.weighted(TAG_COUNTS));
        if (tags.length) task.tagsArray = tags;
        if (rng.chance(SHARES.estimate)) task.totalEstimatedTime = rng.pick(ESTIMATE_MINUTES);
        if (rng.chance(SHARES.points)) task.points = rng.pick(POINTS);
        if (rng.chance(SHARES.description)) {
            task.description = `${task.TaskName}. ${rng.pick(REMARKS)}`;
            task.rawDescription = task.description;
        }
        if (plan.fields.length && rng.chance(SHARES.customFields)) task.customField = customFieldValues(plan.fields, rng, task.DueDate || createdAt);

        const subtasks = rng.chance(SHARES.subtasks)
            ? Array.from({ length: rng.weighted(SUBTASK_COUNTS) }, (_, n) => {
                const subCreatedAt = new Date(createdAt.getTime() + (n + 1) * 60 * 60 * 1000);
                return {
                    _id: objectIdFor('subtask', subCreatedAt, index * (MAX_SUBTASKS + 1) + n),
                    ...baseTask({ plan, rng, name: `${rng.pick(STEPS)}: ${rng.pick(SUBJECTS)}`, key: nextKey(), type: plan.types.subtask, list, createdAt: subCreatedAt, parentId: task._id }),
                };
            })
            : [];
        if (subtasks.length) task.subTasks = subtasks.length;

        const comments = rng.chance(SHARES.comments) ? commentsFor({ plan, rng, index, task }) : [];
        if (comments.length) {
            const last = comments[comments.length - 1];
            task.lastMessage = last.createdAt;
            task.message = last.message;
        }

        yield { index, task, subtasks, comments };
    }
}

/* The counters the app keeps as it creates tasks: a project's last task number and per-type counts, each list's task count. */
const tally = () => {
    const counters = { tasks: 0, subtasks: 0, comments: 0, lastTaskId: 0, perType: {}, perList: {}, perStatus: {} };
    const count = (bucket, key) => { bucket[key] = (bucket[key] || 0) + 1; };
    const add = ({ task, subtasks, comments }) => {
        counters.tasks += 1;
        counters.subtasks += subtasks.length;
        counters.comments += comments.length;
        count(counters.perStatus, task.statusKey);
        [task, ...subtasks].forEach((doc) => {
            counters.lastTaskId += 1;
            count(counters.perType, doc.TaskTypeKey);
            count(counters.perList, String(doc.sprintId));
        });
    };
    return { add, counters };
};

const countersOf = (rows) => {
    const { add, counters } = tally();
    for (const row of rows) add(row);
    return counters;
};

module.exports = { generateTasks, tally, countersOf, statusesOf, taskTypesOf, objectIdFor };
