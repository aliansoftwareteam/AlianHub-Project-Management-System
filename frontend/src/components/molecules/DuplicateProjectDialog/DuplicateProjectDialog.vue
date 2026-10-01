<template>
    <teleport to="body">
        <div class="dpd__overlay" @click.self="cancel">
            <form class="dpd__card" role="dialog" aria-modal="true" :aria-label="t('Projects.duplicate_project')" @submit.prevent="submit" @keydown.esc="cancel">
                <h3 class="ah-h3 dpd__title">{{ t('Projects.duplicate_project') }}</h3>

                <template v-if="!job">
                    <label class="ah-field">
                        <span class="ah-field__label">{{ t('Projects.duplicate_name') }}</span>
                        <input ref="nameInput" v-model="name" data-field="name" type="text" class="ah-input" :class="{ 'ah-input--error': problem }" maxlength="255" :disabled="busy">
                    </label>

                    <fieldset class="dpd__choices" :disabled="busy">
                        <legend class="ah-field__label">{{ t('Projects.duplicate_also') }}</legend>
                        <label class="dpd__choice">
                            <input v-model="include.tasks" data-field="tasks" type="checkbox" class="ah-check" @change="tasksChanged">
                            <span>
                                {{ t('Projects.duplicate_tasks') }}
                                <span class="ah-field__hint dpd__hint">{{ t('Projects.duplicate_tasks_hint') }}</span>
                            </span>
                        </label>
                        <label class="dpd__choice" :class="{ 'is-off': !include.tasks }">
                            <input v-model="include.assignees" data-field="assignees" type="checkbox" class="ah-check" :disabled="!include.tasks">
                            <span>{{ t('Projects.duplicate_assignees') }}</span>
                        </label>
                        <label class="dpd__choice">
                            <input v-model="include.dates" data-field="dates" type="checkbox" class="ah-check">
                            <span>{{ t('Projects.duplicate_dates') }}</span>
                        </label>
                    </fieldset>

                    <p class="ah-field__hint dpd__always">{{ t('Projects.duplicate_always') }}</p>
                    <p v-if="sharedFields.length" class="ah-field__hint dpd__always" data-note="shared-fields">{{ t('Projects.duplicate_fields_shared') }}</p>
                    <p v-if="problem" class="ah-field__error" role="alert">{{ problem }}</p>
                </template>

                <div v-else class="dpd__progress">
                    <p class="dpd__progress-text">{{ t('Projects.duplicate_progress', { done: job.processed, total: job.total }) }}</p>
                    <div class="dpd__bar" role="progressbar" aria-valuemin="0" :aria-valuemax="job.total" :aria-valuenow="job.processed" :aria-label="t('Projects.duplicate_progress', { done: job.processed, total: job.total })">
                        <span class="dpd__bar-fill" :style="{ width: `${percent}%` }"></span>
                    </div>
                    <p class="ah-field__hint">{{ t('Projects.duplicate_progress_hint') }}</p>
                </div>

                <div class="dpd__actions">
                    <button type="button" class="ah-btn ah-btn--secondary ah-btn--sm" data-action="cancel" :disabled="sending" @click="cancel">{{ job ? t('Projects.duplicate_hide') : t('Projects.cancel') }}</button>
                    <button v-if="!job" type="submit" class="ah-btn ah-btn--primary ah-btn--sm" data-action="duplicate" :disabled="busy">
                        {{ busy ? t('Projects.duplicate_working') : t('Projects.duplicate') }}
                    </button>
                </div>
            </form>
        </div>
    </teleport>
</template>

<script setup>
/**
 * Duplicates the project it is handed: asks for the name and what to bring along, shows the
 * progress of a copy large enough to run as a job, then opens the new project.
 */
import { computed, nextTick, onBeforeUnmount, onMounted, reactive, ref } from 'vue';
import { useStore } from 'vuex';
import { useRoute, useRouter } from 'vue-router';
import { useI18n } from 'vue-i18n';
import { useToast } from 'vue-toast-notification';
import { duplicateProject, duplicateProgress, linkedTo, shareFields } from '@/views/Projects/duplicateProject';

const POLL_MS = 1500;

const props = defineProps({
    project: { type: Object, required: true },
});
const emit = defineEmits(['close']);

const { t } = useI18n();
const store = useStore();
const route = useRoute();
const router = useRouter();
const $toast = useToast();

