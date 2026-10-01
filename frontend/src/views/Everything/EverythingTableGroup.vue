<template>
    <tbody class="evr__tbody">
        <tr v-if="showHead" class="evr__tr-group">
            <th :colspan="columnCount" scope="rowgroup">
                <button type="button" class="evr__group-head" :aria-expanded="open ? 'true' : 'false'" data-test="evr-group-head" @click="open = !open">
                    <ShellIcon :name="open ? 'chevronDown' : 'chevronRight'" :size="13" aria-hidden="true" />
                    <span v-if="color" class="evr__dot" :style="{ background: color }" aria-hidden="true"></span>
                    <span class="evr__group-name">{{ label }}</span>
                    <span class="evr__group-count">{{ group.count }}</span>
                </button>
            </th>
        </tr>
        <template v-if="open">
            <EverythingTableRow
                v-for="row in group.rows"
                :key="row._id"
                :task="row"
                :project="projects[String(row.ProjectID)] || null"
                @open="(task) => $emit('open', task)"
                @status="(task, status) => $emit('status', task, status)"
                @priority="(task, option) => $emit('priority', task, option)"
            />
            <tr class="evr__tr-foot">
                <td :colspan="columnCount">
                    <EverythingGroupFoot :group="group" :more="more" @load="$emit('load', group.id)" />
                    <span ref="sentinel" class="evr__sentinel" aria-hidden="true"></span>
                </td>
            </tr>
        </template>
    </tbody>
</template>

<script setup>
import { ref } from "vue";
import ShellIcon from "@/components/organisms/Shell/ShellIcon.vue";
import EverythingTableRow from "./EverythingTableRow.vue";
import EverythingGroupFoot from "./EverythingGroupFoot.vue";
import { useLoadWhenSeen } from "./useLoadWhenSeen";

defineOptions({ name: "EverythingTableGroup" });

const props = defineProps({
    group: { type: Object, required: true },
    label: { type: String, default: "" },
    color: { type: String, default: "" },
    showHead: { type: Boolean, default: false },
    projects: { type: Object, default: () => ({}) },
    columnCount: { type: Number, required: true }
});
const emit = defineEmits(["load", "open", "status", "priority"]);

const open = ref(true);
const { sentinel, more } = useLoadWhenSeen(() => props.group, (id) => emit("load", id), open);
</script>
