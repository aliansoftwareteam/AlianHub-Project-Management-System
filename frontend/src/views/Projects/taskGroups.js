const DAY_SECONDS = 24 * 60 * 60;

const startOfDay = (date) => new Date(date.getFullYear(), date.getMonth(), date.getDate());

const sortByIndex = (rows, indexKey) => (rows || []).sort((x, y) => (x[indexKey] > y[indexKey] ? 1 : -1));

/* `matchName` is the English name the task store matches due-date groups on
   (ProjectData/mutations.js `returnItemCountDetails`), so the displayed name can be translated. */
export function dueDateBuckets(now, t) {
    const today = startOfDay(now).getTime() / 1000;
    const tomorrow = today + DAY_SECONDS;
    const thisWeek = tomorrow + DAY_SECONDS;
    const later = Math.max(thisWeek, today + (7 - startOfDay(now).getDay()) * DAY_SECONDS);

    const buckets = [
        { matchName: "Overdue", name: t("List.due_group_overdue"), value: "OVERDUE", textColor: "red", operation: "lt", searchCondition: ":>", seconds: today - 1 },
        { matchName: "Today", name: t("List.due_group_today"), value: "TODAY", operation: "range", searchCondition: ":=", seconds: today, endSeconds: tomorrow },
        { matchName: "Tomorrow", name: t("List.due_group_tomorrow"), value: "TOMORROW", operation: "range", searchCondition: ":=", seconds: tomorrow, endSeconds: thisWeek },
        { matchName: "This week", name: t("List.due_group_this_week"), value: "THIS_WEEK", operation: "range", searchCondition: ":=", seconds: thisWeek, endSeconds: later },
        { matchName: "Next", name: t("List.due_group_later"), value: "NEXT", operation: "gt", searchCondition: ":<", seconds: later },
        { matchName: "No Due Date", name: t("List.due_group_none"), value: "NO_DUE_DATE", operation: "non", searchCondition: ":=", seconds: 0 }
    ];

    return buckets
        .filter((bucket) => bucket.operation !== "range" || bucket.endSeconds > bucket.seconds)
        .map((bucket) => ({ ...bucket, isExpanded: true }));
}

/* `dbDate` values are re-read with `new Date(value)` on the server (Modules/Auth/helper.js),
   so a bound has to be a date and not the second count the group is keyed on. */
export function dueDateCondition({ operation, seconds, endSeconds }, key) {
    const bound = (value) => new Date(value * 1000);

    switch (operation) {
        case "range":
            return { [key]: { dbDate: { $gte: bound(seconds), $lt: bound(endSeconds) } } };
        case "lt":
            return { [key]: { dbDate: { $lte: bound(seconds) } } };
        case "gt":
            return { [key]: { dbDate: { $gte: bound(seconds) } } };
        default:
            return { [key]: null };
    }
}

/* Groups are matched on `key`, never on `name`: under assignee grouping every group is named
   "Assignee", so a name match applied one person's collapse to everybody. */
export function restoreGroupState(sprints, previousSprints, indexKey) {
    const previousSprintById = new Map((previousSprints || []).map((sprint) => [sprint.id, sprint]));

    (sprints || []).forEach((sprint) => {
        const previousSprint = previousSprintById.get(sprint.id);
        if (!previousSprint) return;

        sprint.isExpanded = previousSprint.isExpanded;

        const previousItemByKey = new Map((previousSprint.items || []).map((item) => [item.key, item]));

        (sprint.items || []).forEach((item) => {
            const previousItem = previousItemByKey.get(item.key);
            if (!previousItem) return;

            item.isExpanded = previousItem.isExpanded;
            item.tasksArray = sortByIndex(item.tasksArray, indexKey);

            const previousTaskById = new Map((previousItem.tasksArray || []).map((task) => [task.id, task]));

            item.tasksArray.forEach((task, index) => {
                if (task[indexKey] === undefined) task[indexKey] = index;

                const previousTask = previousTaskById.get(task.id);
                if (!previousTask) return;

                task.isExpanded = previousTask.isExpanded;
                task.subtaskArray = sortByIndex(task.subtaskArray, indexKey);
                task.subtaskArray.forEach((subTask, subIndex) => {
                    if (subTask[indexKey] === undefined) subTask[indexKey] = subIndex;
                });
            });
        });
    });

    return sprints;
}

export function sprintToLoad(sprints, canExpandFirst) {
    const list = sprints || [];
    const expanded = list.find((sprint) => sprint.isExpanded);
    if (expanded) return expanded;

    const first = list[0];
    if (first && canExpandFirst && (first.deletedStatusKey === undefined || first.deletedStatusKey === 0)) {
        first.isExpanded = true;
        return first;
    }

    return first;
}

export function assigneeGroups(memberIds, getUser, unassignedName) {
    const members = [...new Set((memberIds || []).map(String))].map((id) => ({
        isExpanded: true,
        name: "Assignee",
        users: [getUser(id)],
        value: id
    }));
    return [...members, { isExpanded: true, name: unassignedName, users: [], value: "" }];
}

export function assigneeCondition(value) {
    return value ? { AssigneeUserId: { $in: [value] } } : { AssigneeUserId: { $in: [null, []] } };
}
