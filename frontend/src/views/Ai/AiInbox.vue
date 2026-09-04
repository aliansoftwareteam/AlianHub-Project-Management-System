<template>
    <div class="ah-page ai-page">
        <AiSidebar />
        <div class="ai-page__main">
            <div class="ah-toolbar">
                <div class="ah-toolbar__title">{{ $t('Ai.inbox') }}</div>
                <div class="ah-toolbar__spacer"></div>
                <span v-if="undo" class="ah-chip ah-chip--ok">
                    {{ $t('Ai.approved') }}
                    <button type="button" class="ah-btn ah-btn--ghost ah-btn--sm" @click="onUndo">{{ $t('Ai.undo') }}</button>
                </span>
            </div>

            <div class="ai-inbox" :class="{ 'ai-inbox--detail': selected }">
                <div class="ai-inbox__list ah-scroll">
                    <div class="ai-inbox__tabs">
                        <div class="ah-tabs">
                            <button v-for="tab in tabs" :key="tab.key" type="button" class="ah-tab" :class="{ 'is-active': bucket === tab.key }" @click="switchBucket(tab.key)">
                                {{ $t(tab.label) }}<span v-if="tab.count" class="ai-side__count ah-mono">{{ tab.count }}</span>
                            </button>
                        </div>
                    </div>

                    <div v-if="loading" class="ah-empty" style="margin:14px">{{ $t('Ai.loading') }}</div>
                    <div v-else-if="!proposals.length" class="ai-done">
                        <div class="ai-done__n ah-mono">{{ counts.approved || 0 }}</div>
                        <p class="ah-h3">{{ $t('Ai.queue_clear') }}</p>
                        <p class="ah-small">{{ $t('Ai.queue_clear_body', { approved: counts.approved || 0, declined: counts.declined || 0 }) }}</p>
                    </div>

                    <button
                        v-for="p in proposals"
                        v-else
                        :key="p._id"
                        type="button"
                        class="ai-item"
                        :class="{ 'is-active': selected && selected._id === p._id }"
                        @click="selected = p"
                    >
                        <div class="ai-item__top">
                            <span class="ai-item__agent">{{ p.agentName }}</span>
                            <span v-if="p.gate" class="ah-chip ah-chip--warn ah-chip--mono">{{ $t('Ai.gated') }}</span>
                            <span class="ai-item__time ah-mono">{{ shortTime(p.createdAt) }}</span>
                        </div>
                        <div class="ai-item__what">{{ p.what }}</div>
                        <div class="ai-item__why">{{ p.why }}</div>
                    </button>
                </div>

                <div v-if="!selected" class="ai-detail ai-detail__empty">
                    <span class="ah-small">{{ $t('Ai.pick_one') }}</span>
                </div>

                <div v-else class="ai-detail ah-scroll">
                    <button type="button" class="ah-btn ah-btn--ghost ah-btn--sm ai-back" @click="selected = null">
                        <ShellIcon name="chevronLeft" :size="14" />{{ $t('Ai.back_to_queue') }}
                    </button>

                    <div class="ai-detail__crumb">
                        <span>{{ selected.agentName }}</span>
                        <span v-if="selected.runId">· {{ $t('Ai.run_n', { n: String(selected.runId).slice(-4) }) }}</span>
                        <span>· {{ shortTime(selected.createdAt) }}</span>
                    </div>
                    <h2 class="ai-detail__what">{{ selected.what }}</h2>

                    <div class="ah-label">{{ $t('Ai.why') }}</div>
                    <p class="ai-detail__why">{{ selected.why }}</p>

                    <div class="ah-label">{{ changesLabel }}</div>
                    <div v-for="(change, i) in editable" :key="i" class="ai-change">
                        <ShellIcon :name="change.reversible ? 'check' : 'alert'" :size="14" :class="change.reversible ? 'ah-muted' : ''" />
                        <span class="ai-change__label">{{ change.label }}</span>
                        <span v-if="!change.reversible" class="ah-chip ah-chip--warn">{{ $t('Ai.not_reversible') }}</span>
                        <button v-if="editing" type="button" class="ah-btn ah-btn--ghost ah-btn--sm" @click="editable.splice(i, 1)">{{ $t('Ai.drop') }}</button>
                    </div>

                    <div v-if="selected.gate" class="auth__banner auth__banner--warn" style="margin-top:14px">
                        <ShellIcon name="shield" :size="15" />
                        <span>{{ $t('Ai.gate_note') }}</span>
                    </div>

                    <div v-if="error" class="ah-field__error" style="margin-top:12px">{{ error }}</div>

                    <div class="ai-actions">
                        <button type="button" class="ah-btn ah-btn--primary" :disabled="busy || !editable.length" @click="onApprove">{{ $t('Ai.approve') }}</button>
                        <button type="button" class="ah-btn ah-btn--secondary" :disabled="busy" @click="editing = !editing">
                            {{ editing ? $t('Ai.done_editing') : $t('Ai.edit_then_approve') }}
                        </button>
                        <button type="button" class="ah-btn ah-btn--ghost" :disabled="busy" @click="onDecline">{{ $t('Ai.decline') }}</button>
                    </div>

                    <p class="ai-cost">{{ costLine }}</p>
                </div>
            </div>
        </div>
    </div>
