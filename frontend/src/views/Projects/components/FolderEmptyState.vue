<template>
    <EmptyState
        :title="t('EmptyState.no_lists_in_folder_title', { folder: path })"
        :message="t('EmptyState.no_lists_in_folder_msg')"
        :actionLabel="canCreate ? t('Projects.new_list') : ''"
        @action="emit('create')"
    />
</template>

<script setup>
/**
 * The page of a folder that holds no list.
 *
 * Props
 *   project   Object   the folder's project; handed, because the page that provides `selectedProject` cannot inject it
 *   folders   Object   the project's folders, keyed by id, to name the folder by its path
 *   folder    Object   the folder in view
 *
 * Emits
 *   create   a list is wanted in this folder
 */
import { computed, defineEmits, defineProps } from 'vue';
import { useI18n } from 'vue-i18n';
import { useCustomComposable } from '@/composable';
import EmptyState from '@/components/atom/EmptyState/EmptyState.vue';
import { folderPathLabel } from '@/utils/folderTree';

const props = defineProps({
    project: { type: Object, required: true },
    folders: { type: Object, default: () => ({}) },
    folder: { type: Object, required: true }
});

const emit = defineEmits(['create']);

const { t } = useI18n();
const { checkPermission } = useCustomComposable();

const path = computed(() => folderPathLabel(props.folders, props.folder) || props.folder.name);
const canCreate = computed(() => props.project?.status !== 'close'
    && checkPermission('project.project_sprint_create', props.project?.isGlobalPermission) === true);
</script>
