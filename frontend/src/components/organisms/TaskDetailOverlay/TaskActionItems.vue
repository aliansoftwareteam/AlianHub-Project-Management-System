<template>
    <section v-if="items.length" class="ah-actions" :aria-labelledby="headingId" data-test="action-items">
        <h2 :id="headingId" class="ah-actions__title">{{ $t('TaskPanel.action_items', { n: items.length }) }}</h2>
        <ul class="ah-actions__list">
            <li v-for="item in items" :key="item._id" class="ah-actions__item" data-test="action-item">
                <button type="button" class="ah-actions__open" :title="$t('TaskPanel.open_comment')" @click="$emit('open', item)">
                    {{ snippet(item) }}
                </button>
                <CommentAssignment :comment="item" :allowAssign="false" />
            </li>
        </ul>
    </section>
</template>

<script setup>
import { onBeforeUnmount, ref, watch } from "vue";
import { commentPlainText } from "@/utils/commentHtml";
import { loadActionItems, taskVersion } from "@/composable/commentThreads";
import CommentAssignment from "@/components/molecules/CommentThread/CommentAssignment.vue";

defineOptions({ name: "TaskActionItems" });

const props = defineProps({
    task: { type: Object, required: true }
});
defineEmits(["open"]);

const items = ref([]);
const headingId = `action_items_${Math.random().toString(36).slice(2, 8)}`;
let timer = null;

const snippet = (item) => {
    const text = commentPlainText(item.message || item.mediaOriginalName || "").trim();
    return text.length > 140 ? `${text.slice(0, 140)}…` : text;
};

async function load() {
    if (!props.task?._id) return;
    try {
        items.value = await loadActionItems({ projectId: props.task.ProjectID, sprintId: props.task.sprintId, taskId: props.task._id });
    } catch (e) {
        items.value = [];
    }
}

function reloadSoon() {
    clearTimeout(timer);
    timer = setTimeout(load, 300);
}

watch(() => props.task?._id, load, { immediate: true });
watch(() => taskVersion(props.task?._id), reloadSoon);
onBeforeUnmount(() => clearTimeout(timer));

defineExpose({ load });
</script>

<style scoped>
.ah-actions { border: 1px solid var(--warn, var(--hairline)); background: var(--warn-bg); border-radius: 10px; padding: 10px 12px; margin: 8px 0 12px; display: flex; flex-direction: column; gap: 8px; min-width: 0; }
.ah-actions__title { margin: 0; font-size: var(--fs-sm, 12px); font-weight: 700; letter-spacing: .02em; text-transform: uppercase; color: var(--warn-ink); }
.ah-actions__list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 8px; }
.ah-actions__item { display: flex; flex-direction: column; gap: 4px; min-width: 0; }
.ah-actions__open { text-align: left; background: none; border: 0; padding: 0; color: var(--ink); font: inherit; cursor: pointer; overflow-wrap: anywhere; }
.ah-actions__open:hover { text-decoration: underline; }
.ah-actions__open:focus-visible { outline: 2px solid var(--focus, var(--brand)); outline-offset: 2px; border-radius: 4px; }
</style>
