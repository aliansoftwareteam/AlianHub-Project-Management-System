<template>
    <div class="ai-detail ah-scroll" data-test="approval-detail">
        <button type="button" class="ah-btn ah-btn--ghost ah-btn--sm ai-back" @click="$emit('back')">
            <ShellIcon name="chevronLeft" :size="14" />{{ $t('Ai.back_to_queue') }}
        </button>

        <div class="ai-detail__crumb">
            <span>{{ approval.run?.name || approval.workflowId || $t('Workflows.run_title') }}</span>
            <span>· {{ $t('Workflows.approval_step', { stepId: approval.stepId }) }}</span>
        </div>
        <h2 class="ai-detail__what">{{ approval.title || $t('Workflows.approval_untitled') }}</h2>

        <p v-if="approval.prompt" class="ai-detail__why" data-test="approval-prompt">{{ approval.prompt }}</p>

        <dl class="wf-approval__meta">
            <dt>{{ $t('Workflows.approval_owner') }}</dt>
            <dd data-test="approval-owner">{{ ownerLabel }}</dd>
            <dt>{{ $t('Workflows.approval_deadline') }}</dt>
            <dd data-test="approval-deadline">{{ deadlineLabel }}</dd>
            <dt>{{ $t('Workflows.approval_escalation') }}</dt>
            <dd data-test="approval-escalation">{{ escalationLabel }}</dd>
        </dl>

        <template v-if="handovers.length">
            <div class="ah-label">{{ $t('Workflows.approval_handovers') }}</div>
            <ul class="wf-approval__handovers" data-test="approval-handovers">
                <li v-for="(move, i) in handovers" :key="i" class="ah-small">{{ handoverLine(move) }}</li>
            </ul>
        </template>

        <router-link class="ah-btn ah-btn--ghost ah-btn--sm wf-approval__link" :to="lineageLink" data-test="approval-lineage-link">
            {{ $t('Workflows.lineage_open') }}
        </router-link>

        <div v-if="error" class="ah-field__error" style="margin-top:12px" data-test="approval-error">{{ error }}</div>

        <div v-if="!decidable" class="ah-small wf-approval__read-only" data-test="approval-read-only">{{ $t('Workflows.approval_read_only') }}</div>
        <div v-else-if="!reassigning" class="ai-actions" data-test="approval-actions">
            <button type="button" class="ah-btn ah-btn--primary" :disabled="busy" data-test="approval-approve" @click="answer('approved')">{{ $t('Workflows.approval_approve') }}</button>
            <button type="button" class="ah-btn ah-btn--ghost" :disabled="busy" data-test="approval-reject" @click="answer('rejected')">{{ $t('Workflows.approval_reject') }}</button>
            <button type="button" class="ah-btn ah-btn--secondary" :disabled="busy" data-test="approval-reassign-open" @click="openReassign">{{ $t('Workflows.approval_reassign') }}</button>
        </div>
        <div v-else class="wf-approval__reassign" data-test="approval-reassign">
            <div class="ah-label">{{ $t('Workflows.approval_reassign_title') }}</div>
            <p class="ah-small">{{ $t('Workflows.approval_reassign_lead') }}</p>
            <select v-model="toUserId" class="ah-input" :aria-label="$t('Workflows.approval_reassign_to')" data-test="approval-reassign-to">
                <option value="">{{ $t('Workflows.approval_reassign_pick') }}</option>
                <option v-for="person in people" :key="person._id" :value="person._id">{{ person.name }}</option>
            </select>
            <input
                v-model.trim="reason"
                type="text"
                class="ah-input"
                maxlength="200"
                :placeholder="$t('Workflows.approval_reassign_reason')"
                :aria-label="$t('Workflows.approval_reassign_reason')"
                data-test="approval-reassign-reason"
            />
            <div class="ai-actions">
                <button type="button" class="ah-btn ah-btn--primary" :disabled="busy || !toUserId" data-test="approval-reassign-send" @click="hand">{{ $t('Workflows.approval_reassign') }}</button>
                <button type="button" class="ah-btn ah-btn--ghost" :disabled="busy" data-test="approval-reassign-cancel" @click="reassigning = false">{{ $t('Ai.cancel') }}</button>
            </div>
        </div>
    </div>