</template>

<script setup>
import { computed, onMounted, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import { useToast } from "vue-toast-notification";
import moment from "moment";
import ShellIcon from "@/components/organisms/Shell/ShellIcon.vue";
import AiSidebar from "./AiSidebar.vue";
import { useAgents } from "./useAgents";

defineOptions({ name: "AiInboxPage" });

const { t } = useI18n();
const $toast = useToast();
const { proposals, counts, loading, loadProposals, loadSummary, decide } = useAgents();

const bucket = ref("pending");
const selected = ref(null);
const editing = ref(false);
const editable = ref([]);
const busy = ref(false);
const error = ref("");
const undo = ref(null);

const tabs = computed(() => [
    { key: "pending", label: "Ai.waiting", count: counts.value.pending || 0 },
    { key: "done", label: "Ai.done_by_ai", count: counts.value.approved || 0 },
    { key: "declined", label: "Ai.declined", count: counts.value.declined || 0 }
]);

const changesLabel = computed(() => {
    const list = editable.value;
    const all = list.length && list.every((c) => c.reversible);
    const unit = list.length === 1 ? t("Ai.action_one") : t("Ai.action_other");
    return t("Ai.what_changes", { n: list.length, unit, note: all ? t("Ai.all_reversible") : t("Ai.some_permanent") });
});

const costLine = computed(() => {
    const c = selected.value?.cost || {};
    if (!c.tokens && !c.usd) return t("Ai.logged_to_audit");
    return t("Ai.cost_line", { tokens: c.tokens || 0, usd: Number(c.usd || 0).toFixed(2) });
});

const shortTime = (at) => {
    if (!at) return "";
    const m = moment(at);
    return m.isSame(moment(), "day") ? m.format("H:mm") : m.fromNow();
};

watch(selected, (p) => {
    editing.value = false;
    error.value = "";
    editable.value = p ? (p.changes || []).map((c) => ({ ...c })) : [];
});

const switchBucket = async (key) => {
    bucket.value = key;
    selected.value = null;
    await loadProposals(key === "pending" ? "pending" : key);
};

const afterDecision = async (message) => {
    const id = selected.value._id;
    selected.value = null;
    await Promise.all([loadProposals(bucket.value === "pending" ? "pending" : bucket.value), loadSummary()]);
    $toast.success(message, { position: "top-right" });
    return id;
};

const onApprove = async () => {
    busy.value = true;
    error.value = "";
    try {
        const original = selected.value.changes || [];
        const changed = editable.value.length !== original.length;
        const out = await decide(selected.value._id, "approve", changed ? { changes: editable.value } : {});
        const id = await afterDecision(t("Ai.applied"));
        if (out?.undoUntil) {
            undo.value = { id, until: new Date(out.undoUntil).getTime() };
            setTimeout(() => { if (undo.value && undo.value.id === id) undo.value = null; }, Math.max(0, new Date(out.undoUntil).getTime() - Date.now()));
        }
    } catch (e) {
        error.value = e.message;
    } finally {
        busy.value = false;
    }
};

const onDecline = async () => {
    busy.value = true;
    error.value = "";
    try {
        await decide(selected.value._id, "decline", {});
        await afterDecision(t("Ai.declined_done"));
    } catch (e) {
        error.value = e.message;
    } finally {
        busy.value = false;
    }
};

const onUndo = async () => {
    const id = undo.value?.id;
    undo.value = null;
    if (!id) return;
    try {
        await decide(id, "undo", {});
        await loadProposals(bucket.value === "pending" ? "pending" : bucket.value);
        $toast.success(t("Ai.undone"), { position: "top-right" });
    } catch (e) {
        $toast.error(e.message, { position: "top-right" });
    }
};

onMounted(() => loadProposals("pending"));
</script>

<style>
@import "./style.css";
.ai-back { display: none; }
@media (max-width: 900px) { .ai-back { display: inline-flex; margin-bottom: 10px; } }
</style>
