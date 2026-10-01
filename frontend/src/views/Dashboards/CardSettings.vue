<template>
    <form class="csf" novalidate @submit.prevent="save">
        <template v-for="field in fields" :key="field.name">
            <label v-if="field.type === 'project'" class="ah-field">
                <span class="ah-field__label">{{ $t(field.labelKey) }}</span>
                <select v-model="form[field.name]" class="ah-input" :data-test="`csf-${field.name}`">
                    <option value="">{{ field.required ? $t('Dash.choose_project') : $t('Dash.settings_all_projects') }}</option>
                    <option v-for="p in projects" :key="p._id" :value="String(p._id)">{{ p.ProjectName }}</option>
                </select>
            </label>

            <label v-else-if="field.type === 'sprint'" class="ah-field">
                <span class="ah-field__label">{{ $t(field.labelKey) }}</span>
                <select v-model="form[field.name]" class="ah-input" :disabled="!form.projectId || loadingSprints" :data-test="`csf-${field.name}`">
                    <option value="">{{ loadingSprints ? $t('Dash.settings_loading') : $t('Dash.settings_choose_sprint') }}</option>
                    <option v-for="s in sprints" :key="s._id" :value="s._id">{{ s.name || $t('Reports.sprint') }}</option>
                </select>
                <span v-if="form.projectId && !loadingSprints && !sprints.length" class="ah-field__hint">{{ $t('Dash.settings_no_sprints') }}</span>
            </label>

            <label v-else-if="field.type === 'choice'" class="ah-field">
                <span class="ah-field__label">{{ $t(field.labelKey) }}</span>
                <select v-model="form[field.name]" class="ah-input" :data-test="`csf-${field.name}`">
                    <option v-for="o in field.options" :key="o.id" :value="o.id">{{ $t(o.labelKey) }}</option>
                </select>
            </label>

            <label v-else-if="field.type === 'count'" class="ah-field">
                <span class="ah-field__label">{{ $t(field.labelKey) }}</span>
                <input v-model.number="form[field.name]" type="number" class="ah-input" :min="field.min" :max="field.max" :data-test="`csf-${field.name}`" />
            </label>

            <label v-else-if="field.type === 'text'" class="ah-field">
                <span class="ah-field__label">{{ $t(field.labelKey) }}</span>
                <textarea
                    v-model="form[field.name]"
                    class="ah-input csf__text"
                    rows="3"
                    :maxlength="field.maxLength"
                    :placeholder="field.placeholderKey ? $t(field.placeholderKey) : ''"
                    :data-test="`csf-${field.name}`"
                ></textarea>
                <span v-if="field.hintKey" class="ah-field__hint">{{ $t(field.hintKey) }}</span>
            </label>
        </template>

        <span v-if="error" class="ah-field__error" data-test="csf-error">{{ error }}</span>

        <div class="csf__actions">
            <button type="button" class="ah-btn ah-btn--secondary ah-btn--sm" @click="$emit('cancel')">{{ $t('Dash.cancel') }}</button>
            <button type="submit" class="ah-btn ah-btn--primary ah-btn--sm" data-test="csf-save">{{ $t('Dash.save') }}</button>
        </div>
    </form>
</template>

<script setup>
import { reactive, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { fetchSprints, sprintChoices } from '@/views/Projects/Reports/composables/agileReports';

defineOptions({ name: 'CardSettings' });

const props = defineProps({
    fields: { type: Array, default: () => [] },
    cardData: { type: Object, default: () => ({}) },
    projects: { type: Array, default: () => [] },
});

const emit = defineEmits(['save', 'cancel']);

const { t } = useI18n();

const initialOf = (field) => {
    const saved = props.cardData ? props.cardData[field.name] : undefined;
    if (saved !== undefined && saved !== null && saved !== '') return saved;
    if (field.type === 'choice') return field.options[0].id;
    if (field.type === 'count') return field.default;
    return '';
};

const form = reactive(Object.fromEntries(props.fields.map((f) => [f.name, initialOf(f)])));
const sprints = ref([]);
const loadingSprints = ref(false);
const error = ref('');
const hasSprintField = props.fields.some((f) => f.type === 'sprint');

const loadSprints = async (projectId) => {
    sprints.value = [];
    if (!hasSprintField || !projectId) return;
    loadingSprints.value = true;
    try {
        const list = sprintChoices(await fetchSprints(projectId));
        if (form.projectId === projectId) sprints.value = list;
    } catch (e) {
        sprints.value = [];
    } finally {
        loadingSprints.value = false;
    }
};

watch(() => form.projectId, (projectId, before) => {
    if (before !== undefined && hasSprintField) form.sprintId = '';
    loadSprints(projectId);
}, { immediate: true });

const clamp = (field, value) => {
    const n = Math.round(Number(value));
    if (!Number.isFinite(n)) return field.default;
    return Math.min(field.max, Math.max(field.min, n));
};

const save = () => {
    const missing = props.fields.some((f) => f.required && !String(form[f.name] ?? '').trim());
    if (missing) {
        error.value = t('Dash.settings_required');
        return;
    }
    error.value = '';
    const values = {};
    props.fields.forEach((f) => {
        if (f.type === 'count') values[f.name] = clamp(f, form[f.name]);
        else if (f.type === 'text') values[f.name] = String(form[f.name] || '').trim();
        else values[f.name] = form[f.name];
    });
    emit('save', values);
};
</script>

<style scoped>
.csf { display: flex; flex-direction: column; gap: 14px; }
.csf__text { resize: vertical; min-height: 72px; font-family: inherit; }
.csf__actions { display: flex; justify-content: flex-end; gap: 8px; }
</style>
