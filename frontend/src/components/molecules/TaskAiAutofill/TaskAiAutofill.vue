<template>
    <div v-if="canShow" class="taf" data-taf>
        <button
            type="button"
            class="taf__go"
            :disabled="busy"
            @click="preview"
        >{{ goLabel }}</button>
        <p v-if="notice" class="taf__notice">{{ notice }}</p>
        <div class="taf__preview">
            <h5 class="taf__heading">{{ $t('CustomField.autofill_preview') }}</h5>
            <ul class="taf__list">
                <li v-for="row in rows" :key="row.fieldId" class="taf__item">
                    <label class="taf__pick">
                        <span class="taf__title">{{ row.title }}</span>
                        <span v-if="row.hint" class="taf__hint">{{ row.hint }}</span>
                    </label>
                    <span class="taf__value">{{ row.display || '—' }}</span>
                    <button
                        v-if="row.canApply"
                        type="button"
                        class="taf__apply"
                        :disabled="busy"
                        @click="applyOne(row.item)"
                    >{{ busy ? $t('CustomField.autofill_working') : $t('CustomField.autofill_apply') }}</button>
                    <span v-else-if="row.filled" class="taf__filled">{{ $t('CustomField.autofill_filled') }}</span>
                </li>
            </ul>
            <div class="taf__actions">
                <button type="button" class="taf__dismiss" :disabled="busy || !suggestions.length" @click="dismiss">
                    {{ $t('CustomField.autofill_dismiss') }}
                </button>
            </div>
        </div>
    </div>
</template>

<script setup>
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { useStore } from 'vuex';
import { useI18n } from 'vue-i18n';
import { useToast } from 'vue-toast-notification';
import { apiRequest } from '@/services';
import * as env from '@/config/env';

const OWNER_TITLE = /\bowner\b/i;

const props = defineProps({
    task: { type: Object, default: () => ({}) },
    enabled: { type: [Boolean, Number], default: true },
});

const emit = defineEmits(['applied']);

const { t } = useI18n();
const $toast = useToast();
const { getters, commit } = useStore();

const busy = ref(false);
const notice = ref('');
const suggestions = ref([]);
const filledOnce = ref(false);
const previewedFor = ref('');

const canShow = computed(() => Boolean(props.task && props.task._id));
const goLabel = computed(() => {
    if (busy.value && !suggestions.value.length) return t('CustomField.autofill_working');
    return filledOnce.value ? t('CustomField.autofill_fill_empty') : t('CustomField.autofill');
});

const ownerField = computed(() => {
    const list = getters['settings/finalCustomFields'] || [];
    return list.find((field) => (
        OWNER_TITLE.test(String((field && field.fieldTitle) || ''))
        && String((field && field.fieldType) || '').toLowerCase() === 'dropdown'
    )) || null;
});

function assigneeEmpty() {
    const ids = props.task && Array.isArray(props.task.AssigneeUserId) ? props.task.AssigneeUserId : [];
    return ids.filter(Boolean).length === 0;
}

function ownerValueLabel(field) {
    if (!field) return '';
    const bag = (props.task && props.task.customField) || {};
    const entry = bag[field._id] || bag[String(field._id)] || {};
    const raw = entry.fieldValue;
    const ids = Array.isArray(raw) ? raw : (raw ? [raw] : []);
    if (!ids.length) return '';
    const options = Array.isArray(field.fieldOptions) ? field.fieldOptions : [];
    return ids.map((id) => {
        const hit = options.find((option) => String(option.id || option._id) === String(id));
        return (hit && (hit.label || hit.value || hit.name)) || String(id);
    }).filter(Boolean).join(', ');
}

function findSuggestion(match) {
    return suggestions.value.find(match) || null;
}

const rows = computed(() => {
    const assigneeSug = findSuggestion((item) => item.source === 'native' || item.fieldId === 'assignee');
    const field = ownerField.value;
    const ownerSug = field
        ? findSuggestion((item) => String(item.fieldId) === String(field._id))
        : findSuggestion((item) => item.kind === 'owner' && item.source !== 'native');
    const dueSug = findSuggestion((item) => item.kind === 'date');
    const assigneeIsEmpty = assigneeEmpty();
    const ownerLabel = ownerValueLabel(field);
    const ownerFilled = Boolean(ownerLabel);
    const out = [
        {
            fieldId: 'assignee',
            title: t('ProjectDetails.assignee'),
            hint: t('CustomField.autofill_native'),
            display: (assigneeSug && (assigneeSug.display || assigneeSug.value)) || '',
            item: assigneeSug,
            canApply: Boolean(props.enabled) && Boolean(assigneeSug) && assigneeIsEmpty,
            filled: !assigneeIsEmpty,
        },
        {
            fieldId: (field && field._id) || 'owner',
            title: (field && field.fieldTitle) || 'Owner',
            hint: t('CustomField.autofill_custom_people'),
            display: (ownerSug && (ownerSug.display || ownerSug.value)) || ownerLabel,
            item: ownerSug,
            canApply: Boolean(props.enabled) && Boolean(ownerSug) && !ownerFilled,
            filled: ownerFilled,
        },
    ];
    if (dueSug) {
        out.push({
            fieldId: dueSug.fieldId,
            title: dueSug.title || t('Projects.due_date'),
            hint: '',
            display: dueSug.display || dueSug.value || '',
            item: dueSug,
            canApply: Boolean(props.enabled),
            filled: false,
        });
    }
    return out;
});

