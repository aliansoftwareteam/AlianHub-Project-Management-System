import { computed } from "vue";
import { heldTasks, openRuns } from "@/views/Ai/agentFeed";

const RUNNING = "running";

/* Who is on each task right now: the in-product agent running on it, else the connected agent that holds it.
 * Both lists come from reads the server kept to what this person can open, so a row without an entry says
 * nothing either way. Built once for every row, since a list can hold thousands. */
const byTask = computed(() => {
    const work = new Map();
    heldTasks.value.forEach((held) => work.set(String(held.taskId), { name: held.name, since: held.since || null }));
    openRuns.value.filter((run) => run.status === RUNNING && run.taskId)
        .forEach((run) => work.set(String(run.taskId), { name: run.agentName, since: run.startedAt || null }));
    return work;
});

export const agentWorkFor = (taskId) => byTask.value.get(String(taskId)) || null;

export const agentTaskIds = computed(() => [...byTask.value.keys()]);
