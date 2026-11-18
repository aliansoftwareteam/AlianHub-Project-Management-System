// The global rail highlights its AI tile by route name, and not every screen the AI
// section owns carries the Ai prefix: the agent, workflow and connection screens
// predate the section. Listing them keeps the rail's match honest.
const NAMED_ELSEWHERE = ["AgentTeammates", "AgentRouting", "WorkflowBuilder", "WorkflowRun", "WorkflowLineage", "Connections"];

export const isAiSectionRoute = (name) => String(name || "").startsWith("Ai") || NAMED_ELSEWHERE.includes(name);
