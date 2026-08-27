<template>
    <div class="overflow-auto style-scroll mobile__bg--withPadding mt-10px">
        <div class="w-100 d-flex align-items-center justify-content-between">
            <span :class="{'font-size-16 font-weight-600' : clientWidth <= 767 , 'font-size-14 font-weight-700' : clientWidth > 767 }" class="font-weight-700 font-size-14">{{$t('Projects.blocking_blocked_by')}}</span>
            <span v-if="!isAdding" @click="startAdding" class="linked-tasks__add-link font-size-14 font-weight-500 cursor-pointer pl-20px text-decoration-underline">+ {{$t('Projects.add_link')}}</span>
        </div>

        <div v-if="openBlockers.length > 0" class="linked-tasks__blocked-banner font-size-12 mt-5px">
            <span class="linked-tasks__blocked-icon">&#9888;</span>
            {{ $t('Projects.blocked_warning', { count: openBlockers.length }) }}
            <span class="font-weight-700">{{ openBlockerKeys }}</span>
        </div>

        <div v-if="blockingItems.length || blockedByItems.length || otherItems.length" class="linked-tasks__list">
            <div v-if="blockingItems.length" class="linked-tasks__group">
                <h5 class="linked-tasks__group-title">{{ $t('Projects.relation_blocks') }}</h5>
                <div
                    v-for="item in blockingItems"
                    :key="'linked-'+item.taskId"
                    class="d-flex align-items-center justify-content-between px-1 linked-tasks__row"
                >
                    <div class="d-flex align-items-center linked-tasks__row-main">
                        <template v-if="item.task">
                            <span class="font-size-12 font-weight-600 linked-tasks__key mr-5px">{{ item.task.TaskKey }}</span>
                            <span class="font-size-13 font-weight-400 linked-tasks__name" :class="{'linked-tasks__name--muted': item.task.deletedStatusKey === 1}">
                                {{ item.task.TaskName }}<template v-if="item.task.deletedStatusKey === 1"> ({{$t('Projects.link_task_deleted')}})</template>
                            </span>
                        </template>
                        <span v-else class="font-size-13 font-weight-400 linked-tasks__name--muted">{{$t('Projects.link_task_unavailable')}}</span>
                    </div>
                    <div class="d-flex align-items-center">
                        <span v-if="item.task && item.task.status && item.task.status.text" class="font-size-11 font-weight-500 linked-tasks__status-chip">{{ item.task.status.text }}</span>
                        <span
                            class="font-size-14 cursor-pointer linked-tasks__remove"
                            :class="{'pointer-event-none': isSaving}"
                            :title="$t('Projects.remove_link')"
                            @click="removeRelation(item)"
                        >&#10005;</span>
                    </div>
                </div>
            </div>
            <div v-if="blockedByItems.length" class="linked-tasks__group">
                <h5 class="linked-tasks__group-title">{{ $t('Projects.relation_blocked_by') }}</h5>
                <div
                    v-for="item in blockedByItems"
                    :key="'linked-'+item.taskId"
                    class="d-flex align-items-center justify-content-between px-1 linked-tasks__row"
                >
                    <div class="d-flex align-items-center linked-tasks__row-main">
                        <template v-if="item.task">
                            <span class="font-size-12 font-weight-600 linked-tasks__key mr-5px">{{ item.task.TaskKey }}</span>
                            <span class="font-size-13 font-weight-400 linked-tasks__name" :class="{'linked-tasks__name--muted': item.task.deletedStatusKey === 1}">
                                {{ item.task.TaskName }}<template v-if="item.task.deletedStatusKey === 1"> ({{$t('Projects.link_task_deleted')}})</template>
                            </span>
                        </template>
                        <span v-else class="font-size-13 font-weight-400 linked-tasks__name--muted">{{$t('Projects.link_task_unavailable')}}</span>
                    </div>
                    <div class="d-flex align-items-center">
                        <span v-if="item.task && item.task.status && item.task.status.text" class="font-size-11 font-weight-500 linked-tasks__status-chip">{{ item.task.status.text }}</span>
                        <span
                            class="font-size-14 cursor-pointer linked-tasks__remove"
                            :class="{'pointer-event-none': isSaving}"
                            :title="$t('Projects.remove_link')"
                            @click="removeRelation(item)"
                        >&#10005;</span>
                    </div>
                </div>
            </div>
            <div v-if="otherItems.length" class="linked-tasks__group">
                <h5 class="linked-tasks__group-title">{{ $t('Projects.also_linked') }}</h5>
                <div
                    v-for="item in otherItems"
                    :key="'linked-'+item.taskId"
                    class="d-flex align-items-center justify-content-between px-1 linked-tasks__row"
                >
                    <div class="d-flex align-items-center linked-tasks__row-main">
                        <span class="font-size-11 font-weight-500 linked-tasks__type-label">{{ relationLabel(item.type) }}</span>
                        <template v-if="item.task">
                            <span class="font-size-12 font-weight-600 linked-tasks__key mr-5px">{{ item.task.TaskKey }}</span>
                            <span class="font-size-13 font-weight-400 linked-tasks__name" :class="{'linked-tasks__name--muted': item.task.deletedStatusKey === 1}">
                                {{ item.task.TaskName }}<template v-if="item.task.deletedStatusKey === 1"> ({{$t('Projects.link_task_deleted')}})</template>
                            </span>
                        </template>
                        <span v-else class="font-size-13 font-weight-400 linked-tasks__name--muted">{{$t('Projects.link_task_unavailable')}}</span>
                    </div>
                    <div class="d-flex align-items-center">
                        <span
                            class="font-size-14 cursor-pointer linked-tasks__remove"
                            :class="{'pointer-event-none': isSaving}"
                            :title="$t('Projects.remove_link')"
                            @click="removeRelation(item)"
                        >&#10005;</span>
                    </div>
                </div>
            </div>
        </div>
        <div v-else-if="!isAdding && !isLoading" class="linked-tasks__empty font-size-12 py-10px">
            {{$t('Projects.no_blocking_links')}}
        </div>

        <!-- Add-link row -->
        <div v-if="isAdding" class="linked-tasks__add-row">
            <div class="d-flex align-items-center">
                <select v-model="selectedType" class="linked-tasks__type-select font-size-13">
                    <option v-for="opt in relationTypeOptions" :key="opt.value" :value="opt.value">{{ $t(opt.labelKey) }}</option>
                </select>
                <input
                    v-model="searchQuery"
                    type="text"
                    class="linked-tasks__search-input font-size-13"
                    :placeholder="$t('Projects.search_task_to_link')"
                    @input="onSearchInput"
                />
                <span @click="cancelAdding" class="font-size-13 cursor-pointer gray81 pl-10px">{{$t('Projects.cancel')}}</span>
            </div>
            <div v-if="isSearching" class="gray81 font-size-12 py-5px">{{$t('Projects.searching')}}</div>
            <div v-else-if="searchResults.length > 0" class="linked-tasks__results border-bottom">
                <div
                    v-for="result in searchResults"
                    :key="'link-result-'+result._id"
                    class="d-flex align-items-center px-1 border-bottom cursor-pointer linked-tasks__row linked-tasks__result"
                    :class="{'pointer-event-none opacity-5': isSaving}"
                    @click="addRelation(result)"
                >
                    <span class="font-size-12 font-weight-600 blue mr-5px">{{ result.TaskKey }}</span>
                    <span class="font-size-13 font-weight-400 linked-tasks__name">{{ result.TaskName }}</span>
                </div>
            </div>
            <div v-else-if="searchQuery.trim().length > 0" class="gray81 font-size-12 py-5px">{{$t('Projects.no_task_found')}}</div>
        </div>
    </div>
