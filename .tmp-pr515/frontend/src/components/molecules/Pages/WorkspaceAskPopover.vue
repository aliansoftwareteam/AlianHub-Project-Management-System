<template>
    <div class="wap">
        <button type="button" class="wap__open kiln-ask" :class="{ 'is-on': open }" @click="open = !open">
            {{ $t('Header.workspace_ask') }}
        </button>
        <div v-if="open" class="wap__panel" @click.stop>
            <div class="wap__kicker">{{ $t('Header.workspace_ask_kicker') }}</div>
            <form class="wap__form" @submit.prevent="ask">
                <input
                    v-model="question"
                    type="text"
                    class="wap__input"
                    :placeholder="$t('Projects.pages_workspace_ask_placeholder')"
                    :disabled="busy"
                />
                <button type="submit" class="wap__go" :disabled="busy">
                    {{ busy ? $t('Projects.pages_composing') : $t('Projects.pages_ask') }}
                </button>
            </form>
            <p v-if="notice" class="wap__notice" :class="{ 'is-answer': Boolean(answer) }">{{ notice }}</p>
        </div>
    </div>
</template>

<script setup>
import { onMounted, onUnmounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { useToast } from 'vue-toast-notification';
import { apiRequest } from '@/services';

const { t } = useI18n();
const $toast = useToast();

const open = ref(false);
const question = ref('');
const busy = ref(false);
const notice = ref('');
const answer = ref('');

function onDocClick(event) {
    if (!open.value) return;
    const root = event.target && event.target.closest && event.target.closest('.wap');
    if (!root) open.value = false;
}

onMounted(() => document.addEventListener('click', onDocClick));
onUnmounted(() => document.removeEventListener('click', onDocClick));

function ask() {
    if (busy.value) return;
    if (!question.value.trim()) {
        answer.value = '';
        notice.value = t('Projects.pages_ask_needed');
        return;
    }
    busy.value = true;
    notice.value = '';
    answer.value = '';
    apiRequest('post', '/api/v2/pages/ask-workspace', { question: question.value })
        .then((response) => {
            if (response.data?.isNotAi || (response.data && response.data.status === false && /not integrated/i.test(response.data.statusText || ''))) {
                notice.value = t('Projects.pages_ai_missing');
                return;
            }
            if (!response.data?.status) {
                $toast.error(response.data?.statusText || t('Toast.something_went_wrong'), { position: 'top-right' });
                return;
            }
            const payload = response.data.data || {};
            answer.value = payload.markdown || payload.previewText || '';
            notice.value = answer.value;
        })
        .catch((error) => {
            console.error('ERROR in workspace ask: ', error);
            $toast.error(t('Toast.something_went_wrong'), { position: 'top-right' });
        })
        .finally(() => {
            busy.value = false;
        });
}
</script>

<style scoped>
.wap {
    position: relative;
}
.wap__open {
    border: 1px solid var(--kiln-line);
    background: transparent;
    color: var(--kiln-ink);
    font-family: var(--kiln-font-body);
    font-size: 11px;
    font-weight: 700;
    letter-spacing: 0.1em;
    text-transform: uppercase;
    height: 32px;
    padding: 0 12px;
    border-radius: 999px;
    cursor: pointer;
}
.wap__open.is-on,
.wap__open:hover {
    border-color: var(--kiln-ember);
    color: var(--kiln-ember-deep);
}
.wap__panel {
    position: absolute;
    right: 0;
    top: calc(100% + 10px);
    width: min(420px, 86vw);
    background: var(--kiln-paper);
    border: 1px solid var(--kiln-line);
    border-top: 3px solid var(--kiln-ember);
    border-radius: var(--kiln-radius-sm);
    box-shadow: var(--kiln-shadow);
    padding: 12px 14px 14px;
    z-index: 40;
}
.wap__kicker {
    font-family: var(--kiln-font-display);
    font-size: 16px;
    font-weight: 650;
    color: var(--kiln-ink);
    margin-bottom: 8px;
}
.wap__form {
    display: flex;
    gap: 8px;
}
.wap__input {
    flex: 1 1 auto;
    min-width: 0;
    height: 38px;
    border: 1px solid var(--kiln-line);
    border-radius: var(--kiln-radius-sm);
    background: var(--kiln-canvas);
    padding: 0 10px;
    font-size: 13px;
    color: var(--kiln-text);
    outline: none;
}
.wap__input:focus {
    border-color: var(--kiln-ember);
}
.wap__go {
    border: 0;
    height: 38px;
    padding: 0 12px;
    border-radius: var(--kiln-radius-sm);
    background: var(--kiln-ember);
    color: #fffaf3;
    font-size: 11px;
    font-weight: 700;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    cursor: pointer;
}
.wap__notice {
    margin: 8px 0 0;
    font-size: 12px;
    color: var(--kiln-muted);
}
.wap__notice.is-answer {
    white-space: pre-wrap;
    color: var(--kiln-ink);
    max-height: 240px;
    overflow: auto;
    line-height: 1.5;
}
</style>
