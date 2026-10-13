<template>
    <span v-if="work" class="tam" role="img" data-test="agent-mark" :title="label" :aria-label="label">
        <span class="ah-dot ah-dot--ok tam__dot"></span>
        <span class="tam__name">{{ work.name }}</span>
        <span v-if="since" class="tam__since">{{ since }}</span>
    </span>
</template>

<script setup>
import { computed } from "vue";
import { useI18n } from "vue-i18n";
import { recentClockText } from "@/utils/clockText";
import { agentWorkFor } from "@/views/Projects/composables/agentWork";

defineOptions({ name: "TaskAgentMark" });

const props = defineProps({
    taskId: { type: String, required: true }
});

const { t } = useI18n();

const work = computed(() => agentWorkFor(props.taskId));

const since = computed(() => recentClockText(work.value?.since));

const label = computed(() => (since.value
    ? t("AgentWork.mark_label", { name: work.value.name, time: since.value })
    : t("AgentWork.mark_label_no_time", { name: work.value.name })));
</script>

<style>
.tam {
    display: inline-flex; align-items: center; gap: 4px; flex: 0 1 auto; min-width: 0; max-width: 220px; height: 18px; box-sizing: border-box;
    padding: 0 6px; border: 1px solid var(--border); border-radius: var(--r-sm, 6px); background: var(--surface);
    color: var(--ink-2); font: 400 var(--fs-xs, 11px) var(--font-ui); vertical-align: middle;
}
.tam__dot { width: 6px; height: 6px; }
.tam__name { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.tam__since { flex: none; font-variant-numeric: tabular-nums; }
@media (max-width: 480px) {
    .tam { max-width: 132px; }
}
</style>
