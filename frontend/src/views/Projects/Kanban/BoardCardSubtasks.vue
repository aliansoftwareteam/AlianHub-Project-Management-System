<template>
    <ul v-if="rows.length" class="card-subtasks" :class="{ 'card-subtasks--root': depth === 1 }" @click.stop>
        <li v-for="sub in rows" :key="sub._id" class="card-subtask" :data-depth="depth">
            <div class="card-subtask__row" :style="{ '--card-depth': depth - 1 }">
                <button
                    v-if="canNest && tree.hasChildren(sub)"
                    type="button"
                    class="card-subtask__disclose"
                    :aria-expanded="tree.isExpanded(sub._id)"
                    :aria-label="$t('List.toggle_subtasks')"
                    @click.stop="tree.toggle(sub, column)"
                >{{ tree.isExpanded(sub._id) ? '▾' : '▸' }}</button>
                <span v-else class="card-subtask__disclose card-subtask__disclose--none" aria-hidden="true"></span>
                <span class="card-subtask__dot" :style="{ background: statusColor(sub) }" aria-hidden="true"></span>
                <button type="button" class="card-subtask__name" :title="sub.TaskName" :class="{ 'is-done': isClosedTask(sub) }" @click.stop="open(sub)">{{ sub.TaskName }}</button>
                <span v-if="progressText(sub)" class="card-subtask__count">{{ progressText(sub) }}</span>
                <button
                    v-if="canNest && canAdd"
                    type="button"
                    class="card-subtask__add"
                    :aria-label="$t('Projects.add_subtask_to', { name: sub.TaskName })"
                    :title="$t('Projects.add_subtask_to', { name: sub.TaskName })"
                    @click.stop="tree.startSubtask(sub, column)"
                >+</button>
            </div>
            <BoardCardSubtasks v-if="canNest && tree.isExpanded(sub._id)" :parent="sub" :depth="depth + 1" :column="column" />
            <BoardViewTaskCreate
                v-if="tree.subtaskFor.value === String(sub._id)"
                :sprintData="sub.sprintArray"
                :data="column"
                :taskId="String(sub._id)"
                :assigneeOptionsData="sub.AssigneeUserId"
                :isSubTask="true"
                @toggle="tree.cancelSubtask()"
            />
        </li>
    </ul>
</template>

<script setup>
import { computed, inject, ref } from "vue";
import { MAX_DEPTH } from "@taskTreeRules";
import BoardViewTaskCreate from "@/views/Projects/Kanban/BoardViewTaskCreate.vue";
import { isClosedTask } from "@/views/Projects/ListView/subtaskProgress";

defineOptions({ name: "BoardCardSubtasks" });

const props = defineProps({
    parent: { type: Object, required: true },
    depth: { type: Number, default: 1 },
    column: { type: Object, default: null }
});

const tree = inject("boardSubtaskTree");
const boardMenu = inject("boardTaskMenu", null);
const project = inject("selectedProject", ref({}));
const showArchived = inject("showArchived", ref(false));
const toggleTaskDetail = inject("toggleTaskDetail", null);

const rows = computed(() => tree.childrenOf(props.parent));
const canNest = computed(() => props.depth < MAX_DEPTH);
const canAdd = computed(() => Boolean(boardMenu?.rights.value?.subtask));

const statusColor = (task) => project.value?.taskStatusData?.find((status) => status.key === task.statusKey)?.textColor || "var(--ink-3)";

function progressText(task) {
    const progress = tree.progressFor(task);
    return progress ? `${progress.done}/${progress.total}` : "";
}

function open(task) {
    if (!showArchived.value && toggleTaskDetail) toggleTaskDetail(task);
}
</script>
