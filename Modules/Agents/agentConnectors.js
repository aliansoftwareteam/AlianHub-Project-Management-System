const connectorTools = require('../Connectors/tools');
const connectionTools = require('../Connectors/connectionTools');

// Nothing ticked means none: an agent row without the field, or with an empty list, reads from and proposes to no app.

const MAX_ENTRIES = 100;
const SERVER_TOOL = /^[A-Za-z0-9_.\-/]{1,128}$/;

const invalid = (message) => Object.assign(new Error(message), { status: 400 });

const toolsOf = (provider) => connectorTools.all().filter((tool) => tool.provider === provider);

const providerOfKey = (key) => connectionTools.splitKey(key).provider;

const liveApp = (provider) => (toolsOf(provider).length ? null : connectionTools.liveDefinition(provider));

const appOfKey = (key) => {
    const tool = connectorTools.get(key);
    if (tool) return { provider: tool.provider, name: tool.definition.name };
    const { provider, tool: name } = connectionTools.splitKey(key);
    const definition = liveApp(provider);
    return definition && SERVER_TOOL.test(name) ? { provider, name: definition.name } : null;
};

const grouped = (keys) => {
    const byProvider = new Map();
    keys.forEach((key) => {
        const app = appOfKey(key);
        if (!app) return;
        byProvider.set(app.provider, new Set([...(byProvider.get(app.provider) || []), String(key)]));
    });
    return [...byProvider.entries()]
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([provider, tools]) => ({ provider, tools: [...tools].sort() }));
};

/* A provider or tool this server does not load is refused rather than stored as a tick that never matches. A tool
 * of a provider that is switched off may stay ticked: the run refuses it while it is off. A run has readers only for
 * catalog tools, so a new tick on a live app's tool is refused too: it would never run. One the agent already holds
 * is kept, or it would block every later save of the ticks. */
const toStore = (list, { held = [] } = {}) => {
    if (!Array.isArray(list) || list.length > MAX_ENTRIES) throw invalid('connectors must be a list of { provider, tools }.');
    const keys = [];
    list.forEach((entry) => {
        if (!entry || typeof entry !== 'object' || Array.isArray(entry) || !Array.isArray(entry.tools)) throw invalid('Each connector is { provider, tools } with tools as a list.');
        const provider = String(entry.provider || '');
        const live = liveApp(provider);
        const known = toolsOf(provider);
        if (!live && !known.length) throw invalid(`"${provider.slice(0, 60)}" is not a connected app this server has.`);
        entry.tools.forEach((key) => {
            const text = String(key);
            if (live && !(providerOfKey(text) === provider && isTicked(held, text))) throw invalid(`Agents cannot use ${live.name} yet, so its tools cannot be ticked.`);
            if (!live && !known.some((tool) => tool.key === text)) throw invalid(`"${text.slice(0, 120)}" is not a tool of ${known[0].definition.name}.`);
            keys.push(text);
        });
    });
    return grouped(keys);
};

const isTicked = (connectors, key) => (Array.isArray(connectors) ? connectors : [])
    .some((entry) => entry && Array.isArray(entry.tools) && entry.tools.map(String).includes(String(key)) && String(key).startsWith(`${entry.provider}.`));

// A key that is no connector tool is not ours to refuse.
const refusalFor = (connectors, key) => {
    const app = appOfKey(key);
    if (!app || isTicked(connectors, key)) return '';
    const providerTicked = (Array.isArray(connectors) ? connectors : []).some((entry) => entry && entry.provider === app.provider);
    return providerTicked
        ? `This agent may use ${app.name}, but not this tool. Tick it in the agent's settings.`
        : `This agent is not allowed to use ${app.name}. Tick it in the agent's settings.`;
};

// A live app lists tools per connection, so only a tool AlianHub itself dropped is certainly gone for everyone.
const missingReason = (key, { everyone = false } = {}) => {
    const { provider, tool } = connectionTools.splitKey(key);
    const app = appOfKey(key) || { name: provider || String(key) };
    const name = tool || key;
    return everyone
        ? `This agent is ticked for ${name} on ${app.name}, but ${app.name} no longer offers it. Remove the tick in the agent's settings.`
        : `This agent is ticked for ${name} on ${app.name}, but the ${app.name} connection this run uses does not offer it. If ${app.name} no longer offers it to anyone, remove the tick in the agent's settings.`;
};

const listOf = (value) => (Array.isArray(value) ? value : []);

const keysOfSkill = (doc) => [
    ...listOf(doc && doc.gather).map((step) => step && step.reader),
    ...listOf(doc && doc.reads),
    ...listOf(doc && doc.emit).map((mapping) => mapping && mapping.action),
    ...listOf(doc && doc.emits),
].filter(Boolean).map(String).filter((key) => connectorTools.get(key));

const ticksForSkills = (docs) => grouped([...new Set((docs || []).flatMap(keysOfSkill))]);

const toolView = (tool) => ({
    key: tool.key,
    label: tool.label,
    kind: tool.kind,
    product: tool.product,
    live: Boolean(tool.live),
    description: String(tool.description || tool.input.description || ''),
});

/* A REST app's tools do not depend on a connection, so a viewer who has not connected it can still tick them. */
const toolsShown = (app, lookup) => (app.status === lookup.STATUS.OK ? app.tools : toolsOf(app.provider).filter(connectorTools.isOn));

/* A live app is left out until a run can read it (see toStore), so the settings never offer a tick that cannot run. */
const offered = async (companyId, userId) => {
    const lookup = require('../Connectors/available');
    const companyApps = await require('../Connectors/apps').companyProviders(companyId);
    const ids = require('../Connectors/registry').offered({ companyApps }).map((definition) => definition.id).filter((id) => !lookup.isLive(id));
    const found = await lookup.available({ companyId, userId, provider: ids, purpose: lookup.PURPOSE.AGENT });
    return found.apps
        .filter((app) => app.status !== lookup.STATUS.OFF)
        .map((app) => ({ provider: app.provider, name: app.name, status: app.status, live: lookup.isLive(app.provider), tools: toolsShown(app, lookup).map(toolView), leftOut: app.leftOut }))
        .filter((app) => app.status !== lookup.STATUS.OK || app.tools.length || app.leftOut.length)
        .sort((a, b) => a.name.localeCompare(b.name));
};

module.exports = { toStore, isTicked, refusalFor, missingReason, keysOfSkill, ticksForSkills, offered };
