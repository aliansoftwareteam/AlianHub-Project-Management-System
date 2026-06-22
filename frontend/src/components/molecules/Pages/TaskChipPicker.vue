<template>
    <div class="task-chip-picker">
        <div class="d-flex align-items-center">
            <input
                ref="searchInputRef"
                v-model="searchQuery"
                type="text"
                class="task-chip-picker__input font-size-13"
                :placeholder="$t('Projects.search_task')"
                @input="onSearchInput"
            />
            <span class="font-size-13 cursor-pointer gray81 pl-10px" @click="$emit('close')">{{ $t('Projects.cancel') }}</span>
        </div>
        <div v-if="isSearching" class="gray81 font-size-12 py-5px">{{ $t('Projects.searching') }}</div>
        <div v-else-if="searchResults.length > 0" class="task-chip-picker__results border-bottom">
            <div
                v-for="result in searchResults"
                :key="'chip-result-'+result._id"
                class="d-flex align-items-center px-1 border-bottom cursor-pointer task-chip-picker__result"
                @click="$emit('pick', result)"
            >
                <span class="font-size-12 font-weight-600 blue mr-5px">{{ result.TaskKey }}</span>
                <span class="font-size-13 font-weight-400 task-chip-picker__name">{{ result.TaskName }}</span>
            </div>
        </div>
        <div v-else-if="searchQuery.trim().length > 0" class="gray81 font-size-12 py-5px">{{ $t('Projects.no_tasks_found') }}</div>
    </div>
</template>

<script setup>
// PACKAGES
import { defineProps, defineEmits, nextTick, onMounted, ref } from "vue";

// UTILS
import { apiRequest } from '@/services';
import * as env from '@/config/env';
import { useCustomComposable } from "@/composable";

const { debounce } = useCustomComposable();

// PROPS
const props = defineProps({
    projectId: {
        type: String,
        required: true
    }
});

defineEmits(['pick', 'close']);

const searchInputRef = ref(null);
const searchQuery = ref('');
const searchResults = ref([]);
const isSearching = ref(false);

onMounted(() => {
    nextTick(() => searchInputRef.value?.focus());
});

const onSearchInput = debounce(() => {
    searchTasks();
}, 300);

// Reuse the same task-find pattern as LinkedTasks.vue: aggregate $match scoped
// to the current project, matching TaskName OR TaskKey, returning only the
// fields the chip token needs.
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
                ProjectID: { objId: { $in: [props.projectId] } },
                deletedStatusKey: { $in: [0, undefined] },
                $or: [
                    { TaskName: { $regex: escaped, $options: 'i' } },
                    { TaskKey: { $regex: escaped, $options: 'i' } },
                ],
            }
        },
        { $project: { TaskName: 1, TaskKey: 1 } },
        { $limit: 10 },
    ];
    apiRequest('post', `${env.TASK}/find`, { findQuery }).then((response) => {
        searchResults.value = response.data || [];
    }).catch((error) => {
        console.error("ERROR in search tasks for chip: ", error);
        searchResults.value = [];
    }).finally(() => {
        isSearching.value = false;
    });
}
</script>

<style scoped>
.task-chip-picker {
    border: 1px solid #e0e0e0;
    border-radius: 6px;
    padding: 8px 10px;
    margin-bottom: 10px;
    background: #fff;
}
.task-chip-picker__input {
    border: 1px solid #e0e0e0;
    border-radius: 4px;
    padding: 5px 8px;
    flex: 1;
    min-width: 0;
}
.task-chip-picker__results {
    margin-top: 4px;
    max-height: 220px;
    overflow-y: auto;
}
.task-chip-picker__result {
    min-height: 34px;
    padding-top: 4px;
    padding-bottom: 4px;
}
.task-chip-picker__result:hover {
    background: #f7f9fc;
}
.task-chip-picker__name {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}
</style>
