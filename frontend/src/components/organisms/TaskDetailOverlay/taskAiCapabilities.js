import { reactive } from "vue";
import { apiRequest } from "@/services";
import * as env from "@/config/env";

/* Instance-wide, so one read serves every task panel for the session. */
export const taskAiCapabilities = reactive({ research: false, loaded: false });

let pending = null;

export function loadTaskAiCapabilities() {
    if (taskAiCapabilities.loaded) return Promise.resolve(taskAiCapabilities);
    if (!pending) {
        pending = apiRequest("get", env.AI_TASK_ASSIST)
            .then((response) => {
                taskAiCapabilities.research = response?.data?.status === true && response.data.data?.research === true;
                taskAiCapabilities.loaded = true;
            })
            .catch(() => { taskAiCapabilities.research = false; })
            .finally(() => { pending = null; });
    }
    return pending.then(() => taskAiCapabilities);
}

export function resetTaskAiCapabilities() {
    taskAiCapabilities.research = false;
    taskAiCapabilities.loaded = false;
    pending = null;
}
