<template>
    <section v-if="visible" class="hc-card hwait" data-test="waiting-card" :aria-label="$t('Home.card_waiting')">
        <div class="hc-card__head">
            <span class="hc-card__title">{{ $t('Home.card_waiting') }}</span>
            <span class="ah-chip ah-chip--brand ah-chip--mono" data-test="waiting-count">{{ items.length }}</span>
            <button type="button" class="hwait__hide" data-test="waiting-hide" :aria-label="$t('Home.hide_card')" :title="$t('Home.hide_card')" @click="$emit('hide')">
                <ShellIcon name="x" :size="13" />
            </button>
        </div>
        <ul class="hwait__list">
            <li v-for="item in top" :key="`${item.kind}:${item.id}`" class="hwait__row" :class="{ 'is-open': isReviewing(item) }" data-test="waiting-row">
                <div class="hwait__text">
                    <span class="hwait__what">{{ item.what }}</span>
                    <span class="hwait__who">{{ item.who }}</span>
                    <span v-if="item.kind === 'proposal'" class="hwait__why" data-test="waiting-why"><span class="ah-label">{{ $t('Ai.why') }}</span> {{ item.why || $t('Time.why_no_reason') }}</span>
                </div>
                <div class="hwait__actions">
                    <button
                        v-if="item.plan"
                        type="button"
                        class="ah-btn ah-btn--primary ah-btn--sm"
                        data-test="waiting-review"
                        :aria-expanded="String(isReviewing(item))"
                        :aria-controls="partsId(item)"
                        :aria-label="$t('Home.waiting_review_named', { what: item.what })"
                        @click="toggleReview(item)"
                    >{{ $t('Home.waiting_review_parts') }}</button>
                    <button v-else type="button" class="ah-btn ah-btn--primary ah-btn--sm" data-test="waiting-approve" :disabled="busy" :aria-label="$t('Home.waiting_approve_named', { what: item.what })" @click="approve(item)">{{ $t('Inbox.approve') }}</button>
                    <button v-if="hasInbox" type="button" class="ah-btn ah-btn--secondary ah-btn--sm" data-test="waiting-open" :aria-label="$t(inQueueTab(item) ? 'Inbox.queue_open_named' : 'Home.waiting_open_named', { what: item.what })" @click="openItem(item)">{{ $t('Inbox.open') }}</button>
                </div>
                <div v-if="isReviewing(item)" :id="partsId(item)" class="hwait__parts" data-test="waiting-parts">
                    <template v-for="(change, i) in item.plan" :key="i">
                        <IntentPreview
                            v-if="change.preview"
                            :preview="change.preview"
                            choosable
                            :left-out="plans.leftOutOf(item.id, i)"
                            :disabled="busy"
                            @update:left-out="plans.setLeftOut(item.id, i, $event)"
                        />
                        <span v-else class="hwait__change">{{ changeLabel(t, change) }}</span>
                    </template>
                    <button type="button" class="ah-btn ah-btn--primary ah-btn--sm" data-test="waiting-parts-approve" :disabled="busy" :aria-label="$t('Home.waiting_approve_named', { what: item.what })" @click="approve(item)">{{ $t('Inbox.approve') }}</button>
                </div>
            </li>
        </ul>
        <router-link v-if="hasInbox" class="hwait__inbox" data-test="waiting-inbox" :to="allWaiting.to">
            {{ $t(allWaiting.label) }}
        </router-link>
    </section>
</template>

