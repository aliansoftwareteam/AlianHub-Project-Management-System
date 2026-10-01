const crypto = require('crypto');
const mongoose = require('mongoose');
const { ancestorsFor } = require('../Tasks/helpers/taskTree');

const DAY_MS = 24 * 60 * 60 * 1000;
const NAME_MAX = 120;
const TITLE_MAX = 250;
const OFFSET_LIMIT = 3650;
const MAX_SUBTASKS = 50;
const MAX_CHECKLIST_ITEMS = 200;
const MAX_TZ_MINUTES = 14 * 60;
const DAY_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

const PARTS = ['title', 'description', 'checklist', 'subtasks', 'type', 'priority', 'tags', 'estimate', 'points', 'customFields', 'dates', 'subtaskAssignees'];

const FIELD_KEYS = Object.freeze({
    title: 'task.task_name_edit',
    description: 'task.task_description',
    type: 'task.task_type',
    priority: 'task.task_priority',
    tags: 'task.task_tag',
    estimate: 'task.task_estimated_hours',
    points: 'task.task_estimated_hours',
    customFields: 'task.task_custom_field',
    startDate: 'task.task_start_date',
    dueDate: 'task.task_due_date',
    checklist: 'task.task_checklist',
    subtasks: 'task.sub_task_create',
});

const isPlainObject = (value) => Boolean(value) && typeof value === 'object' && !Array.isArray(value);
const isSet = (value) => value !== undefined && value !== null && value !== '';
const isEmpty = (value) => !isSet(value) || (Array.isArray(value) && !value.length) || (isPlainObject(value) && !Object.keys(value).length);
const sameValue = (a, b) => JSON.stringify(a) === JSON.stringify(b);

const cleanName = (value) => (typeof value === 'string' ? value.trim().slice(0, NAME_MAX) : '');

const includesOf = (include) => Object.fromEntries(PARTS.map((part) => [part, !(isPlainObject(include) && include[part] === false)]));

const toOffset = (value) => {
    if (!isSet(value)) return null;
    const n = Number(value);
    return Number.isFinite(n) ? Math.max(-OFFSET_LIMIT, Math.min(OFFSET_LIMIT, Math.round(n))) : null;
};

/* Minutes as Date#getTimezoneOffset gives them: UTC minus local. */
const tzOf = (value) => {
    const n = Number(value);
    return Number.isFinite(n) && Math.abs(n) <= MAX_TZ_MINUTES ? n : 0;
};

const dayIndex = (date, tz) => {
    const ms = date ? new Date(date).getTime() : NaN;
    return Number.isFinite(ms) ? Math.floor((ms - tz * 60000) / DAY_MS) : null;
};

const offsetBetween = (date, base, tz) => {
    const at = dayIndex(date, tz);
    const from = dayIndex(base, tz);
    return at === null || from === null ? null : toOffset(at - from);
};

/* The caller's local day the template is applied on: its midnight as an instant, and its YYYY-MM-DD label. */
const applyDayOf = ({ applyDate, tzOffsetMinutes } = {}, now = new Date()) => {
    const tz = tzOf(tzOffsetMinutes);
    const match = typeof applyDate === 'string' ? DAY_PATTERN.exec(applyDate) : null;
    const utcMidnight = match ? Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])) : dayIndex(now, tz) * DAY_MS;
    return { start: utcMidnight + tz * 60000, label: new Date(utcMidnight).toISOString().slice(0, 10) };
};

const startAt = (day, offset) => (offset === null ? null : new Date(day.start + offset * DAY_MS));
const dueAt = (day, offset) => (offset === null ? null : new Date(day.start + (offset + 1) * DAY_MS - 1));

const renderTitle = (pattern, { title = '', date = '' } = {}) => {
    if (!pattern) return String(title || '').slice(0, TITLE_MAX);
    return String(pattern).replace(/\{title\}/g, title || '').replace(/\{date\}/g, date || '').replace(/\s+/g, ' ').trim().slice(0, TITLE_MAX);
};

const checklistOf = (items) => {
    const list = (Array.isArray(items) ? items : [])
        .filter((item) => isPlainObject(item) && isSet(item.id) && typeof item.name === 'string' && item.name.trim())
        .slice(0, MAX_CHECKLIST_ITEMS);
    const ids = new Set(list.map((item) => String(item.id)));
    return list.map((item) => ({
        key: String(item.id),
        name: item.name.trim().slice(0, TITLE_MAX),
        parentKey: isSet(item.parentId) && ids.has(String(item.parentId)) ? String(item.parentId) : '',
    }));
};

const newItemId = () => crypto.randomBytes(6).toString('hex');

const freshChecklist = (checklist) => {
    const list = Array.isArray(checklist) ? checklist : [];
    const ids = new Map(list.map((item) => [item.key, newItemId()]));
    return list.map((item) => ({
        id: ids.get(item.key),
        name: item.name,
        isChecked: false,
        isExpand: false,
        AssigneeUserId: [],
        ...(item.parentKey && ids.has(item.parentKey) ? { parentId: ids.get(item.parentKey) } : {}),
    }));
};

