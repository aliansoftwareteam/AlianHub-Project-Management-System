<template>
    <section class="ah-card arc" :aria-labelledby="ids.heading" data-test="assignment-rules">
        <div class="arc__head">
            <h5 :id="ids.heading" class="arc__title">{{ $t('AssignmentRules.title') }}</h5>
            <p class="ah-small arc__lead">{{ $t('AssignmentRules.lead') }}</p>
        </div>

        <p v-if="!loading && !loadError && !aiOn" class="arc__note" role="note" data-test="ai-note">{{ $t('AssignmentRules.ai_unavailable') }}</p>

        <div v-if="loading" class="ah-empty">{{ $t('AssignmentRules.loading') }}</div>
        <div v-else-if="loadError" class="arc__load-error">
            <p class="ah-field__error" role="alert">{{ loadError }}</p>
            <button type="button" class="ah-btn ah-btn--secondary ah-btn--sm" @click="load(projectId)">{{ $t('AssignmentRules.retry') }}</button>
        </div>
        <template v-else>
            <ul v-if="entries.length" class="arc__rows">
                <li v-for="(entry, index) in entries" :key="entry.userId" class="arc__row" data-test="rule-row">
                    <span class="arc__who" :id="`${ids.heading}-who-${index}`">{{ nameOf(entry.userId) }}</span>
                    <textarea
                        v-model="entry.when"
                        class="ah-input arc__when"
                        data-test="rule-when"
                        rows="2"
                        :maxlength="MAX_WHEN"
                        :disabled="!canEdit || busy"
                        :placeholder="$t('AssignmentRules.when_placeholder')"
                        :aria-label="$t('AssignmentRules.when_label', { name: nameOf(entry.userId) })"
                    ></textarea>
                    <button
                        v-if="canEdit"
                        type="button"
                        class="ah-btn ah-btn--ghost ah-btn--sm arc__remove"
                        data-test="rule-remove"
                        :disabled="busy"
                        :aria-label="$t('AssignmentRules.remove_person', { name: nameOf(entry.userId) })"
                        @click="removeEntry(index)"
                    >{{ $t('AssignmentRules.remove') }}</button>
                </li>
            </ul>
            <p v-else class="ah-small arc__empty">{{ $t('AssignmentRules.empty') }}</p>

            <div v-if="canEdit" class="arc__add">
                <select v-model="picked" class="ah-input arc__select" data-test="add-person" :aria-label="$t('AssignmentRules.add_person')" :disabled="busy || !available.length">
                    <option value="">{{ available.length ? $t('AssignmentRules.add_person') : $t('AssignmentRules.everyone_added') }}</option>
                    <option v-for="person in available" :key="person.id" :value="person.id">{{ person.name }}</option>
                </select>
                <button type="button" class="ah-btn ah-btn--secondary ah-btn--sm" data-test="add-person-btn" :disabled="busy || !picked" @click="addEntry">{{ $t('AssignmentRules.add') }}</button>
                <button
                    type="button"
                    class="ah-btn ah-btn--outline ah-btn--sm arc__suggest"
                    data-test="suggest"
                    :disabled="busy || drafting || !aiOn || !entries.length"
                    :aria-busy="drafting ? 'true' : null"
                    :title="$t('AssignmentRules.suggest_hint')"
                    @click="suggest"
                >{{ drafting ? $t('AssignmentRules.suggesting') : $t('AssignmentRules.suggest') }}</button>
            </div>

            <div v-if="drafts" class="arc__drafts" data-test="drafts" role="region" :aria-label="$t('AssignmentRules.drafts_title')">
                <p class="arc__drafts-title">{{ $t('AssignmentRules.drafts_title') }}</p>
                <ul v-if="drafts.length" class="arc__draft-list">
                    <li v-for="draft in drafts" :key="draft.userId" class="arc__draft" data-test="draft-row">
                        <strong>{{ nameOf(draft.userId) }}</strong><span>{{ draft.when }}</span>
                    </li>
                </ul>
                <p v-else class="ah-small">{{ $t('AssignmentRules.drafts_empty') }}</p>
                <div class="arc__actions">
                    <button v-if="drafts.length" type="button" class="ah-btn ah-btn--primary ah-btn--sm" data-test="use-drafts" @click="useDrafts">{{ $t('AssignmentRules.use_drafts') }}</button>
                    <button type="button" class="ah-btn ah-btn--ghost ah-btn--sm" data-test="discard-drafts" @click="drafts = null">{{ $t('AssignmentRules.discard_drafts') }}</button>
                </div>
            </div>

            <div class="arc__settings">
                <label class="arc__field">
                    <span class="ah-field__label">{{ $t('AssignmentRules.fallback') }}</span>
                    <select v-model="fallbackUserId" class="ah-input arc__select" data-test="fallback" :disabled="!canEdit || busy" :aria-describedby="ids.fallback">
                        <option value="">{{ $t('AssignmentRules.no_assignee') }}</option>
                        <option v-for="person in candidates" :key="person.id" :value="person.id">{{ person.name }}</option>
                    </select>
                    <span :id="ids.fallback" class="ah-field__hint">{{ $t('AssignmentRules.fallback_hint') }}</span>
                </label>

                <label class="arc__switch">
                    <input v-model="onCreate" type="checkbox" role="switch" data-test="on-create" :disabled="!canEdit || busy" />
                    <span>{{ $t('AssignmentRules.on_create') }}</span>
                </label>
                <label class="arc__switch">
                    <input v-model="onChange" type="checkbox" role="switch" data-test="on-change" :disabled="!canEdit || busy" />
                    <span>{{ $t('AssignmentRules.on_change') }}</span>
                </label>

                <fieldset class="arc__mode">
                    <legend class="ah-field__label">{{ $t('AssignmentRules.mode') }}</legend>
                    <label class="arc__radio">
                        <input v-model="mode" type="radio" value="suggest" :name="ids.mode" data-test="mode-suggest" :disabled="!canEdit || busy" />
                        <span><strong>{{ $t('AssignmentRules.mode_suggest') }}</strong> <span class="ah-small">{{ $t('AssignmentRules.mode_suggest_hint') }}</span></span>
                    </label>
                    <label class="arc__radio">
                        <input v-model="mode" type="radio" value="apply" :name="ids.mode" data-test="mode-apply" :disabled="!canEdit || busy" />
                        <span><strong>{{ $t('AssignmentRules.mode_apply') }}</strong> <span class="ah-small">{{ $t('AssignmentRules.mode_apply_hint') }}</span></span>
                    </label>
                </fieldset>
            </div>

            <p v-if="error" class="ah-field__error" role="alert">{{ error }}</p>

            <div v-if="canEdit" class="arc__actions arc__footer">
                <button type="button" class="ah-btn ah-btn--primary ah-btn--sm" data-test="save" :disabled="busy" :aria-busy="busy ? 'true' : null" @click="save">
                    {{ busy ? $t('AssignmentRules.saving') : $t('AssignmentRules.save') }}
                </button>
            </div>
        </template>
    </section>
