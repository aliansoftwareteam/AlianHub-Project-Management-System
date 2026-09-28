<template>
    <ImportWizard
        :showImportModal="source === 'csv'"
        :projectId="String(projectData?._id || '')"
        :taskStatus="projectData?.taskStatusData || []"
        :users="projectData?.isPrivateSpace ? (projectData?.AssigneeUserId || []) : users"
        :sprint="sprint"
        @toggle-import-modal="(open) => set('csv', open)"
    />
    <ImportJiraModal :modelValue="source === 'jira'" :projectData="projectData" @update:modelValue="(open) => set('jira', open)" />
    <ImportTrelloModal :modelValue="source === 'trello'" :projectData="projectData" @update:modelValue="(open) => set('trello', open)" />
    <ImportAsanaModal :modelValue="source === 'asana'" :projectData="projectData" @update:modelValue="(open) => set('asana', open)" />
    <ImportMondayModal :modelValue="source === 'monday'" :projectData="projectData" @update:modelValue="(open) => set('monday', open)" />
</template>

<script setup>
import { defineEmits, defineProps } from 'vue';
import ImportWizard from '@/plugins/importTasks/components/organisms/ImportWizard/ImportWizard.vue';
import ImportJiraModal from '@/components/molecules/ImportJira/ImportJiraModal.vue';
import ImportTrelloModal from '@/components/molecules/ImportTrello/ImportTrelloModal.vue';
import ImportAsanaModal from '@/components/molecules/ImportAsana/ImportAsanaModal.vue';
import ImportMondayModal from '@/components/molecules/ImportMonday/ImportMondayModal.vue';

const props = defineProps({
    source: { type: String, default: '' },
    projectData: { type: Object, default: () => ({}) },
    users: { type: Array, default: () => [] },
    sprint: { type: Object, default: () => ({}) }
});
const emit = defineEmits(['update:source']);

const set = (key, open) => {
    if (open) emit('update:source', key);
    else if (props.source === key) emit('update:source', '');
};
</script>
