<template>
    <template v-if="tree.isExpanded(parent._id)">
        <template v-for="sub in tree.childrenOf(parent)" :key="sub._id">
            <TableRow
                :data="sub"
                :depth="depth"
                :parent="parent"
                :selected="tree.isSelected(sub._id)"
                :can-select="tree.canSelect.value"
                :expanded="tree.isExpanded(sub._id)"
                :has-subtasks="tree.hasChildren(sub)"
                :progress="tree.progressFor(sub)"
                @open="tree.open(sub)"
                @select="tree.select"
                @toggle-subtasks="tree.toggle(sub)"
            />
            <TableSubtaskRows v-if="depth < MAX_DEPTH" :parent="sub" :depth="depth + 1" />
        </template>
    </template>
</template>

<script setup>
import { inject } from "vue";
import { MAX_DEPTH } from "@taskTreeRules";
import TableRow from "./TableRow.vue";

defineOptions({ name: "TableSubtaskRows" });

defineProps({
    parent: { type: Object, required: true },
    depth: { type: Number, default: 1 }
});

const tree = inject("tableGroupTree");
</script>
