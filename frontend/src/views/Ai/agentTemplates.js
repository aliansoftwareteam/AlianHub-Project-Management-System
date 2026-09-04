// The roles the wizard can start from. Every skill key here resolves in
// Modules/Agents/skills — a template is never a label the engine cannot run.
export const AGENT_TEMPLATES = [
    { slug: "intake", name: "Intake", skills: ["brief.parse", "project.plan"], actions: ["task.get", "tasks.search", "subtask.create", "task.comment"] },
    { slug: "reviewer", name: "Reviewer", skills: ["pr.summary", "risk.flags"], actions: ["task.get", "tasks.search", "task.comment", "task.link"] },
    { slug: "reporter", name: "Reporter", skills: ["digest.ceo", "risk.today"], actions: ["task.get", "tasks.search", "task.comment"] },
    { slug: "qa", name: "QA Reviewer", skills: ["qa-review"], actions: ["task.get", "tasks.search", "subtask.create", "task.comment"] }
];
