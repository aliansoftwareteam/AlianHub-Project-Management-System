<template>
    <section v-if="templates.length" ref="root" class="ah-cp__saved" data-saved-templates>
        <div class="ah-label ah-cp__group">{{ $t('Projects.template_saved_group') }}</div>
        <div v-for="template in templates" :key="template._id" class="ah-cp__saved-row">
            <form
                v-if="editingId === template._id"
                class="ah-cp__saved-form"
                data-template-edit-form
                @submit.prevent="saveEdit(template)"
                @keydown.esc.stop.prevent="editingId = ''"
            >
                <input v-model="draft.name" type="text" class="ah-input ah-cp__saved-input" data-template-name :maxlength="NAME_LIMIT" :aria-label="$t('Projects.template_name')">
                <textarea v-model="draft.description" class="ah-input ah-cp__saved-input ah-cp__saved-text" data-template-description rows="2" :maxlength="DESCRIPTION_LIMIT" :aria-label="$t('Projects.template_description')" :placeholder="$t('Projects.template_description')"></textarea>
                <label class="ah-cp__check">
                    <input v-model="draft.everyone" type="checkbox" class="ah-check" data-template-everyone>
                    <span>{{ $t('Projects.template_everyone') }}</span>
                </label>
                <div class="ah-cp__saved-actions">
                    <button type="submit" class="ah-cp__link" :disabled="busy">{{ $t('Projects.template_save_changes') }}</button>
                    <button type="button" class="ah-cp__link" @click="editingId = ''">{{ $t('Projects.cancel') }}</button>
                </div>
            </form>
            <template v-else>
                <button type="button" class="ah-cp__tpl" :class="{ 'is-on': selectedId === template._id }" :data-saved-template="template._id" @click="$emit('pick', template)">
                    <span class="ah-cp__tpl-icon ah-cp__tpl-icon--brand"><ShellIcon name="star" :size="15" /></span>
                    <span class="ah-cp__saved-body">
                        <span class="ah-cp__tpl-name ah-cp__saved-line">{{ template.name }}</span>
                        <span v-if="template.description" class="ah-cp__tpl-desc ah-cp__saved-line">{{ shortened(template.description) }}</span>
                        <span class="ah-cp__tpl-desc ah-cp__saved-line">{{ countsText(template.counts, t) }}<template v-if="makerOf(template)"> · {{ $t('Projects.template_by', { name: makerOf(template) }) }}</template></span>
                    </span>
                </button>
                <div v-if="template.canManage" class="ah-cp__saved-actions">
                    <template v-if="deletingId === template._id">
                        <button type="button" class="ah-cp__link ah-cp__link--danger" data-template-confirm-delete :disabled="busy" @click="remove(template)">{{ $t('Projects.template_delete_confirm') }}</button>
                        <button type="button" class="ah-cp__link" @click="deletingId = ''">{{ $t('Projects.cancel') }}</button>
                    </template>
                    <template v-else>
                        <button type="button" class="ah-cp__link" :data-template-edit="template._id" :aria-label="$t('Projects.template_edit_label', { name: template.name })" @click="startEdit(template)">{{ $t('Projects.template_edit') }}</button>
                        <button type="button" class="ah-cp__link ah-cp__link--danger" :data-template-delete="template._id" :aria-label="$t('Projects.template_delete_label', { name: template.name })" @click="deletingId = template._id">{{ $t('Projects.template_delete') }}</button>
                    </template>
                </div>
            </template>
        </div>
        <p v-if="error" class="ah-field__error" role="alert">{{ error }}</p>
    </section>
</template>

<script setup>
/**
 * The workspace's templates saved from projects, as rows of the template picker. The person who saved one, owners and
 * admins can rename it, rewrite its description, change who it is offered to and delete it, here.
 */
import { nextTick, reactive, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import ShellIcon from '@/components/organisms/Shell/ShellIcon.vue';
import { DESCRIPTION_LIMIT, NAME_LIMIT, countsText, deleteProjectTemplate, editProjectTemplate } from '@/views/Projects/projectTemplates';

defineOptions({ name: 'SavedProjectTemplates' });

const DESCRIPTION_SHOWN = 90;

const props = defineProps({
    templates: { type: Array, default: () => [] },
    selectedId: { type: String, default: '' },
    users: { type: Array, default: () => [] },
});
const emit = defineEmits(['pick', 'changed']);

const { t } = useI18n();

const root = ref(null);
const editingId = ref('');
const deletingId = ref('');
const draft = reactive({ name: '', description: '', everyone: false });
const busy = ref(false);
const error = ref('');

const makerOf = (template) => props.users.find((user) => String(user._id) === String(template.createdBy))?.Employee_Name || '';
const shortened = (text) => {
    const line = String(text || '').replace(/\s+/g, ' ').trim();
    return line.length > DESCRIPTION_SHOWN ? `${line.slice(0, DESCRIPTION_SHOWN - 3).trim()}…` : line;
};

async function startEdit(template) {
    error.value = '';
    deletingId.value = '';
    Object.assign(draft, { name: template.name, description: template.description || '', everyone: template.everyone === true });
    editingId.value = template._id;
    await nextTick();
    root.value?.querySelector('[data-template-name]')?.focus();
}

async function change(task) {
    if (busy.value) return;
    busy.value = true;
    error.value = '';
    const answer = await task();
    busy.value = false;
    editingId.value = '';
    deletingId.value = '';
    if (answer.ok) emit('changed');
    else error.value = answer.message || t('Projects.template_change_failed');
}

function saveEdit(template) {
    const wanted = { name: draft.name.trim(), description: draft.description.trim(), everyone: draft.everyone };
    const before = { name: template.name, description: template.description || '', everyone: template.everyone === true };
    const changes = Object.fromEntries(Object.entries(wanted).filter(([key, value]) => value !== before[key]));
    if (!wanted.name || !Object.keys(changes).length) {
        editingId.value = '';
        return undefined;
    }
    return change(() => editProjectTemplate(template._id, changes));
}

const remove = (template) => change(() => deleteProjectTemplate(template._id));
</script>
