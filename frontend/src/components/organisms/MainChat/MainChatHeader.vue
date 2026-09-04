<template>
    <header class="mc-head">
        <slot name="lead"></slot>

        <span v-if="isChannel" class="mc-head-hash">#</span>
        <MainChatAvatar v-else :name="title" :src="avatarSrc" :presence="presence" :size="28" />

        <div class="mc-head-id">
            <span class="mc-head-name">{{ title }}</span>
            <span v-if="subtitle" class="mc-head-sub">{{ subtitle }}</span>
        </div>

        <div class="mc-head-actions">
            <button
                type="button"
                class="mc-head-ai"
                :disabled="summarizing"
                :title="$t('Chat.summarize')"
                @click="$emit('summarize')"
            >
                <ShellIcon name="ai" :size="13" />
                <span>{{ summarizing ? $t('Chat.summarizing') : $t('Chat.summarize') }}</span>
            </button>

            <slot name="call-actions"></slot>

            <button
                type="button"
                class="mc-icon-btn"
                :class="{ 'mc-icon-btn--on': activePane === 'search' }"
                :title="$t('MainChat.search')"
                @click="$emit('search')"
            ><MainChatIcon name="search" /></button>

            <button
                type="button"
                class="mc-icon-btn"
                :class="{ 'mc-icon-btn--on': detailsOpen }"
                :title="detailsOpen ? $t('Chat.close_details') : $t('Chat.open_details')"
                @click="$emit('info')"
            ><MainChatIcon name="info" /></button>

            <slot name="actions"></slot>
        </div>
    </header>
</template>

<script setup>
import { defineProps, defineEmits } from 'vue';
import ShellIcon from '@/components/organisms/Shell/ShellIcon.vue';
import MainChatAvatar from './MainChatAvatar.vue';
import MainChatIcon from './MainChatIcon.vue';

defineProps({
    title: { type: String, default: '' },
    subtitle: { type: String, default: '' },
    avatarSrc: { type: String, default: '' },
    presence: { type: Boolean, default: null },
    isChannel: { type: Boolean, default: false },
    activePane: { type: String, default: '' },
    detailsOpen: { type: Boolean, default: false },
    summarizing: { type: Boolean, default: false },
});

defineEmits(['search', 'info', 'summarize']);
</script>
