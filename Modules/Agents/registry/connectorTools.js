const { RISK, SCOPE, read, write } = require('../registryKit');
const connectorTools = require('../../Connectors/tools');

const PERMISSION = Object.freeze({ key: 'artificial_intelligence.ai_connectors', write: false });

const readOf = (tool) => ({
    key: tool.key,
    label: String(tool.input.description).slice(0, 120),
    risk: RISK.LOW,
    undoable: false,
    write: false,
    cost: 'read',
    constraint: 'only the connection of the person the agent acts for; text only, capped per read and per run; the run is marked and makes no web fetch after it',
    permission: PERMISSION,
});

const writeOf = (tool) => ({
    key: tool.key,
    label: String(tool.input.description).slice(0, 120),
    risk: RISK.HIGH,
    undoable: false,
    write: true,
    cost: 'write',
    proposeOnly: true,
    gate: connectorTools.WRITE_GATE,
    constraint: 'only on the connection of the person the agent acts for; never sent until that person approves exactly what goes out; sent once',
    permission: PERMISSION,
});

const reads = connectorTools.reads();
const writes = connectorTools.writes();
const entryOf = (actionOf) => (tool) => ({ enabled: () => connectorTools.isOn(tool), action: Object.freeze(actionOf(tool)) });

/* A built-in MCP app lists its tools per connection, so its writes have no entry until one is named. Only a write is
 * ever filed under such a key, and writes.js admits it against the owner's connection before it is stored or sent. */
const liveWriteOf = (key, appName) => Object.freeze({
    ...writeOf({ key, input: { description: `A change to ${appName}` } }),
    live: true,
});
const LIVE_WRITE_RATING = Object.freeze(write(SCOPE.WORKSPACE, false));

module.exports = {
    liveWriteOf,
    LIVE_WRITE_RATING,
    entries: [...reads.map(entryOf(readOf)), ...writes.map(entryOf(writeOf))],
    ratings: Object.freeze({
        ...Object.fromEntries(reads.map((tool) => [tool.key, read(SCOPE.WORKSPACE)])),
        ...Object.fromEntries(writes.map((tool) => [tool.key, write(SCOPE.WORKSPACE, false)])),
    }),
};