</template>

<script setup>
import { computed, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import { useRoute } from "vue-router";
import { useStore } from "vuex";
import moment from "moment";
import ShellIcon from "@/components/organisms/Shell/ShellIcon.vue";
import { canDecide, deadlineOf, escalationOf, handoversOf, ownerOf } from "./workflowApprovals";

defineOptions({ name: "WorkflowApprovalDetail" });

const props = defineProps({
    approval: { type: Object, required: true },
    busy: { type: Boolean, default: false },
    error: { type: String, default: "" }
});

const emit = defineEmits(["back", "decide", "reassign"]);

const { t } = useI18n();
const route = useRoute();
const { getters } = useStore();

const reassigning = ref(false);
const toUserId = ref("");
const reason = ref("");

watch(() => props.approval?._id, () => {
    reassigning.value = false;
    toUserId.value = "";
    reason.value = "";
});

const decidable = computed(() => canDecide(props.approval));

const owner = computed(() => ownerOf(props.approval));
const ownerLabel = computed(() => {
    const { name, userId, role } = owner.value;
    if (name) return name;
    if (userId) return t("Workflows.approval_owner_unknown", { id: String(userId).slice(-6) });
    return role ? t("Workflows.approval_owner_role", { role }) : t("Workflows.approval_owner_none");
});

const deadline = computed(() => deadlineOf(props.approval));
const deadlineLabel = computed(() => {
    if (!deadline.value) return t("Workflows.approval_deadline_none");
    const when = moment(deadline.value.at).format("D MMM, H:mm");
    if (deadline.value.overdue) return t("Workflows.approval_deadline_overdue", { at: when });
    return t("Workflows.approval_deadline_at", { at: when, away: moment(deadline.value.at).fromNow() });
});

const escalation = computed(() => escalationOf(props.approval));
const escalationLabel = computed(() => {
    const path = escalation.value;
    if (!path) return t("Workflows.approval_escalation_none");
    const who = path.name || t("Workflows.approval_escalation_someone");
    if (path.escalated) return t("Workflows.approval_escalation_done", { who, at: moment(path.escalatedAt).fromNow() });
    if (!path.at) return t("Workflows.approval_escalation_to", { who });
    return t("Workflows.approval_escalation_at", { who, at: moment(path.at).format("D MMM, H:mm") });
});

const handovers = computed(() => handoversOf(props.approval));
const handoverLine = (move) => t("Workflows.approval_handover_line", {
    by: move.byName || t("Workflows.approval_handover_system"),
    from: move.fromName || t("Workflows.approval_owner_none"),
    to: move.toName || t("Workflows.approval_escalation_someone"),
    at: move.at ? moment(move.at).format("D MMM, H:mm") : ""
});

/* The people a request can be handed to are the company's own, less whoever
 * holds it now: handing it to its owner is not a handover. */
const people = computed(() => (getters["users/users"] || [])
    .filter((user) => String(user._id) !== String(owner.value.userId))
    .map((user) => ({ _id: String(user._id), name: user.Employee_Name || String(user._id).slice(-6) })));

const lineageLink = computed(() => ({ name: "WorkflowLineage", params: { cid: route.params.cid, id: props.approval.runId } }));

const answer = (decision) => emit("decide", { approval: props.approval, decision });

const openReassign = () => {
    toUserId.value = "";
    reason.value = "";
    reassigning.value = true;
};

const hand = () => {
    emit("reassign", { approval: props.approval, toUserId: toUserId.value, reason: reason.value });
    reassigning.value = false;
};
</script>
