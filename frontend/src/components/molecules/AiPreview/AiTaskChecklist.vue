<template>
    <AiResultPreview
        class="atc"
        :title="$t('NotesToTasks.title')"
        :busy="busy"
        :show-replace="loaded && !done && !error"
        :replace-disabled="!canCreate"
        :replace-label="$t('NotesToTasks.create_n', { n: ticked.length })"
        :return-focus="returnFocus"
        @replace="create"
        @retry="load(true)"
        @cancel="$emit('close')"
    >
        <p v-if="error" class="atc__error" role="alert">{{ error }}</p>

        <div v-else-if="done" class="atc__done" role="status">
            <p class="atc__done-line">
                <span>{{ undone ? $t('NotesToTasks.undone', { n: undone }) : $t('NotesToTasks.created', { n: created.length }) }}</span>
                <button v-if="!undone" type="button" class="ah-btn ah-btn--ghost ah-btn--sm atc__undo" :disabled="busy" @click="undo">{{ $t('UndoToast.undo') }}</button>
            </p>
            <ul v-if="!undone" class="atc__made">
                <li v-for="task in created" :key="task.taskId">
                    <router-link class="atc__made-link" :to="taskRoute(task)">{{ task.title }}</router-link>
                </li>
            </ul>
            <p v-if="failedCount && !undone" class="atc__hint">{{ $t('NotesToTasks.some_failed', { n: failedCount }) }}</p>
        </div>

        <p v-else-if="!loaded" class="atc__hint">{{ $t('NotesToTasks.reading') }}</p>

        <template v-else>
            <label class="atc__field">
                <span class="atc__label">{{ $t('NotesToTasks.project') }}</span>
                <select v-model="projectId" class="ah-input atc__project" :disabled="fixedProject || !projects.length || busy">
                    <option value="">{{ projects.length ? $t('NotesToTasks.pick_project') : $t('NotesToTasks.no_projects') }}</option>
                    <option v-for="project in projects" :key="project.id" :value="project.id">{{ project.name }}</option>
                </select>
            </label>

            <p v-if="!items.length" class="atc__hint">{{ allCreated ? $t('NotesToTasks.all_created') : $t('NotesToTasks.none_found') }}</p>
            <ul v-else class="atc__list">
                <li v-for="item in items" :key="item.key" class="atc__row" :class="{ 'is-off': !item.ticked }">
                    <input
                        v-model="item.ticked"
                        type="checkbox"
                        class="ah-check atc__tick"
                        :aria-label="$t('NotesToTasks.include', { title: item.title })"
                    />
                    <input
                        v-model="item.title"
                        type="text"
                        maxlength="250"
                        class="ah-input atc__title"
                        :aria-label="$t('NotesToTasks.task_title')"
                    />
                    <select v-model="item.ownerId" class="ah-input atc__owner" :aria-label="$t('NotesToTasks.owner')">
                        <option value="">{{ $t('NotesToTasks.no_owner') }}</option>
                        <option v-for="person in owners" :key="person.id" :value="person.id">{{ person.name }}</option>
                    </select>
                    <input v-model="item.due" type="date" class="ah-input atc__due" :aria-label="$t('NotesToTasks.due')" />
                    <span v-if="item.dueText && !item.due" class="atc__said">{{ $t('NotesToTasks.due_said', { text: item.dueText }) }}</span>
                </li>
            </ul>
        </template>
    </AiResultPreview>
</template>

