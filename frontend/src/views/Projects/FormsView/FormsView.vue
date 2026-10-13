<template>
    <div class="ah-page fv">
        <div class="fv__bar">
            <select v-if="forms.length" v-model="currentId" class="fv__pick" :aria-label="$t('Projects.forms')">
                <option v-for="form in forms" :key="form._id" :value="String(form._id)">{{ form.title }}</option>
            </select>
            <span v-else class="ah-muted">{{ loading ? $t('Projects.loading') : $t('Projects.no_forms') }}</span>
            <button type="button" class="ah-btn ah-btn--secondary ah-btn--sm" :disabled="creating" @click="createForm">
                + {{ $t('Projects.add_form') }}
            </button>
            <input
                v-if="current"
                v-model="draftTitle"
                type="text"
                class="fv__title"
                :placeholder="$t('Projects.form_untitled')"
                :aria-label="$t('Projects.form_untitled')"
            />
            <span v-if="current" class="ah-chip" :class="current.state === 'live' ? 'ah-chip--ok' : ''">{{ stateLabel(current.state) }}</span>
        </div>

        <div v-if="!current" class="fv__blank">
            <div class="ah-empty fv__blank-card">
                <p class="fv__blank-text">{{ forms.length ? $t('Projects.select_form') : $t('Projects.no_forms_hint') }}</p>
                <button type="button" class="ah-btn ah-btn--primary ah-btn--sm" :disabled="creating" @click="createForm">
                    {{ creating ? '…' : $t('Projects.add_form') }}
                </button>
            </div>
        </div>
        <FormBuilder
            v-else
            v-model:showSubmissions="showSubmissions"
            :form="current"
            :projectData="projectData || {}"
            :titleDraft="draftTitle"
            @saved="onSaved"
            @deleted="onDeleted"
            @dirty="(v) => builderDirty = v"
        />
        <div v-if="err" class="ah-field__error fv__err">{{ err }}</div>
    </div>
</template>

<script setup>
import { ref, computed, inject, onMounted, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { apiRequest } from '@/services';
import FormBuilder from './FormBuilder.vue';

defineOptions({ name: 'FormsView' });

const { t } = useI18n();
const projectData = inject('selectedProject');

const forms = ref([]);
const current = ref(null);
const draftTitle = ref('');
const loading = ref(false);
const creating = ref(false);
const builderDirty = ref(false);
// Lives here because the control that toggles it sits in this header, while the
// pane it swaps belongs to the builder.
const showSubmissions = ref(false);
const err = ref('');

const projectId = computed(() => String((projectData.value && projectData.value._id) || ''));

const stateLabel = (s) => (s === 'live' ? t('Projects.form_live') : t('Projects.form_draft'));

const load = async () => {
    if (!projectId.value) return;
    loading.value = true; err.value = '';
    try {
        const body = (await apiRequest('get', `/api/v2/forms?projectId=${encodeURIComponent(projectId.value)}`))?.data;
        forms.value = (body && body.status && Array.isArray(body.data)) ? body.data : [];
        // A populated list with nothing open is a dead end, so the first form
        // opens itself. Only when nothing is open: a save that refreshes the list
        // must not pull the user off the form they are editing.
        if (!current.value && forms.value.length) await openForm(forms.value[0]);
    } catch (e) {
        err.value = (e && e.response && e.response.data && e.response.data.statusText) || (e && e.message) || t('Toast.something_went_wrong');
    } finally { loading.value = false; }
};

const leaveBuilder = () => !builderDirty.value
    // eslint-disable-next-line no-alert
    || window.confirm(t('Projects.form_discard_confirm'));

const openForm = async (form) => {
    if (!form || !form._id) return;
    if (current.value && String(current.value._id) !== String(form._id) && !leaveBuilder()) return;
    builderDirty.value = false;
    showSubmissions.value = false;
    try {
        const body = (await apiRequest('get', `/api/v2/forms/${form._id}`))?.data;
        if (body && body.status) {
            current.value = body.data;
            draftTitle.value = body.data.title || '';
        } else {
            err.value = (body && body.statusText) || t('Toast.something_went_wrong');
        }
    } catch (e) {
        err.value = (e && e.message) || t('Toast.something_went_wrong');
    }
};

const currentId = computed({
    get: () => String((current.value && current.value._id) || ''),
    set: (id) => {
        const form = forms.value.find((f) => String(f._id) === String(id));
        if (form) openForm(form);
    },
});

const createForm = async () => {
    if (creating.value || !projectId.value || !leaveBuilder()) return;
    creating.value = true; err.value = '';
    try {
        const body = (await apiRequest('post', '/api/v2/forms', {
            title: t('Projects.form_untitled'),
            projectId: projectId.value,
        }))?.data;
        if (body && body.status) {
            await load();
            await openForm(body.data);
        } else {
            err.value = (body && body.statusText) || t('Toast.something_went_wrong');
        }
    } catch (e) {
        err.value = (e && e.response && e.response.data && e.response.data.statusText) || (e && e.message) || t('Toast.something_went_wrong');
    } finally { creating.value = false; }
};

// The list only shows a title and a state badge, so it is refetched only when one
// of those actually changed. Reloading on every save made the sidebar flash a
// loading state for edits it does not display.
const onSaved = async (updated) => {
    if (!updated) return;
    const before = current.value || {};
    const listChanged = updated.title !== before.title
        || updated.state !== before.state
        || updated.submissionCount !== before.submissionCount;
    current.value = { ...before, ...updated };
    if (updated.title) draftTitle.value = updated.title;
    if (listChanged) await load();
};

const onDeleted = async (id) => {
    builderDirty.value = false;
    showSubmissions.value = false;
    forms.value = forms.value.filter((f) => String(f._id) !== String(id));
    current.value = null;
    draftTitle.value = '';
    await load();
};

// Switching projects keeps this component mounted — only the injected project
// changes — so the list and the open form have to be rebuilt, or the previous
// project's forms stay on screen. Same trap the Docs view hit.
watch(projectId, (id, previous) => {
    if (!id || !previous || id === previous) return;
    current.value = null;
    draftTitle.value = '';
    forms.value = [];
    builderDirty.value = false;
    showSubmissions.value = false;
    err.value = '';
    load();
});

onMounted(load);
</script>

<style scoped>
.fv { height: 100%; min-height: 520px; background: var(--canvas); font: var(--text-small); }
.fv__bar {
    height: 44px; flex: none;
    display: flex; align-items: center; gap: 8px;
    padding: 0 20px;
    background: var(--surface);
    border-bottom: 1px solid var(--hairline);
}
.fv__pick {
    height: 28px; max-width: 220px;
    border: 1px solid var(--border); border-radius: var(--r-input);
    background: var(--surface); color: var(--ink);
    font: var(--text-small); padding: 0 8px;
}
.fv__title {
    flex: 1; min-width: 0; max-width: 360px;
    border: 1px solid transparent; border-radius: var(--r-input);
    background: transparent; color: var(--ink);
    font: 600 15px/1.2 var(--font-ui); letter-spacing: -.2px;
    padding: 4px 8px;
}
.fv__title:hover { border-color: var(--hairline); }
.fv__title:focus { outline: none; border-color: var(--brand); box-shadow: var(--focus); }
.fv__blank { flex: 1; display: grid; place-items: center; padding: 24px; }
.fv__blank-card { display: flex; flex-direction: column; align-items: center; gap: 12px; background: var(--surface); text-align: center; }
.fv__blank-text { margin: 0; }
.fv__err { padding: 8px 20px; }
</style>
