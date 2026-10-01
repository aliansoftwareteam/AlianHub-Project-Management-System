<template>
    <div v-if="canTask || canList || canFolder || canDoc" class="nip">
        <button
            type="button"
            class="ah-btn ah-btn--secondary ah-btn--sm"
            :aria-expanded="open"
            :disabled="projectData?.status === 'close'"
            @click.stop="open = !open"
        >+ {{ $t('Projects.new') }}</button>
        <div v-if="open" class="ah-pop nip__pop" role="menu" @click.stop>
            <button v-if="canTask" type="button" class="ah-pop__item" role="menuitem" @click="newTask">
                <ShellIcon name="plus" :size="14" />{{ $t('Projects.new_menu_task') }}
            </button>
            <button v-if="canList" type="button" class="ah-pop__item" role="menuitem" @click="start('sprint')">
                <ShellIcon name="layout" :size="14" />{{ $t('Projects.new_list') }}
            </button>
            <button v-if="canFolder" type="button" class="ah-pop__item" role="menuitem" @click="start('folder')">
                <ShellIcon name="file" :size="14" />{{ $t('Projects.new_folder') }}
            </button>
            <button v-if="canFolder && folderInView" type="button" class="ah-pop__item" role="menuitem" @click="start('subfolder')">
                <ShellIcon name="file" :size="14" />{{ $t('Projects.new_subfolder') }}
            </button>
            <button v-if="canDoc" type="button" class="ah-pop__item" role="menuitem" @click="newDoc">
                <ShellIcon name="docs" :size="14" />{{ $t('Docs.new_doc') }}
            </button>
        </div>

        <teleport to="body">
            <div v-if="mode" class="nip__overlay" @click.self="mode = ''">
                <div class="nip__card" role="dialog" aria-modal="true">
                    <h3 class="ah-h3 nip__title">{{ title }}</h3>
                    <SprintFolderInput
                        :createSprint="mode === 'sprint'"
                        :createFolder="mode !== 'sprint'"
                        :project="projectData"
                        :parentFolderId="mode === 'subfolder' ? folderInView.folderId : ''"
                        :folder="newListFolder"
                        :subItems="subItems"
                        @cancel="mode = ''"
                        @updateData="onCreated"
                    />
                </div>
            </div>
        </teleport>
    </div>
</template>

<script setup>
import { ref, computed, onMounted, onUnmounted, defineExpose, defineProps } from 'vue';
import { useRouter, useRoute } from 'vue-router';
import { useI18n } from 'vue-i18n';
import { useCustomComposable } from '@/composable';
import ShellIcon from '@/components/organisms/Shell/ShellIcon.vue';
import SprintFolderInput from '@/components/atom/SprintFolderInput/SprintFolderInput.vue';
import { openQuickCreate } from '@/components/organisms/QuickCreateTask/quickCreateTask';
import { useNewDoc } from '@/components/molecules/Pages/useNewDoc';
import { treeRoute } from '@/components/molecules/ProjectTree/projectTreeModel';
import { canHoldSubfolders, folderPathLabel, isLiveFolder } from '@/utils/folderTree';

const props = defineProps({
    projectData: { type: Object, required: true }
});

const { t } = useI18n();

const { checkPermission } = useCustomComposable();
const router = useRouter();
const route = useRoute();

const open = ref(false);
const mode = ref('');

const canList = computed(() => checkPermission('project.project_sprint_create', props.projectData?.isGlobalPermission) === true);
const canTask = computed(() => checkPermission('task.task_create', props.projectData?.isGlobalPermission) === true
    && checkPermission('task.task_list', props.projectData?.isGlobalPermission) === true);
const canFolder = computed(() => checkPermission('project.project_folder_create', props.projectData?.isGlobalPermission) === true);
const { canCreateIn, createIn } = useNewDoc();
const canDoc = computed(() => Boolean(props.projectData?._id) && canCreateIn(props.projectData));

/* Folders nest one level, so only a live top-level folder in view takes a subfolder. */
const folderInView = computed(() => {
    const folders = props.projectData?.sprintsfolders || {};
    const folder = folders[route.params?.folderId];
    return canHoldSubfolders(folders, folder) ? folder : null;
});

/* A list goes into the folder or subfolder in view, on its page or on the page of a list in it. */
const listFolderInView = computed(() => {
    const folders = props.projectData?.sprintsfolders || {};
    const folder = folders[route.params?.folderId];
    return isLiveFolder(folders, folder) ? folder : null;
});
const newListFolder = computed(() => (mode.value === 'sprint' && listFolderInView.value
    ? { folderId: listFolderInView.value.folderId, folderName: listFolderInView.value.name }
    : null));

const title = computed(() => {
    if (mode.value === 'sprint') {
        return newListFolder.value
            ? t('Projects.new_list_in', { folder: folderPathLabel(props.projectData.sprintsfolders, listFolderInView.value) })
            : t('Projects.new_list');
    }
    return mode.value === 'subfolder' ? t('Projects.new_subfolder_in', { folder: folderInView.value?.name }) : t('Projects.new_folder');
});

const subItems = computed(() => (newListFolder.value
    ? Object.values(listFolderInView.value.sprintsObj || {})
    : [
        ...Object.values(props.projectData?.sprintsfolders || {}).map((f) => ({ ...f, name: f.name || f.folderName })),
        ...Object.values(props.projectData?.sprintsObj || {})
    ]));

const newTask = () => {
    open.value = false;
    openQuickCreate({ projectId: props.projectData?._id, sprintId: route.params.sprintId });
};

const newDoc = () => {
    open.value = false;
    createIn(props.projectData._id);
};

const start = (kind) => {
    open.value = false;
    mode.value = kind;
};

const onCreated = (doc, kind) => {
    mode.value = '';
    const sprintId = doc?._id || doc?.id;
    if (kind === 'Sprint' && sprintId) {
        router.push(treeRoute('sprint', { cid: route.params.cid, projectId: props.projectData._id, folderId: doc.folderId ? String(doc.folderId) : '', id: sprintId }));
    }
};

defineExpose({ start });

const closeMenu = () => { open.value = false; };
onMounted(() => document.addEventListener('click', closeMenu));
onUnmounted(() => document.removeEventListener('click', closeMenu));
</script>

<style scoped>
.nip { position: relative; }
.nip__pop { position: absolute; top: calc(100% + 6px); right: 0; z-index: 40; min-width: 170px; }
.nip__overlay { position: fixed; inset: 0; background: rgba(0, 0, 0, .35); z-index: 1000; display: flex; align-items: center; justify-content: center; padding: 16px; }
.nip__card { background: var(--surface); color: var(--ink); border-radius: 12px; width: min(420px, 100%); padding: 18px 20px 26px; box-shadow: var(--shadow-pop); font-family: var(--font-ui); }
.nip__title { margin: 0 0 12px; }
</style>
