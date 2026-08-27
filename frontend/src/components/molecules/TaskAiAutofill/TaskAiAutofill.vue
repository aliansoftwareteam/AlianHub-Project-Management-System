<template>
    <div v-if="canShow" class="taf" data-taf>
        <button
            type="button"
            class="taf__go"
            :disabled="busy"
            @click="preview"
        >{{ goLabel }}</button>
        <p v-if="notice && !showCard" class="taf__notice">{{ notice }}</p>
        <div v-if="showCard" class="taf__preview">
            <h5 class="taf__heading">{{ $t('CustomField.autofill_preview') }}</h5>
            <p v-if="notice" class="taf__notice">{{ notice }}</p>
            <ul class="taf__list">
                <li v-for="row in rows" :key="row.fieldId" class="taf__item">
                    <label class="taf__pick">
                        <input
                            type="checkbox"
                            :checked="row.checked"
                            :disabled="row.filled || !row.item"
                            @change="toggleRow(row.fieldId)"
                        />
                        <span class="taf__title">{{ row.title }}</span>
                    </label>
                    <span class="taf__value">{{ row.display || '—' }}</span>
                    <button
                        v-if="row.canApply"
                        type="button"
                        class="taf__apply"
                        :disabled="busy || !row.checked"
                        @click="applyOne(row)"
                    >{{ busy ? $t('CustomField.autofill_working') : $t('CustomField.autofill_apply') }}</button>
                    <span v-else-if="row.filled" class="taf__filled">{{ $t('CustomField.autofill_filled') }}</span>
                </li>
            </ul>
            <div class="taf__actions">
                <button
                    v-if="canFillEmpty"
                    type="button"
                    class="taf__apply"
                    :disabled="busy"
                    @click="applyEmpty"
                >{{ busy ? $t('CustomField.autofill_working') : $t('CustomField.autofill_fill_empty') }}</button>
                <button type="button" class="taf__dismiss" :disabled="busy" @click="dismiss">
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
import { useGetterFunctions } from '@/composable';

const OWNER_TITLE = /\bowner\b/i;
const DUE_TITLE = /\b(due|deadline)\b/i;
const DATE_PLACEHOLDER = /^(dd|mm|yyyy)([/.-])(dd|mm|yyyy)\2(dd|mm|yyyy)$/i;

const props = defineProps({
    task: { type: Object, default: () => ({}) },
    enabled: { type: [Boolean, Number], default: true },
});

const emit = defineEmits(['applied']);

const { t } = useI18n();
const $toast = useToast();
const { getters, commit } = useStore();
const { getUser } = useGetterFunctions();

const busy = ref(false);
const notice = ref('');
const suggestions = ref([]);
const selectedIds = ref([]);
const filledOnce = ref(false);
const showCard = ref(false);

const canShow = computed(() => Boolean(props.task && props.task._id));
const goLabel = computed(() => {
    if (busy.value && !showCard.value) return t('CustomField.autofill_working');
    return filledOnce.value ? t('CustomField.autofill_fill_empty') : t('CustomField.autofill');
});

const ownerField = computed(() => {
    const list = getters['settings/finalCustomFields'] || [];
    return list.find((field) => (
        OWNER_TITLE.test(String((field && field.fieldTitle) || ''))
        && String((field && field.fieldType) || '').toLowerCase() === 'dropdown'
    )) || null;
});

const dueField = computed(() => {
    const list = getters['settings/finalCustomFields'] || [];
    return list.find((field) => (
        DUE_TITLE.test(String((field && field.fieldTitle) || ''))
        && String((field && field.fieldType) || '').toLowerCase() === 'date'
    )) || null;
});

