<template>
    <section class="ah-card ai-agent agap" data-test="approval">
        <div class="agap__who">
            <span class="ah-small" data-test="agent-maker">{{ makerLine }}</span>
            <span v-if="approvedLine" class="ah-small" data-test="agent-approved-by">{{ approvedLine }}</span>
        </div>

        <div v-if="state === 'pending'" class="agap__state agap__state--warn" role="status" data-test="approval-pending">
            <strong>{{ $t('AgentAccess.pending_title') }}</strong>
            <span class="ah-small">{{ canManage ? $t('AgentAccess.pending_body_manager') : $t('AgentAccess.pending_body') }}</span>
        </div>
        <div v-else-if="state === 'declined'" class="agap__state agap__state--danger" role="status" data-test="approval-declined">
            <strong>{{ $t('AgentAccess.declined_title', { name: agent.decidedByName || $t('AgentAccess.someone') }) }}</strong>
            <span v-if="agent.approval && agent.approval.reason" class="ah-small">{{ agent.approval.reason }}</span>
            <span v-if="isMine" class="ah-small">{{ $t('AgentAccess.declined_resend') }}</span>
        </div>

        <div v-if="agent.pendingEdit" class="agap__state agap__state--warn" role="status" data-test="approval-edit">
            <strong>{{ $t('AgentAccess.edit_waiting_title', { name: agent.pendingEdit.createdByName || $t('AgentAccess.someone') }) }}</strong>
            <span class="ah-small">{{ $t('AgentAccess.edit_waiting_body') }}</span>
            <router-link v-if="canManage" class="ah-small" :to="{ query: { rev: agent.pendingEdit.n } }">{{ $t('AgentAccess.see_change') }}</router-link>
        </div>

        <div v-if="canManage && (state === 'pending' || agent.pendingEdit)" class="agap__decide">
            <label class="ah-field__label" for="agap-reason">{{ $t('AgentAccess.decline_reason') }}</label>
            <textarea id="agap-reason" v-model.trim="reason" class="ah-input ah-textarea" maxlength="500" :placeholder="$t('AgentAccess.decline_reason_hint')"></textarea>
            <div class="ai-actions">
                <button type="button" class="ah-btn ah-btn--primary" data-test="approve" :disabled="busy" @click="answer(true)">{{ state === 'pending' ? $t('AgentAccess.approve_agent') : $t('AgentAccess.approve_change') }}</button>
                <button type="button" class="ah-btn ah-btn--secondary" data-test="decline" :disabled="busy || !reason" @click="answer(false)">{{ state === 'pending' ? $t('AgentAccess.decline_agent') : $t('AgentAccess.decline_change') }}</button>
            </div>
        </div>
    </section>
</template>

<script setup>
import { computed, ref } from "vue";
import { useI18n } from "vue-i18n";
import { useToast } from "vue-toast-notification";
import { useAgents } from "./useAgents";
import { approvalStateOf } from "./agentAccess";

defineOptions({ name: "AgentApprovalPanel" });

const props = defineProps({
    agent: { type: Object, required: true },
    canManage: { type: Boolean, default: false },
    isMine: { type: Boolean, default: false },
});
const emit = defineEmits(["changed"]);

const { t } = useI18n();
const $toast = useToast();
const { answerAgent, promoteRevision, declineRevision } = useAgents();

const busy = ref(false);
const reason = ref("");
const state = computed(() => approvalStateOf(props.agent));

const makerLine = computed(() => (props.agent.builtIn || props.agent.madeBy || !props.agent.ownerId
    ? t("AgentAccess.built_in")
    : t("AgentAccess.created_by", { name: props.agent.ownerName || t("AgentAccess.someone") })));

const approvedLine = computed(() => {
    const approval = props.agent.approval || {};
    if (approval.state !== "approved" || !approval.decidedBy) return "";
    const day = approval.decidedAt ? new Date(approval.decidedAt).toLocaleDateString() : "";
    return t("AgentAccess.approved_by", { name: props.agent.decidedByName || t("AgentAccess.someone"), date: day });
});

const answer = async (approve) => {
    busy.value = true;
    try {
        if (state.value === "pending") {
            await answerAgent(props.agent._id, approve, reason.value);
        } else if (approve) {
            await promoteRevision(props.agent._id, props.agent.pendingEdit.n);
        } else {
            await declineRevision(props.agent._id, props.agent.pendingEdit.n, reason.value);
        }
        reason.value = "";
        $toast.success(t(approve ? "AgentAccess.approved_toast" : "AgentAccess.declined_toast", { name: props.agent.name }), { position: "top-right" });
        emit("changed");
    } catch (error) {
        $toast.error(error.message, { position: "top-right" });
    } finally {
        busy.value = false;
    }
};
</script>

<style>
.agap { display: flex; flex-direction: column; gap: 10px; }
.agap__who { display: flex; flex-wrap: wrap; gap: 4px 14px; color: var(--ink-2); }
.agap__state { display: flex; flex-direction: column; gap: 4px; padding: 10px 12px; border-radius: 9px; }
.agap__state--warn { background: var(--warn-bg); color: var(--warn-ink); }
.agap__state--danger { background: var(--danger-bg); color: var(--danger-ink); }
.agap__decide { display: flex; flex-direction: column; gap: 6px; }
</style>
