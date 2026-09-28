/* The server keeps agent ids apart from person ids by this prefix in a comment mention. */
export const agentMentionKey = (agentId) => `agent_${agentId}`;

export const mentionsAnAgent = (message) => /\(agent_[0-9a-fA-F]{24}\)/.test(String(message || ""));
