<template>
    <div class="slp" data-test="slack-post">
        <div class="slp__head">
            <span class="ah-label">{{ $t('Ai.slack_post_title') }}</span>
            <span class="ah-chip ah-chip--warn">{{ $t('Ai.slack_post_outside') }}</span>
        </div>
        <dl class="slp__fields">
            <dt class="ah-small">{{ $t('Ai.slack_post_channel') }}</dt>
            <dd class="ah-mono" data-test="slack-post-channel">#{{ params.channelName }} <span class="slp__id">{{ params.channelId }}</span></dd>
            <dt class="ah-small">{{ $t('Ai.slack_post_text') }}</dt>
            <dd class="slp__text" data-test="slack-post-text">{{ params.text }}</dd>
        </dl>
        <p class="ah-small slp__note">{{ $t('Ai.slack_post_note') }}</p>
        <p v-if="delivery" class="ah-small slp__result" :class="{ 'ah-field__error': !delivery.ok }" data-test="slack-post-result">
            {{ delivery.ok ? $t('Ai.slack_post_sent', { ts: delivery.ts }) : $t('Ai.slack_post_failed', { error: delivery.error }) }}
        </p>
    </div>
</template>

<script setup>
defineOptions({ name: 'SlackPostPreview' });
import { computed } from 'vue';

const props = defineProps({
    change: { type: Object, required: true },
    delivery: { type: Object, default: null },
});

const params = computed(() => props.change.params || {});
</script>

<style scoped>
.slp { margin: 6px 0 10px 22px; padding: 10px 12px; border: 1px solid var(--border); border-radius: 8px; background: var(--surface); }
.slp__head { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; }
.slp__fields { margin: 8px 0 0; display: grid; grid-template-columns: max-content minmax(0, 1fr); gap: 6px 12px; }
.slp__fields dt { color: var(--ink-2); }
.slp__fields dd { margin: 0; color: var(--ink); min-width: 0; overflow-wrap: anywhere; }
.slp__id { color: var(--ink-2); }
.slp__text { white-space: pre-wrap; padding: 8px 10px; border-radius: 6px; background: var(--fill); }
.slp__note, .slp__result { margin: 8px 0 0; }
.slp__note { color: var(--ink-2); }
@media (max-width: 480px) { .slp { margin-left: 0; } .slp__fields { grid-template-columns: minmax(0, 1fr); } }
</style>
