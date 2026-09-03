<template>
    <div class="tcp">
        <div class="tcp__row">
            <input
                ref="searchInputRef"
                v-model="searchQuery"
                type="text"
                class="ah-input tcp__input"
                :placeholder="$t('Projects.search_task')"
                @input="onSearchInput"
            />
            <button type="button" class="ah-btn ah-btn--ghost ah-btn--sm" @click="$emit('close')">{{ $t('Projects.cancel') }}</button>
        </div>
        <div v-if="isSearching" class="ah-small tcp__note">{{ $t('Projects.searching') }}</div>
        <div v-else-if="searchResults.length > 0" class="tcp__results">
            <button
                v-for="result in searchResults"
                :key="'chip-result-'+result._id"
                type="button"
                class="tcp__result"
                @click="$emit('pick', result)"
            >
                <span class="ah-chip ah-chip--mono">{{ result.TaskKey }}</span>
                <span class="tcp__name">{{ result.TaskName }}</span>
            </button>
        </div>
        <div v-else-if="searchQuery.trim().length > 0" class="ah-small tcp__note">{{ $t('Projects.no_tasks_found') }}</div>
    </div>
</template>

<script setup>
import { nextTick, onMounted, ref } from "vue";
import { apiRequest } from '@/services';
import * as env from '@/config/env';
import { useCustomComposable } from "@/composable";

defineOptions({ name: 'TaskChipPicker' });

const { debounce } = useCustomComposable();

const props = defineProps({
    projectId: { type: String, required: true },
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
            // ProjectID is an ObjectId; aggregate $match skips mongoose casting, so the
            // backend's `objId` marker wraps it (see replaceObjectKey in Modules/Auth/helper.js).
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
.tcp {
    border: 1px solid var(--hairline);
    border-radius: 10px;
    padding: 8px 10px;
    background: var(--surface);
    box-shadow: var(--shadow-card);
    font-family: var(--font-ui);
}
.tcp__row { display: flex; align-items: center; gap: 8px; }
.tcp__input { flex: 1; min-width: 0; height: 32px; }
.tcp__note { padding: 6px 2px 2px; }
.tcp__results { margin-top: 4px; max-height: 220px; overflow-y: auto; display: flex; flex-direction: column; gap: 1px; }
.tcp__result {
    display: flex; align-items: center; gap: 8px;
    min-height: 34px; padding: 4px 8px; border: 0; border-radius: 7px;
    background: transparent; text-align: left; cursor: pointer;
    font: 400 13px var(--font-ui); color: var(--ink);
}
.tcp__result:hover { background: var(--surface-hover); }
.tcp__name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
</style>
