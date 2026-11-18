import { computed } from "vue";
import { heldTasks, openRuns } from "@/views/Ai/agentFeed";

const RUNNING = "running";

/* Who is on each task right now: the in-product agent running on it, else the connected agent that holds it.
 * Both lists come from reads the server kept to what this person can open, so a row without an entry says
 * nothing either way. Built once for every row, since a list can hold thousands. */
const runningOnTasks = computed(() => openRuns.value.filter((run) => run.status === RUNNING && run.taskId));

const byTask = computed(() => {
    const work = new Map();
    heldTasks.value.forEach((held) => work.set(String(held.taskId), { name: held.name, since: held.since || null }));
    runningOnTasks.value.forEach((run) => work.set(String(run.taskId), { name: run.agentName, since: run.startedAt || null }));
    return work;
});

/* The marked tasks of each project, from the same two lists, so a project's count is the number of its tasks that carry the mark. */
const tasksByProject = computed(() => {
    const tasks = new Map();
    [...heldTasks.value, ...runningOnTasks.value].forEach((row) => {
        const projectId = String(row.projectId || "");
        if (!tasks.has(projectId)) tasks.set(projectId, new Set());
        tasks.get(projectId).add(String(row.taskId));
    });
    return tasks;
});

export const agentWorkFor = (taskId) => byTask.value.get(String(taskId)) || null;

export const agentWorkCountIn = (projectId) => (projectId ? (tasksByProject.value.get(String(projectId)) || new Set()).size : 0);

/* The marked tasks of one project with the name each mark shows, in a fixed order, so the same work reads the same twice. */
export const agentWorkIn = (projectId) => [...(tasksByProject.value.get(String(projectId || "")) || [])]
    .sort()
    .map((taskId) => ({ taskId, name: byTask.value.get(taskId)?.name || "" }));

export const agentTaskIds = computed(() => [...byTask.value.keys()]);