function valueIsEmpty(value) {
    if (value == null || value === '' || value === 0) return true;
    if (typeof value === 'number') return !Number.isFinite(value) || value <= 0;
    if (typeof value === 'string') {
        const trimmed = value.trim();
        if (!trimmed) return true;
        if (DATE_PLACEHOLDER.test(trimmed)) return true;
        return trimmed.toLowerCase() === 'invalid date';
    }
    if (value instanceof Date) return Number.isNaN(value.getTime());
    if (typeof value === 'object') {
        if (Object.prototype.hasOwnProperty.call(value, 'fieldValue')) return valueIsEmpty(value.fieldValue);
        if (Object.prototype.hasOwnProperty.call(value, 'date')) return valueIsEmpty(value.date);
        if (Object.prototype.hasOwnProperty.call(value, 'seconds')) return !Number(value.seconds);
        return Object.keys(value).length === 0;
    }
    return false;
}

function assigneeEmpty() {
    const raw = props.task && props.task.AssigneeUserId;
    const list = Array.isArray(raw) ? raw : [];
    return list.filter((value) => {
        const id = value && typeof value === 'object' ? String(value._id || value.id || '') : String(value || '');
        if (!id || id === '0' || id.toLowerCase() === 'unassigned') return false;
        try {
            const user = getUser(id);
            if (!user || user.ghostUser) return false;
            const name = String(user.Employee_Name || user.name || '').trim();
            return Boolean(name) && name.toLowerCase() !== 'ghost user';
        } catch (_error) {
            return false;
        }
    }).length === 0;
}

function sprintDueDisplay(task) {
    const name = String((task && (task.sprintName || (task.sprintArray && task.sprintArray.name))) || '');
    const range = name.match(/(\d{1,2})\s*[-–]\s*(\d{1,2})\s+([A-Za-z]{3,9})\.?\s+(20\d{2})/);
    if (!range) return '';
    const months = {
        jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6,
        jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12,
    };
    const month = months[String(range[3] || '').slice(0, 3).toLowerCase()];
    if (!month) return '';
    return `${range[4]}-${String(month).padStart(2, '0')}-${String(Number(range[2])).padStart(2, '0')}`;
}

function nativeDueEmpty() {
    return valueIsEmpty(props.task && props.task.DueDate);
}

