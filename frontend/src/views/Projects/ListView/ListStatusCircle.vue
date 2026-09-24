<template>
    <button
        v-if="editable"
        type="button"
        class="lv2__status"
        :class="{ 'is-done': done }"
        :style="{ '--lv2-status': color }"
        :aria-label="t('List.cell_change', { field: t('List.status'), value: name })"
        :title="name"
        aria-haspopup="dialog"
        :aria-expanded="open ? 'true' : 'false'"
        @click.stop="open = true"
    ><span class="lv2__status-dot" aria-hidden="true"></span></button>
    <span
        v-else
        class="lv2__status"
        :class="{ 'is-done': done }"
        :style="{ '--lv2-status': color }"
        role="img"
        :aria-label="t('List.cell_value', { field: t('List.status'), value: name })"
        :title="name"
    ><span class="lv2__status-dot" aria-hidden="true"></span></span>
    <Sidebar
        v-if="editable"
        v-model:visible="open"
        className="task-status-sidebar"
        :title="t('Templates.select_task_status')"
        :enable-search="true"
        :grouped="true"
        :options="options"
        :value="current ? [{ value: current.key }] : []"
        @selected="pick"
        @item-clicked="open = false"
    />
</template>

<script setup>
import { computed, ref } from "vue";
import { useI18n } from "vue-i18n";
import Sidebar from "@/components/molecules/Sidebar/Sidebar.vue";
import { isDoneStatus, statusOptions } from "./listRowEdit";

defineOptions({ name: "ListStatusCircle" });

const props = defineProps({
    task: { type: Object, required: true },
    statuses: { type: Array, default: () => [] },
    editable: { type: Boolean, default: false }
});
const emit = defineEmits(["change"]);

const { t } = useI18n();
const open = ref(false);

const current = computed(() => props.statuses.find((s) => s.key === props.task.statusKey) || null);
const name = computed(() => current.value?.name || props.task.status?.text || "");
const color = computed(() => current.value?.textColor || "var(--ink-2)");
const done = computed(() => (current.value ? isDoneStatus(current.value) : props.task.statusType === "close"));
const options = computed(() => statusOptions(props.statuses, (id) => t(`List.status_group_${id}`)));

function pick(option) {
    const status = props.statuses.find((s) => s.key === option?.value);
    if (!status || status.key === current.value?.key) return;
    emit("change", status);
}
</script>
