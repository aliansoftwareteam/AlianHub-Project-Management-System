<template>
    <section id="revisions" class="ah-card ai-agent ai-revisions" data-test="revision-history">
        <div class="ah-label">{{ $t('Ai.revisions_title') }}</div>
        <p class="ai-lead ai-revisions__lead">{{ $t('Ai.revisions_lead') }}</p>

        <div v-if="error" class="ah-field__error">{{ error }}</div>
        <div v-else-if="loading" class="ah-empty">{{ $t('Ai.loading') }}</div>
        <template v-else>
            <div class="ai-revisions__scroll">
                <table class="ai-revisions__table">
                    <thead>
                        <tr>
                            <th class="ai-revisions__pick">{{ $t('Ai.revision_col_from') }}</th>
                            <th class="ai-revisions__pick">{{ $t('Ai.revision_col_to') }}</th>
                            <th>{{ $t('Ai.revision_col_n') }}</th>
                            <th>{{ $t('Ai.revision_col_state') }}</th>
                            <th>{{ $t('Ai.revision_col_who') }}</th>
                            <th>{{ $t('Ai.revision_col_what') }}</th>
                            <th></th>
                        </tr>
                    </thead>
                    <tbody>
                        <tr v-for="r in ordered" :key="r.n" class="ai-revisions__row" :class="{ 'is-live': r.state === 'live', 'is-highlight': r.n === highlight }" :data-test="`revision-${r.n}`">
                            <td class="ai-revisions__pick"><input v-model.number="from" type="radio" name="rev-from" :value="r.n" class="ah-check" :aria-label="$t('Ai.revision_pick_from', { n: r.n })" /></td>
                            <td class="ai-revisions__pick"><input v-model.number="to" type="radio" name="rev-to" :value="r.n" class="ah-check" :aria-label="$t('Ai.revision_pick_to', { n: r.n })" /></td>
                            <td class="ah-mono">#{{ r.n }}</td>
                            <td><span class="ah-chip" :class="stateChip(r.state)" data-test="state">{{ $t(`Ai.revision_state_${r.state}`) }}</span></td>
                            <td class="ai-revisions__who">
                                <span>{{ whoOf(r) }}</span>
                                <span class="ah-small ah-mono">{{ when(r.createdAt) }}</span>
                            </td>
                            <td class="ai-revisions__what" data-test="what">
                                <span>{{ whatOf(r) }}</span>
                                <span v-if="r.note" class="ah-small">{{ r.note }}</span>
                            </td>
                            <td class="ai-revisions__controls">
                                <button v-if="canPromote(r)" type="button" class="ah-btn ah-btn--primary ah-btn--sm" :disabled="busy" data-test="promote" @click="promote(r)">{{ $t('Ai.revision_promote', { n: r.n, live: liveN }) }}</button>
                                <button v-else-if="r.state === 'superseded'" type="button" class="ah-btn ah-btn--secondary ah-btn--sm" :disabled="busy" data-test="rollback" @click="rollback(r)">{{ $t('Ai.revision_rollback', { n: r.n, next: nextN }) }}</button>
                            </td>
                        </tr>
                    </tbody>
                </table>
            </div>

            <div class="ai-revisions__diff" data-test="diff">
                <div class="ah-label">{{ diffTitle }}</div>
                <p v-if="!diff.length" class="ah-small ai-revisions__none">{{ $t('Ai.revision_diff_none') }}</p>
                <table v-else class="ai-revisions__table ai-revisions__difftable">
                    <thead>
                        <tr>
                            <th>{{ $t('Ai.revision_diff_field') }}</th>
                            <th>{{ fromLabel }}</th>
                            <th>{{ toLabel }}</th>
                        </tr>
                    </thead>
                    <tbody>
                        <tr v-for="d in diff" :key="d.field" data-test="diff-row">
                            <td class="ah-mono">{{ d.field }}</td>
                            <td class="ai-revisions__from">{{ d.fromText }}</td>
                            <td class="ai-revisions__to">{{ d.toText }}</td>
                        </tr>
                    </tbody>
                </table>
            </div>
        </template>
    </section>
</template>