function customDueEmpty() {
    const field = dueField.value;
    if (!field) return nativeDueEmpty();
    const bag = (props.task && props.task.customField) || {};
    const entry = bag[field._id] || bag[String(field._id)] || {};
    return valueIsEmpty(entry && Object.prototype.hasOwnProperty.call(entry, 'fieldValue') ? entry.fieldValue : undefined);
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

function isSelected(fieldId) {
    return selectedIds.value.includes(String(fieldId));
}

function toggleRow(fieldId) {
    const id = String(fieldId);
    if (selectedIds.value.includes(id)) {
        selectedIds.value = selectedIds.value.filter((item) => item !== id);
    } else {
        selectedIds.value = [...selectedIds.value, id];
    }
}

const rows = computed(() => {
    const assigneeSug = findSuggestion((item) => item.source === 'native' || item.fieldId === 'assignee');
    const field = ownerField.value;
    const ownerSug = field
        ? findSuggestion((item) => String(item.fieldId) === String(field._id) && item.source !== 'native')
        : findSuggestion((item) => item.kind === 'owner' && item.source !== 'native');
    const dueSug = findSuggestion((item) => (
        item.kind === 'date'
        || item.fieldId === 'due'
        || (dueField.value && String(item.fieldId) === String(dueField.value._id))
    ));
    const assigneeIsEmpty = assigneeEmpty();
    const ownerLabel = ownerValueLabel(field);
    const ownerFilled = Boolean(ownerLabel);
    const dueIsEmpty = dueField.value ? customDueEmpty() : nativeDueEmpty();
    const dueId = (dueSug && dueSug.fieldId) || (dueField.value && dueField.value._id) || 'due';
    const dueSeed = sprintDueDisplay(props.task);
    const dueItem = dueSug || (dueIsEmpty && dueSeed
        ? { fieldId: dueId, kind: 'date', value: dueSeed, display: dueSeed, source: dueField.value ? 'customField' : 'native' }
        : null);
    const out = [
        {
            fieldId: 'assignee',
            title: t('ProjectDetails.assignee'),
            display: (assigneeSug && (assigneeSug.display || assigneeSug.value)) || '',
            item: assigneeSug,
            checked: isSelected('assignee'),
            canApply: Boolean(props.enabled) && Boolean(assigneeSug) && assigneeIsEmpty,
            filled: false,
            write: 'assignee',
        },
    ];
    if (!assigneeIsEmpty && !assigneeSug) out.pop();
    if (!ownerFilled) {
        out.push({
            fieldId: (field && field._id) || 'owner',
            title: (field && field.fieldTitle) || 'Owner',
            display: (ownerSug && (ownerSug.display || ownerSug.value)) || '',
            item: ownerSug,
            checked: Boolean(field) && isSelected(field._id),
            canApply: Boolean(props.enabled) && Boolean(ownerSug),
            filled: false,
            write: 'owner',
        });
    }
    if (dueIsEmpty) {
        out.push({
            fieldId: dueId,
            title: (dueField.value && dueField.value.fieldTitle) || (dueSug && dueSug.title) || t('Projects.due_date'),
            display: (dueItem && (dueItem.display || dueItem.value)) || dueSeed || '',
            item: dueItem,
            checked: isSelected(dueId),
            canApply: Boolean(props.enabled) && Boolean(dueItem),
            filled: false,
            write: 'date',
        });
    }
    return out;
});

const canFillEmpty = computed(() => rows.value.some((row) => row.canApply && row.item));

function dismiss() {
    showCard.value = false;
    notice.value = '';
    filledOnce.value = true;
}

function onEscape(event) {
    if (!event || event.key !== 'Escape') return;
    if (document.querySelector('.drop-down-menu')) return;
    if (!showCard.value) return;
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
            selectedIds.value = [];
            return;
        }
        const next = Array.isArray(payload.data?.suggestions) ? payload.data.suggestions : [];
        suggestions.value = next;
        const ids = next.filter((item) => item && item.fieldId).map((item) => String(item.fieldId));
        const dueIso = sprintDueDisplay(props.task);
        const dueTarget = (dueField.value && dueField.value._id) || 'due';
        if (dueIso && !ids.includes(String(dueTarget)) && !ids.includes('due')) {
            ids.push(String(dueTarget));
        }
        selectedIds.value = ids;
        showCard.value = true;
        filledOnce.value = true;
        if (!next.length && !dueIso) notice.value = t('CustomField.autofill_none');
    } catch (_error) {
        notice.value = t('CustomField.autofill_failed');
        suggestions.value = [];
        selectedIds.value = [];
    } finally {
        busy.value = false;
    }
}

watch(() => props.task && props.task._id, (id, prev) => {
    if (String(id || '') === String(prev || '')) return;
    showCard.value = false;
    suggestions.value = [];
    selectedIds.value = [];
    notice.value = '';
    filledOnce.value = false;
});

function applyPatch(applied, write) {
    const customField = { ...(props.task.customField || {}) };
    const appliedIds = [];
    const next = {};
    applied.forEach((item) => {
        appliedIds.push(String(item.fieldId));
        if (write === 'assignee' || item.fieldId === 'assignee' || (item.source === 'native' && item.kind !== 'date')) {
            next.AssigneeUserId = item.value || [];
        } else if (write === 'date' || item.kind === 'date' || item.fieldId === 'due') {
            if (item.fieldId === 'due' || item.source === 'native') {
                next.DueDate = item.value;
                appliedIds.push('due');
            } else {
                customField[item.fieldId] = { _id: item.fieldId, fieldValue: item.value };
                if (nativeDueEmpty()) {
                    next.DueDate = item.value;
                    appliedIds.push('due');
                }
            }
        } else {
            customField[item.fieldId] = { _id: item.fieldId, fieldValue: item.value };
        }
    });
    if (write !== 'assignee') next.customField = customField;
    const prior = Array.isArray(props.task._autofilledFields) ? props.task._autofilledFields : [];
    next._autofilledFields = [...new Set([...prior, ...appliedIds])];
    patchTask(next);
    filledOnce.value = true;
    emit('applied', appliedIds);
    const used = new Set(applied.map((item) => String(item.fieldId)));
    suggestions.value = suggestions.value.filter((item) => !used.has(String(item.fieldId)));
    selectedIds.value = selectedIds.value.filter((id) => !used.has(id));
}

