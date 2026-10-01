<template>
    <div v-if="goals.length" class="ah-detail__prop-group" data-test="task-goals">
        <span class="ah-label">{{ $t('TaskPanel.counts_toward') }}</span>
        <ul class="tgl">
            <li v-for="item in goals" :key="`${item.goalId}-${item.targetId}`" class="tgl__item">
                <router-link
                    class="tgl__chip"
                    data-test="task-goal"
                    :data-goal="item.goalId"
                    :to="{ name: 'Goal', params: { cid: companyId, goalId: item.goalId } }"
                    :aria-label="$t('TaskPanel.counts_toward_goal', { target: item.targetName, goal: item.goalName, pct: item.progressPct })"
                    :title="$t('TaskPanel.counts_toward_goal', { target: item.targetName, goal: item.goalName, pct: item.progressPct })"
                >
                    <ShellIcon name="target" :size="12" class="tgl__icon" />
                    <span class="tgl__goal">{{ item.goalName }}</span>
                    <span class="tgl__target">{{ item.targetName }}</span>
                    <span class="tgl__pct">{{ item.progressPct }}%</span>
                </router-link>
            </li>
        </ul>
    </div>
</template>

<script setup>
import { computed, inject, ref, unref, watch } from "vue";
import ShellIcon from "@/components/organisms/Shell/ShellIcon.vue";
import { apiRequest } from "@/services";
import { forTaskRequest } from "@/views/Goals/goalRequest";

defineOptions({ name: "TaskGoals" });

const props = defineProps({
    taskId: { type: String, required: true }
});

const injectedCompany = inject("$companyId", "");
const companyId = computed(() => unref(injectedCompany));
const goals = ref([]);
let asked = 0;

/* The server answers for a task this person cannot open as for one that is not there; either way there is nothing to show. */
async function load(taskId) {
    asked += 1;
    const mine = asked;
    goals.value = [];
    if (!taskId) return;
    try {
        const { method, path } = forTaskRequest(taskId);
        const res = await apiRequest(method, path);
        if (mine === asked) goals.value = res?.data?.status && Array.isArray(res.data.data) ? res.data.data : [];
    } catch (error) {
        if (mine === asked) goals.value = [];
    }
}

watch(() => props.taskId, load, { immediate: true });
</script>

<style scoped>
.tgl { list-style: none; margin: 0; padding: 0; display: flex; flex-wrap: wrap; gap: 6px; min-width: 0; }
.tgl__item { min-width: 0; max-width: 100%; }
.tgl__chip {
    display: inline-flex; align-items: center; gap: 6px; max-width: 100%; min-height: var(--hit-min, 24px); padding: 2px 8px;
    border: 1px solid var(--border); border-radius: var(--r-chip); background: var(--surface); color: var(--ink);
    font: 500 var(--fs-sm, 12px)/1.3 var(--font-ui); text-decoration: none;
}
.tgl__chip:hover { background: var(--surface-hover); border-color: var(--brand); }
.tgl__chip:focus-visible { outline: none; box-shadow: var(--focus); }
.tgl__icon { flex: none; color: var(--ink-2); }
.tgl__goal, .tgl__target { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.tgl__target { color: var(--ink-2); font-weight: 400; }
.tgl__pct { flex: none; font: 500 var(--fs-sm, 12px)/1 var(--font-mono); color: var(--ink-2); }
@media (max-width: 767px) {
    .tgl__chip { min-height: 44px; }
}
</style>
