<template>
    <button v-if="count" type="button" class="tum" data-test="unread-mark" :title="label" :aria-label="label" @click.stop="$emit('open')">
        <ShellIcon name="chat" :size="12" />
        <span class="tum__count">{{ count > 99 ? "99+" : count }}</span>
    </button>
</template>

<script setup>
import { computed } from "vue";
import { useStore } from "vuex";
import { useI18n } from "vue-i18n";
import ShellIcon from "@/components/organisms/Shell/ShellIcon.vue";
import { unreadCommentsOf } from "./unreadComments";

defineOptions({ name: "TaskUnreadMark" });

const props = defineProps({
    task: { type: Object, required: true }
});
defineEmits(["open"]);

const { getters } = useStore();
const { t } = useI18n();

const count = computed(() => unreadCommentsOf(getters["users/myCounts"]?.data, props.task));
const label = computed(() => t("List.unread_comments", { count: count.value }));
</script>

<style>
.tum {
    display: inline-flex; align-items: center; gap: 3px; flex: none; height: 18px; box-sizing: border-box;
    padding: 0 6px; border: 0; border-radius: var(--r-sm, 6px); background: var(--brand); color: var(--on-brand, var(--surface));
    font: 600 var(--fs-xs, 11px) var(--font-ui); font-variant-numeric: tabular-nums; vertical-align: middle; cursor: pointer;
}
</style>