<script setup>
import { computed, inject, onMounted, ref, unref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { apiRequest } from '@/services';
import * as env from '@/config/env';
import AiResultPreview from '@/components/molecules/AiPreview/AiResultPreview.vue';

defineOptions({ name: 'AiTaskChecklist' });

const props = defineProps({
    kind: { type: String, required: true },
    sourceId: { type: String, required: true },
    returnFocus: { type: [Object, Function], default: null },
});

const emit = defineEmits(['created', 'undone', 'close']);

const { t } = useI18n();
const companyId = inject('$companyId', '');

const busy = ref(false);
const loaded = ref(false);
const error = ref('');
const items = ref([]);
const people = ref([]);
const projects = ref([]);
const projectId = ref('');
const fixedProject = ref(false);
const allCreated = ref(false);
const created = ref([]);
const failedCount = ref(0);
const done = ref(false);
const undone = ref(0);

const ticked = computed(() => items.value.filter((item) => item.ticked));
const canCreate = computed(() => Boolean(projectId.value) && ticked.value.length > 0 && ticked.value.every((item) => item.title.trim().length >= 3));
const owners = computed(() => (projectId.value ? people.value.filter((p) => (p.projectIds || []).includes(projectId.value)) : people.value));

watch(projectId, () => {
    const allowed = new Set(owners.value.map((p) => p.id));
    items.value.forEach((item) => { if (item.ownerId && !allowed.has(item.ownerId)) item.ownerId = ''; });
});

const source = () => ({ kind: props.kind, id: props.sourceId });
const failure = (response) => (response && response.data && response.data.statusText) || t('Toast.something_went_wrong');

async function load(refresh = false) {
    if (busy.value) return;
    busy.value = true;
    error.value = '';
    done.value = false;
    undone.value = 0;
    created.value = [];
    try {
        const response = await apiRequest('post', `${env.AI_NOTES_TO_TASKS}/propose`, refresh ? { ...source(), refresh: true } : source());
        if (!response?.data?.status) {
            error.value = failure(response);
            return;
        }
        const data = response.data.data || {};
        people.value = data.people || [];
        projects.value = data.projects || [];
        fixedProject.value = Boolean(data.fixedProject);
        allCreated.value = Boolean(data.allCreated);
        items.value = (data.items || []).map((item) => ({ key: item.key, title: item.title || '', ownerId: item.ownerId || '', due: item.due || '', dueText: item.dueText || '', ticked: true }));
        projectId.value = data.projectId || '';
        loaded.value = true;
    } catch (e) {
        error.value = failure(e?.response);
    } finally {
        busy.value = false;
    }
}

async function create() {
    if (busy.value || !canCreate.value) return;
    busy.value = true;
    try {
        const response = await apiRequest('post', env.AI_NOTES_TO_TASKS, {
            ...source(),
            projectId: projectId.value,
            items: ticked.value.map((item) => ({ key: item.key, title: item.title.trim(), ownerId: item.ownerId, due: item.due })),
        });
        if (!response?.data?.status) {
            error.value = failure(response);
            return;
        }
        created.value = response.data.data?.created || [];
        failedCount.value = (response.data.data?.failed || []).length;
        done.value = true;
        emit('created', created.value);
    } catch (e) {
        error.value = failure(e?.response);
    } finally {
        busy.value = false;
    }
}

async function undo() {
    if (busy.value || !created.value.length) return;
    busy.value = true;
    const taskIds = created.value.map((task) => task.taskId);
    try {
        const response = await apiRequest('post', `${env.AI_NOTES_TO_TASKS}/undo`, { ...source(), taskIds });
        if (!response?.data?.status) {
            error.value = failure(response);
            return;
        }
        const removed = response.data.data?.removed || [];
        undone.value = removed.length || taskIds.length;
        emit('undone', removed);
    } catch (e) {
        error.value = failure(e?.response);
    } finally {
        busy.value = false;
    }
}

const taskRoute = (task) => ({
    name: 'ProjectSprintTask',
    params: { cid: unref(companyId), id: task.projectId, sprintId: task.sprintId, taskId: task.taskId },
    query: { detailTab: 'task-detail-tab' },
});

onMounted(() => load());
</script>

<style scoped>
.atc :deep(.aip__body) { max-height: min(420px, 60vh); }
.atc__field { display: flex; align-items: center; gap: 8px; margin: 0 0 10px; }
.atc__label { font: 500 12.5px/1.3 var(--font-ui); color: var(--ink-2); flex: none; }
.atc__project { max-width: 280px; height: 34px; }
.atc__list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 6px; }
.atc__row {
    display: grid;
    grid-template-columns: auto minmax(0, 1fr) minmax(0, 150px) 140px;
    align-items: center;
    gap: 6px;
    padding: 6px 8px;
    border: 1px solid var(--hairline);
    border-radius: var(--r-input);
    background: var(--surface-2);
}
.atc__row.is-off { opacity: 0.6; }
.atc__row .ah-input { height: 32px; font-size: 13px; padding: 0 8px; }
.atc__said { grid-column: 2 / -1; font: 400 12px/1.3 var(--font-ui); color: var(--ink-2); }
.atc__hint, .atc__error { margin: 0; font: 400 13px/1.5 var(--font-ui); color: var(--ink-2); }
.atc__error { color: var(--danger); }
.atc__done-line { display: flex; align-items: center; gap: 8px; margin: 0; font: 500 13px/1.4 var(--font-ui); color: var(--ink); }
.atc__made { margin: 6px 0 0; padding-left: 18px; display: flex; flex-direction: column; gap: 4px; }
.atc__made-link { color: var(--brand); font: 400 13px/1.4 var(--font-ui); overflow-wrap: anywhere; }
@media (max-width: 560px) {
    .atc__field { flex-direction: column; align-items: stretch; }
    .atc__project { max-width: none; }
    .atc__row { grid-template-columns: auto minmax(0, 1fr) minmax(0, 1fr); }
    .atc__title { grid-column: 2 / -1; }
    .atc__owner { grid-column: 2; }
}
</style>
