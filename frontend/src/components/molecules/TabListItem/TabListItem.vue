<template>
    <li
        v-if="tabKey === 'time-log' ? (checkApps('TimeTracking') || getAppState('TimeTracking') === 'disabled') : true"
        role="presentation"
        :class="{ active: isActive }"
        class="cursor-pointer"
        @mousedown.stop
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
const { checkApps, getAppState } = useCustomComposable();

const emit = defineEmits(["changeTab"]);
const props = defineProps({
    isActive: Boolean,
    tab: Object,
    tabKey: String,
    commentCounts: Number
})

function selectTab() {
    if (!props.isActive) emit('changeTab', props.tabKey);
}
</script>
<style scoped src="./style.css">
</style>
