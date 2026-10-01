<template>
    <teleport to="body">
        <div class="sptd__overlay" @click.self="cancel">
            <form class="sptd__card" role="dialog" aria-modal="true" :aria-label="t('Projects.template_save')" @submit.prevent="submit" @keydown.esc="cancel">
                <h3 class="ah-h3 sptd__title">{{ t('Projects.template_save') }}</h3>

                <label class="ah-field">
                    <span class="ah-field__label">{{ t('Projects.template_name') }}</span>
                    <input ref="nameInput" v-model="name" data-field="name" type="text" class="ah-input" :class="{ 'ah-input--error': problem }" :maxlength="NAME_LIMIT" :disabled="busy">
                </label>
                <label class="ah-field">
                    <span class="ah-field__label">{{ t('Projects.template_description') }}</span>
                    <textarea v-model="description" data-field="description" class="ah-input sptd__description" rows="2" :maxlength="DESCRIPTION_LIMIT" :disabled="busy"></textarea>
                </label>

                <fieldset class="sptd__choices" :disabled="busy">
                    <legend class="ah-field__label">{{ t('Projects.template_also') }}</legend>
                    <label class="sptd__choice">
                        <input v-model="include.tasks" data-field="tasks" type="checkbox" class="ah-check" @change="tasksChanged">
                        <span>
                            {{ t('Projects.duplicate_tasks') }}
                            <span class="ah-field__hint sptd__hint">{{ t('Projects.template_tasks_hint') }}</span>
                        </span>
                    </label>
                    <label class="sptd__choice" :class="{ 'is-off': !include.tasks }">
                        <input v-model="include.assignees" data-field="assignees" type="checkbox" class="ah-check" :disabled="!include.tasks">
                        <span>{{ t('Projects.duplicate_assignees') }}</span>
                    </label>
                    <label class="sptd__choice">
                        <input v-model="include.dates" data-field="dates" type="checkbox" class="ah-check">
                        <span>
                            {{ t('Projects.duplicate_dates') }}
                            <span class="ah-field__hint sptd__hint">{{ t('Projects.template_dates_hint') }}</span>
                        </span>
                    </label>
                    <label class="sptd__choice">
                        <input v-model="include.automations" data-field="automations" type="checkbox" class="ah-check">
                        <span>
                            {{ t('Projects.template_automations') }}
                            <span class="ah-field__hint sptd__hint">{{ t('Projects.template_automations_hint') }}</span>
                        </span>
                    </label>
                </fieldset>

                <p class="ah-field__hint sptd__always">{{ t('Projects.template_always') }}</p>

                <label class="sptd__choice sptd__everyone">
                    <input v-model="everyone" data-field="everyone" type="checkbox" class="ah-check" :disabled="busy">
                    <span>
                        {{ t('Projects.template_everyone') }}
                        <span class="ah-field__hint sptd__hint">{{ t('Projects.template_everyone_hint') }}</span>
                    </span>
                </label>

                <p v-if="problem" class="ah-field__error" role="alert">{{ problem }}</p>

                <div class="sptd__actions">
                    <button type="button" class="ah-btn ah-btn--secondary ah-btn--sm" data-action="cancel" :disabled="busy" @click="cancel">{{ t('Projects.cancel') }}</button>
                    <button type="submit" class="ah-btn ah-btn--primary ah-btn--sm" data-action="save" :disabled="busy">
                        {{ busy ? t('Projects.template_saving') : t('Projects.template_save_action') }}
                    </button>
                </div>
            </form>
        </div>
    </teleport>
</template>

<script setup>
/**
 * Saves the project it is handed as a workspace template: asks for the name, what to keep and who it is offered to.
 * A template of a private project starts out kept to the person saving it, owners and admins.
 */
import { nextTick, onBeforeUnmount, onMounted, reactive, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { useToast } from 'vue-toast-notification';
import { DESCRIPTION_LIMIT, NAME_LIMIT, saveProjectTemplate } from '@/views/Projects/projectTemplates';

const LEFT_OUT = ['private_lists_left', 'automations_skipped', 'tasks_left_out'];

const props = defineProps({
    project: { type: Object, required: true },
});
const emit = defineEmits(['close']);

const { t } = useI18n();
const $toast = useToast();

const name = ref(props.project.ProjectName || '');
const description = ref('');
const include = reactive({ tasks: false, assignees: false, dates: false, automations: false });
const everyone = ref(props.project.isPrivateSpace !== true);
const busy = ref(false);
const problem = ref('');
const nameInput = ref(null);
let closed = false;

const tasksChanged = () => { if (!include.tasks) include.assignees = false; };

/* The request cannot be called back, so the dialog stays until the answer says what was saved. */
const cancel = () => { if (!busy.value) emit('close'); };

async function submit() {
    if (busy.value) return;
    const wanted = name.value.trim();
    if (!wanted) { problem.value = t('Projects.template_name_required'); return; }
    busy.value = true;
    problem.value = '';
    const answer = await saveProjectTemplate(props.project._id, { name: wanted, description: description.value.trim(), everyone: everyone.value, include: { ...include } });
    if (closed) return;
    busy.value = false;
    if (!answer.ok) {
        problem.value = answer.message || t('Projects.template_save_failed');
        return;
    }
    $toast.success(t('Projects.template_saved', { name: answer.template.name || wanted }), { position: 'top-right' });
    (answer.notes || []).filter((note) => LEFT_OUT.includes(note.code)).forEach((note) => {
        $toast.info(t(`Projects.template_note_${note.code}`, { count: note.count }), { position: 'top-right' });
    });
    emit('close');
}

onMounted(() => nextTick(() => nameInput.value?.select()));
onBeforeUnmount(() => { closed = true; });
</script>

<style scoped>
.sptd__overlay { position: fixed; inset: 0; background: rgba(0, 0, 0, .35); z-index: 1000; display: flex; align-items: center; justify-content: center; padding: var(--sp-7); }
.sptd__card { background: var(--surface); color: var(--ink); border-radius: 12px; width: min(460px, 100%); max-height: 100%; overflow-y: auto; padding: 18px var(--sp-8) var(--sp-8); box-shadow: var(--shadow-pop); font-family: var(--font-ui); display: flex; flex-direction: column; gap: var(--sp-6); box-sizing: border-box; }
.sptd__title { margin: 0; overflow-wrap: anywhere; }
.ah-input.sptd__description { height: auto; min-height: 56px; padding-top: 8px; padding-bottom: 8px; resize: vertical; line-height: 1.4; }
.sptd__choices { border: 0; margin: 0; padding: 0; min-width: 0; display: flex; flex-direction: column; gap: var(--sp-4); }
.sptd__choices legend { padding: 0; margin-bottom: var(--sp-4); }
.sptd__choice { display: flex; align-items: flex-start; gap: var(--sp-4); font-size: 13.5px; line-height: 1.4; color: var(--ink); cursor: pointer; }
.sptd__choice.is-off { color: var(--ink-2); cursor: default; }
.sptd__choice .ah-check { flex: none; margin-top: 1px; }
.sptd__hint { display: block; }
.sptd__always { margin: 0; }
.sptd__everyone { padding-top: var(--sp-5); border-top: 1px solid var(--hairline); }
.sptd__actions { display: flex; justify-content: flex-end; gap: var(--sp-4); }
</style>
