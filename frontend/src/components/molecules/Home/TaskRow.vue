<template>
    <div
        class="hc-row"
        :class="{ 'hc-row--dim': dim, 'hc-row--done': done }"
        :draggable="draggable"
        @dragstart="onDragStart"
    >
        <input
            type="checkbox"
            class="ah-check hc-row__check"
            :checked="done"
            :aria-label="task.TaskName"
            @change="$emit('toggle', task)"
        />
        <button type="button" class="hc-row__title" :title="task.TaskName" @click="$emit('open', task)">{{ task.TaskName }}</button>
        <span v-if="showPriority && prio.cls" class="hc-row__prio" :class="prio.cls">{{ $t(prio.label) }}</span>
        <button
            v-if="timer && !done"
            type="button"
            class="hc-row__act"
            :class="{ 'is-on': tracking }"
            :title="$t('Home.start_timer')"
            @click="$emit('timer', task)"
        >
            <ShellIcon :name="tracking ? 'pause' : 'play'" :size="13" />
        </button>
        <span v-if="showProject && projectName" class="hc-row__meta" :title="projectName">{{ projectName }}</span>
        <template v-if="!done">
            <span v-if="task.DueDate" class="hc-row__meta" :class="{ 'hc-row__meta--danger': overdue }">{{ due }}</span>
            <button v-else-if="setDate" type="button" class="hc-row__meta hc-row__meta--brand" @click="$emit('set-date', task)">{{ $t('Home.set_date') }}</button>
        </template>
        <span v-if="draggable" class="hc-row__grip" aria-hidden="true"><ShellIcon name="grip" :size="13" /></span>
    </div>
</template>

<script setup>
import { computed, defineEmits, defineProps } from "vue";
import { useI18n } from "vue-i18n";
import ShellIcon from "@/components/organisms/Shell/ShellIcon.vue";
import { dueBucket, dueLabel, priorityMeta } from "./homeFormat";

defineOptions({ name: "TaskRow" });

const props = defineProps({
    task: { type: Object, required: true },
    projectName: { type: String, default: "" },
    showProject: { type: Boolean, default: true },
    showPriority: { type: Boolean, default: true },
    done: { type: Boolean, default: false },
    dim: { type: Boolean, default: false },
    setDate: { type: Boolean, default: true },
    timer: { type: Boolean, default: true },
    tracking: { type: Boolean, default: false },
    draggable: { type: Boolean, default: true }
});
defineEmits(["toggle", "open", "timer", "set-date"]);

const { t } = useI18n();
const prio = computed(() => priorityMeta(props.task.Task_Priority));
const overdue = computed(() => dueBucket(props.task) === "overdue");
const due = computed(() => (overdue.value ? dueLabel(props.task.DueDate, t) : dueLabel(props.task.DueDate, t)));

function onDragStart(event) {
    event.dataTransfer.setData("application/x-ah-task", props.task._id);
    event.dataTransfer.setData("text/plain", props.task.TaskName);
    event.dataTransfer.effectAllowed = "move";
}
</script>
