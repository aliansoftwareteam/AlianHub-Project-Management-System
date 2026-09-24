/* The rules the task panel applies (TaskDetailRightSide, TaskStatus): a picker opens only on
 * `=== true`, and every property also needs task list access. Read (false) keeps the value
 * on show with nothing to open. */
export function rowEditRights(check, { archived = false } = {}) {
    const yes = (key) => check(`task.${key}`) === true;
    const open = !archived && yes("task_list");
    return {
        status: open && yes("task_status"),
        assignee: open && yes("task_assignee"),
        due: open && yes("task_due_date"),
        priority: open && yes("task_priority"),
        rename: open && yes("task_name_edit"),
        subtask: open && yes("sub_task_create")
    };
}

export const projectHasApp = (project, key) => (project?.apps || []).some((app) => app === key || app?.key === key);

export function priorityAppOn(project, planFeature) {
    return projectHasApp(project, "Priority") && Boolean(planFeature?.projectProjectApp);
}

const STATUS_KINDS = [
    { id: "todo", types: ["default_active", "default"] },
    { id: "active", types: [] },
    { id: "done", types: ["close", "done"] }
];

const kindOf = (type) => (STATUS_KINDS.find((kind) => kind.types.includes(type)) || STATUS_KINDS[1]).id;

export function statusOptions(statuses, label) {
    return STATUS_KINDS
        .map((kind) => ({
            label: label(kind.id),
            options: (statuses || []).filter((s) => kindOf(s.type) === kind.id).map((s) => ({ ...s, label: s.name, value: s.key }))
        }))
        .filter((group) => group.options.length);
}

export const isDoneStatus = (status) => kindOf(status?.type) === "done";

export function nextAssignees(before, type, uid) {
    if (type === "add") return [...new Set([...before, uid])];
    if (type === "remove") return before.filter((id) => id !== uid);
    return [uid];
}

export function assigneeInverse(type, uid, before) {
    if (type === "add") return { type: "remove", uid };
    if (type === "remove") return { type: "add", uid };
    const previous = before.find((id) => id !== uid);
    return previous ? { type: "replace", uid: previous } : { type: "remove", uid };
}

const asDate = (value) => (value && value.seconds ? new Date(value.seconds * 1000) : new Date(value));

export function dueChange(task, date) {
    return {
        DueDate: date,
        dueDateDeadLine: [...(task.dueDateDeadLine || []).map((x) => ({ date: asDate(x.date) })), { date: asDate(date) }]
    };
}

export function dueSnapshot(task) {
    return {
        DueDate: task.DueDate || null,
        dueDateDeadLine: (task.dueDateDeadLine || []).map((x) => ({ date: x.date }))
    };
}

export function dueRestore(snapshot) {
    return {
        DueDate: snapshot.DueDate ? asDate(snapshot.DueDate) : null,
        dueDateDeadLine: snapshot.dueDateDeadLine.map((x) => ({ date: asDate(x.date) }))
    };
}
