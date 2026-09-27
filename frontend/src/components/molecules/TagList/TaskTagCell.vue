<template>
    <div v-if="visible" class="task-tags">
        <TagChip
            v-for="tag in shown"
            :key="tag.uid"
            :data="tag"
            :isBorder="false"
            :ids="{}"
            :tagsArray="project.tagsArray"
            readonly
        />
        <span v-if="hidden.length" class="tagcount task-tags__more" :title="hiddenNames">
            <span aria-hidden="true">+{{ hidden.length }}</span>
            <span class="ah-sr-only">{{ $t('Tags.more_tags', { count: hidden.length, names: hiddenNames }) }}</span>
        </span>
        <CreateTagPopup
            v-if="mayAdd"
            class="task-tags__add"
            :class="{ 'is-open': pickerOpen }"
            :task="task"
            :project="project"
            @send:dropvisible="(open) => pickerOpen = open"
        />
    </div>
</template>

<script setup>
import { computed, inject, ref } from "vue";
import TagChip from "@/components/atom/TagChip/TagChip.vue";
import CreateTagPopup from "./CreateTagPopup.vue";
import { taskTagChips } from "./helper.js";
import { useCustomComposable } from "@/composable";

defineOptions({ name: "TaskTagCell" });

const props = defineProps({
    task: { type: Object, required: true },
    limit: { type: Number, default: 3 },
    canAdd: { type: Boolean, default: true }
});

const { checkApps, checkPermission } = useCustomComposable();
const projectRef = inject("selectedProject", ref(null));
const showArchived = inject("showArchived", ref(false));
const pickerOpen = ref(false);

const project = computed(() => projectRef.value || {});
const tagAccess = computed(() => checkPermission("task.task_tag", project.value.isGlobalPermission));
const visible = computed(() => Boolean(projectRef.value) && checkApps("tags") && tagAccess.value !== null);
const mayAdd = computed(() => props.canAdd && tagAccess.value === true && !showArchived.value);

const tags = computed(() => taskTagChips(project.value.tagsArray, props.task.tagsArray));
const shown = computed(() => tags.value.slice(0, props.limit));
const hidden = computed(() => tags.value.slice(props.limit));
const hiddenNames = computed(() => hidden.value.map((tag) => tag.tagName).join(", "));
</script>

<style>
.task-tags {
    display: flex;
    align-items: center;
    gap: 4px;
    min-width: 0;
    max-width: 100%;
    overflow: hidden;
}
.task-tags .tagList_inner { flex: 0 1 auto; min-width: 0; }
.task-tags .tagList { min-width: 0; max-width: 100%; }
.task-tags .tagname__contianer { min-width: 0; max-width: 96px; }
.task-tags .remove_hover span.tagname { min-width: 0 !important; }
/* The shared .tagcount grey fails AA contrast with its white text. */
.task-tags .task-tags__more {
    flex: none;
    height: auto;
    min-width: 0;
    margin: 0;
    padding: 2px 5px;
    border: 1px solid var(--hairline);
    border-radius: 3px;
    background: var(--surface-2);
    color: var(--ink-label);
    font: 500 11px/1 var(--font-mono);
}
.task-tags__add { flex: none; }
/* Like the row's other empty-cell triggers, the picker waits for hover or focus, so a
   list of tagged rows is not a column of identical buttons. */
@media (hover: hover) and (min-width: 768px) {
    .task-tags__add { opacity: 0; transition: opacity var(--t-state) var(--ease); }
    [role="row"]:hover .task-tags__add,
    [role="row"]:focus-within .task-tags__add,
    .task-tags__add.is-open { opacity: 1; }
}
</style>