<script setup>
import { computed, inject, onMounted, ref, watch } from "vue";
import { useRouter } from "vue-router";
import { useStore } from "vuex";
import { useI18n } from "vue-i18n";
import { useToast } from "vue-toast-notification";
import ShellIcon from "@/components/organisms/Shell/ShellIcon.vue";
import IntentPreview from "@/components/molecules/IntentPreview/IntentPreview.vue";
import { hasParts } from "@/components/molecules/IntentPreview/planPicks";
import { usePlanChoices } from "@/components/molecules/IntentPreview/planChoices";
import { laterLine, unappliedOf } from "@/views/Inbox/approvalQueue";
import { changeLabel } from "@/views/Ai/agentActionLabels";
import { aiOff } from "@/composable/aiAvailability";
import { fetchPendingProposals, sendProposalDecision } from "@/composable/agentProposals";
import { showProjects } from "@/composable/approvedProjects";
import { madeProjectIds } from "@/composable/approvedProjectIds";
import { useWorkflowApprovals } from "@/views/Ai/useWorkflowApprovals";
import { canDecide as canDecideApproval } from "@/views/Ai/workflowApprovals";
import { useAgentAccess } from "@/views/Ai/agentAccess";
import { proposalTitle } from "@/views/Ai/plainLabels";
import { findingReasons } from "@/views/Projects/ProjectDetail/findingText";

defineOptions({ name: "WaitingOnYouCard" });
const emit = defineEmits(["hide", "count"]);

const SHOWN = 3;
const GATE_OWNER_ADMIN = "owner_admin";

const router = useRouter();
const store = useStore();
const { t } = useI18n();
const $toast = useToast();
const companyId = inject("$companyId");
const { canManage } = useAgentAccess();
const workflow = useWorkflowApprovals();

const items = ref([]);
const loaded = ref(false);
const busy = ref(false);

const hasInbox = computed(() => router.hasRoute("AiInbox"));
const visible = computed(() => !aiOff.value && loaded.value && items.value.length > 0);
const top = computed(() => items.value.slice(0, SHOWN));

const time = (value) => (value ? new Date(value).getTime() || 0 : 0);

/* The server has the last word on every decision; this only keeps off the card what the AI Inbox would lock. */
const mine = (p) => (typeof p.locked === "boolean" ? !p.locked : p.gate !== GATE_OWNER_ADMIN || canManage.value);
const whyOf = (p) => (p.finding && findingReasons(t, p.finding).join(" · ")) || p.why || "";
const planOf = (p) => (!p.batch && hasParts(p.changes) ? p.changes : null);
const fromProposal = (p) => ({ kind: "proposal", id: String(p._id), what: proposalTitle(t, p) || t("Home.waiting_untitled"), who: p.agentName || "", why: whyOf(p), at: time(p.createdAt), source: p, plan: planOf(p) });
const fromApproval = (a) => ({ kind: "approval", id: String(a._id), what: a.title || t("Workflows.approval_untitled"), who: a.run?.name || a.ownerName || "", at: time(a.createdAt || a.deadlineAt), source: a });

async function load() {
    if (aiOff.value) return;
    const [proposals] = await Promise.allSettled([fetchPendingProposals(), workflow.load()]);
    const decidable = proposals.status === "fulfilled"
        ? proposals.value.filter((p) => p.status === "pending" && mine(p)).map(fromProposal)
        : [];
    const approvals = workflow.approvals.value.filter(canDecideApproval).map(fromApproval);
    items.value = [...decidable, ...approvals].sort((a, b) => b.at - a.at);
    loaded.value = true;
}

const drop = (item) => { items.value = items.value.filter((x) => !(x.kind === item.kind && x.id === item.id)); };

const plans = usePlanChoices();
const reviewing = ref("");
const isReviewing = (item) => Boolean(item.plan) && reviewing.value === item.id;
const partsId = (item) => `hwait-parts-${item.id}`;
const toggleReview = (item) => { reviewing.value = isReviewing(item) ? "" : item.id; };

