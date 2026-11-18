<template>
    <div class="ftrf">
        <p v-if="picked" class="ftrf__picked" data-link-picked>{{ picked }}</p>
        <input
            v-model="query"
            class="ftrf__input"
            type="text"
            data-link-search
            :aria-label="$t('Projects.search_task')"
            :placeholder="$t('Projects.search_task')"
            @input="onSearch"
        />
        <p v-if="searching" class="ftrf__note">{{ $t('Projects.searching') }}</p>
        <div v-else-if="results.length" class="ftrf__results">
            <button v-for="result in results" :key="result.id" type="button" class="ftrf__result" data-link-result @click="choose(result)">{{ nameOf(result) }}</button>
        </div>
        <p v-else-if="query.trim()" class="ftrf__note">{{ $t('Projects.no_tasks_found') }}</p>
    </div>
</template>

<script setup>
import { computed, ref, watch } from "vue";
import * as env from "@/config/env";
import { apiRequest } from "@/services";
import { isId } from "@fieldTypes/relationship";
import { taskLink, useTaskSearch } from "./taskSearch";

defineOptions({ name: "RelationshipFilterValue" });

const props = defineProps({
    field: { type: Object, required: true },
    modelValue: { type: Array, default: () => [] }
});
const emit = defineEmits(["update:modelValue"]);

const chosen = computed(() => (isId(props.modelValue[0]) ? props.modelValue[0] : ""));
const picked = ref("");
const { query, results, searching, onSearch, clear } = useTaskSearch({ definition: () => props.field, held: () => [chosen.value] });

const nameOf = (link) => [link.key, link.title].filter(Boolean).join(" ");

function choose(result) {
    picked.value = nameOf(result);
    clear();
    emit("update:modelValue", [result.id]);
}

/* A saved filter keeps the task's id; its name is read through the task read, which answers only a task this person can open. */
watch(chosen, async (id) => {
    if (!id || picked.value) return;
    try {
        const response = await apiRequest("get", `${env.TASK}/${id}`);
        if (response?.data?._id && chosen.value === id) picked.value = nameOf(taskLink(response.data));
    } catch (error) {
        picked.value = "";
    }
}, { immediate: true });
</script>

<style>
.ftrf { display: flex; flex-direction: column; gap: 4px; }
.ftrf__picked { margin: 0; color: var(--ink); font: var(--text-small); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.ftrf__input {
    width: 100%; height: 32px; padding: 0 8px;
    border: 1px solid var(--border); border-radius: 6px;
    background: var(--surface); color: var(--ink);
    font: var(--text-small);
}
.ftrf__input:focus-visible, .ftrf__result:focus-visible { outline: none; box-shadow: var(--focus); }
.ftrf__results {
    display: flex; flex-direction: column;
    max-height: 160px; overflow-y: auto; padding: 4px;
    border: 1px solid var(--border); border-radius: 6px;
    background: var(--surface);
}
.ftrf__result {
    min-height: 28px; padding: 4px;
    border: 0; border-radius: 6px;
    background: none; color: var(--ink); font: var(--text-small); text-align: left; cursor: pointer;
    overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.ftrf__result:hover { background: var(--surface-hover); }
.ftrf__note { margin: 0; padding: 4px; color: var(--ink-2); font: var(--text-small); }
@media (max-width: 767px) {
    .ftrf__input { height: 40px; font-size: 16px; }
    .ftrf__result { min-height: 40px; }
}
</style>
