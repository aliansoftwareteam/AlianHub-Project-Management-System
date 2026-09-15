// Who may be picked as a task's assignee. Shared by the task detail panel, the list row, the
// Kanban card, the dashboard list and the subtask create row, which each carried their own copy.

export const sprintOf = (project, task) => (task?.folderObjId
    ? project?.sprintsfolders?.[task.folderObjId]?.sprintsObj?.[task?.sprintId]
    : project?.sprintsObj?.[task?.sprintId]) || null;

function scopedAssignees({ task, sprint, project, parentAssignees, companyUsers }) {
    if (!sprint) return [];
    const container = sprint.private
        ? (sprint.AssigneeUserId || [])
        : project?.isPrivateSpace ? (project.AssigneeUserId || []) : (companyUsers || []);
    let users = container;
    if (!task?.isParentTask) {
        const fromParent = sprint.private
            ? (parentAssignees || []).filter((x) => sprint.AssigneeUserId?.includes(x))
            : (parentAssignees || []);
        // A subtask is narrowed to its parent's people, but a parent with nobody on it must not
        // leave the subtask with nobody to pick — fall back to what the container offers.
        users = fromParent.length ? fromParent : container;
    }
    return project?.isPrivateSpace ? users.filter((x) => project.AssigneeUserId?.includes(x)) : users;
}

// The task's current assignees are always offered, so someone who has fallen out of scope can
// still be removed.
export const permittedAssignees = (input) =>
    Array.from(new Set([...scopedAssignees(input), ...(input.task?.AssigneeUserId || [])]));

export const selfAssignable = ({ userId, ...input }) =>
    scopedAssignees({ ...input, companyUsers: [userId] }).filter((x) => x === userId);

// The create row offered the parent's assignees whether or not the sprint resolved, and some
// hosts inject no real project; keep that answer there rather than offering nobody.
export const subtaskCreateAssignees = ({ parent, project, companyUsers }) => {
    const scoped = permittedAssignees({
        task: { isParentTask: false },
        sprint: sprintOf(project, parent),
        project,
        parentAssignees: parent?.AssigneeUserId,
        companyUsers
    });
    return scoped.length ? scoped : (parent?.AssigneeUserId || []);
};