/* Offsets count days from the day the source task was created, in the saver's time zone. */
const buildTemplate = ({ task, subtasks = [], body = {}, uid }) => {
    const include = includesOf(body.include);
    const tz = tzOf(body.tzOffsetMinutes);
    const base = task.createdAt || new Date();
    const scope = body.scope === 'workspace' ? 'workspace' : 'project';
    const given = (key) => Object.prototype.hasOwnProperty.call(body, key);
    const offsetOf = (key, date) => {
        if (!include.dates) return null;
        return given(key) ? toOffset(body[key]) : offsetBetween(date, base, tz);
    };
    const typeKey = Number(task.TaskTypeKey);
    return {
        name: cleanName(body.name),
        scope,
        ProjectID: scope === 'project' ? task.ProjectID : null,
        defaultForProjects: [],
        sourceTaskId: String(task._id),
        titlePattern: include.title ? (typeof body.titlePattern === 'string' ? body.titlePattern.trim() : String(task.TaskName || '')).slice(0, TITLE_MAX) : '',
        rawDescription: include.description ? String(task.rawDescription || '') : '',
        descriptionBlock: include.description && isPlainObject(task.descriptionBlock) ? task.descriptionBlock : {},
        TaskType: include.type ? String(task.TaskType || '') : '',
        TaskTypeKey: include.type && Number.isFinite(typeKey) ? typeKey : null,
        Task_Priority: include.priority ? String(task.Task_Priority || '') : '',
        tagsArray: include.tags && Array.isArray(task.tagsArray) ? task.tagsArray.map(String) : [],
        totalEstimatedTime: include.estimate && Number(task.totalEstimatedTime) > 0 ? Number(task.totalEstimatedTime) : null,
        points: include.points && isSet(task.points) && Number.isFinite(Number(task.points)) ? Number(task.points) : null,
        customField: include.customFields && isPlainObject(task.customField) ? task.customField : {},
        startOffsetDays: offsetOf('startOffsetDays', task.startDate),
        dueOffsetDays: offsetOf('dueOffsetDays', task.DueDate),
        checklist: include.checklist ? checklistOf(task.checklistArray) : [],
        subtasks: include.subtasks
            ? subtasks.slice(0, MAX_SUBTASKS).map((sub) => ({
                title: String(sub.TaskName || '').trim().slice(0, TITLE_MAX),
                startOffsetDays: include.dates ? offsetBetween(sub.startDate, base, tz) : null,
                dueOffsetDays: include.dates ? offsetBetween(sub.DueDate, base, tz) : null,
                assigneeIds: include.subtaskAssignees && Array.isArray(sub.AssigneeUserId) ? sub.AssigneeUserId.map(String) : [],
            })).filter((sub) => sub.title)
            : [],
        createdBy: uid,
        updatedBy: uid,
        deletedStatusKey: 0,
    };
};

const preview = (value) => (typeof value === 'string' ? value.slice(0, 80) : value);

/*
 * What applying `template` to `task` would change. A field the task leaves empty is filled; a filled field that
 * differs is a conflict unless `overwrite` names it. Tags, checklist items and subtasks are only ever added.
 */
