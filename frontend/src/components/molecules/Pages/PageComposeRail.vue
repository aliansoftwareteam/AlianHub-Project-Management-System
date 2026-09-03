<template>
    <div class="pcr">
        <div class="pcr__row">
            <span class="pcr__mark"><ShellIcon name="ai" :size="14" /></span>
            <div class="ah-tabs">
                <button
                    v-for="item in actions"
                    :key="item.key"
                    type="button"
                    class="ah-tab"
                    :class="{ 'is-active': action === item.key }"
                    @click="action = item.key"
                >{{ $t(item.label) }}</button>
            </div>
        </div>
        <form class="pcr__form" @submit.prevent="compose">
            <input
                ref="inputRef"
                v-model="instruction"
                type="text"
                class="ah-input pcr__input"
                :placeholder="$t('Projects.pages_compose_placeholder')"
                :disabled="busy"
            />
            <button type="submit" class="ah-btn ah-btn--primary" :disabled="busy">
                {{ busy ? $t('Projects.pages_composing') : $t('Projects.pages_compose') }}
            </button>
        </form>
        <p v-if="notice" class="pcr__notice">{{ notice }}</p>
    </div>
</template>

<script setup>
import { nextTick, onMounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { useToast } from 'vue-toast-notification';
import { apiRequest } from '@/services';
import * as env from '@/config/env';
import ShellIcon from '@/components/organisms/Shell/ShellIcon.vue';

defineOptions({ name: 'PageComposeRail' });

const { t } = useI18n();
const $toast = useToast();

const props = defineProps({
    pageId: { type: String, default: '' },
    title: { type: String, default: '' },
    currentText: { type: String, default: '' },
});

const emit = defineEmits(['apply']);

const actions = [
    { key: 'draft', label: 'Projects.pages_compose_draft' },
    { key: 'expand', label: 'Projects.pages_compose_expand' },
    { key: 'summarize', label: 'Projects.pages_compose_summarize' },
    { key: 'outline', label: 'Projects.pages_compose_outline' },
    { key: 'rewrite', label: 'Projects.pages_compose_rewrite' },
    { key: 'ask', label: 'Projects.pages_compose_ask' },
];

const action = ref('draft');
const instruction = ref('');
const busy = ref(false);
const notice = ref('');
const inputRef = ref(null);

onMounted(() => {
    apiRequest('get', `${env.PAGES}/ai-status`)
        .then((response) => {
            if (!(response.data?.status && response.data.data?.configured)) notice.value = t('Projects.pages_ai_missing');
        })
        .catch(() => { notice.value = t('Projects.pages_ai_missing'); });
});

function focusAsk() {
    action.value = 'ask';
    nextTick(() => inputRef.value && inputRef.value.focus());
}

defineExpose({ focusAsk });

function compose() {
    if (busy.value) return;
    if (action.value === 'ask' && !instruction.value.trim()) {
        notice.value = t('Projects.pages_compose_placeholder');
        return;
    }
    busy.value = true;
    notice.value = '';
    apiRequest('post', `${env.PAGES}/ai`, {
        action: action.value,
        title: props.title,
        instruction: instruction.value,
        currentText: props.currentText,
        pageId: props.pageId || undefined,
    }).then((response) => {
        if (response.data?.isNotAi || (response.data && response.data.status === false && /not integrated/i.test(response.data.statusText || ''))) {
            notice.value = t('Projects.pages_ai_missing');
            return;
        }
        if (!response.data?.status) {
            $toast.error(response.data?.statusText || t('Toast.something_went_wrong'), { position: 'top-right' });
            return;
        }
        const payload = response.data.data || {};
        if (action.value === 'ask') {
            notice.value = payload.previewText || payload.markdown || t('Projects.pages_ai_applied');
            return;
        }
        emit('apply', { mode: action.value === 'expand' ? 'append' : 'replace', blocks: payload.blocks });
        $toast.success(t('Projects.pages_ai_applied'), { position: 'top-right' });
    }).catch((error) => {
        console.error('ERROR in page compose: ', error);
        $toast.error(t('Toast.something_went_wrong'), { position: 'top-right' });
    }).finally(() => {
        busy.value = false;
    });
}
</script>

<style scoped>
.pcr {
    flex: none;
    border-top: 1px solid var(--hairline);
    background: var(--surface-2);
    padding: 10px 20px 12px;
    display: flex;
    flex-direction: column;
    gap: 8px;
}
.pcr__row { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.pcr__mark {
    width: 22px; height: 22px; border-radius: 6px;
    background: var(--brand-tint); color: var(--brand);
    display: inline-grid; place-items: center; flex: none;
}
.pcr__form { display: flex; gap: 8px; }
.pcr__input { flex: 1 1 auto; min-width: 0; height: 36px; }
.pcr__notice {
    margin: 0;
    font: var(--text-small);
    color: var(--ink);
    white-space: pre-wrap;
    max-height: 220px;
    overflow: auto;
}
</style>
