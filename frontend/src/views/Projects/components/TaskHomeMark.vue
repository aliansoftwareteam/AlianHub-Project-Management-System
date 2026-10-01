<template>
    <span v-if="mark" class="ah-home-mark" data-home-mark :title="mark.title" :aria-label="mark.title">
        <ShellIcon name="link" :size="11" /><span class="ah-home-mark__name">{{ mark.name }}</span>
    </span>
</template>

<script setup>
import { computed } from "vue";
import { useStore } from "vuex";
import { useI18n } from "vue-i18n";
import ShellIcon from "@/components/organisms/Shell/ShellIcon.vue";
import { homeMarkText, homeOf } from "@/views/Projects/composables/taskHomeMark";

defineOptions({ name: "TaskHomeMark" });

const props = defineProps({
    task: { type: Object, required: true },
    /** The list on screen: { sprintId, projectId }. */
    list: { type: Object, default: null }
});

const { t } = useI18n();
const store = useStore();

const mark = computed(() => homeMarkText(homeOf(props.task, props.list, store?.getters?.["projectData/onlyActiveProjects"]?.data), t));
</script>

<style>
.ah-home-mark {
    display: inline-flex; align-items: center; gap: 3px; flex: none; min-width: 0; max-width: 140px; height: 18px; box-sizing: border-box;
    padding: 0 5px; border: 1px solid var(--border); border-radius: var(--r-sm, 6px); background: var(--surface);
    color: var(--ink-2); font: 400 var(--fs-xs, 11px) var(--font-ui); vertical-align: middle;
}
.ah-home-mark__name { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
</style>
