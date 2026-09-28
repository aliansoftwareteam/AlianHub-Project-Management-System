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
            <div class="pcr__quick">
                <button type="button" class="ah-btn ah-btn--ghost ah-btn--sm pcr__summarise" :disabled="busy" @click="summarise">{{ $t('Projects.pages_ai_summarise_page') }}</button>
                <button v-if="pageId" type="button" class="ah-btn ah-btn--ghost ah-btn--sm pcr__extract" :disabled="busy" @click="extract">{{ $t('Projects.pages_ai_extract_items') }}</button>
            </div>
        </div>
        <AiTaskChecklist
            v-if="extracting"
            kind="page"
            :source-id="pageId"
            :return-focus="() => inputRef"
            @created="$emit('tasks-linked', $event)"
            @undone="$emit('tasks-unlinked', $event)"
            @close="extracting = false"
        />
        <AiResultPreview
            v-else-if="result"
            :text="result.text"
            :busy="busy"
            :title="previewTitle"
            :show-replace="result.kind === 'compose'"
            :show-insert="result.kind !== 'ask'"
            :show-copy="result.kind !== 'compose'"
            :insert-label="result.kind === 'summary' ? $t('Projects.pages_ai_insert_top') : $t('Projects.pages_ai_insert_below')"
            :return-focus="() => inputRef"
            @replace="apply('replace')"
            @insert="apply(result.kind === 'summary' ? 'prepend' : 'append')"
            @retry="compose(result.request, result.kind)"
            @cancel="result = null"
        />
        <div v-else-if="applied" class="pcr__applied" role="status">
            <span>{{ $t(appliedLabel) }}</span>
            <button type="button" class="ah-btn ah-btn--ghost ah-btn--sm pcr__undo" @click="undo">{{ $t('UndoToast.undo') }}</button>
        </div>
        <form class="pcr__form" @submit.prevent="compose()">
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
import { computed, nextTick, onMounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { useToast } from 'vue-toast-notification';
import { apiRequest } from '@/services';
import * as env from '@/config/env';
import ShellIcon from '@/components/organisms/Shell/ShellIcon.vue';
import AiResultPreview from '@/components/molecules/AiPreview/AiResultPreview.vue';
import AiTaskChecklist from '@/components/molecules/AiPreview/AiTaskChecklist.vue';

defineOptions({ name: 'PageComposeRail' });

const { t } = useI18n();
const $toast = useToast();

const props = defineProps({
    pageId: { type: String, default: '' },
    title: { type: String, default: '' },
    currentText: { type: String, default: '' },
});

const emit = defineEmits(['apply', 'undo', 'tasks-linked', 'tasks-unlinked']);

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
const result = ref(null);
const applied = ref('');
const extracting = ref(false);

const APPLIED_LABELS = { replace: 'Projects.pages_ai_replaced', prepend: 'Projects.pages_ai_added_top', append: 'Projects.pages_ai_added' };
const appliedLabel = computed(() => APPLIED_LABELS[applied.value] || APPLIED_LABELS.append);

const previewTitle = computed(() => {
    if (!result.value) return '';
    if (result.value.kind === 'ask') return t('Projects.pages_ai_answer');
    if (result.value.kind === 'summary') return t('Projects.pages_ai_summary');
    return '';
});

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

function kindOf(requestAction) {
    return requestAction === 'ask' ? 'ask' : 'compose';
}

function summarise() {
    compose({ action: 'summarize', title: props.title, instruction: '', currentText: props.currentText, pageId: props.pageId || undefined }, 'summary');
}

function extract() {
    result.value = null;
    applied.value = '';
    extracting.value = true;
}

function compose(previous = null, kind = '') {
    if (busy.value) return;
    extracting.value = false;
    const request = previous || {
        action: action.value,
        title: props.title,
        instruction: instruction.value,
        currentText: props.currentText,
        pageId: props.pageId || undefined,
    };
    if (request.action === 'ask' && !String(request.instruction || '').trim()) {
        notice.value = t('Projects.pages_compose_placeholder');
        return;
    }
    busy.value = true;
    notice.value = '';
    applied.value = '';
    apiRequest('post', `${env.PAGES}/ai`, request).then((response) => {
        if (response.data?.isNotAi || (response.data && response.data.status === false && /not integrated/i.test(response.data.statusText || ''))) {
            notice.value = t('Projects.pages_ai_missing');
            return;
        }
        if (!response.data?.status) {
            $toast.error(response.data?.statusText || t('Toast.something_went_wrong'), { position: 'top-right' });
            return;
        }
        const payload = response.data.data || {};
        result.value = {
            kind: kind || kindOf(request.action),
            request,
            text: payload.markdown || payload.previewText || '',
            blocks: payload.blocks,
        };
    }).catch((error) => {
        console.error('ERROR in page compose: ', error);
        $toast.error(t('Toast.something_went_wrong'), { position: 'top-right' });
    }).finally(() => {
        busy.value = false;
    });
}

function apply(mode) {
    if (!result.value) return;
    emit('apply', { mode, blocks: result.value.blocks });
    result.value = null;
    applied.value = mode;
}

function undo() {
    applied.value = '';
    emit('undo');
    nextTick(() => inputRef.value && inputRef.value.focus());
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
.pcr__quick { display: flex; gap: 4px; flex-wrap: wrap; margin-left: auto; }
.pcr__mark {
    width: 22px; height: 22px; border-radius: 6px;
    background: var(--brand-tint); color: var(--brand);
    display: inline-grid; place-items: center; flex: none;
}
.pcr__form { display: flex; gap: 8px; }
.pcr__input { flex: 1 1 auto; min-width: 0; height: 36px; }
.pcr__applied {
    display: flex;
    align-items: center;
    gap: 8px;
    font: var(--text-small);
    color: var(--ink-2);
}
.pcr__notice {
    margin: 0;
    font: var(--text-small);
    color: var(--ink);
    white-space: pre-wrap;
    max-height: 220px;
    overflow: auto;
}
</style>
