const fs = require('fs');
const path = require('path');
const { createRegistry } = require('./registry');

const DIR = path.join(__dirname, 'providers');
// A provider with products names the product too: google.calendar.events.list (063 contract, section 3).
const KEY = /^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*){2,3}$/;
const LABEL = /^Connectors\.tool\.[A-Za-z0-9_]+$/;
const CARD_LABEL = /^Connectors\.card\.[A-Za-z0-9_]+$/;
const KIND = Object.freeze({ READ: 'read', WRITE: 'write' });
const PROPERTY_TYPES = Object.freeze(['string', 'integer', 'number', 'boolean']);
const MIN_DESCRIPTION = 20;
const FIELD = /^[a-z][A-Za-z]{0,29}$/;
const RESERVED_FIELDS = Object.freeze(['text', 'chars', 'truncated', 'taint', 'failed', 'reason']);
const MCP_TOOL = /^[A-Za-z0-9_.\-/]{1,128}$/;
const SHAPE = /^[a-f0-9]{64}$/;

const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const positive = (value) => Number.isInteger(value) && value > 0;

/* A tool's input is the schema MCP publishes and a data skill's reader params are built from, so it stays flat:
 * named scalars only, numbers and strings bounded, nothing extra accepted. Its description is the text both show. */
const inputProblems = (input) => {
    if (!isObject(input) || input.type !== 'object') return ['input is not an object schema'];
    const found = [];
    if (input.additionalProperties !== false) found.push('input does not set additionalProperties: false');
    if (String(input.description || '').trim().length < MIN_DESCRIPTION) found.push(`input.description has fewer than ${MIN_DESCRIPTION} characters`);
    const properties = isObject(input.properties) ? input.properties : {};
    if (Object.prototype.hasOwnProperty.call(properties, 'connectionId')) found.push('input names connectionId, which is reserved');
    Object.entries(properties).forEach(([name, schema]) => {
        if (!isObject(schema) || !PROPERTY_TYPES.includes(schema.type)) found.push(`input.${name} is not a ${PROPERTY_TYPES.join(', ')}`);
        else if (['integer', 'number'].includes(schema.type) && !(Number.isFinite(schema.minimum) && Number.isFinite(schema.maximum))) found.push(`input.${name} has no minimum and maximum`);
        else if (schema.type === 'string' && !positive(schema.maxLength)) found.push(`input.${name} has no maxLength`);
    });
    (Array.isArray(input.required) ? input.required : []).filter((name) => !properties[name]).forEach((name) => found.push(`input requires ${name}, which it does not describe`));
    return found;
};

const controlFits = (field, schema) => {
    if (field.toggle) return schema.type === 'boolean';
    if (field.options) return Array.isArray(schema.enum) && field.options.every((option) => schema.enum.includes(option.value));
    return schema.type === 'string' && !schema.enum;
};

/* What its owner may change on the approval card, each with the control its input takes. An id is left out on purpose:
 * it says what the write acts on, and a mistyped one would act on something else. */
const editableProblems = (tool) => {
    if (tool.editable === undefined) return [];
    if (!Array.isArray(tool.editable)) return ['editable is not a list'];
    const properties = (tool.input && tool.input.properties) || {};
    return tool.editable.flatMap((field) => {
        const schema = properties[field && field.param];
        if (!schema || !controlFits(field, schema)) return [`editable names ${field && field.param}, which its control cannot set`];
        const labels = [field.label, field.hint, field.blank, ...(field.options || []).map((option) => option.label)].filter((label) => label !== undefined);
        return labels.every((label) => CARD_LABEL.test(String(label || ''))) ? [] : [`editable ${field.param} has no Connectors.card.* label`];
    });
};

/* An MCP provider's tool names the server's tool it calls and the shape it was reviewed against; a provider that calls
 * its own API has neither. */
const mcpProblems = (definition, tool) => {
    if (definition.transport !== 'mcp') return tool.mcp === undefined ? [] : ['mcp is set but the provider does not use MCP'];
    if (!isObject(tool.mcp) || !MCP_TOOL.test(String(tool.mcp.tool || ''))) return ['mcp.tool names no tool of the server'];
    return tool.mcp.shape === null || SHAPE.test(String(tool.mcp.shape)) ? [] : ['mcp.shape is not a reviewed shape or null'];
};

