<template>
    <div class="fv">
        <!-- list of the project's forms -->
        <aside class="fv__side">
            <div class="fv__side-head">
                <span class="fv__side-title">{{ $t('Projects.forms') }}</span>
                <button type="button" class="fv__icon-btn" :title="$t('Projects.add_form')" :disabled="creating" @click="createForm">+</button>
            </div>
            <div class="fv__list">
                <div v-if="loading" class="fv__muted">{{ $t('Projects.loading') }}</div>
                <div v-else-if="!forms.length" class="fv__muted">{{ $t('Projects.no_forms') }}</div>
                <div
                    v-for="form in forms"
                    :key="form._id"
                    class="fv__row"
                    :class="{ 'is-active': current && String(current._id) === String(form._id) }"
                    @click="openForm(form)"
                >
                    <span class="fv__row-title" :title="form.title">{{ form.title }}</span>
                    <span class="fv__state" :class="'is-' + form.state">{{ stateLabel(form.state) }}</span>
                </div>
            </div>
        </aside>

        <!-- the selected form -->
        <section class="fv__main">
            <div v-if="!current" class="fv__blank">
                <p class="fv__blank-text">{{ forms.length ? $t('Projects.select_form') : $t('Projects.no_forms_hint') }}</p>
                <button type="button" class="fv__btn fv__btn--primary" :disabled="creating" @click="createForm">
                    {{ creating ? '…' : $t('Projects.add_form') }}
                </button>
            </div>
            <template v-else>
                <div class="fv__head">
                    <input v-model="draftTitle" type="text" class="fv__title" :placeholder="$t('Projects.form_untitled')" />
                    <button type="button" class="fv__subs" :class="{ 'is-on': showSubmissions }"
                        @click="showSubmissions = !showSubmissions">
                        <FormIcon :name="showSubmissions ? 'back' : 'table'" />
                        {{ showSubmissions ? $t('Projects.form_back_to_form') : $t('Projects.form_view_submissions') }}
                    </button>
                    <span class="fv__state" :class="'is-' + current.state">{{ stateLabel(current.state) }}</span>
                </div>
                <FormBuilder v-model:showSubmissions="showSubmissions" :form="current"
                    :projectData="projectData || {}" :titleDraft="draftTitle"
                    @saved="onSaved" @deleted="onDeleted" @dirty="(v) => builderDirty = v" />
            </template>
            <div v-if="err" class="fv__err">{{ err }}</div>
        </section>
    </div>
</template>

<script setup>
import { ref, computed, inject, onMounted, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { apiRequest } from '@/services';
import FormBuilder from './FormBuilder.vue';
import FormIcon from './FormIcon.vue';

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
        err.value = (e && e.response && e.response.data && e.response.data.statusText) || (e && e.message) || 'Failed to load forms';
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
            err.value = (body && body.statusText) || 'Could not open that form';
        }
    } catch (e) {
        err.value = (e && e.message) || 'Could not open that form';
    }
};

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
            err.value = (body && body.statusText) || 'Could not create a form';
        }
    } catch (e) {
        err.value = (e && e.response && e.response.data && e.response.data.statusText) || (e && e.message) || 'Could not create a form';
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
.fv { display: flex; align-items: stretch; height: 100%; min-height: 520px; font-family: 'Roboto', sans-serif; background: #fff; }
.fv__side { flex: 0 0 280px; border-right: 1px solid #eef0f6; display: flex; flex-direction: column; min-height: 0; }
.fv__side-head { display: flex; align-items: center; justify-content: space-between; padding: 14px 14px 10px; }
.fv__side-title { font-size: 15px; font-weight: 600; color: #2f3444; }
.fv__icon-btn { border: none; background: none; font-size: 20px; line-height: 1; color: #6b7280; cursor: pointer; padding: 0 4px; }
.fv__icon-btn:disabled { opacity: .5; cursor: default; }
.fv__list { flex: 1; min-height: 0; overflow-y: auto; padding: 0 6px 14px; }
.fv__muted { font-size: 13px; color: #9aa0b4; padding: 8px 8px; }
.fv__row { display: flex; align-items: center; gap: 8px; padding: 8px 10px; margin: 1px 0; border-radius: 6px; cursor: pointer; font-size: 13.5px; color: #3b4252; }
.fv__row:hover { background: #f4f5f8; }
.fv__row.is-active { background: #eceef3; font-weight: 600; color: #111; }
.fv__row-title { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.fv__subs { flex: 0 0 auto; display: flex; align-items: center; gap: 7px; border: 1px solid #d7d9e6;
    background: #fff; color: #3b4252; border-radius: 7px; padding: 6px 13px; font-size: 13px;
    cursor: pointer; font-family: inherit; }
.fv__subs:hover, .fv__subs.is-on { background: #f4f5fb; color: #2f3990; border-color: #b9c0ea; }
.fv__state { flex: 0 0 auto; font-size: 11px; padding: 1px 8px; border-radius: 10px; border: 1px solid #d7d9e6; color: #6b7280; }
.fv__state.is-live { color: #1c7a43; border-color: #bfe3cd; }
.fv__main { flex: 1; min-width: 0; padding: 22px 26px; overflow-y: auto; }
.fv__blank { height: 100%; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 14px; }
.fv__blank-text { font-size: 13px; color: #9aa0b4; margin: 0; }
.fv__btn { border: 1px solid #d7d9e6; background: #fff; border-radius: 7px; padding: 8px 16px; font-size: 13px; cursor: pointer; font-family: inherit; }
.fv__btn--primary { background: #2f3a8f; border-color: #2f3a8f; color: #fff; }
.fv__btn:disabled { opacity: .5; cursor: default; }
.fv__head { display: flex; align-items: center; gap: 10px; margin-bottom: 18px; }
.fv__title { flex: 1; min-width: 0; border: none; outline: none; font-size: 22px; font-weight: 600; color: #2f3444; padding: 2px 0; font-family: inherit; }
.fv__placeholder { border: 1px dashed #dfe2ec; border-radius: 8px; padding: 34px; text-align: center; font-size: 13px; color: #9aa0b4; }
.fv__err { font-size: 12px; color: #c0392b; margin-top: 12px; }
@media (max-width: 860px) {
    .fv { display: block; }
    .fv__side { border-right: none; border-bottom: 1px solid #eef0f6; }
    .fv__main { padding: 16px; }
}
</style>
