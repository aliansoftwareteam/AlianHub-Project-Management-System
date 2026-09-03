<template>
    <div class="ah-card mc-sum" role="dialog">
        <div class="mc-sum-head">
            <span class="ah-avatar ah-avatar--agent ah-avatar--sm">◉</span>
            <b>{{ $t('ChatV2.summary_title') }}</b>
            <span class="ah-chip ah-chip--agent ah-chip--mono">{{ $t('ChatV2.agent') }}</span>
            <button type="button" class="mc-icon-btn" :title="$t('ChatV2.cancel')" @click="$emit('close')"><ShellIcon name="x" :size="14" /></button>
        </div>

        <p v-if="loading" class="ah-small">{{ $t('ChatV2.summarizing') }}</p>
        <p v-else-if="error" class="ah-field__error">{{ error }}</p>

        <template v-else>
            <p class="mc-sum-text">{{ summary || $t('ChatV2.summary_empty') }}</p>

            <template v-if="items.length">
                <span class="ah-label">{{ $t('ChatV2.action_items') }} · {{ items.length }}</span>
                <div v-for="item in items" :key="item.id" class="mc-sum-item">
                    <span class="mc-sum-check"></span>
                    <div>
                        <div>{{ item.title }}</div>
                        <div v-if="item.owner || item.due" class="ah-small">{{ [item.owner, item.due].filter(Boolean).join(' · ') }}</div>
                    </div>
                    <a v-if="item.taskUrl" class="mc-created" :href="item.taskUrl">{{ $t('ChatV2.created') }}</a>
                    <button v-else type="button" class="ah-btn ah-btn--outline ah-btn--sm" @click="$emit('create-task', item)">{{ $t('ChatV2.create_task') }}</button>
                </div>
            </template>
        </template>
    </div>
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
