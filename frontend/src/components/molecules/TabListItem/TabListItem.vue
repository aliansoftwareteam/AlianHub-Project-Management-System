<template>
    <li
        v-if="tabKey === 'time-log' ? (checkApps('TimeTracking') || getAppState('TimeTracking') === 'disabled') : true"
        role="presentation"
        data-tab
        :data-tab-key="tabKey"
        :class="{ active: isActive }"
        class="cursor-pointer"
        @mousedown.stop.prevent="onTabPointer"
        @click.prevent.stop="selectTab"
    >
        <img
            v-if="isActive"
            class="pr-10px"
            :src="tab.activeIcon"
            alt=""
        />
        <img
            v-else
            class="pr-10px"
            :src="tab.inactiveIcon"
            alt=""
        />
        <span
            :aria-controls="tabKey"
            role="tab"
        >
            {{ $t(`Header.${tab.name}`) }}
        </span>
        <span
            v-if="tabKey == 'comment' && commentCounts"
            class="chat-count  position-ab white text-center"
        >
            {{ commentCounts > 99 ? "+99" : commentCounts }}
        </span>
    </li>
</template>
<script setup>
import { defineProps, defineEmits } from 'vue';
import { useCustomComposable } from '@/composable';
import { markTabPointer } from '@/utils/taskPanelGuard';
const { checkApps, getAppState } = useCustomComposable();

const emit = defineEmits(["changeTab"]);
const props = defineProps({
    isActive: Boolean,
    tab: Object,
    tabKey: String,
    commentCounts: Number
})

function emitTaskTab() {
    if (typeof document === 'undefined' || !document.dispatchEvent) return;
    document.dispatchEvent(new CustomEvent('kiln-task-tab', { detail: props.tabKey }));
}

function onTabPointer() {
    emitTaskTab();
    markTabPointer();
    if (!props.isActive) emit('changeTab', props.tabKey);
}

function selectTab() {
    emitTaskTab();
    markTabPointer();
    if (!props.isActive) emit('changeTab', props.tabKey);
}
</script>
<style scoped src="./style.css">
</style>
