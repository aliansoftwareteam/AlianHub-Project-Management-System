<template>
    <table class="evr__table">
        <thead>
            <tr>
                <th v-for="column in COLUMNS" :key="column.id" scope="col" :class="`evr__th evr__th--${column.id}`" :aria-sort="ariaSort(column)">
                    <button
                        v-if="column.sort"
                        type="button"
                        class="evr__th-btn"
                        :data-test="`evr-th-${column.id}`"
                        @click="$emit('sort', nextSort(column))"
                    >
                        <span>{{ $t(column.label) }}</span>
                        <ShellIcon v-if="sortBy === column.sort" name="chevronDown" :size="12" class="evr__th-dir" :class="{ 'is-asc': sortDir === 'asc' }" aria-hidden="true" />
                    </button>
                    <button
                        v-else
                        type="button"
                        class="evr__th-btn is-off"
                        aria-disabled="true"
                        :title="$t('Everything.sort_unavailable')"
                        :data-test="`evr-th-${column.id}`"
                    >{{ $t(column.label) }}</button>
                </th>
            </tr>
        </thead>
        <EverythingTableGroup
            v-for="group in groups"
            :key="group.id"
            :group="group"
            :label="labelOf(group)"
            :color="colorOf(group)"
            :showHead="showHeads"
            :projects="projects"
            :columnCount="COLUMNS.length"
            @load="(id) => $emit('load', id)"
            @open="(task) => $emit('open', task)"
            @status="(task, status) => $emit('status', task, status)"
            @priority="(task, option) => $emit('priority', task, option)"
        />
    </table>
</template>

<script setup>
import ShellIcon from "@/components/organisms/Shell/ShellIcon.vue";
import EverythingTableGroup from "./EverythingTableGroup.vue";
import { SORT_DIRECTION } from "./everythingRequest";

defineOptions({ name: "EverythingTable" });

/* Sorting happens on the server, which sorts by two keys; the other headers say so instead of
 * sorting the rows that happen to be loaded. */
const COLUMNS = [
    { id: "name", label: "Everything.col_name" },
    { id: "project", label: "Everything.filter_project" },
    { id: "status", label: "Everything.filter_status" },
    { id: "priority", label: "Everything.filter_priority" },
    { id: "assignee", label: "Everything.filter_assignee" },
    { id: "due", label: "Everything.filter_due", sort: "DueDate" },
    { id: "type", label: "Everything.filter_type" },
    { id: "updated", label: "Everything.col_updated", sort: "updatedAt" }
];

const props = defineProps({
    groups: { type: Array, default: () => [] },
    projects: { type: Object, default: () => ({}) },
    showHeads: { type: Boolean, default: false },
    sortBy: { type: String, default: "updatedAt" },
    sortDir: { type: String, default: "desc" },
    labelOf: { type: Function, default: () => "" },
    colorOf: { type: Function, default: () => "" }
});
defineEmits(["sort", "load", "open", "status", "priority"]);

function ariaSort(column) {
    if (!column.sort || props.sortBy !== column.sort) return null;
    return props.sortDir === "asc" ? "ascending" : "descending";
}

function nextSort(column) {
    if (props.sortBy !== column.sort) return { sortBy: column.sort, sortDir: SORT_DIRECTION[column.sort] };
    return { sortBy: column.sort, sortDir: props.sortDir === "asc" ? "desc" : "asc" };
}
</script>
