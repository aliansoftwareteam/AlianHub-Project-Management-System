import { computed, inject } from "vue";
import { useStore } from "vuex";
import { isOwnerOrAdmin } from "@/utils/roles";
import { AI_RIGHT, useAiRights } from "@/composable/aiRights";

export const canManageAgents = (roleType) => isOwnerOrAdmin(Number(roleType));

const isSelf = (ownerId, userId) => Boolean(userId) && Boolean(ownerId) && String(ownerId) === String(userId);

export const canControlRun = (run, { userId, roleType } = {}) => Boolean(run) && (canManageAgents(roleType) || isSelf(run.startedBy, userId));

export const canUndoDecision = (proposal, { userId, roleType } = {}) => Boolean(proposal) && (canManageAgents(roleType) || isSelf(proposal.decidedBy, userId));

// Mirrors Modules/Agents/agentApproval.js: an agent with no approval state was made before approvals, by an owner or admin.
export const approvalStateOf = (agent) => (agent && agent.approval && agent.approval.state) || "approved";
export const awaitsApproval = (agent) => ["pending", "declined"].includes(approvalStateOf(agent));

export function useAgentAccess() {
    const { getters } = useStore();
    const injectedUserId = inject("$userId", null);
    const roleType = computed(() => getters["settings/companyUserDetail"]?.roleType);
    const userId = computed(() => injectedUserId?.value ?? injectedUserId);
    const canManage = computed(() => canManageAgents(roleType.value));
    const { mayUse, maySee } = useAiRights();
    const canBuild = mayUse(AI_RIGHT.AGENTS);
    const seesAll = maySee(AI_RIGHT.AGENTS);
    const canWriteSkills = mayUse(AI_RIGHT.SKILLS);
    const seesSkills = maySee(AI_RIGHT.SKILLS);
    const canUseAgents = mayUse(AI_RIGHT.AGENT_USE);
    const canAsk = mayUse(AI_RIGHT.ASSISTANT);
    const canConnectApps = mayUse(AI_RIGHT.CONNECTORS);
    const canConnectOwnAi = mayUse(AI_RIGHT.EXTERNAL_CLIENTS);
    const who = () => ({ userId: userId.value, roleType: roleType.value });
    const mayStop = (run) => canControlRun(run, who());
    const mayUndo = (proposal) => canUndoDecision(proposal, who());
    const isMine = (agent) => isSelf(agent && agent.ownerId, userId.value);
    const mayEdit = (agent) => canManage.value || (canBuild.value && isMine(agent));
    return { canManage, canBuild, seesAll, canWriteSkills, seesSkills, canUseAgents, canAsk, canConnectApps, canConnectOwnAi, userId, isMine, mayEdit, mayStop, mayUndo };
}
