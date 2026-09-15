// Who may be picked as a task's assignee. Shared by the task detail panel, the list row, the
// Kanban card, the dashboard list and the subtask create row, which each carried their own copy.

export const sprintOf = (project, task) => (task?.folderObjId
    ? project?.sprintsfolders?.[task.folderObjId]?.sprintsObj?.[task?.sprintId]
    : project?.sprintsObj?.[task?.sprintId]) || null;

// parentAssignees is undefined while the parent is still loading, and that must not read as a
// parent with nobody on it — otherwise the picker offers everyone until the request lands.
export function scopedAssignees({ task, sprint, project, parentAssignees, companyUsers }) {
    if (!sprint) return [];
    const inSpace = (users) => (project?.isPrivateSpace ? users.filter((x) => project.AssigneeUserId?.includes(x)) : users);
    const container = inSpace(sprint.private
        ? (sprint.AssigneeUserId || [])
        : project?.isPrivateSpace ? (project.AssigneeUserId || []) : (companyUsers || []));
    if (task?.isParentTask) return container;
    if (!Array.isArray(parentAssignees)) return [];
    const fromParent = inSpace(sprint.private
        ? parentAssignees.filter((x) => sprint.AssigneeUserId?.includes(x))
        : parentAssignees);
    // A subtask is narrowed to its parent's people, but a parent with nobody left in scope must
    // not leave the subtask with nobody to pick — fall back to what the container offers.
    return fromParent.length ? fromParent : container;
}

// The task's current assignees are always offered, so someone who has fallen out of scope can
// still be removed.
export const permittedAssignees = (input) =>
    Array.from(new Set([...scopedAssignees(input), ...(input.task?.AssigneeUserId || [])]));

export const selfAssignable = ({ userId, ...input }) =>
    scopedAssignees({ ...input, companyUsers: [userId] }).filter((x) => x === userId);

// The create row has always offered the parent's own assignees unfiltered; only an unassigned
// parent changes, gaining what a top-level task in the same sprint would offer.
export const subtaskCreateAssignees = ({ parent, project, companyUsers }) => {
    const own = parent?.AssigneeUserId || [];
    return own.length
        ? own
        : scopedAssignees({ task: { isParentTask: true }, sprint: sprintOf(project, parent), project, companyUsers });
};
