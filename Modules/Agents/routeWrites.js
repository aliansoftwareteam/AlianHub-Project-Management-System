// What a web route takes from an agent as its person may, where the registry has no action for the change or keeps
// its action behind a flag. Nothing here can be performed or proposed: registry.evaluate knows only its own keys.
// Each is named so that the project's rule for agents (./projectPolicy) is asked of it and its audit row says what
// was changed.

const ROUTE_ONLY = Object.freeze([
    'project.comment', 'comment.assign', 'comment.resolve', 'reaction.set', 'timelog.edit', 'time.plan',
    'epic.create', 'epic.update', 'epic.assign', 'project.update', 'whiteboard.update', 'task.reorder',
]);

// The registry's own names for the same change, which a route takes whatever the flag of the MCP tool says.
const ALSO_A_TOOL = Object.freeze(['comment.update', 'timelog.create', 'task.field.set']);

const ENTRIES = new Map([...ROUTE_ONLY, ...ALSO_A_TOOL].map((key) => [key, Object.freeze({ key, write: true, undoable: true })]));

const get = (key) => ENTRIES.get(String(key || '')) || null;

module.exports = { ROUTE_ONLY, ALSO_A_TOOL, get };
