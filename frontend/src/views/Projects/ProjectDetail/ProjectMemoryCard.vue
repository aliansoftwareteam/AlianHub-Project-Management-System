<template>
    <section class="ah-card pm" data-test="project-memory">
        <div class="pm__head">
            <span class="ah-label">{{ $t('Memory.title') }}</span>
            <span class="ah-small pm__lead">{{ $t('Memory.lead') }}</span>
            <button v-if="privileged && !loading && !error && !adding" type="button" class="ah-btn ah-btn--ghost ah-btn--sm pm__add-btn" data-test="add" @click="openAdd">{{ $t('Memory.add') }}</button>
        </div>

        <div v-if="loading" class="ah-empty">{{ $t('Memory.loading') }}</div>
        <EmptyState v-else-if="error" :title="$t('Memory.load_failed')" :message="error" :action-label="$t('Memory.retry')" @action="reload" />
        <template v-else>
            <div v-if="guide" class="pm__section" data-test="guide">
                <div class="pm__section-title">{{ $t('Memory.guide') }}</div>
                <ol v-if="stages.length" class="pm__stages">
                    <li v-for="(s, i) in stages" :key="i"><strong>{{ s.name }}</strong><span v-if="s.goal" class="pm__goal"> — {{ s.goal }}</span></li>
                </ol>
                <div v-if="essentials.length" class="pm__sub">
                    <div class="pm__sub-title">{{ $t('Memory.guide_essentials') }}</div>
                    <ul class="pm__list"><li v-for="(e, i) in essentials" :key="i">{{ e }}</li></ul>
                </div>
                <div v-if="escalations.length" class="pm__sub">
                    <div class="pm__sub-title">{{ $t('Memory.guide_escalations') }}</div>
                    <ul class="pm__list"><li v-for="(e, i) in escalations" :key="i">{{ e }}</li></ul>
                </div>
                <details v-if="guide.markdown" class="pm__details">
                    <summary class="pm__details-trigger">{{ $t('Memory.guide_markdown') }}</summary>
                    <pre class="pm__markdown">{{ guide.markdown }}</pre>
                </details>
            </div>

            <div v-if="assumptions.length" class="pm__section" data-test="assumptions">
                <div class="pm__section-title">{{ $t('Memory.assumptions') }}</div>
                <ul class="pm__list"><li v-for="(a, i) in assumptions" :key="i">{{ a.text }}</li></ul>
            </div>

            <div v-if="rows.length || adding || !empty" class="pm__section" data-test="rows">
                <div class="pm__section-title">{{ $t('Memory.rows') }}</div>
                <form v-if="adding" class="pm__add" data-test="add-form" @submit.prevent="submitAdd">
                    <select v-model="draft.kind" class="ah-input pm__kind" :aria-label="$t('Memory.kind')" data-test="add-kind">
                        <option value="project.decision">{{ $t('Memory.kind_decision') }}</option>
                        <option value="project.constraint">{{ $t('Memory.kind_constraint') }}</option>
                    </select>
                    <input v-model.trim="draft.text" type="text" class="ah-input pm__add-text" maxlength="300" :placeholder="$t('Memory.add_placeholder')" :aria-label="$t('Memory.add_text')" data-test="add-text" />
                    <button type="submit" class="ah-btn ah-btn--primary ah-btn--sm" :disabled="busy || !draft.text" data-test="add-save">{{ busy ? $t('Memory.saving') : $t('Memory.save') }}</button>
                    <button type="button" class="ah-btn ah-btn--ghost ah-btn--sm" :disabled="busy" @click="adding = false">{{ $t('Memory.cancel') }}</button>
                </form>
                <div v-if="actionError" class="ah-field__error" data-test="action-error">{{ actionError }}</div>
                <ul v-if="visibleRows.length" class="pm__rows">
                    <li v-for="row in visibleRows" :key="row.id" class="pm__row" :class="{ 'is-retired': row.status === 'retired' }" data-test="memory-row" :data-status="row.status">
                        <span class="ah-chip" :class="kindChip(row.kind)">{{ $t(`Memory.kind_${kindKey(row.kind)}`) }}</span>
                        <span class="ah-chip ah-chip--mono" data-test="source">{{ $t(`Memory.source_${originKey(row.source)}`) }}</span>
                        <template v-if="editingId === row.id">
                            <input v-model.trim="editText" type="text" class="ah-input pm__edit" maxlength="300" :aria-label="$t('Memory.edit_text')" data-test="edit-text" @keydown.enter.prevent="saveEdit(row)" @keydown.esc="editingId = ''" />
                            <button type="button" class="ah-btn ah-btn--primary ah-btn--sm" :disabled="busy || !editText" data-test="edit-save" @click="saveEdit(row)">{{ $t('Memory.save') }}</button>
                            <button type="button" class="ah-btn ah-btn--ghost ah-btn--sm" :disabled="busy" @click="editingId = ''">{{ $t('Memory.cancel') }}</button>
                        </template>
                        <template v-else>
                            <span class="pm__text">{{ row.text }}</span>
                            <span v-if="Number(row.occurrences) > 1" class="ah-small ah-mono" :title="$t('Memory.seen_n', { n: row.occurrences })">×{{ row.occurrences }}</span>
                            <span v-if="row.status === 'retired'" class="ah-chip ah-chip--dark">{{ $t('Memory.retired') }}</span>
                            <template v-if="privileged">
                                <template v-if="row.status !== 'retired'">
                                    <button type="button" class="ah-btn ah-btn--ghost ah-btn--sm" :disabled="busy" data-test="edit" @click="startEdit(row)">{{ $t('Memory.edit') }}</button>
                                    <button type="button" class="ah-btn ah-btn--ghost ah-btn--sm" :disabled="busy" data-test="retire" @click="retire(row)">{{ $t('Memory.retire') }}</button>
                                </template>
                                <button v-else type="button" class="ah-btn ah-btn--ghost ah-btn--sm" :disabled="busy" data-test="restore" @click="restore(row)">{{ $t('Memory.restore') }}</button>
                            </template>
                        </template>
                    </li>
                </ul>
                <p v-else-if="!adding" class="ah-small pm__none">{{ $t('Memory.no_rows') }}</p>
                <button v-if="retiredRows.length" type="button" class="ah-btn ah-btn--ghost ah-btn--sm pm__toggle" data-test="toggle-retired" @click="showRetired = !showRetired">{{ showRetired ? $t('Memory.hide_retired') : $t('Memory.show_retired', { n: retiredRows.length }) }}</button>
            </div>

            <div v-if="episodes.length" class="pm__section" data-test="episodes">
                <div class="pm__section-title">{{ $t('Memory.recent_runs') }}</div>
                <ul class="pm__episodes">
                    <li v-for="e in episodes" :key="e.runId" class="pm__episode">
                        <span class="ah-mono pm__at">{{ when(e.at) }}</span>
                        <span class="pm__skill">{{ e.skill }}</span>
                        <span v-if="e.taskTitle" class="pm__task">· {{ e.taskTitle }}</span>
                        <span v-if="e.summary" class="ah-small">{{ e.summary }}</span>
                    </li>
                </ul>
            </div>

            <p v-if="empty && !adding" class="ah-small pm__empty" data-test="empty">{{ $t('Memory.empty') }}</p>
        </template>
    </section>