</template>

<script setup>
// PACKAGES
import { computed, defineProps, inject, onMounted, ref, watch } from "vue";
import { useStore } from "vuex";
import { useToast } from "vue-toast-notification";
import { useI18n } from "vue-i18n";

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

const clientWidth = inject("$clientWidth");
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
const blockingItems = computed(() => linkedItems.value.filter((item) => item.type === 'blocks'));
const blockedByItems = computed(() => linkedItems.value.filter((item) => item.type === 'blocked_by'));
const otherItems = computed(() => linkedItems.value.filter((item) => item.type !== 'blocks' && item.type !== 'blocked_by'));

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

function relationLabel(type) {
    const option = relationTypeOptions.find((opt) => opt.value === type);
    return option ? t(option.labelKey) : type;
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
.linked-tasks__row {
    min-height: 36px;
    padding-top: 4px;
    padding-bottom: 4px;
}
.linked-tasks__row-main {
    min-width: 0;
    flex: 1;
}
.linked-tasks__type-label {
    min-width: 92px;
    text-transform: capitalize;
}
.linked-tasks__name {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}
.linked-tasks__name--muted {
    color: #9a9a9a;
    font-style: italic;
}
.linked-tasks__status-chip {
    background: #f0f0f0;
    border-radius: 10px;
    padding: 2px 8px;
    margin-right: 10px;
    white-space: nowrap;
}
.linked-tasks__remove {
    color: #9a9a9a;
    padding: 0 4px;
}
.linked-tasks__remove:hover {
    color: #e84a4a;
}
.linked-tasks__add-row {
    padding: 8px 0;
}
.linked-tasks__type-select {
    border: 1px solid #e0e0e0;
    border-radius: 4px;
    padding: 5px 6px;
    margin-right: 8px;
    background: #fff;
}
.linked-tasks__search-input {
    border: 1px solid #e0e0e0;
    border-radius: 4px;
    padding: 5px 8px;
    flex: 1;
    min-width: 0;
}
.linked-tasks__results {
    margin-top: 4px;
}
.linked-tasks__result:hover {
    background: #f7f9fc;
}
.linked-tasks__blocked-banner {
    background: #f4ead8;
    border: 1px solid #c45c26;
    border-radius: 6px;
    color: #c45c26;
    padding: 6px 10px;
    margin-bottom: 6px;
}
.linked-tasks__blocked-icon {
    margin-right: 4px;
}
.linked-tasks__add-link { color: #c45c26; }
.linked-tasks__group { margin-top: 8px; }
.linked-tasks__group-title {
    margin: 0 0 4px;
    font-size: 11px;
    letter-spacing: .04em;
    text-transform: uppercase;
    color: #1b2f28;
    font-weight: 700;
}
.linked-tasks__key { color: #1b2f28; }
.linked-tasks__empty { color: #1b2f28; opacity: 0.7; }
.linked-tasks__list {
    background: #f4ead8;
    border: 1px solid #d8cbb3;
    border-radius: 8px;
    padding: 6px 8px;
}
</style>
