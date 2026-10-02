<template>
    <EmptyState
        :title="t('EmptyState.folder_gone_title')"
        :message="t('EmptyState.folder_gone_msg')"
        :actionLabel="t('EmptyState.folder_gone_action', { project: project?.ProjectName || '' })"
        @action="emit('open')"
    />
</template>

<script setup>
/**
 * The page of a folder that was deleted, here or by someone else, while it was open.
 *
 * Props
 *   project   Object   the project the folder was in
 *
 * Emits
 *   open   the project is wanted in its place
 */
import { useI18n } from 'vue-i18n';
import EmptyState from '@/components/atom/EmptyState/EmptyState.vue';

defineProps({ project: { type: Object, required: true } });
const emit = defineEmits(['open']);

const { t } = useI18n();
</script>