<script setup>
import { computed, onMounted, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import { useToast } from "vue-toast-notification";
import { useAgents } from "./useAgents";
import { diffSnapshots, defaultPair } from "./revisionDiff";

defineOptions({ name: "AgentRevisionHistory" });

const props = defineProps({
    agentId: { type: String, required: true },
    highlight: { type: Number, default: null }
});
const emit = defineEmits(["changed"]);

const { t } = useI18n();
const $toast = useToast();
const { loadRevisions, promoteRevision, rollbackRevision } = useAgents();

const revisions = ref([]);
const loading = ref(true);
const busy = ref(false);
const error = ref("");
const from = ref(null);
const to = ref(null);

const ordered = computed(() => [...revisions.value].sort((a, b) => b.n - a.n));
const byN = (n) => revisions.value.find((r) => r.n === n) || null;
const liveN = computed(() => (revisions.value.find((r) => r.state === "live") || {}).n ?? null);
const nextN = computed(() => revisions.value.reduce((m, r) => Math.max(m, r.n), 0) + 1);
const previousOf = (r) => [...revisions.value].filter((x) => x.n < r.n).sort((a, b) => b.n - a.n)[0] || null;

const diff = computed(() => diffSnapshots((byN(from.value) || {}).snapshot, (byN(to.value) || {}).snapshot, t));
const fromLabel = computed(() => (from.value ? t("Ai.revision_n", { n: from.value }) : t("Ai.revision_nothing")));
const toLabel = computed(() => (to.value ? t("Ai.revision_n", { n: to.value }) : t("Ai.revision_nothing")));
const diffTitle = computed(() => t("Ai.revision_diff_title", { from: fromLabel.value, to: toLabel.value }));

const canPromote = (r) => r.state === "draft" || r.state === "candidate";
const stateChip = (state) => ({ live: "ah-chip--ok", candidate: "ah-chip--brand", draft: "ah-chip--warn", superseded: "ah-chip--dark" }[state] || "");
const when = (at) => (at ? new Date(at).toLocaleString() : "");
const whoOf = (r) => r.createdByName || r.createdBy || t("Ai.revision_by_system");

const whatOf = (r) => {
    if (r.source === "rollback" && r.rollbackOf) return t("Ai.revision_what_rollback", { n: r.rollbackOf });
    if (r.source === "migration" || r.source === "bootstrap" || r.source === "create") return t("Ai.revision_what_first");
    const prev = previousOf(r);
    const fields = diffSnapshots(prev ? prev.snapshot : {}, r.snapshot, t).map((d) => d.field);
    if (!fields.length) return t("Ai.revision_what_same");
    return t("Ai.revision_what_changed", { fields: fields.join(", ") });
};

const load = async () => {
    error.value = "";
    try {
        revisions.value = await loadRevisions(props.agentId);
        const pair = defaultPair(revisions.value);
        if (props.highlight && byN(props.highlight)) { to.value = props.highlight; from.value = (previousOf(byN(props.highlight)) || {}).n ?? null; }
        else { from.value = pair.from; to.value = pair.to; }
    } catch (e) {
        error.value = e.message;
    } finally {
        loading.value = false;
    }
};

const move = async (fn, r, doneKey) => {
    busy.value = true;
    try {
        const out = await fn(props.agentId, r.n);
        $toast.success(t(doneKey, { n: r.n, live: out?.revision?.n ?? r.n }), { position: "top-right" });
        await load();
        emit("changed", out);
    } catch (e) {
        $toast.error(e.message, { position: "top-right" });
    } finally {
        busy.value = false;
    }
};

const promote = (r) => move(promoteRevision, r, "Ai.revision_promoted");
const rollback = (r) => move(rollbackRevision, r, "Ai.revision_rolled_back");

watch(() => props.highlight, (n) => { if (n && byN(n)) { to.value = n; from.value = (previousOf(byN(n)) || {}).n ?? null; } });
onMounted(load);
</script>

<style>
.ai-revisions__lead { margin: 6px 0 12px; }
.ai-revisions__scroll { overflow-x: auto; }
.ai-revisions__table { width: 100%; border-collapse: collapse; font: var(--text-small); }
.ai-revisions__table th { text-align: left; font-weight: 600; color: var(--ink-2); padding: 6px 8px; border-bottom: 1px solid var(--hairline); white-space: nowrap; }
.ai-revisions__table td { padding: 8px; border-bottom: 1px solid var(--hairline); vertical-align: top; }
.ai-revisions__pick { width: 44px; text-align: center; }
.ai-revisions__row.is-live { background: var(--brand-tint); }
.ai-revisions__row.is-highlight td { box-shadow: inset 3px 0 0 var(--brand); }
.ai-revisions__who, .ai-revisions__what { display: flex; flex-direction: column; gap: 2px; min-width: 140px; }
.ai-revisions__who .ah-small, .ai-revisions__what .ah-small { color: var(--ink-3); }
.ai-revisions__controls { text-align: right; white-space: nowrap; }
.ai-revisions__diff { margin-top: 14px; padding-top: 12px; border-top: 1px solid var(--hairline); }
.ai-revisions__none { margin: 6px 0 0; color: var(--ink-2); }
.ai-revisions__difftable { margin-top: 8px; }
.ai-revisions__from { color: var(--ink-2); text-decoration: line-through; }
.ai-revisions__to { color: var(--ink); }
</style>
