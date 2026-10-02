/* "An agent is working on it" as conditions for the shared task search, so each narrows inside what the task
 * query lets this person see whatever ids it names. CommonJS so tests/agent-work-visible.test.js can send them
 * through the server's task query guard. */

const SEARCH_KEY = 'agentWork';

const idsOf = (taskIds) => [...new Set((taskIds || []).map(String))];

const agentWorkMatch = (taskIds) => ({ _id: { objId: { $in: idsOf(taskIds) } } });

const noAgentWorkMatch = (taskIds) => ({ _id: { objId: { $nin: idsOf(taskIds) } } });

/* Nothing is dropped into a group: a person does not hand a task to an agent by dragging it. A group keeps no
 * place of its own for a row either, so rows sit in status order. */
const groupBase = Object.freeze({ agentWork: true, searchKey: SEARCH_KEY, indexName: 'groupByStatusIndex', isExpanded: true, dropDisabled: true });

/* `work` is [{ taskId, name }]: the tasks of one project an agent is on, each with the name its mark shows. One
 * group for each name, then one for every task no agent holds. The store reads a group once under its
 * `searchValue`, so an agent's group carries its tasks there and is read again when they change. */
const agentWorkGroups = (work, noAgentName) => {
    const byName = new Map();
    (work || []).forEach(({ taskId, name }) => {
        const key = String(name || '');
        byName.set(key, [...(byName.get(key) || []), String(taskId)]);
    });
    const names = [...byName.keys()].sort((a, b) => a.localeCompare(b));
    const held = idsOf(names.flatMap((name) => byName.get(name))).sort();
    return [
        ...names.map((name) => {
            const taskIds = idsOf(byName.get(name)).sort();
            return { ...groupBase, name, value: name, searchValue: [name, ...taskIds].join('|'), taskIds, tasksArray: [], conditions: [agentWorkMatch(taskIds)] };
        }),
        { ...groupBase, noAgent: true, name: noAgentName, value: '', searchValue: '', taskIds: held, tasksArray: [], conditions: [noAgentWorkMatch(held)] },
    ];
};

const inAgentWorkGroup = (task, group) => (group.taskIds || []).includes(String(task?._id)) !== Boolean(group.noAgent);

module.exports = { agentWorkMatch, noAgentWorkMatch, agentWorkGroups, inAgentWorkGroup };
