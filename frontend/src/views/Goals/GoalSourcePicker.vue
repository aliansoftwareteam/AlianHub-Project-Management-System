<template>
    <fieldset class="gsp" data-test="gsp">
        <legend class="ah-field__label">{{ $t('Goals.sources') }}</legend>
        <GoalSourceChips :sources="linked" :refused="refused" removable @remove="remove" />
        <p v-if="!count" class="gsp__note" data-test="gsp-empty">{{ $t('Goals.sources_none') }}</p>

        <label class="gsp__find">
            <span class="ah-sr-only">{{ $t('Goals.source_search') }}</span>
            <input
                v-model="needle"
                type="search"
                class="ah-input gsp__search"
                :class="{ 'ah-input--error': error }"
                autocomplete="off"
                :placeholder="$t('Goals.source_search')"
                :aria-invalid="error ? 'true' : null"
                :aria-describedby="error ? errorId : null"
                data-test="gsp-search"
                @input="findTasks"
                @keydown.enter.prevent
            />
        </label>

        <div class="gsp__options ah-scroll">
            <p class="gsp__group">{{ $t('Goals.source_lists') }}</p>
            <button v-for="list in listChoices" :key="list.id" type="button" class="gsp__option" data-test="gsp-list" :data-source="list.id" :disabled="full.sprintIds" @click="add(list)">
                <span class="gsp__option-name">{{ list.name }}</span><span class="gsp__option-place">{{ placeOf(list) }}</span>
            </button>
            <p v-if="!listChoices.length" class="gsp__note">{{ $t('Goals.source_no_lists') }}</p>

            <p class="gsp__group">{{ $t('Goals.source_tasks') }}</p>
            <button v-for="task in taskChoices" :key="task.id" type="button" class="gsp__option" data-test="gsp-task" :data-source="task.id" :disabled="full.taskIds" @click="add(task)">
                <span class="gsp__option-name">{{ task.name }}</span><span class="gsp__option-place">{{ task.projectName }}</span>
            </button>
            <p v-if="!taskChoices.length" class="gsp__note" role="status" data-test="gsp-task-note">{{ $t(`Goals.source_tasks_${search}`) }}</p>
        </div>

        <p v-if="full.sprintIds" class="gsp__note" data-test="gsp-full-lists">{{ $t('Goals.sources_lists_full') }}</p>
        <p v-if="full.taskIds" class="gsp__note" data-test="gsp-full-tasks">{{ $t('Goals.sources_tasks_full') }}</p>
        <span v-if="error" :id="errorId" class="ah-field__error" role="alert" data-error-for="sources">{{ error }}</span>
    </fieldset>
</template>

<script setup>
import { computed, onUnmounted, ref } from "vue";
import GoalSourceChips from "./GoalSourceChips.vue";
import { LIMITS, sourceCount, sourcesOf, withoutSources } from "./goalRequest";
import { SEARCH_FROM, useGoalSources } from "./useGoalSources";

defineOptions({ name: "GoalSourcePicker" });

const SEARCH_DELAY_MS = 250;

const props = defineProps({
    modelValue: { type: Object, default: null },
    refused: { type: Object, default: null },
    error: { type: String, default: "" },
    errorId: { type: String, default: "" }
});
const emit = defineEmits(["update:modelValue"]);

const { lists, searchTasks } = useGoalSources();

const needle = ref("");
const found = ref([]);
/* idle: too little typed to search; then searching, done or failed. Each names its own line of help. */
const search = ref("idle");
let timer = null;
let serial = 0;

const linked = computed(() => sourcesOf(props.modelValue));
const count = computed(() => sourceCount(linked.value));
const full = computed(() => ({ sprintIds: linked.value.sprintIds.length >= LIMITS.sprintIds, taskIds: linked.value.taskIds.length >= LIMITS.taskIds }));

const placeOf = (list) => (list.folderName ? `${list.projectName} · ${list.folderName}` : list.projectName);
const listChoices = computed(() => {
    const text = needle.value.trim().toLowerCase();
    return lists.value.filter((list) => list.offered && !linked.value.sprintIds.includes(list.id) && (!text || `${list.name} ${placeOf(list)}`.toLowerCase().includes(text)));
});
const taskChoices = computed(() => found.value.filter((task) => !linked.value.taskIds.includes(task.id)));

function add(source) {
    if (full.value[source.kind] || linked.value[source.kind].includes(source.id)) return;
    emit("update:modelValue", { ...linked.value, [source.kind]: [...linked.value[source.kind], source.id] });
}

const remove = (source) => emit("update:modelValue", withoutSources(linked.value, { [source.kind]: [source.id] }));

function findTasks() {
    clearTimeout(timer);
    serial += 1;
    const asked = serial;
    const query = needle.value.trim();
    if (query.length < SEARCH_FROM) {
        found.value = [];
        search.value = "idle";
        return;
    }
    search.value = "searching";
    timer = setTimeout(async () => {
        try {
            const tasks = await searchTasks(query);
            if (asked === serial) [found.value, search.value] = [tasks, "done"];
        } catch (error) {
            if (asked === serial) [found.value, search.value] = [[], "failed"];
        }
    }, SEARCH_DELAY_MS);
}

onUnmounted(() => clearTimeout(timer));
</script>
