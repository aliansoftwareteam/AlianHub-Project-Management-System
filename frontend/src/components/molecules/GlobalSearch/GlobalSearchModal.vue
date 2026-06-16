<template>
    <div v-if="modelValue" class="gsearch__overlay" @click.self="close">
        <div class="gsearch__card">
            <input
                ref="inputEl"
                v-model="query"
                type="text"
                class="gsearch__input font-size-14"
                :placeholder="$t('Projects.search_everything')"
                @input="onInput"
                @keydown.esc="close"
            />
            <div v-if="isSearching" class="gray81 font-size-12 gsearch__hint">{{ $t('Projects.searching') }}</div>
            <template v-else-if="hasResults">
                <div v-if="results.tasks.length" class="gsearch__group">
                    <div class="gsearch__group-title font-size-11">{{ $t('Projects.tasks') }}</div>
                    <div
                        v-for="task in results.tasks"
                        :key="'gs-task-'+task._id"
                        class="d-flex align-items-center cursor-pointer gsearch__row"
                        @click="openTask(task)"
                    >
                        <span class="font-size-12 font-weight-600 blue mr-5px">{{ task.TaskKey }}</span>
                        <span class="font-size-13 gsearch__name">{{ task.TaskName }}</span>
                        <span v-if="task.status && task.status.text" class="font-size-11 gsearch__chip">{{ task.status.text }}</span>
                    </div>
                </div>
                <div v-if="results.projects.length" class="gsearch__group">
                    <div class="gsearch__group-title font-size-11">{{ $t('Header.Projects') }}</div>
                    <div
                        v-for="project in results.projects"
                        :key="'gs-prj-'+project._id"
                        class="d-flex align-items-center cursor-pointer gsearch__row"
                        @click="openProject(project)"
                    >
                        <span class="font-size-13 gsearch__name">{{ project.ProjectName }}</span>
                    </div>
                </div>
                <div v-if="results.comments.length" class="gsearch__group">
                    <div class="gsearch__group-title font-size-11">{{ $t('Header.Chat') }}</div>
                    <div
                        v-for="comment in results.comments"
                        :key="'gs-cmt-'+comment._id"
                        class="d-flex align-items-center gsearch__row gsearch__row--static"
                    >
                        <span class="font-size-12 gsearch__name">{{ comment.message }}</span>
                    </div>
                </div>
            </template>
            <div v-else-if="searched" class="gray81 font-size-12 gsearch__hint">{{ $t('Projects.no_search_results') }}</div>
        </div>
    </div>
</template>

<script setup>
// PACKAGES
import { computed, defineProps, inject, nextTick, ref, watch } from "vue";
import { useRouter } from "vue-router";

// UTILS
import { apiRequest } from '@/services';
import { useCustomComposable } from "@/composable";

const { debounce } = useCustomComposable();
const router = useRouter();
const companyId = inject('$companyId');

const props = defineProps({
    modelValue: {
        type: Boolean,
        default: false
    }
});

const emit = defineEmits(['update:modelValue']);

const inputEl = ref(null);
const query = ref('');
const isSearching = ref(false);
const searched = ref(false);
const results = ref({ tasks: [], projects: [], comments: [] });

const hasResults = computed(() =>
    results.value.tasks.length || results.value.projects.length || results.value.comments.length
);

watch(() => props.modelValue, (open) => {
    if (open) {
        query.value = '';
        searched.value = false;
        results.value = { tasks: [], projects: [], comments: [] };
        nextTick(() => inputEl.value && inputEl.value.focus());
    }
});

function close() {
    emit('update:modelValue', false);
}

const onInput = debounce(() => {
    const value = query.value.trim();
    if (value.length < 2) {
        results.value = { tasks: [], projects: [], comments: [] };
        searched.value = false;
        return;
    }
    isSearching.value = true;
    apiRequest('post', '/api/v2/search', { query: value })
    .then((response) => {
        if (response.data?.status) {
            results.value = response.data.data;
        }
        searched.value = true;
    })
    .catch((error) => {
        console.error('ERROR in global search: ', error);
    })
    .finally(() => {
        isSearching.value = false;
    });
}, 300);

// Task routes: /:cid/project/:id/fs/:folderId/:sprintId/:taskId (folder) or
// /:cid/project/:id/s/:sprintId/:taskId (plain sprint).
function openTask(task) {
    close();
    const base = `/${companyId.value}/project/${task.ProjectID}`;
    const path = task.folderObjId
        ? `${base}/fs/${task.folderObjId}/${task.sprintId}/${task._id}`
        : `${base}/s/${task.sprintId}/${task._id}`;
    router.push(path).catch((error) => console.error('ERROR opening search task: ', error));
}

// Project routes always include a sprint segment (see router/projects), so the
// API returns each project's first active sprint. Projects without one fall
// back to the sprint-less /p route, keeping the list view as landing tab.
function openProject(project) {
    close();
    const base = `/${companyId.value}/project/${project._id}`;
    let path = `${base}/p?tab=ProjectListView`;
    if (project.sprintId) {
        path = project.folderId
            ? `${base}/fs/${project.folderId}/${project.sprintId}?tab=ProjectListView`
            : `${base}/s/${project.sprintId}?tab=ProjectListView`;
    }
    router.push(path).catch((error) => console.error('ERROR opening search project: ', error));
}
</script>

<style scoped>
.gsearch__overlay {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.35);
    z-index: 1000;
    display: flex;
    align-items: flex-start;
    justify-content: center;
    padding-top: 12vh;
}
.gsearch__card {
    background: #fff;
    border-radius: 10px;
    width: min(640px, 92vw);
    max-height: 64vh;
    overflow-y: auto;
    padding: 14px 16px;
    box-shadow: 0 8px 30px rgba(0, 0, 0, 0.18);
}
.gsearch__input {
    width: 100%;
    border: 1px solid #e0e0e0;
    border-radius: 8px;
    padding: 9px 12px;
    outline: none;
}
.gsearch__input:focus {
    border-color: #7b68ee;
}
.gsearch__hint {
    padding: 18px 4px;
    text-align: center;
}
.gsearch__group {
    margin-top: 12px;
}
.gsearch__group-title {
    color: #9a9a9a;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    margin-bottom: 4px;
}
.gsearch__row {
    padding: 7px 8px;
    border-radius: 6px;
    min-width: 0;
}
.gsearch__row:hover {
    background: #f7f9fc;
}
.gsearch__row--static:hover {
    background: transparent;
}
.gsearch__name {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    flex: 1;
}
.gsearch__chip {
    background: #f0f0f0;
    border-radius: 10px;
    padding: 1px 7px;
    margin-left: 8px;
    white-space: nowrap;
    color: #6a6a6a;
}
</style>
