<template>
    <header class="mc-head">
        <!-- Anything that has to sit left of the conversation, e.g. the button that
             brings the list back on a narrow screen. Empty on wide layouts, where the
             list is always visible and there is nothing to go back to. -->
        <slot name="lead"></slot>

        <MainChatConversationIcon
            :title="title"
            :avatar-src="avatarSrc"
            :is-channel="isChannel"
            :icon="icon"
            :presence="presence"
            :size="34"
        />

        <div class="mc-head-id">
            <span class="mc-head-name">{{ title }}</span>
            <span v-if="subtitle" class="mc-head-sub">{{ subtitle }}</span>
        </div>

        <div class="mc-head-actions">
            <!--
              Extension point for the planned Audio / Video call controls: drop the
              buttons into this slot and they land left of the built-in actions,
              without this component needing to know anything about calling.
              e.g. <template #call-actions><button class="mc-icon-btn" …/></template>
            -->
            <slot name="call-actions"></slot>

            <!-- Both open a pane in the right-hand column; the active one stays lit
                 so it is obvious which is showing and that clicking again closes it. -->
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
                :class="{ 'mc-icon-btn--on': activePane === 'pinned' }"
                :title="$t('MainChat.pinned_messages')"
                @click="$emit('pinned')"
            ><MainChatIcon name="pin" /></button>

            <button
                type="button"
                class="mc-icon-btn"
                :class="{ 'mc-icon-btn--on': activePane === 'info' }"
                :title="isChannel ? $t('MainChat.channel_info') : $t('MainChat.user_info')"
                @click="$emit('info')"
            ><MainChatIcon name="info" /></button>

            <slot name="actions"></slot>
        </div>
    </header>
</template>

<script setup>
import { defineProps, defineEmits } from 'vue';
import MainChatConversationIcon from './MainChatConversationIcon.vue';
import MainChatIcon from './MainChatIcon.vue';

defineProps({
    title: { type: String, default: '' },
    subtitle: { type: String, default: '' },
    avatarSrc: { type: String, default: '' },
    presence: { type: Boolean, default: null },
    isChannel: { type: Boolean, default: false },
    // A channel's own icon (image or glyph); empty for direct messages.
    icon: { type: Object, default: () => ({}) },
    // '' | 'info' | 'search' | 'pinned' — which right-hand pane the parent has open.
    activePane: { type: String, default: '' },
});

defineEmits(['search', 'info', 'pinned']);
</script>
