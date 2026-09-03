<template>
    <section class="lt">
        <header class="lt__head">
            <span class="lt__title">{{ $t('MembersV2.relations') }}</span>
            <span v-if="linkedItems.length" class="ah-mono lt__count">{{ linkedItems.length }}</span>
            <button v-if="!isAdding" type="button" class="lt__link" @click="startAdding">+ {{ $t('MembersV2.add_link') }}</button>
        </header>

        <div v-if="openBlockers.length" class="lt__blocked">
            <ShellIcon name="alert" :size="14" />
            <span>{{ $t('MembersV2.blocked_warning', { count: openBlockers.length }) }} <strong class="ah-mono">{{ openBlockerKeys }}</strong></span>
        </div>

        <div v-if="linkedItems.length" class="lt__list">
            <div v-for="item in linkedItems" :key="'linked-' + item.taskId" class="lt__row">
                <span class="lt__type" :class="typeClass(item.type)">{{ typeLabel(item.type) }}</span>
                <span class="lt__name">
                    <template v-if="item.task">
                        <span class="ah-mono lt__key">{{ item.task.TaskKey }}</span>
                        <span :class="{ 'lt__name--gone': item.task.deletedStatusKey === 1 }">
                            {{ item.task.TaskName }}<template v-if="item.task.deletedStatusKey === 1"> ({{ $t('Projects.link_task_deleted') }})</template>
                        </span>
                    </template>
                    <span v-else class="lt__name--gone">{{ $t('Projects.link_task_unavailable') }}</span>
                </span>
                <span v-if="item.task && item.task.status && item.task.status.text" class="lt__status">{{ item.task.status.text }}</span>
                <button
                    type="button"
                    class="lt__x"
                    :disabled="isSaving"
                    :title="$t('MembersV2.remove_link')"
                    :aria-label="$t('MembersV2.remove_link')"
                    @click="removeRelation(item)"
                >×</button>
            </div>
        </div>
        <p v-else-if="!isAdding && !isLoading" class="lt__empty">{{ $t('MembersV2.no_relations') }}</p>

        <div v-if="isAdding" class="lt__add">
            <div class="lt__add-row">
                <select v-model="selectedType" class="ah-input lt__add-type">
                    <option v-for="opt in relationTypeOptions" :key="opt.value" :value="opt.value">{{ $t(opt.labelKey) }}</option>
                </select>
                <input
                    v-model="searchQuery"
                    type="text"
                    class="ah-input lt__add-search"
                    :placeholder="$t('MembersV2.search_task_ph')"
                    @input="onSearchInput"
                />
                <button type="button" class="ah-btn ah-btn--ghost ah-btn--sm" @click="cancelAdding">{{ $t('MembersV2.cancel') }}</button>
            </div>
            <p v-if="isSearching" class="lt__empty">{{ $t('MembersV2.searching') }}</p>
            <div v-else-if="searchResults.length" class="lt__results">
                <button
                    v-for="result in searchResults"
                    :key="'link-result-' + result._id"
                    type="button"
                    class="lt__result"
                    :disabled="isSaving"
                    @click="addRelation(result)"
                >
                    <span class="ah-mono lt__key">{{ result.TaskKey }}</span>
                    <span class="lt__name">{{ result.TaskName }}</span>
                </button>
            </div>
            <p v-else-if="searchQuery.trim().length" class="lt__empty">{{ $t('MembersV2.no_task_found') }}</p>
        </div>
    </section>
</template>

<script setup>
// PACKAGES
import { computed, defineProps, inject, onMounted, ref, watch } from "vue";
import { useStore } from "vuex";
import { useToast } from "vue-toast-notification";
import { useI18n } from "vue-i18n";

// COMPONENTS
import ShellIcon from "@/components/organisms/Shell/ShellIcon.vue";

// UTILS
import { apiRequest } from '@/services';
import * as env from '@/config/env';
import { useCustomComposable, useGetterFunctions } from "@/composable";

const { t } = useI18n();
const { debounce } = useCustomComposable();
const { getUser } = useGetterFunctions();
const { getters } = useStore();
const $toast = useToast();

// PROPS
const props = defineProps({
    task: {
        type: Object,
        required: true
    }
});

const userId = inject('$userId');

const linkedItems = ref([]);
const isLoading = ref(false);
const isAdding = ref(false);
const isSearching = ref(false);
const isSaving = ref(false);
const selectedType = ref('blocks');
const searchQuery = ref('');
const searchResults = ref([]);

