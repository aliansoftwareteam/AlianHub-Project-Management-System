/* A project's settings for agents. Their own routes (Modules/Agents) save them, for owners and admins,
 * and record each change; no other write of a project takes them from a request. */
const PROJECT_AGENT_FIELDS = Object.freeze(['agentPolicy', 'agentManager', 'agentLimits', 'agentManagerLookedOn']);

const agentFieldNamed = (document) => Object.keys(document && typeof document === 'object' ? document : {})
    .map((path) => path.split('.')[0])
    .find((field) => PROJECT_AGENT_FIELDS.includes(field));

module.exports = { PROJECT_AGENT_FIELDS, agentFieldNamed };
