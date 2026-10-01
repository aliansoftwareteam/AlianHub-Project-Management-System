/* The selection store holds plain task ids. A subtask is told apart by looking the id up in
 * the loaded tasks: sprint lists, Table rows and search results all nest subtasks under
 * their parent's subtaskArray. An id that is not loaded counts as a task. */
function* loadedTasks(projectData) {
    const data = projectData || {};
    const lists = [];
    for (const bucket of [data.tasks, data.tableTasks]) {
        for (const project of Object.values(bucket || {})) {
            for (const sprint of Object.values(project || {})) {
                if (Array.isArray(sprint?.tasks)) lists.push(sprint.tasks);
            }
        }
    }
    if (Array.isArray(data.searchedTasks)) lists.push(data.searchedTasks);
    for (const list of lists) {
        for (const task of list) {
            yield task;
            if (Array.isArray(task?.subtaskArray)) yield* task.subtaskArray;
        }
    }
}

const isSubtask = (task) => task?.isParentTask === false || Boolean(task?.ParentTaskId);

export function subtaskIdsIn(projectData, ids) {
    const wanted = new Set((ids || []).map(String));
    const found = new Set();
    for (const task of loadedTasks(projectData)) {
        const id = String(task?._id || "");
        if (wanted.has(id) && isSubtask(task)) found.add(id);
    }
    return (ids || []).map(String).filter((id) => found.has(id));
}

/* 'none' | 'tasks' | 'subtasks' | 'mixed' */
export function selectionMix(total, subtasks) {
    if (!total) return "none";
    if (!subtasks) return "tasks";
    return subtasks >= total ? "subtasks" : "mixed";
}