const planApply = ({ template, task, project = {}, day, overwrite = [] }) => {
    const allowed = new Set(Array.isArray(overwrite) ? overwrite.map(String) : []);
    const changes = [];
    const conflicts = [];
    const consider = (field, { filled, differs, patch, current, next }) => {
        if (!filled || (differs && allowed.has(field))) changes.push({ field, patch });
        else if (differs) conflicts.push({ field, current: preview(current), template: preview(next) });
    };

    if (template.titlePattern) {
        const title = renderTitle(template.titlePattern, { title: task.TaskName, date: day.label });
        consider('title', { filled: true, differs: Boolean(title) && title !== task.TaskName, patch: { TaskName: title }, current: task.TaskName, next: title });
    }
    if (template.rawDescription || !isEmpty(template.descriptionBlock)) {
        consider('description', {
            filled: Boolean(String(task.rawDescription || '').trim()),
            differs: template.rawDescription !== task.rawDescription,
            patch: { rawDescription: template.rawDescription, descriptionBlock: template.descriptionBlock || {} },
            current: task.rawDescription,
            next: template.rawDescription,
        });
    }
    const type = isSet(template.TaskTypeKey) && (project.taskTypeCounts || []).find((t) => Number(t.key) === Number(template.TaskTypeKey));
    if (type) {
        consider('type', {
            filled: isSet(task.TaskTypeKey),
            differs: Number(task.TaskTypeKey) !== Number(type.key),
            patch: { TaskType: type.value || template.TaskType, TaskTypeKey: Number(type.key) },
            current: task.TaskType,
            next: type.name || type.value,
        });
    }
    if (template.Task_Priority) {
        consider('priority', { filled: isSet(task.Task_Priority), differs: task.Task_Priority !== template.Task_Priority, patch: { Task_Priority: template.Task_Priority }, current: task.Task_Priority, next: template.Task_Priority });
    }
    const tags = (task.tagsArray || []).map(String);
    const missingTags = (template.tagsArray || []).map(String).filter((tag) => !tags.includes(tag));
    if (missingTags.length) changes.push({ field: 'tags', patch: { tagsArray: [...(task.tagsArray || []), ...missingTags] } });
    if (Number(template.totalEstimatedTime) > 0) {
        const estimate = Number(template.totalEstimatedTime);
        consider('estimate', { filled: Number(task.totalEstimatedTime) > 0, differs: Number(task.totalEstimatedTime) !== estimate, patch: { totalEstimatedTime: estimate }, current: task.totalEstimatedTime, next: estimate });
    }
    if (isSet(template.points)) {
        consider('points', { filled: isSet(task.points), differs: Number(task.points) !== Number(template.points), patch: { points: Number(template.points) }, current: task.points, next: template.points });
    }
    const fields = Object.entries(isPlainObject(template.customField) ? template.customField : {});
    if (fields.length) {
        const own = isPlainObject(task.customField) ? task.customField : {};
        const empty = fields.filter(([id]) => isEmpty(own[id]));
        const differing = fields.filter(([id, value]) => !isEmpty(own[id]) && !sameValue(own[id], value));
        const taken = [...empty, ...(allowed.has('customFields') ? differing : [])];
        if (taken.length) changes.push({ field: 'customFields', patch: { customField: { ...own, ...Object.fromEntries(taken) } } });
        if (differing.length && !allowed.has('customFields')) conflicts.push({ field: 'customFields', current: differing.length, template: differing.length });
    }
    const start = startAt(day, toOffset(template.startOffsetDays));
    if (start) {
        consider('startDate', { filled: isSet(task.startDate), differs: dayIndex(task.startDate, 0) !== dayIndex(start, 0), patch: { startDate: start }, current: task.startDate, next: start });
    }
    const due = dueAt(day, toOffset(template.dueOffsetDays));
    if (due) {
        consider('dueDate', {
            filled: isSet(task.DueDate),
            differs: new Date(task.DueDate).getTime() !== due.getTime(),
            patch: { DueDate: due, dueDateDeadLine: [...(Array.isArray(task.dueDateDeadLine) ? task.dueDateDeadLine : []), due] },
            current: task.DueDate,
            next: due,
        });
    }

    return {
        changes,
        conflicts,
        checklist: freshChecklist(template.checklist),
        subtasks: (Array.isArray(template.subtasks) ? template.subtasks : []).slice(0, MAX_SUBTASKS).map((sub) => ({
            title: sub.title,
            startDate: startAt(day, toOffset(sub.startOffsetDays)),
            dueDate: dueAt(day, toOffset(sub.dueOffsetDays)),
            assigneeIds: Array.isArray(sub.assigneeIds) ? sub.assigneeIds.map(String) : [],
        })).filter((sub) => sub.title),
    };
};

const defaultStatusOf = (project) => {
    const statuses = (project && project.taskStatusData) || [];
    return statuses.find((s) => s.type === 'default_active') || statuses[0] || { key: 1, name: 'To Do', value: 'to_do', type: 'default_active' };
};

/* The body POST /api/v2/tasks takes for a subtask, in the parent's list and folder. */
const subtaskData = ({ sub, parent, project, companyId, actorId, assignees }) => {
    const status = defaultStatusOf(project);
    const type = ((project && project.taskTypeCounts) || [])[0] || { key: 1, value: 'task' };
    const due = sub.dueDate ? sub.dueDate.toISOString() : '';
    const data = {
        _id: new mongoose.Types.ObjectId(),
        TaskName: sub.title,
        TaskKey: '-',
        AssigneeUserId: assignees,
        watchers: [...new Set([...assignees, actorId])],
        DueDate: due,
        dueDateDeadLine: due ? [{ date: due }] : [],
        TaskType: type.value || type.name || 'task',
        TaskTypeKey: Number(type.key),
        ParentTaskId: String(parent._id),
        ancestors: ancestorsFor(parent),
        ProjectID: String(parent.ProjectID),
        CompanyId: companyId,
        status: { text: status.name, key: status.key, value: status.value, type: status.type },
        isParentTask: false,
        Task_Leader: actorId,
        sprintArray: parent.sprintArray,
        Task_Priority: 'MEDIUM',
        deletedStatusKey: 0,
        sprintId: String(parent.sprintId || ''),
        statusType: status.type,
        statusKey: status.key,
    };
    if (sub.startDate) data.startDate = sub.startDate.toISOString();
    if (parent.folderObjId) data.folderObjId = String(parent.folderObjId);
    return data;
};

module.exports = {
    FIELD_KEYS,
    NAME_MAX,
    cleanName,
    includesOf,
    applyDayOf,
    renderTitle,
    buildTemplate,
    planApply,
    defaultStatusOf,
    subtaskData,
};
