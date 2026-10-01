/* "An agent is working on it" as a condition for the shared task search, so it narrows inside what the task
 * query lets this person see whatever ids it names. CommonJS so tests/agent-work-visible.test.js can send it
 * through the server's task query guard. */

const agentWorkMatch = (taskIds) => ({ _id: { objId: { $in: [...new Set((taskIds || []).map(String))] } } });

module.exports = { agentWorkMatch };