async function approve(item) {
    busy.value = true;
    try {
        let later = "";
        let unapplied = [];
        if (item.kind === "proposal") {
            const res = await sendProposalDecision(item.id, "approve", item.plan ? plans.bodyFor(item.id, item.plan) : {});
            if (!res?.data?.status) throw new Error(res?.data?.statusText || t("Inbox.action_failed"));
            showProjects(store, madeProjectIds(res.data.data));
            later = laterLine(t, res.data.data);
            unapplied = unappliedOf(res.data.data);
            plans.forget(item.id);
        } else {
            await workflow.decide(item.source, "approved");
        }
        drop(item);
        if (unapplied.length) $toast.error(t("Ai.applied_with_failures", { n: unapplied.length, error: unapplied[0].error }), { position: "top-right" });
        else $toast.success(t("Home.waiting_approved"), { position: "top-right" });
        if (later) {
            $toast.info(later, { position: "top-right" });
            await load().catch(() => {});
        }
    } catch (error) {
        $toast.error(error?.response?.data?.statusText || error?.message || t("Inbox.action_failed"), { position: "top-right" });
    } finally {
        busy.value = false;
    }
}

// Workflow steps are not in the Inbox's approval tab yet, so they still open where they can be answered.
const inQueueTab = (item) => item.kind === "proposal" && router.hasRoute("inbox");
const placeOf = (item) => (inQueueTab(item)
    ? { name: "inbox", params: { cid: companyId?.value ?? companyId }, query: { tab: "approval" } }
    : { name: "AiInbox", params: { cid: companyId?.value ?? companyId } });
const openItem = (item) => router.push(placeOf(item)).catch(() => {});
const allWaiting = computed(() => {
    const proposal = items.value.find(inQueueTab);
    return { to: placeOf(proposal || {}), label: proposal ? "Home.waiting_open_inbox" : "Inbox.open_ai_inbox" };
});

watch(aiOff, (off) => { if (!off && !loaded.value) load().catch(() => {}); });
watch(() => (visible.value ? items.value.length : 0), (count) => emit("count", count), { immediate: true });
onMounted(() => { load().catch(() => {}); });
</script>

<style scoped>
.hwait__hide {
    width: var(--control-h, 26px); height: var(--control-h, 26px); display: grid; place-items: center; flex: none;
    border: 0; border-radius: var(--r-chip); background: transparent; color: var(--ink-2); cursor: pointer;
}
.hwait__hide:hover { background: var(--surface-hover); color: var(--ink); }
.hwait__hide:focus-visible { outline: none; box-shadow: var(--focus); }
.hwait__list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; }
.hwait__row { display: flex; align-items: center; gap: 10px; padding: 8px 0; border-bottom: 1px solid var(--hairline); min-width: 0; }
.hwait__row:last-child { border-bottom: 0; }
.hwait__text { display: flex; flex-direction: column; gap: 2px; min-width: 0; flex: 1 1 auto; }
.hwait__what { font: 500 var(--fs-md, 13px)/1.35 var(--font-ui); color: var(--ink); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.hwait__who { font: 400 var(--fs-sm, 11.5px)/1.3 var(--font-ui); color: var(--ink-2); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.hwait__why { font: 400 var(--fs-sm, 11.5px)/1.35 var(--font-ui); color: var(--ink-2); overflow-wrap: anywhere; }
.hwait__actions { display: flex; gap: 6px; flex: none; }
.hwait__row.is-open { flex-wrap: wrap; }
.hwait__row.is-open .hwait__text { flex-basis: 0; }
.hwait__parts { flex: 1 1 100%; display: flex; flex-direction: column; gap: 6px; min-width: 0; }
.hwait__parts > .ah-btn { align-self: flex-start; }
.hwait__change { font: 400 var(--fs-sm, 11.5px)/1.4 var(--font-ui); color: var(--ink); overflow-wrap: anywhere; }
.hwait__inbox { align-self: flex-start; display: inline-flex; align-items: center; min-height: var(--hit-min); font: 600 var(--fs-md, 12.5px)/1.2 var(--font-ui); color: var(--brand); text-decoration: none; }
.hwait__inbox:hover { text-decoration: underline; }
@media (max-width: 767px) {
    .hwait__row { flex-wrap: wrap; }
    .hwait__actions { width: 100%; }
    .hwait__actions .ah-btn { flex: 1 1 0; min-height: 44px; }
    .hwait__parts > .ah-btn { align-self: stretch; min-height: 44px; }
    .hwait__hide { width: 44px; height: 44px; }
}
</style>
