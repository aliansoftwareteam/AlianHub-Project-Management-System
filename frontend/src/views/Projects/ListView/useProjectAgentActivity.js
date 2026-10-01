import { proposals } from "@/views/Ai/agentFeed";
import { useProjectAgents } from "@/views/Projects/Kanban/useProjectAgents";

/* Agent activity for the rows of one project (handoff 28b): an open run puts the
 * dark border and strip on the row, a pending proposal puts the "✦ agent: …"
 * line on it. Nothing renders when there is nothing to show. */
export function useProjectAgentActivity() {
    const { state, start, openRunFor } = useProjectAgents();

    // A proposal filed without a project still belongs on the row of its task.
    const proposalFor = (taskId) => proposals.value.find((p) => String(p.taskId || "") === String(taskId)
        && (!p.projectId || String(p.projectId) === state.projectId)) || null;

    return { load: start, runFor: openRunFor, proposalFor };
}
