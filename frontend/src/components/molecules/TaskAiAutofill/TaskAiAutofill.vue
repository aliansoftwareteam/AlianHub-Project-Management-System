<template>
    <div v-if="canShow" class="taf">
        <button
            type="button"
            class="taf__go"
            :disabled="busy"
            @click="preview"
        >{{ busy && !suggestions.length ? $t('CustomField.autofill_working') : $t('CustomField.autofill') }}</button>
        <p v-if="notice && !suggestions.length" class="taf__notice">{{ notice }}</p>
        <div v-if="suggestions.length" class="taf__preview">
            <h5 class="taf__heading">{{ $t('CustomField.autofill_preview') }}</h5>
            <ul class="taf__list">
                <li v-for="item in suggestions" :key="item.fieldId" class="taf__item">
                    <span class="taf__kind">{{ item.kind }}</span>
                    <span class="taf__title">{{ item.title }}</span>
                    <span class="taf__value">{{ item.display || item.value }}</span>
                </li>
            </ul>
            <div class="taf__actions">
                <button type="button" class="taf__apply" :disabled="busy" @click="apply">
                    {{ busy ? $t('CustomField.autofill_working') : $t('CustomField.autofill_apply') }}
                </button>
                <button type="button" class="taf__dismiss" :disabled="busy" @click="dismiss">
                    {{ $t('CustomField.autofill_dismiss') }}
                </button>
            </div>
        </div>
    </div>
</template>

<script setup>
import { computed, ref } from 'vue';
import { useStore } from 'vuex';
import { useI18n } from 'vue-i18n';
import { useToast } from 'vue-toast-notification';
import { apiRequest } from '@/services';
import * as env from '@/config/env';
import { useCustomComposable } from '@/composable';

const props = defineProps({
    task: { type: Object, default: () => ({}) },
    enabled: { type: [Boolean, Number], default: false },
});

const { t } = useI18n();
const $toast = useToast();
const { commit } = useStore();
const { checkApps } = useCustomComposable();

const busy = ref(false);
const notice = ref('');
const suggestions = ref([]);

const canShow = computed(() => Boolean(props.enabled) && Boolean(checkApps('AI')) && Boolean(checkApps('CustomFields')));

function patchTask(next) {
    const task = props.task || {};
    if (!task._id) return;
    commit('projectData/mutateUpdateFirebaseTasks', {
        snap: null,
        op: 'modified',
        pid: task.ProjectID || '',
        sprintId: task.sprintId || '',
        data: { ...task, ...next },
        updatedFields: next,
    });
}

function dismiss() {
    suggestions.value = [];
    notice.value = '';
}

async function preview() {
    if (busy.value || !props.task?._id) return;
    busy.value = true;
    notice.value = '';
    suggestions.value = [];
    try {
        const response = await apiRequest('post', env.V2_TASKS_AI_AUTOFILL, {
            action: 'preview',
            taskId: props.task._id,
        });
        const payload = response.data || {};
        if (!payload.status) {
            notice.value = payload.statusText || t('CustomField.autofill_failed');
            return;
        }
        const next = Array.isArray(payload.data?.suggestions) ? payload.data.suggestions : [];
        if (!next.length) {
            notice.value = t('CustomField.autofill_none');
            return;
        }
        suggestions.value = next;
    } catch (_error) {
        notice.value = t('CustomField.autofill_failed');
    } finally {
        busy.value = false;
    }
}

async function apply() {
    if (busy.value || !suggestions.value.length || !props.task?._id) return;
    busy.value = true;
    notice.value = '';
    try {
        const response = await apiRequest('post', env.V2_TASKS_AI_AUTOFILL, {
            action: 'apply',
            taskId: props.task._id,
            suggestions: suggestions.value,
        });
        const payload = response.data || {};
        if (!payload.status) {
            notice.value = payload.statusText || t('CustomField.autofill_failed');
            return;
        }
        const applied = Array.isArray(payload.data?.suggestions) ? payload.data.suggestions : suggestions.value;
        const customField = { ...(props.task.customField || {}) };
        let assignees = Array.isArray(props.task.AssigneeUserId) ? [...props.task.AssigneeUserId] : [];
        applied.forEach((item) => {
            if (item.source === 'native' || item.fieldId === 'assignee') {
                assignees = item.value || [];
            } else {
                customField[item.fieldId] = { _id: item.fieldId, fieldValue: item.value };
            }
        });
        patchTask({ customField, AssigneeUserId: assignees });
        suggestions.value = [];
        $toast.success(t('CustomField.autofill_applied'), { position: 'top-right' });
    } catch (_error) {
        notice.value = t('CustomField.autofill_failed');
    } finally {
        busy.value = false;
    }
}
</script>

<style scoped>
.taf {
    margin: 8px 0 12px;
}
.taf__go,
.taf__apply,
.taf__dismiss {
    border: 1px solid var(--kiln-line);
    border-radius: var(--kiln-radius-sm);
    background: var(--kiln-paper);
    color: var(--kiln-ink);
    font-family: var(--kiln-font-body);
    font-size: 12px;
    font-weight: 700;
    letter-spacing: 0.04em;
    text-transform: uppercase;
    padding: 6px 10px;
    cursor: pointer;
}
.taf__go {
    background: var(--kiln-ember);
    border-color: var(--kiln-ember);
    color: #fffaf3;
}
.taf__go:disabled,
.taf__apply:disabled,
.taf__dismiss:disabled {
    opacity: 0.55;
    cursor: default;
}
.taf__notice {
    margin: 8px 0 0;
    font-size: 12px;
    color: var(--kiln-muted);
}
.taf__preview {
    margin-top: 10px;
    background: var(--kiln-canvas);
    border: 1px solid var(--kiln-line);
    border-left: 3px solid var(--kiln-ember);
    border-radius: var(--kiln-radius-sm);
    padding: 12px 14px;
    color: var(--kiln-ink);
}
.taf__heading {
    margin: 0 0 8px;
    font-size: 10px;
    font-weight: 700;
    letter-spacing: 0.1em;
    text-transform: uppercase;
    color: var(--kiln-ember);
}
.taf__list {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 8px;
}
.taf__item {
    display: grid;
    grid-template-columns: 72px minmax(0, 1fr) minmax(0, 1.4fr);
    gap: 8px;
    align-items: start;
    font-size: 13px;
}
.taf__kind {
    font-size: 10px;
    font-weight: 700;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: var(--kiln-ember);
    padding-top: 2px;
}
.taf__title {
    font-family: var(--kiln-font-display);
    font-weight: 600;
    color: var(--kiln-ink);
}
.taf__value {
    color: var(--kiln-text);
    word-break: break-word;
}
.taf__actions {
    display: flex;
    gap: 8px;
    margin-top: 12px;
}
.taf__apply {
    background: var(--kiln-ink);
    border-color: var(--kiln-ink);
    color: var(--kiln-paper);
}
</style>
