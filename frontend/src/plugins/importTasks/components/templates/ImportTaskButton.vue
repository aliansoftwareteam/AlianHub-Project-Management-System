<template>
    <ImportWizard
        :showImportModal="showImportModal"
        :projectId="projectId"
        :taskStatus="taskStatus"
        :users="users"
        :sprint="sprint"
        @toggle-import-modal="(value) => emit('toggle-import-modal', value)"
        @imported="(summary) => emit('imported', summary)"
    />
</template>

<script setup>
import ImportWizard from "../organisms/ImportWizard/ImportWizard.vue";

defineOptions({ name: "ImportTaskButton" });

defineProps({
    users: { type: Array, default: () => [] },
    projectId: { type: String, default: "" },
    taskStatus: { type: Array, default: () => [] },
    sprint: { type: Object, default: () => ({}) },
    showImportModal: { type: Boolean, default: false }
});

const emit = defineEmits(["toggle-import-modal", "imported"]);
</script>
