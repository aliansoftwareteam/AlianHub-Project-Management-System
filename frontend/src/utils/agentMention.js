/* The server keeps agent ids apart from person ids by this prefix in a comment mention. */
export const agentMentionKey = (agentId) => `agent_${agentId}`;

export const mentionsAnAgent = (message) => /\(agent_[0-9a-fA-F]{24}\)/.test(String(message || ""));

/* The person's own connected AI: named by its owner, so it is no person and no in-product agent. */
export const ownAiMentionKey = (ownerId) => `myai_${ownerId}`;

export const mentionsOwnAi = (message) => /\(myai_[0-9a-fA-F]{24}\)/.test(String(message || ""));

/* A comment draws a mention only when its name is letters, digits and spaces. */
export const mentionName = (name) => String(name || "").replace(/[^\w ]+/g, " ").replace(/\s+/g, " ").trim();
