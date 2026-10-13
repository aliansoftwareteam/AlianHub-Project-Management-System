<!--
  The header of the ✦ Summary and ✦ Area columns. The rows read the values the server keeps; this is
  where a person asks a model for the rows that have none, with the number of calls in the label.
-->
<template>
    <span class="aich">
        <span class="aich__label" :title="$t('List.ai_source_hint')">✦ {{ $t(column.labelKey) }}</span>
        <button
            v-if="aiOn && count"
            type="button"
            class="aich__gen"
            data-test="ai-column-generate"
            :disabled="working"
            :title="$t('List.ai_generate_rows_hint')"
            @click.stop="ask"
        >{{ $t('List.ai_generate_rows', { n: count }, count) }}</button>
        <ConfirmModal
            :id="`ai-column-${column.id}`"
            :modelValue="confirming"
            :title="$t('List.ai_generate_rows', { n: count }, count)"
            :acceptButtonText="$t('List.ai_generate')"
            @accept="run"
            @close="confirming = false"
        >
            <template #body>
                <p class="aich__confirm">{{ $t('List.ai_generate_rows_confirm', { n: count }, count) }}</p>
            </template>
        </ConfirmModal>
    </span>
</template>

<script setup>
import { computed, inject, ref, watch } from "vue";
import ConfirmModal from "@/components/atom/Modal/Modal.vue";
import { canUseAi } from "@/composable/aiAvailability";
import { useTaskSummaries } from "./useTaskSummaries.js";
import { useTaskCategories } from "./useTaskCategories.js";

defineOptions({ name: "AiColumnHead" });

const props = defineProps({
    column: { type: Object, required: true },
    tasks: { type: Array, default: () => [] }
});

const MAX_AT_ONCE = 50;
const ASK_FIRST_OVER = 25;

const project = inject("selectedProject", null);
const aiOn = computed(() => canUseAi(project?.value ? { project: project.value } : {}));
const values = props.column.id === "summary" ? useTaskSummaries() : useTaskCategories();

const ids = computed(() => props.tasks.map((task) => String(task._id)).filter(Boolean));
const missing = computed(() => values.missing(ids.value).slice(0, MAX_AT_ONCE));
const count = computed(() => missing.value.length);
const working = ref(false);
const confirming = ref(false);

async function run() {
    confirming.value = false;
    if (working.value || !count.value) return;
    working.value = true;
    try {
        await values.generateShown(missing.value);
    } finally {
        working.value = false;
    }
}

function ask() {
    if (count.value > ASK_FIRST_OVER) confirming.value = true;
    else run();
}

watch(ids, (shown) => shown.forEach((id) => values.ensure(id)), { immediate: true });
</script>

<style scoped>
.aich { display: inline-flex; align-items: center; gap: 8px; min-width: 0; }
.aich__label { color: var(--brand); white-space: nowrap; }
.aich__gen {
    min-width: 0;
    padding: 0;
    border: 0;
    background: none;
    font: var(--text-small);
    color: var(--ink-2);
    text-decoration: underline;
    text-underline-offset: 2px;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    cursor: pointer;
}
.aich__gen:hover { color: var(--brand); }
.aich__gen:focus-visible { outline: none; box-shadow: var(--focus); border-radius: 3px; }
.aich__gen:disabled { opacity: .6; cursor: default; }
.aich__confirm { margin: 0; max-width: 46ch; font: var(--text-body); line-height: 1.5; color: var(--ink); }
</style>