// Keys match the backend relation types in Modules/Tasks/helpers/taskMongo/relationRules.js
const relationTypeOptions = [
    { value: 'blocks', labelKey: 'Projects.relation_blocks' },
    { value: 'blocked_by', labelKey: 'Projects.relation_blocked_by' },
    { value: 'duplicates', labelKey: 'Projects.relation_duplicates' },
    { value: 'duplicated_by', labelKey: 'Projects.relation_duplicated_by' },
    { value: 'relates_to', labelKey: 'Projects.relation_relates_to' },
];

const TYPE_TONE = {
    blocks: 'lt__type--danger',
    blocked_by: 'lt__type--warn',
    duplicates: 'lt__type--brand',
    duplicated_by: 'lt__type--brand',
    relates_to: '',
};

// Open blockers: `blocked_by` links whose blocking task is still open (not
// closed, not deleted). Mirrors selectOpenBlockers on the backend. The list
// response already carries each linked task's statusType, so no extra call.
const openBlockers = computed(() =>
    linkedItems.value.filter((item) =>
        item.type === 'blocked_by' &&
        item.task &&
        item.task.deletedStatusKey !== 1 &&
        String(item.task.statusType || '') !== 'close'
    )
);
const openBlockerKeys = computed(() =>
    openBlockers.value.map((item) => item.task && item.task.TaskKey).filter(Boolean).join(', ')
);

const companyOwner = computed(() => {
    return getters["settings/companyOwnerDetail"];
});

const taskDetailGetter = computed(() => {
    return getters["projectData/gettaskDetailData"];
});

// Refresh when another client links/unlinks this task — the backend emits the
// updated task doc with `relations` in updatedFields over the socket.
watch(taskDetailGetter, (newVal) => {
    if (newVal?.fullDocument?._id === props.task._id && newVal?.updatedFields && 'relations' in newVal.updatedFields) {
        fetchRelations();
    }
});

watch(() => props.task._id, () => {
    cancelAdding();
    fetchRelations();
});

onMounted(() => {
    fetchRelations();
});

function typeLabel(type) {
    const key = `MembersV2.relation_${type}`;
    const label = t(key);
    return label === key ? String(type).replace(/_/g, ' ').toUpperCase() : label;
}

function typeClass(type) {
    return TYPE_TONE[type] || '';
}

function buildUserData() {
    const user = getUser(userId.value);
    return {
        id: user.id,
        Employee_Name: user.Employee_Name,
        companyOwnerId: companyOwner.value?.userId,
    };
}

function fetchRelations() {
    isLoading.value = true;
    apiRequest('post', '/api/v2/tasks/relations', {
        action: 'list',
        taskId: props.task._id,
    }).then((response) => {
        linkedItems.value = response.data?.status ? (response.data.data || []) : [];
    }).catch((error) => {
        console.error("ERROR in fetch task relations: ", error);
    }).finally(() => {
        isLoading.value = false;
    });
}

function startAdding() {
    isAdding.value = true;
    selectedType.value = 'blocks';
    searchQuery.value = '';
    searchResults.value = [];
}

function cancelAdding() {
    isAdding.value = false;
    searchQuery.value = '';
    searchResults.value = [];
}

const onSearchInput = debounce(() => {
    searchTasks();
}, 300);

function searchTasks() {
    const query = searchQuery.value.trim();
    if (!query.length) {
        searchResults.value = [];
        return;
    }
    isSearching.value = true;
    const escaped = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const findQuery = [
        {
            // ProjectID is stored as an ObjectId; aggregate $match skips mongoose
            // casting, so the backend's `objId` marker must wrap it (see
            // replaceObjectKey in Modules/Auth/helper.js).
            $match: {
                ProjectID: { objId: { $in: [props.task.ProjectID] } },
                deletedStatusKey: { $in: [0, undefined] },
                TaskName: { $regex: escaped, $options: 'i' },
            }
        },
        { $project: { TaskName: 1, TaskKey: 1, status: 1 } },
        { $limit: 10 },
    ];
    apiRequest('post', `${env.TASK}/find`, { findQuery }).then((response) => {
        const alreadyLinked = new Set(linkedItems.value.map((item) => String(item.taskId)));
        searchResults.value = (response.data || []).filter((result) =>
            String(result._id) !== String(props.task._id) && !alreadyLinked.has(String(result._id))
        );
    }).catch((error) => {
        console.error("ERROR in search tasks to link: ", error);
        searchResults.value = [];
    }).finally(() => {
        isSearching.value = false;
    });
}

