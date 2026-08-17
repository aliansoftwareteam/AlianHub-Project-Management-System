<template>
    <li
        v-if="tabKey === 'time-log' ? (checkApps('TimeTracking') || getAppState('TimeTracking') === 'disabled') : true"
        role="presentation"
        :class="{ active: isActive }"
        class="cursor-pointer"
        @click="!isActive ? $emit('changeTab' ,tabKey) : ''"
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
        <a
            :aria-controls="tabKey"
            role="tab"
        >
            {{ $t(`Header.${tab.name}`) }}
        </a>
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

defineEmits(["changeTab"]);
defineProps({
    isActive: Boolean,
    tab: Object,
    tabKey: String,
    commentCounts: Number
})
</script>
<style scoped src="./style.css">
</style>