async function applyEmpty() {
    const batch = rows.value.filter((row) => row.canApply && row.checked && row.item);
    if (busy.value || !batch.length || !props.task?._id) return;
    busy.value = true;
    notice.value = '';
    try {
        const response = await apiRequest('post', env.V2_TASKS_AI_AUTOFILL, {
            action: 'apply',
            taskId: props.task._id,
            suggestions: batch.map((row) => row.item),
        });
        const payload = response.data || {};
        if (!payload.status) {
            notice.value = payload.statusText || t('CustomField.autofill_failed');
            return;
        }
        const applied = Array.isArray(payload.data?.suggestions) ? payload.data.suggestions : batch.map((row) => row.item);
        applyPatch(applied);
        $toast.success(t('CustomField.autofill_applied'), { position: 'top-right' });
    } catch (_error) {
        notice.value = t('CustomField.autofill_failed');
    } finally {
        busy.value = false;
    }
}

async function applyOne(row) {
    if (busy.value || !row || !row.item || !row.checked || !props.task?._id) return;
    if (row.write === 'assignee' && !row.checked) return;
    busy.value = true;
    notice.value = '';
    try {
        const response = await apiRequest('post', env.V2_TASKS_AI_AUTOFILL, {
            action: 'apply',
            taskId: props.task._id,
            suggestions: [row.item],
        });
        const payload = response.data || {};
        if (!payload.status) {
            notice.value = payload.statusText || t('CustomField.autofill_failed');
            return;
        }
        const applied = Array.isArray(payload.data?.suggestions) ? payload.data.suggestions : [row.item];
        applyPatch(applied, row.write);
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
    border: 1px solid var(--kiln-line, #d8cbb3);
    border-radius: var(--kiln-radius-sm, 9px);
    background: var(--kiln-paper, #f4ead8);
    color: var(--kiln-ink, #1b2f28);
    font-family: var(--kiln-font-body);
    font-size: 12px;
    font-weight: 700;
    letter-spacing: 0.04em;
    text-transform: uppercase;
    padding: 6px 10px;
    cursor: pointer;
}
.taf__go {
    background: var(--kiln-ember, #c45c26);
    border-color: var(--kiln-ember, #c45c26);
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
    color: var(--kiln-muted, #6b7280);
}
.taf__preview {
    margin-top: 10px;
    background: var(--kiln-canvas, #fbf6ec);
    border: 1px solid var(--kiln-line, #d8cbb3);
    border-left: 3px solid var(--kiln-ember, #c45c26);
    border-radius: var(--kiln-radius-sm, 9px);
    padding: 12px 14px;
    color: var(--kiln-ink, #1b2f28);
}
.taf__heading {
    margin: 0 0 8px;
    font-size: 10px;
    font-weight: 700;
    letter-spacing: 0.1em;
    text-transform: uppercase;
    color: var(--kiln-ember, #c45c26);
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
    align-items: center;
    gap: 8px;
    min-width: 0;
    cursor: pointer;
}
.taf__pick input {
    margin: 0;
    accent-color: var(--kiln-ember, #c45c26);
    flex: 0 0 auto;
}
.taf__title {
    font-family: var(--kiln-font-display);
    font-weight: 600;
    color: var(--kiln-ink, #1b2f28);
}
.taf__value {
    color: var(--kiln-text, #1b2f28);
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
    background: var(--kiln-ink, #1b2f28);
    border-color: var(--kiln-ink, #1b2f28);
    color: var(--kiln-paper, #f4ead8);
    justify-self: end;
}
</style>
