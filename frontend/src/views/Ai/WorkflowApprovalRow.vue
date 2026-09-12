<template>
    <button type="button" class="ai-item" :class="{ 'is-active': active }" data-test="approval-row" @click="$emit('pick')">
        <div class="ai-item__top">
            <span class="ai-item__agent" data-test="approval-row-owner">{{ ownerLabel }}</span>
            <span v-if="escalated" class="ah-chip ah-chip--warn ah-chip--mono" data-test="approval-row-escalated">{{ $t('Workflows.approval_escalated') }}</span>
            <span v-if="deadline" class="ah-chip ah-chip--mono" :class="deadlineChip" data-test="approval-row-deadline">{{ deadlineLabel }}</span>
        </div>
        <div class="ai-item__what">{{ approval.title || $t('Workflows.approval_untitled') }}</div>
        <div class="ai-item__why">{{ approval.run?.name || approval.workflowId }} · {{ $t('Workflows.approval_step', { stepId: approval.stepId }) }}</div>
    </button>
</template>

<script setup>
import { computed } from "vue";
import { useI18n } from "vue-i18n";
import moment from "moment";
import { deadlineOf, escalationOf, ownerOf } from "./workflowApprovals";

defineOptions({ name: "WorkflowApprovalRow" });

const props = defineProps({
    approval: { type: Object, required: true },
    active: { type: Boolean, default: false }
});

defineEmits(["pick"]);

const { t } = useI18n();

const owner = computed(() => ownerOf(props.approval));
const ownerLabel = computed(() => owner.value.name
    || (owner.value.role ? t("Workflows.approval_owner_role", { role: owner.value.role }) : t("Workflows.approval_owner_none")));

const deadline = computed(() => deadlineOf(props.approval));
const deadlineLabel = computed(() => (deadline.value.overdue
    ? t("Workflows.approval_overdue")
    : t("Workflows.approval_due", { away: moment(deadline.value.at).fromNow() })));
const deadlineChip = computed(() => {
    if (deadline.value.overdue) return "ah-chip--danger";
    return deadline.value.soon ? "ah-chip--warn" : "";
});

const escalated = computed(() => Boolean(escalationOf(props.approval)?.escalated));
</script>
