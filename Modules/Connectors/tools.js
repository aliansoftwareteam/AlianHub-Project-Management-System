const fs = require('fs');
const path = require('path');
const { createRegistry } = require('./registry');

const DIR = path.join(__dirname, 'providers');
const KEY = /^[a-z][a-z0-9_]*\.[a-z][a-z0-9_]*\.[a-z][a-z0-9_]*$/;
const LABEL = /^Connectors\.tool\.[A-Za-z0-9_]+$/;
const KIND = Object.freeze({ READ: 'read', WRITE: 'write' });
const PROPERTY_TYPES = Object.freeze(['string', 'integer', 'number', 'boolean']);
const MIN_DESCRIPTION = 20;

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

const toolProblems = (definition, tool) => {
    if (!isObject(tool)) return ['a tool is not an object'];
    const key = String(tool.key || '');
    const found = [];
    if (!KEY.test(key)) found.push(`key "${key}" is not <provider>.<object>.<verb>`);
    else if (key.split('.')[0] !== definition.id) found.push(`key "${key}" does not start with ${definition.id}`);
    if (!LABEL.test(String(tool.label || ''))) found.push(`${key}: label is not a Connectors.tool.* key`);
    if (!Object.values(KIND).includes(tool.kind)) found.push(`${key}: kind is not read or write`);
    const products = isObject(definition.products) ? definition.products : {};
    if (!Object.prototype.hasOwnProperty.call(products, tool.product)) found.push(`${key}: product "${tool.product}" is not one of ${Object.keys(products).join(', ')}`);
    else if (!(products[tool.product] || []).includes(tool.scope)) found.push(`${key}: scope is not one of the ${tool.product} scopes`);
    found.push(...inputProblems(tool.input).map((problem) => `${key}: ${problem}`));
    if (!isObject(tool.caps) || !positive(tool.caps.maxItems) || !positive(tool.caps.maxChars)) found.push(`${key}: caps needs maxItems and maxChars above 0`);
    if (typeof tool.run !== 'function') found.push(`${key}: run is not a function`);
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

const make = (dir) => {
    let loaded = null;
    const all = () => { loaded = loaded || load(dir); return loaded; };
    const get = (key) => all().find((tool) => tool.key === String(key)) || null;
    const reads = () => all().filter((tool) => tool.kind === KIND.READ);
    return { all, get, reads, isOn: (tool) => providerOn(tool.provider), anyOn: () => all().some((tool) => providerOn(tool.provider)) };
};

module.exports = { KIND, problemsOf, make, ...make(DIR) };
