<template>
    <teleport to="body">
        <TaskTemplateDialog
            :open="templateDialog.open"
            :mode="templateDialog.mode"
            :task="templateDialog.task"
            :project="project"
            @close="closeTemplateDialog"
        />
    </teleport>
</template>

<script setup>
import { computed } from "vue";
import { useStore } from "vuex";
import TaskTemplateDialog from "./TaskTemplateDialog.vue";
import { closeTemplateDialog, templateDialog } from "./taskTemplates";

defineOptions({ name: "TaskTemplateDialogHost" });

const { getters } = useStore();

const project = computed(() => {
    if (templateDialog.project) return templateDialog.project;
    const id = String(templateDialog.task?.ProjectID || "");
    return (getters["projectData/allProjects"]?.data || []).find((p) => String(p._id) === id) || null;
});
</script>