const name = ref(t('Projects.duplicate_copy_name', { name: props.project.ProjectName || '' }));
const include = reactive({ tasks: false, assignees: false, dates: false });
const busy = ref(false);
const problem = ref('');
const job = ref(null);
const nameInput = ref(null);
let timer = null;
let closed = false;

const sharedFields = computed(() => (store.getters['settings/finalCustomFields'] || []).filter((field) => linkedTo(field, props.project._id)));

const percent = computed(() => (job.value?.total ? Math.min(100, Math.round((job.value.processed / job.value.total) * 100)) : 0));

const tasksChanged = () => { if (!include.tasks) include.assignees = false; };

const sending = computed(() => busy.value && !job.value);

/* The request cannot be called back, so the dialog stays until the answer says what was made. */
const cancel = () => { if (!sending.value) emit('close'); };

function finish(copy, notes, { complete = true } = {}) {
    if (complete) $toast.success(t('Projects.duplicate_done', { name: copy.ProjectName }), { position: 'top-right' });
    const off = (notes || []).find((note) => note.code === 'automations_disabled');
    if (off) $toast.info(t('Projects.duplicate_automations_off', { count: off.count }), { position: 'top-right' });
    emit('close');
    router.push({ name: 'Project', params: { cid: route.params.cid, id: copy._id } });
}

function watchJob(copy, notes) {
    timer = setTimeout(async () => {
        const latest = await duplicateProgress(copy._id);
        if (closed) return;
        if (latest) job.value = latest;
        if (latest?.status === 'failed') {
            $toast.error(t('Projects.duplicate_tasks_failed', { created: latest.created, total: latest.total }), { position: 'top-right' });
            finish(copy, notes, { complete: false });
            return;
        }
        if (latest?.status === 'done') { finish(copy, notes); return; }
        watchJob(copy, notes);
    }, POLL_MS);
}

async function submit() {
    if (busy.value) return;
    const wanted = name.value.trim();
    if (!wanted) { problem.value = t('Projects.duplicate_name_required'); return; }
    busy.value = true;
    problem.value = '';
    const answer = await duplicateProject(props.project._id, { name: wanted, include: { ...include } });
    if (answer.ok) {
        store.commit('projectData/mutateProjects', [{ snap: null, privateSnap: false, op: 'added', data: { ...answer.project, id: answer.project._id } }]);
        shareFields(store, answer.sharedFields, answer.project._id);
    }
    if (closed) return;
    if (!answer.ok) {
        busy.value = false;
        problem.value = answer.message || t('Projects.duplicate_failed');
        return;
    }
    if (!answer.job) { finish(answer.project, answer.notes); return; }
    job.value = { processed: 0, created: 0, ...answer.job };
    watchJob(answer.project, answer.notes);
}

onMounted(() => nextTick(() => nameInput.value?.select()));
onBeforeUnmount(() => { closed = true; clearTimeout(timer); });
</script>

<style scoped>
.dpd__overlay { position: fixed; inset: 0; background: rgba(0, 0, 0, .35); z-index: 1000; display: flex; align-items: center; justify-content: center; padding: var(--sp-7); }
.dpd__card { background: var(--surface); color: var(--ink); border-radius: 12px; width: min(440px, 100%); max-height: 100%; overflow-y: auto; padding: 18px var(--sp-8) var(--sp-8); box-shadow: var(--shadow-pop); font-family: var(--font-ui); display: flex; flex-direction: column; gap: var(--sp-6); box-sizing: border-box; }
.dpd__title { margin: 0; overflow-wrap: anywhere; }
.dpd__choices { border: 0; margin: 0; padding: 0; min-width: 0; display: flex; flex-direction: column; gap: var(--sp-4); }
.dpd__choices legend { padding: 0; margin-bottom: var(--sp-4); }
.dpd__choice { display: flex; align-items: flex-start; gap: var(--sp-4); font-size: 13.5px; line-height: 1.4; color: var(--ink); cursor: pointer; }
.dpd__choice.is-off { color: var(--ink-2); cursor: default; }
.dpd__choice .ah-check { flex: none; margin-top: 1px; }
.dpd__hint { display: block; }
.dpd__always { margin: 0; }
.dpd__progress { display: flex; flex-direction: column; gap: var(--sp-4); }
.dpd__progress-text { margin: 0; font-size: 13.5px; color: var(--ink); }
.dpd__bar { height: 6px; border-radius: 3px; background: var(--fill); overflow: hidden; }
.dpd__bar-fill { display: block; height: 100%; background: var(--brand); transition: width .3s ease; }
.dpd__actions { display: flex; justify-content: flex-end; gap: var(--sp-4); }
</style>
