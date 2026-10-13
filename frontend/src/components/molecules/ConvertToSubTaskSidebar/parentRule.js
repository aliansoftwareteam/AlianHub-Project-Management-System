import { computed, ref } from "vue";
import { apiRequest } from "@/services";
import * as env from "@/config/env";
import { deepestParentDepth, subtreeHeight } from "@/views/Projects/composables/taskDepth";

/* A task placed under a parent brings its subtasks along, so how far they reach below it
 * decides how deep that parent may sit. Off (rule null) for a bulk pick, which has no one task. */
export function useParentRule(task, choosing) {
    const height = ref(null);
    const active = computed(() => Boolean(choosing() && task()?._id));
    const pending = computed(() => active.value && height.value === null);
    const rule = computed(() => (active.value && height.value !== null ? { task: task(), height: height.value } : null));
    const blocked = computed(() => Boolean(rule.value) && deepestParentDepth(rule.value.height) < 0);

    function load() {
        if (!active.value) return Promise.resolve();
        const top = task();
        /* Rows from before the chain was stored are not found by it; the child count still says there is a level below. */
        const counted = Number(top.subTasks) > 0 ? 1 : 0;
        return apiRequest("post", `${env.TASK}/find`, {
            findQuery: [
                { $match: { ancestors: String(top._id), deletedStatusKey: { $ne: 1 } } },
                { $project: { ancestors: 1, ParentTaskId: 1 } }
            ]
        }).then((response) => {
            height.value = Math.max(counted, subtreeHeight(top, Array.isArray(response?.data) ? response.data : []));
        }).catch((error) => {
            console.error("ERROR in reading the subtree of the task: ", error);
            height.value = counted;
        });
    }

    return { rule, pending, blocked, load };
}
