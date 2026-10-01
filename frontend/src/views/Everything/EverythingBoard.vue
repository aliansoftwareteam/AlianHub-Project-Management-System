<template>
    <div class="evr__board ah-scroll" role="list" :aria-label="$t('Everything.board_label')">
        <EverythingColumn
            v-for="column in groups"
            :key="column.id"
            :group="column"
            :color="colorOf(column)"
            :projects="projects"
            :dragged="dragged"
            @load="(id) => $emit('load', id)"
            @open="(task) => $emit('open', task)"
            @status="(task, status) => $emit('status', task, status)"
            @priority="(task, option) => $emit('priority', task, option)"
            @drag-start="(task) => dragged = task"
            @drag-end="dragged = null"
            @drop-card="onDrop"
        />
    </div>
</template>

<script setup>
import { ref } from "vue";
import { useI18n } from "vue-i18n";
import { useToast } from "vue-toast-notification";
import EverythingColumn from "./EverythingColumn.vue";
import { dropDecision } from "./everythingRequest";

defineOptions({ name: "EverythingBoard" });

const props = defineProps({
    groups: { type: Array, default: () => [] },
    projects: { type: Object, default: () => ({}) },
    colorOf: { type: Function, default: () => "" }
});
const emit = defineEmits(["load", "open", "status", "priority"]);

const { t } = useI18n();
const $toast = useToast();
const dragged = ref(null);

/* The card never left its column, so a refused drop needs no undoing: it only has to say why. */
function onDrop(column) {
    const task = dragged.value;
    dragged.value = null;
    if (!task) return;
    const project = props.projects[String(task.ProjectID)] || null;
    const decision = dropDecision(task, project, column.key);
    if (decision.allowed) {
        emit("status", task, decision.status);
        return;
    }
    if (decision.reason === "no_status") {
        $toast.error(t("Everything.drop_no_status", { project: project?.ProjectName || "", status: column.key }), { position: "top-right" });
    } else if (decision.reason === "no_permission") {
        $toast.error(t("Everything.drop_no_permission"), { position: "top-right" });
    }
}
</script>
