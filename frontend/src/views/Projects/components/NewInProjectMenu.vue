<template>
    <div v-if="canList || canFolder" class="nip">
        <button
            type="button"
            class="ah-btn ah-btn--secondary ah-btn--sm"
            :aria-expanded="open"
            :disabled="projectData?.status === 'close'"
            @click.stop="open = !open"
        >+ {{ $t('Projects.new') }}</button>
        <div v-if="open" class="ah-pop nip__pop" role="menu" @click.stop>
            <button v-if="canList" type="button" class="ah-pop__item" role="menuitem" @click="start('sprint')">
                <ShellIcon name="layout" :size="14" />{{ $t('Projects.new_list') }}
            </button>
            <button v-if="canFolder" type="button" class="ah-pop__item" role="menuitem" @click="start('folder')">
                <ShellIcon name="file" :size="14" />{{ $t('Projects.new_folder') }}
            </button>
        </div>

        <teleport to="body">
            <div v-if="mode" class="nip__overlay" @click.self="mode = ''">
                <div class="nip__card" role="dialog" aria-modal="true">
                    <h3 class="ah-h3 nip__title">{{ $t(mode === 'sprint' ? 'Projects.new_list' : 'Projects.new_folder') }}</h3>
                    <SprintFolderInput
                        :createSprint="mode === 'sprint'"
                        :createFolder="mode === 'folder'"
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
import { ref, computed, onMounted, onUnmounted, defineProps } from 'vue';
import { useRouter, useRoute } from 'vue-router';
import { useCustomComposable } from '@/composable';
import ShellIcon from '@/components/organisms/Shell/ShellIcon.vue';
import SprintFolderInput from '@/components/atom/SprintFolderInput/SprintFolderInput.vue';

const props = defineProps({
    projectData: { type: Object, required: true }
});

const { checkPermission } = useCustomComposable();
const router = useRouter();
const route = useRoute();

const open = ref(false);
const mode = ref('');

const canList = computed(() => checkPermission('project.project_sprint_create', props.projectData?.isGlobalPermission) === true);
const canFolder = computed(() => checkPermission('project.project_folder_create', props.projectData?.isGlobalPermission) === true);

const subItems = computed(() => [
    ...Object.values(props.projectData?.sprintsfolders || {}).map((f) => ({ ...f, name: f.name || f.folderName })),
    ...Object.values(props.projectData?.sprintsObj || {})
]);

const start = (kind) => {
    open.value = false;
    mode.value = kind;
};

const onCreated = (doc, kind) => {
    mode.value = '';
    const sprintId = doc?._id || doc?.id;
    if (kind === 'Sprint' && sprintId) {
        router.push({ name: 'ProjectSprint', params: { cid: route.params.cid, id: props.projectData._id, sprintId } });
    }
};

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
