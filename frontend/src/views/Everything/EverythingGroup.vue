<template>
    <section class="evr__group" :aria-label="label || $t('Everything.tasks_label')">
        <button
            v-if="showHead"
            type="button"
            class="evr__group-head"
            :aria-expanded="open ? 'true' : 'false'"
            data-test="evr-group-head"
            @click="open = !open"
        >
            <ShellIcon :name="open ? 'chevronDown' : 'chevronRight'" :size="13" aria-hidden="true" />
            <span v-if="color" class="evr__dot" :style="{ background: color }" aria-hidden="true"></span>
            <span class="evr__group-name">{{ label }}</span>
            <span class="evr__group-count">{{ group.count }}</span>
        </button>
        <div v-show="open" class="evr__rows" role="list">
            <EverythingRow
                v-for="row in group.rows"
                :key="row._id"
                :task="row"
                :project="projects[String(row.ProjectID)] || null"
                @open="(task) => $emit('open', task)"
                @status="(task, status) => $emit('status', task, status)"
                @priority="(task, option) => $emit('priority', task, option)"
            />
            <EverythingGroupFoot :group="group" :more="more" @load="$emit('load', group.id)" />
            <span ref="sentinel" class="evr__sentinel" aria-hidden="true"></span>
        </div>
    </section>
</template>

<script setup>
import { ref } from "vue";
import ShellIcon from "@/components/organisms/Shell/ShellIcon.vue";
import EverythingRow from "./EverythingRow.vue";
import EverythingGroupFoot from "./EverythingGroupFoot.vue";
import { useLoadWhenSeen } from "./useLoadWhenSeen";

defineOptions({ name: "EverythingGroup" });

const props = defineProps({
    group: { type: Object, required: true },
    label: { type: String, default: "" },
    color: { type: String, default: "" },
    showHead: { type: Boolean, default: true },
    projects: { type: Object, default: () => ({}) }
});
const emit = defineEmits(["load", "open", "status", "priority"]);

const open = ref(true);
const { sentinel, more } = useLoadWhenSeen(() => props.group, (id) => emit("load", id), open);
</script>