</template>

<script setup>
import { computed, reactive, ref, watch } from "vue";
import { useStore } from "vuex";
import EmptyState from "@/components/atom/EmptyState/EmptyState.vue";
import { useProjectMemory } from "@/views/Ai/useProjectMemory";

defineOptions({ name: "ProjectMemoryCard" });

const props = defineProps({ projectId: { type: String, required: true } });

const ORIGIN_KEYS = { brief: "brief", "proposal.approve": "approved", owner: "owner", run: "run" };

const { getters } = useStore();
const { guide, assumptions, rows, episodes, loading, error, load, addRow, updateRow, retireRow } = useProjectMemory();

const adding = ref(false);
const busy = ref(false);
const actionError = ref("");
const editingId = ref("");
const editText = ref("");
const showRetired = ref(false);
const draft = reactive({ kind: "project.decision", text: "" });

const list = (v) => (Array.isArray(v) ? v : []);
const privileged = computed(() => [1, 2].includes(Number(getters["settings/companyUserDetail"]?.roleType)));
const stages = computed(() => list(guide.value?.stages).filter((s) => s && s.name));
const essentials = computed(() => list(guide.value?.essentials));
const escalations = computed(() => list(guide.value?.escalations));
const activeRows = computed(() => rows.value.filter((r) => r.status !== "retired"));
const retiredRows = computed(() => rows.value.filter((r) => r.status === "retired"));
const visibleRows = computed(() => (showRetired.value ? rows.value : activeRows.value));
const empty = computed(() => !guide.value && !assumptions.value.length && !rows.value.length && !episodes.value.length);

