/* A project's settings for agents. Their own routes (Modules/Agents) save them, for owners and admins,
 * and record each change; no other write of a project takes them from a request. */
const PROJECT_AGENT_FIELDS = Object.freeze(['agentPolicy', 'agentManager', 'agentLimits', 'agentManagerLookedOn']);

module.exports = { PROJECT_AGENT_FIELDS };
