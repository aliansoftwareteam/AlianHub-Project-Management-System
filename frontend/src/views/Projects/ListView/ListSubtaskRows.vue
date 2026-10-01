<template>
    <template v-if="tree.isExpanded(parent._id)">
        <template v-for="sub in tree.childrenOf(parent)" :key="sub._id">
            <ListRow
                :data="sub"
                is-sub
                :depth="depth"
                :parent="parent"
                :selected="tree.isSelected(sub._id)"
                :expanded="tree.isExpanded(sub._id)"
                :progress="tree.progressFor(sub._id)"
                :can-select="tree.canSelect.value"
                @open="tree.open(sub)"
                @select="tree.select"
                @toggle-subtasks="tree.toggle(sub)"
                @add-subtask="tree.startSubtask(sub)"
            />
            <ListSubtaskRows v-if="depth < MAX_DEPTH" :parent="sub" :depth="depth + 1" />
        </template>
    </template>
    <div v-if="tree.subtaskFor.value === String(parent._id)" role="row" class="lv2__aria-row">
        <div role="cell" class="lv2__create lv2__create--sub" :style="{ '--lv2-depth': depth }">
            <CreateTask
                :sprint="{ ...parent.sprintArray, id: parent.sprintId, folderId: parent.folderObjId }"
                :taskId="parent._id"
                :assigneeOptions="tree.createAssignees(parent)"
                :considerWidth="false"
                @cancel="tree.cancelSubtask()"
            />
        </div>
    </div>
</template>

<script setup>
import { inject } from "vue";
import { MAX_DEPTH } from "@taskTreeRules";
import ListRow from "./ListRow.vue";
import CreateTask from "@/components/atom/CreateTask/CreateTask.vue";

defineOptions({ name: "ListSubtaskRows" });

defineProps({
    parent: { type: Object, required: true },
    depth: { type: Number, default: 1 }
});

const tree = inject("listGroupTree");
</script>
