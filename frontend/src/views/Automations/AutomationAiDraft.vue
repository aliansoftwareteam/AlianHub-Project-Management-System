<template>
    <div v-if="failed" class="au__ai" aria-live="polite">
        <p v-if="blockedKey" class="ah-small au__ai-note" data-test="ai-draft-off">{{ $t(blockedKey) }}</p>
        <template v-else-if="usable">
            <p class="ah-small au__ai-note">{{ $t('Automations.ai_draft_offer') }}</p>
            <button type="button" class="ah-btn ah-btn--secondary ah-btn--sm" data-test="ai-draft" :disabled="drafting" :aria-busy="drafting" @click="draftWithAi">
                <ShellIcon name="ai" :size="14" class="au__ai-mark" />{{ drafting ? $t('Automations.ai_drafting') : $t('Automations.ai_draft_button') }}
            </button>
        </template>
    </div>
    <p v-if="error" class="ah-field__error" role="alert">{{ error }}</p>
    <div v-if="rejected.length" class="au__errors" data-test="ai-rejected">
        <p class="au__ai-rejected-title">{{ $t('Automations.ai_rejected') }}</p>
        <ul>
            <li v-for="(reason, i) in rejected" :key="i">{{ reason }}</li>
        </ul>
    </div>
    <div v-if="drafted" ref="banner" class="au__ai-banner" role="status" tabindex="-1" data-test="ai-draft-banner">
        <strong>{{ $t('Automations.ai_draft_banner') }}</strong>
        <span class="ah-small">{{ $t('Automations.ai_draft_banner_sub') }}</span>
    </div>
    <ul v-if="unmapped.length" class="au__ai-unmapped">
        <li v-for="(part, i) in unmapped" :key="i" data-test="ai-unmapped">
            {{ part.reason ? $t('Automations.ai_unmapped', { text: part.text, reason: part.reason }) : $t('Automations.ai_unmapped_no_reason', { text: part.text }) }}
        </li>
    </ul>
</template>

<script setup>
import { computed, nextTick, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { apiRequest } from '@/services';
import * as env from '@/config/env';
import ShellIcon from '@/components/organisms/Shell/ShellIcon.vue';
import { AI_ACCESS, AI_STATE, aiAccessFor } from '@/composable/aiAvailability';

defineOptions({ name: 'AutomationAiDraft' });

const props = defineProps({
    sentence: { type: String, default: '' },
    failed: { type: Boolean, default: false },
});
const emit = defineEmits(['drafted']);

const { t } = useI18n();
const drafting = ref(false);
const drafted = ref(false);
const banner = ref(null);
const unmapped = ref([]);
const rejected = ref([]);
const error = ref('');
const serverState = ref('');

const BLOCKED_KEYS = {
    [AI_ACCESS.OFF]: 'Automations.ai_draft_off',
    [AI_ACCESS.UNCONFIGURED]: 'Automations.ai_draft_unconfigured',
    [AI_ACCESS.NOT_PERMITTED]: 'Automations.ai_draft_not_permitted',
};

const SERVER_ACCESS = {
    [AI_STATE.OFF_INSTANCE]: AI_ACCESS.OFF,
    [AI_STATE.OFF_WORKSPACE]: AI_ACCESS.OFF,
    [AI_STATE.UNCONFIGURED]: AI_ACCESS.UNCONFIGURED,
};

const access = computed(() => SERVER_ACCESS[serverState.value] || aiAccessFor());
const usable = computed(() => access.value === AI_ACCESS.USABLE);
const blockedKey = computed(() => BLOCKED_KEYS[access.value] || '');

const draftWithAi = async () => {
    if (drafting.value || !usable.value) return;
    drafting.value = true;
    error.value = '';
    unmapped.value = [];
    rejected.value = [];
    try {
        const body = (await apiRequest('post', env.AUTOMATIONS_AI_DRAFT, { sentence: props.sentence }))?.data;
        if (!body?.status) {
            if (SERVER_ACCESS[body?.aiState]) serverState.value = body.aiState;
            else error.value = body?.statusText || t('Automations.ai_draft_failed');
            return;
        }
        const data = body.data || {};
        unmapped.value = data.unmapped || [];
        rejected.value = data.rejected || [];
        if (!data.rule) return;
        drafted.value = true;
        emit('drafted', { rule: data.rule, sentence: data.sentence });
        await nextTick();
        if (banner.value) banner.value.focus();
    } catch (e) {
        const data = e?.response?.data;
        if (SERVER_ACCESS[data?.aiState]) serverState.value = data.aiState;
        else error.value = data?.statusText || t('Automations.ai_draft_failed');
    } finally {
        drafting.value = false;
    }
};
</script>
