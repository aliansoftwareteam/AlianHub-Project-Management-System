const registry = require('./registry');

// A change is filed with words of its own ("Comment on AP-12: ...") or with none: the action's key, the registry's
// English label, or the name of the tool a connected agent called. One with none is marked, so the web app words it
// in the reader's language (frontend/src/views/Ai/agentActionLabels.js).

const VIA_TOOL = ' via MCP';

const toolLabel = (toolName) => `${toolName}${VIA_TOOL}`;

const isStock = (change) => {
    const action = String((change && change.action) || '');
    const label = String((change && change.label) || '').trim();
    const known = registry.get(action);
    return !label || label === action || label.endsWith(VIA_TOOL) || Boolean(known && label === known.label);
};

const markOf = (change) => (isStock(change) ? { stockLabel: true } : {});

module.exports = { toolLabel, isStock, markOf };