function addRelation(targetTask) {
    if (isSaving.value) return;
    isSaving.value = true;
    apiRequest('post', '/api/v2/tasks/relations', {
        action: 'add',
        taskId: props.task._id,
        relatedTaskId: targetTask._id,
        type: selectedType.value,
        userData: buildUserData(),
    }).then((response) => {
        if (response.data?.status) {
            $toast.success(response.data.statusText, { position: "top-right" });
            cancelAdding();
            fetchRelations();
        } else {
            $toast.error(response.data?.statusText || t('Toast.something_went_wrong'), { position: "top-right" });
        }
    }).catch((error) => {
        console.error("ERROR in add task relation: ", error);
        $toast.error(t('Toast.something_went_wrong'), { position: "top-right" });
    }).finally(() => {
        isSaving.value = false;
    });
}

function removeRelation(item) {
    if (isSaving.value) return;
    isSaving.value = true;
    apiRequest('post', '/api/v2/tasks/relations', {
        action: 'remove',
        taskId: props.task._id,
        relatedTaskId: item.taskId,
        userData: buildUserData(),
    }).then((response) => {
        if (response.data?.status) {
            $toast.success(response.data.statusText, { position: "top-right" });
            fetchRelations();
        } else {
            $toast.error(response.data?.statusText || t('Toast.something_went_wrong'), { position: "top-right" });
        }
    }).catch((error) => {
        console.error("ERROR in remove task relation: ", error);
        $toast.error(t('Toast.something_went_wrong'), { position: "top-right" });
    }).finally(() => {
        isSaving.value = false;
    });
}
</script>

<style scoped>
.lt {
    display: flex;
    flex-direction: column;
    gap: 9px;
    padding: 12px 14px;
    border: 1px solid var(--hairline);
    border-radius: 11px;
    background: var(--surface-2);
    color: var(--ink);
    font: 400 12.5px/1.4 var(--font-ui);
}
.lt__head { display: flex; align-items: center; gap: 8px; }
.lt__title { font-weight: 600; }
.lt__count { color: var(--ink-3); }
.lt__link {
    margin-left: auto;
    border: 0;
    background: transparent;
    padding: 0;
    color: var(--brand);
    font: 600 11.5px/1 var(--font-ui);
    cursor: pointer;
}
.lt__link:hover { text-decoration: underline; }

.lt__blocked {
    display: flex;
    align-items: flex-start;
    gap: 7px;
    padding: 7px 10px;
    border-radius: 8px;
    background: var(--warn-bg);
    color: var(--warn-ink);
    font-size: 11.5px;
}

.lt__list { display: flex; flex-direction: column; gap: 9px; }
.lt__row { display: flex; align-items: center; gap: 9px; min-width: 0; }
.lt__type {
    width: 74px;
    flex: none;
    text-align: center;
    padding: 2px 6px;
    border-radius: 4px;
    font: 600 9.5px/1.4 var(--font-mono);
    letter-spacing: .04em;
    background: rgba(0, 0, 0, .07);
    color: var(--ink-label);
}
:root[data-theme="dark"] .lt__type { background: rgba(255, 255, 255, .1); }
.lt__type--danger { background: var(--danger-bg); color: var(--danger-ink); }
.lt__type--warn { background: var(--warn-bg); color: var(--warn-ink); }
.lt__type--brand { background: var(--brand-tint); color: var(--brand); }
.lt__name { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.lt__key { color: var(--brand); margin-right: 5px; }
.lt__name--gone { color: var(--ink-2); font-style: italic; }
.lt__status { font-size: 11.5px; color: var(--ink-2); white-space: nowrap; }
.lt__x {
    border: 0;
    background: transparent;
    color: var(--ink-3);
    font-size: 14px;
    line-height: 1;
    padding: 0 2px;
    cursor: pointer;
    transition: color var(--t-state) var(--ease);
}
.lt__x:hover:not(:disabled) { color: var(--danger); }
.lt__x:disabled { cursor: not-allowed; }

.lt__empty { margin: 0; color: var(--ink-2); font-size: 12px; }

.lt__add { display: flex; flex-direction: column; gap: 7px; }
.lt__add-row { display: flex; align-items: center; gap: 8px; }
.lt__add-type { width: auto; min-width: 132px; height: 32px; font-size: 12.5px; }
.lt__add-search { flex: 1; min-width: 0; height: 32px; font-size: 12.5px; }
.lt__results { display: flex; flex-direction: column; border: 1px solid var(--hairline); border-radius: 8px; overflow: hidden; background: var(--surface); }
.lt__result {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 7px 10px;
    border: 0;
    border-bottom: 1px solid var(--hairline);
    background: transparent;
    color: var(--ink);
    font: 400 12.5px/1.4 var(--font-ui);
    text-align: left;
    cursor: pointer;
}
.lt__result:last-child { border-bottom: 0; }
.lt__result:hover:not(:disabled) { background: var(--surface-hover); }
</style>
