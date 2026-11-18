<template>
    <section class="ah-card mc-sum" :aria-label="$t('Chat.summary_title')" @keydown.esc.stop="$emit('close')">
        <div class="mc-sum-head">
            <ShellIcon name="ai" :size="14" />
            <b>{{ $t('Chat.summary_title') }}</b>
            <button
                type="button"
                class="mc-icon-btn"
                :title="$t('Chat.close_summary')"
                :aria-label="$t('Chat.close_summary')"
                @click="$emit('close')"
            ><ShellIcon name="x" :size="14" /></button>
        </div>

        <div role="status" aria-live="polite">
            <p v-if="loading" class="ah-small">{{ $t('Chat.summarizing') }}</p>
            <p v-else-if="error" class="ah-field__error">{{ error }}</p>
            <p v-else class="mc-sum-text">{{ summary || $t('Chat.summary_empty') }}</p>
        </div>

        <template v-if="!loading && !error && items.length">
            <span class="ah-label">{{ $t('Chat.action_items') }} · {{ items.length }}</span>
            <div v-for="item in items" :key="item.id" class="mc-sum-item">
                <div>
                    <div>{{ item.title }}</div>
                    <div v-if="item.owner || item.due" class="ah-small">{{ [item.owner, item.due].filter(Boolean).join(' · ') }}</div>
                </div>
                <a v-if="item.taskUrl" class="mc-created" :href="item.taskUrl">{{ $t('Chat.created') }}</a>
                <button v-else type="button" class="ah-btn ah-btn--outline ah-btn--sm" @click="$emit('create-task', item)">{{ $t('Chat.create_task') }}</button>
            </div>
        </template>
    </section>
</template>

<script setup>
import { defineProps, defineEmits } from 'vue';
import ShellIcon from '@/components/organisms/Shell/ShellIcon.vue';

defineProps({
    loading: { type: Boolean, default: false },
    error: { type: String, default: '' },
    summary: { type: String, default: '' },
    items: { type: Array, default: () => [] },
});

defineEmits(['close', 'create-task']);
</script>
