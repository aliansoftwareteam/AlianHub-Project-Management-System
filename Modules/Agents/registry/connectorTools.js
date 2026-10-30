const { RISK, SCOPE, read } = require('../registryKit');
const connectorTools = require('../../Connectors/tools');

/* Each read tool a connector provider defines is one action, on while CONNECTORS names its provider. Its writes
 * join with the approval flow (task 069). */
const PERMISSION = Object.freeze({ key: 'artificial_intelligence.ai_connectors', write: false });

const actionOf = (tool) => ({
    key: tool.key,
    label: String(tool.input.description).slice(0, 120),
    risk: RISK.LOW,
    undoable: false,
    write: false,
    cost: 'read',
    constraint: 'only the connection of the person the agent acts for; text only, capped per read and per run; the run is marked and makes no web fetch after it',
    permission: PERMISSION,
});

const tools = connectorTools.reads();

module.exports = {
    entries: tools.map((tool) => ({ enabled: () => connectorTools.isOn(tool), action: Object.freeze(actionOf(tool)) })),
    ratings: Object.freeze(Object.fromEntries(tools.map((tool) => [tool.key, read(SCOPE.WORKSPACE)]))),
};