function dismiss() {
    suggestions.value = [];
    notice.value = '';
}

function onEscape(event) {
    if (!event || event.key !== 'Escape') return;
    if (!suggestions.value.length) return;
    const tag = document.activeElement && document.activeElement.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA') return;
    event.preventDefault();
    event.stopPropagation();
    if (typeof event.stopImmediatePropagation === 'function') event.stopImmediatePropagation();
    dismiss();
}

onMounted(() => {
    document.addEventListener('keydown', onEscape, true);
    document.addEventListener('kiln-dismiss-autofill', dismiss);
});
onBeforeUnmount(() => {
    document.removeEventListener('keydown', onEscape, true);
    document.removeEventListener('kiln-dismiss-autofill', dismiss);
});

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

async function preview() {
    if (busy.value || !props.task?._id) return;
    busy.value = true;
    notice.value = '';
    try {
        const response = await apiRequest('post', env.V2_TASKS_AI_AUTOFILL, {
            action: 'preview',
            taskId: props.task._id,
        });
        const payload = response.data || {};
        if (!payload.status) {
            notice.value = payload.statusText || t('CustomField.autofill_failed');
            suggestions.value = [];
            return;
        }
        const next = Array.isArray(payload.data?.suggestions) ? payload.data.suggestions : [];
        suggestions.value = next;
        previewedFor.value = String(props.task._id);
        if (!next.length) notice.value = t('CustomField.autofill_none');
    } catch (_error) {
        notice.value = t('CustomField.autofill_failed');
        suggestions.value = [];
    } finally {
        busy.value = false;
    }
}

watch(() => [canShow.value, props.task && props.task._id], ([show, id]) => {
    if (!show || !id) return;
    if (previewedFor.value === String(id) || busy.value) return;
    preview();
}, { immediate: true });

function applyPatch(applied) {
    const customField = { ...(props.task.customField || {}) };
    let assignees = Array.isArray(props.task.AssigneeUserId) ? [...props.task.AssigneeUserId] : [];
    let dueDate = props.task.DueDate;
    const appliedIds = [];
    applied.forEach((item) => {
        appliedIds.push(String(item.fieldId));
        if (item.source === 'native' || item.fieldId === 'assignee') {
            assignees = item.value || [];
        } else if (item.kind === 'date') {
            customField[item.fieldId] = { _id: item.fieldId, fieldValue: item.value };
            if (!dueDate) {
                dueDate = item.value;
                appliedIds.push('due');
            }
        } else {
            customField[item.fieldId] = { _id: item.fieldId, fieldValue: item.value };
        }
    });
    const prior = Array.isArray(props.task._autofilledFields) ? props.task._autofilledFields : [];
    const _autofilledFields = [...new Set([...prior, ...appliedIds])];
    const next = { customField, AssigneeUserId: assignees, _autofilledFields };
    if (dueDate) next.DueDate = dueDate;
    patchTask(next);
    filledOnce.value = true;
    emit('applied', appliedIds);
    const used = new Set(applied.map((item) => String(item.fieldId)));
    suggestions.value = suggestions.value.filter((item) => !used.has(String(item.fieldId)));
}

async function applyOne(item) {
    if (busy.value || !item || !props.task?._id) return;
    busy.value = true;
    notice.value = '';
    try {
        const response = await apiRequest('post', env.V2_TASKS_AI_AUTOFILL, {
            action: 'apply',
            taskId: props.task._id,
            suggestions: [item],
        });
        const payload = response.data || {};
        if (!payload.status) {
            notice.value = payload.statusText || t('CustomField.autofill_failed');
            return;
        }
        const applied = Array.isArray(payload.data?.suggestions) ? payload.data.suggestions : [item];
        applyPatch(applied);
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
    grid-template-columns: minmax(0, 1fr) minmax(0, 1.2fr) auto;
    gap: 8px;
    align-items: start;
    font-size: 13px;
}
.taf__pick {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: 2px;
    min-width: 0;
}
.taf__title {
    font-family: var(--kiln-font-display);
    font-weight: 600;
    color: var(--kiln-ink);
}
.taf__hint {
    font-size: 10px;
    letter-spacing: 0.04em;
    text-transform: uppercase;
    color: var(--kiln-muted, #6b7280);
}
.taf__value {
    color: var(--kiln-text);
    word-break: break-word;
}
.taf__filled {
    font-size: 10px;
    letter-spacing: 0.04em;
    text-transform: uppercase;
    color: var(--kiln-muted, #6b7280);
    align-self: center;
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
    justify-self: end;
}
</style>