const toolProblems = (definition, tool) => {
    if (!isObject(tool)) return ['a tool is not an object'];
    const key = String(tool.key || '');
    const found = [];
    if (!KEY.test(key)) found.push(`key "${key}" is not <provider>.<object>.<verb>`);
    else if (key.split('.')[0] !== definition.id) found.push(`key "${key}" does not start with ${definition.id}`);
    if (!LABEL.test(String(tool.label || ''))) found.push(`${key}: label is not a Connectors.tool.* key`);
    if (!Object.values(KIND).includes(tool.kind)) found.push(`${key}: kind is not read or write`);
    const products = isObject(definition.products) ? definition.products : {};
    const productScopes = products[tool.product] || [];
    if (!Object.prototype.hasOwnProperty.call(products, tool.product)) found.push(`${key}: product "${tool.product}" is not one of ${Object.keys(products).join(', ')}`);
    else if (productScopes.length && !productScopes.includes(tool.scope)) found.push(`${key}: scope is not one of the ${tool.product} scopes`);
    else if (!productScopes.length && tool.scope !== undefined && tool.scope !== null) found.push(`${key}: ${tool.product} has no scopes, so the tool names none`);
    found.push(...mcpProblems(definition, tool).map((problem) => `${key}: ${problem}`));
    found.push(...inputProblems(tool.input).map((problem) => `${key}: ${problem}`));
    if (!isObject(tool.caps) || !positive(tool.caps.maxItems) || !positive(tool.caps.maxChars)) found.push(`${key}: caps needs maxItems and maxChars above 0`);
    if (typeof tool.run !== 'function') found.push(`${key}: run is not a function`);
    // The approval card is the only place a person sees what a write sends, so a write without one never loads.
    if (tool.kind === KIND.WRITE && typeof tool.card !== 'function') found.push(`${key}: a write has no card`);
    found.push(...editableProblems(tool).map((problem) => `${key}: ${problem}`));
    if (tool.fields !== undefined && !(tool.kind === KIND.READ && Array.isArray(tool.fields) && tool.fields.every((name) => FIELD.test(String(name)) && !RESERVED_FIELDS.includes(name)))) {
        found.push(`${key}: fields must be a read's list of extra value names`);
    }
    return found;
};

const problemsOf = (definition, tools) => {
    if (!Array.isArray(tools)) return ['tools.js does not export a list'];
    const found = tools.flatMap((tool) => toolProblems(definition, tool));
    const keys = tools.map((tool) => tool && tool.key);
    keys.filter((key, i) => key && keys.indexOf(key) !== i).forEach((key) => found.push(`key "${key}" is used twice`));
    return found;
};

const readFolder = (dir, definition) => {
    const toolsFile = path.join(dir, definition.id, 'tools.js');
    if (!fs.existsSync(toolsFile)) return [];
    const tools = require(toolsFile);
    const found = problemsOf(definition, tools);
    // A broken tools file stops the server at boot rather than ship a tool that skips a check.
    if (found.length) throw new Error(`connector tools of ${definition.id} are invalid: ${found.join('; ')}`);
    return tools.map((tool) => Object.freeze({ ...tool, provider: definition.id, definition }));
};

// Only a provider the registry accepted has tools: one it skipped has no checked definition to hold them to.
const load = (dir) => Object.freeze(createRegistry({ dir }).list()
    .sort((a, b) => a.id.localeCompare(b.id))
    .flatMap((definition) => readFolder(dir, definition)));

/* A provider's tools exist for agents and MCP only while CONNECTORS names it, and only where a run that read
 * from outside is routed to approval. Whether this workspace has an app for it is asked at call time. */
const providerOn = (provider) => require('../Agents/connectors/flag').named().includes(provider) && require('../Agents/taint').enabled();

/* An MCP tool nobody has reviewed is offered nowhere: not registered for agents, MCP or skills, and refused if named.
 * `all()` still holds it, so owners and admins can see it waiting for review. */
const reviewed = (tool) => !tool.mcp || SHAPE.test(String(tool.mcp.shape || ''));

/* The three generic tools of a workspace's custom servers (customTools.js) sit beside the catalog's from boot, so the
 * agent registry and the MCP server hold them like any other; they are on only while custom servers are. */
const customTools = () => require('./customTools');

const make = (dir, { custom = false } = {}) => {
    let loaded = null;
    const all = () => { loaded = loaded || Object.freeze([...load(dir), ...(custom ? customTools().TOOLS : [])]); return loaded; };
    const get = (key) => all().find((tool) => tool.key === String(key)) || null;
    const reads = () => all().filter((tool) => tool.kind === KIND.READ && reviewed(tool));
    const writes = () => all().filter((tool) => tool.kind === KIND.WRITE && reviewed(tool));
    const isWrite = (key) => { const tool = get(key); return Boolean(tool) && tool.kind === KIND.WRITE; };
    const isOn = (tool) => (tool.custom ? customTools().isOn() : providerOn(tool.provider) && reviewed(tool));
    return { all, get, reads, writes, isWrite, isOn, anyOn: () => all().some(isOn) };
};

/* A call of a custom tool names its server and tool, and becomes that server's reviewed tool here; any other tool is
 * itself. */
const bound = async (tool, { companyId, input }) => (typeof tool.bind === 'function' ? tool.bind({ companyId, input }) : { tool, args: input });

const WRITE_GATE = 'connection_owner';

module.exports = { KIND, WRITE_GATE, problemsOf, make, bound, ...make(DIR, { custom: true }) };