</template>

<script setup>
import { computed, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import { useToast } from "vue-toast-notification";
import { draftProjectRules, fetchProjectRules, refusalText, saveProjectRules } from "@/utils/assignmentRules";

defineOptions({ name: "AssignmentRulesCard" });

const props = defineProps({
    projectId: { type: String, required: true },
    candidates: { type: Array, default: () => [] },
    canEdit: { type: Boolean, default: false }
});

const MAX_WHEN = 300;

const { t } = useI18n();
const $toast = useToast();

const uid = `arc-${Math.random().toString(36).slice(2, 8)}`;
const ids = { heading: `${uid}-heading`, fallback: `${uid}-fallback`, mode: `${uid}-mode` };

const entries = ref([]);
const fallbackUserId = ref("");
const onCreate = ref(true);
const onChange = ref(false);
const mode = ref("suggest");
const aiState = ref("on");
const picked = ref("");
const drafts = ref(null);
const loading = ref(false);
const loadError = ref("");
const busy = ref(false);
const drafting = ref(false);
const error = ref("");

const aiOn = computed(() => aiState.value === "on");
const names = computed(() => new Map(props.candidates.map((person) => [person.id, person.name])));
const nameOf = (id) => names.value.get(id) || t("AssignmentRules.unknown_person");
const available = computed(() => props.candidates.filter((person) => !entries.value.some((entry) => entry.userId === person.id)));

function apply(rules) {
    entries.value = (rules?.entries || []).map((entry) => ({ userId: entry.userId, when: entry.when }));
    fallbackUserId.value = rules?.fallbackUserId || "";
    onCreate.value = rules ? rules.onCreate !== false : true;
    onChange.value = rules ? rules.onChange === true : false;
    mode.value = rules?.mode === "apply" ? "apply" : "suggest";
}

function load(pid) {
    loading.value = true;
    loadError.value = "";
    drafts.value = null;
    fetchProjectRules(pid)
        .then((data) => {
            if (pid !== props.projectId) return;
            apply(data?.rules || null);
            aiState.value = data?.ai?.state || "unconfigured";
        })
        .catch((e) => { loadError.value = refusalText(e, t("AssignmentRules.load_failed")); })
        .finally(() => { loading.value = false; });
}

watch(() => props.projectId, (pid) => { if (pid) load(pid); }, { immediate: true });

function addEntry() {
    if (!picked.value) return;
    entries.value.push({ userId: picked.value, when: "" });
    picked.value = "";
}

function removeEntry(index) {
    entries.value.splice(index, 1);
}

async function suggest() {
    drafting.value = true;
    error.value = "";
    try {
        const data = await draftProjectRules(props.projectId, entries.value.map((entry) => entry.userId));
        drafts.value = data?.drafts || [];
    } catch (e) {
        error.value = refusalText(e, t("AssignmentRules.suggest_failed"));
    } finally {
        drafting.value = false;
    }
}

function useDrafts() {
    (drafts.value || []).forEach((draft) => {
        const entry = entries.value.find((row) => row.userId === draft.userId);
        if (entry) entry.when = draft.when;
    });
    drafts.value = null;
}

async function save() {
    busy.value = true;
    error.value = "";
    try {
        const saved = await saveProjectRules(props.projectId, {
            entries: entries.value.map((entry) => ({ userId: entry.userId, when: String(entry.when || "").trim() })),
            fallbackUserId: fallbackUserId.value || null,
            onCreate: onCreate.value,
            onChange: onChange.value,
            mode: mode.value
        });
        if (saved && Array.isArray(saved.entries)) apply(saved);
        $toast.success(t("AssignmentRules.saved"), { position: "top-right" });
    } catch (e) {
        error.value = refusalText(e, t("AssignmentRules.save_failed"));
    } finally {
        busy.value = false;
    }
}
</script>

<style scoped>
.arc { display: flex; flex-direction: column; gap: 12px; margin: 20px 0 0; padding: 14px 16px; max-width: 720px; box-sizing: border-box; }
.arc__head { display: flex; flex-direction: column; gap: 4px; }
.arc__title { margin: 0; font: 600 14px/1.3 var(--font-ui); color: var(--ink); }
.arc__lead { margin: 0; }
.arc__note { margin: 0; padding: 8px 10px; border-radius: var(--r-input, 8px); background: var(--surface-2); color: var(--ink-2); font-size: 12.5px; }
.arc__load-error { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
.arc__rows { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 8px; }
.arc__row { display: grid; grid-template-columns: minmax(90px, 160px) minmax(0, 1fr) auto; gap: 8px; align-items: start; }
.arc__who { font: 600 13px/1.3 var(--font-ui); color: var(--ink); padding-top: 9px; overflow-wrap: anywhere; }
.arc__when { height: auto; min-height: 38px; padding: 8px 10px; line-height: 1.4; resize: vertical; }
.arc__when:disabled, .arc__select:disabled { opacity: .7; cursor: not-allowed; }
.arc__empty { margin: 0; }
.arc__add { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; }
.arc__add .arc__select { flex: 1 1 180px; width: auto; min-width: 0; }
.arc__select { height: 34px; font-size: 13px; padding: 0 8px; }
.arc__suggest { margin-left: auto; }
.arc__drafts { border: 1px dashed var(--border); border-radius: var(--r-input, 8px); padding: 10px 12px; display: flex; flex-direction: column; gap: 8px; }
.arc__drafts-title { margin: 0; font: 600 12.5px/1.3 var(--font-ui); color: var(--ink); }
.arc__draft-list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 6px; }
.arc__draft { display: flex; flex-wrap: wrap; gap: 6px; font-size: 13px; color: var(--ink); }
.arc__draft strong { font-weight: 600; }
.arc__settings { display: flex; flex-direction: column; gap: 10px; }
.arc__field { display: flex; flex-direction: column; gap: 6px; max-width: 360px; }
.arc__switch, .arc__radio { display: flex; align-items: flex-start; gap: 8px; font-size: 13px; color: var(--ink); cursor: pointer; }
.arc__switch input, .arc__radio input { margin: 2px 0 0; accent-color: var(--brand); width: 16px; height: 16px; flex: none; }
.arc__switch input:focus-visible, .arc__radio input:focus-visible { outline: 2px solid var(--brand); outline-offset: 2px; }
.arc__mode { border: 0; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 6px; }
.arc__actions { display: flex; flex-wrap: wrap; gap: 8px; }
.arc__footer { justify-content: flex-end; }

@media (max-width: 520px) {
    .arc { padding: 12px; }
    .arc__row { grid-template-columns: minmax(0, 1fr) auto; }
    .arc__who { grid-column: 1 / -1; padding-top: 0; }
    .arc__suggest { margin-left: 0; }
    .arc__footer .ah-btn { width: 100%; }
}
</style>
