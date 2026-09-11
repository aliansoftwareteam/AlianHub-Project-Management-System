import { computed, inject } from "vue";
import { useStore } from "vuex";
import { isOwnerOrAdmin } from "@/utils/roles";

export const canManageAgents = (roleType) => isOwnerOrAdmin(Number(roleType));

const isSelf = (ownerId, userId) => Boolean(userId) && Boolean(ownerId) && String(ownerId) === String(userId);

export const canControlRun = (run, { userId, roleType } = {}) => Boolean(run) && (canManageAgents(roleType) || isSelf(run.startedBy, userId));

export const canUndoDecision = (proposal, { userId, roleType } = {}) => Boolean(proposal) && (canManageAgents(roleType) || isSelf(proposal.decidedBy, userId));

export function useAgentAccess() {
    const { getters } = useStore();
    const injectedUserId = inject("$userId", null);
    const roleType = computed(() => getters["settings/companyUserDetail"]?.roleType);
    const userId = computed(() => injectedUserId?.value ?? injectedUserId);
    const canManage = computed(() => canManageAgents(roleType.value));
    const who = () => ({ userId: userId.value, roleType: roleType.value });
    const mayStop = (run) => canControlRun(run, who());
    const mayUndo = (proposal) => canUndoDecision(proposal, who());
    return { canManage, userId, mayStop, mayUndo };
}
