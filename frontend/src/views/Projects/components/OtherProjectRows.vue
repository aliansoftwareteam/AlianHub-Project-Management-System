<template>
    <section v-if="rows.length || truncated" class="opr" :class="`opr--${as}`" data-other-project-rows :aria-label="t('TaskLists.other_projects')">
        <div v-if="heading" class="opr__head">
            <span>{{ t('TaskLists.other_projects') }}</span>
            <span class="opr__count">{{ rows.length }}</span>
        </div>
        <div class="opr__rows" role="list">
            <component :is="part" v-for="row in rows" :key="row._id" :task="row" :project="cardOf(row)" @open="open">
                <template #lists>
                    <TaskHomeMark :task="row" :list="list" :projects="[cardOf(row)]" />
                </template>
            </component>
        </div>
        <p v-if="truncated" class="opr__note">{{ t('TaskLists.other_projects_more') }}</p>
    </section>
</template>

<script setup>
import { computed, inject, ref } from "vue";
import { useI18n } from "vue-i18n";
import EverythingRow from "@/views/Everything/EverythingRow.vue";
import EverythingCard from "@/views/Everything/EverythingCard.vue";
import TaskHomeMark from "@/views/Projects/components/TaskHomeMark.vue";
import { openTask } from "@/components/organisms/TaskDetailOverlay/useTaskOverlay";
import { readOnlyCard } from "@/views/Projects/composables/otherProjectRows";
import "@/views/Projects/ListView/style.css";
import "@/views/Everything/style.css";

defineOptions({ name: "OtherProjectRows" });

const props = defineProps({
    rows: { type: Array, default: () => [] },
    /** Each row's own project card, by project id, as the Everything read sent it. */
    projects: { type: Object, default: () => ({}) },
    /** The list on screen: { sprintId, projectId }. */
    list: { type: Object, default: null },
    as: { type: String, default: "row" },
    heading: { type: Boolean, default: false },
    truncated: { type: Boolean, default: false }
});

const { t } = useI18n();
const companyId = inject("$companyId", ref(""));
const part = computed(() => (props.as === "card" ? EverythingCard : EverythingRow));
const cardOf = (row) => readOnlyCard(props.projects[String(row.ProjectID)]);

function open(task) {
    openTask({ companyId: companyId.value, projectId: task.ProjectID, sprintId: task.sprintId, folderId: task.folderObjId || "", taskId: task._id });
}
</script>

<style>
.opr { min-width: 0; }
.opr--row { margin-top: 12px; border-top: 1px solid var(--hairline); }
.opr__head { display: flex; align-items: center; gap: 8px; padding: 8px 12px; color: var(--ink-2); font: 500 var(--fs-sm, 12px) var(--font-ui); }
.opr__count { font: 500 var(--fs-xs, 11px)/1 var(--font-mono); }
.opr--card .opr__rows { display: flex; flex-direction: column; gap: 8px; }
.opr__note { margin: 0; padding: 6px 12px; color: var(--ink-2); font: 400 var(--fs-xs, 11px) var(--font-ui); }
</style>