const kindKey = (kind) => (String(kind || "").endsWith("constraint") ? "constraint" : "decision");
const kindChip = (kind) => (kindKey(kind) === "constraint" ? "ah-chip--warn" : "ah-chip--brand");
const originKey = (source) => ORIGIN_KEYS[source?.origin] || "other";
const when = (at) => (at ? new Date(at).toLocaleDateString() : "");

const reload = () => load(props.projectId);

const attempt = async (fn) => {
    busy.value = true;
    actionError.value = "";
    try {
        await fn();
        return true;
    } catch (e) {
        actionError.value = e.message;
        return false;
    } finally {
        busy.value = false;
    }
};

const openAdd = () => {
    draft.kind = "project.decision";
    draft.text = "";
    actionError.value = "";
    adding.value = true;
};

const submitAdd = async () => {
    if (!draft.text) return;
    if (await attempt(() => addRow(props.projectId, { kind: draft.kind, text: draft.text }))) {
        adding.value = false;
        draft.text = "";
    }
};

const startEdit = (row) => {
    editingId.value = row.id;
    editText.value = row.text;
    actionError.value = "";
};

const saveEdit = async (row) => {
    if (!editText.value) return;
    if (editText.value === row.text || await attempt(() => updateRow(row.id, { scopeId: props.projectId, text: editText.value }))) editingId.value = "";
};

const retire = (row) => attempt(() => retireRow(row.id, props.projectId));
const restore = (row) => attempt(() => updateRow(row.id, { scopeId: props.projectId, status: "active" }));

watch(() => props.projectId, (id) => {
    adding.value = false;
    editingId.value = "";
    showRetired.value = false;
    if (id) reload();
}, { immediate: true });
</script>

<style scoped>
.pm { margin-top: 20px; padding: 14px 16px; display: flex; flex-direction: column; gap: 12px; }
.pm__head { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
.pm__lead { flex: 1; min-width: 160px; }
.pm__add-btn { margin-left: auto; }
.pm__section { display: flex; flex-direction: column; gap: 6px; }
.pm__section + .pm__section { padding-top: 12px; border-top: 1px solid var(--hairline); }
.pm__section-title { font: 600 13px/1.2 var(--font-ui); color: var(--ink); }
.pm__sub-title { font: var(--text-label); letter-spacing: .06em; text-transform: uppercase; color: var(--ink-3); margin: 6px 0 2px; }
.pm__stages, .pm__list { margin: 0; padding-left: 18px; font: var(--text-small); color: var(--ink); line-height: 1.5; }
.pm__goal { color: var(--ink-2); }
.pm__details-trigger { cursor: pointer; font: var(--text-small); color: var(--brand); font-weight: 500; list-style: none; }
.pm__details-trigger::-webkit-details-marker { display: none; }
.pm__markdown { margin: 8px 0 0; padding: 10px 12px; border: 1px solid var(--hairline); border-radius: 9px; background: var(--surface-2); font: 12.5px/1.55 var(--font-mono); color: var(--ink); white-space: pre-wrap; }
.pm__add { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.pm__kind { width: auto; height: 32px; padding: 0 8px; }
.pm__add-text, .pm__edit { flex: 1; min-width: 200px; height: 32px; }
.pm__rows { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 6px; }
.pm__row { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; font: var(--text-small); color: var(--ink); }
.pm__row.is-retired .pm__text { color: var(--ink-3); text-decoration: line-through; }
.pm__text { flex: 1; min-width: 160px; }
.pm__none, .pm__empty { margin: 0; }
.pm__toggle { align-self: flex-start; }
.pm__episodes { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 4px; }
.pm__episode { display: flex; align-items: baseline; gap: 8px; flex-wrap: wrap; font: var(--text-small); color: var(--ink); }
.pm__at { color: var(--ink-3); }
.pm__task { color: var(--ink-2); }
</style>
