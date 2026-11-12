const connectorTools = require('../Connectors/tools');

// Which connected apps, and which of their tools, an agent may use (FR-61 of task 056). Nothing ticked means none:
// an agent row without the field, or with an empty list, reads from and proposes to no app.

const MAX_ENTRIES = 100;

const invalid = (message) => Object.assign(new Error(message), { status: 400 });

const toolsOf = (provider) => connectorTools.all().filter((tool) => tool.provider === provider);

const grouped = (keys) => {
    const byProvider = new Map();
    keys.forEach((key) => {
        const tool = connectorTools.get(key);
        if (!tool) return;
        byProvider.set(tool.provider, new Set([...(byProvider.get(tool.provider) || []), tool.key]));
    });
    return [...byProvider.entries()]
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([provider, tools]) => ({ provider, tools: [...tools].sort() }));
};

/* A provider or tool this server does not load is refused rather than stored as a tick that never matches. A tool
 * of a provider that is switched off may stay ticked: the run refuses it while it is off. */
const toStore = (list) => {
    if (!Array.isArray(list) || list.length > MAX_ENTRIES) throw invalid('connectors must be a list of { provider, tools }.');
    const keys = [];
    list.forEach((entry) => {
        if (!entry || typeof entry !== 'object' || Array.isArray(entry) || !Array.isArray(entry.tools)) throw invalid('Each connector is { provider, tools } with tools as a list.');
        const provider = String(entry.provider || '');
        const known = toolsOf(provider);
        if (!known.length) throw invalid(`"${provider.slice(0, 60)}" is not a connected app this server has.`);
        entry.tools.forEach((key) => {
            if (!known.some((tool) => tool.key === String(key))) throw invalid(`"${String(key).slice(0, 120)}" is not a tool of ${known[0].definition.name}.`);
            keys.push(String(key));
        });
    });
    return grouped(keys);
};

const isTicked = (connectors, key) => (Array.isArray(connectors) ? connectors : [])
    .some((entry) => entry && Array.isArray(entry.tools) && entry.tools.map(String).includes(String(key)) && String(key).startsWith(`${entry.provider}.`));

/* '' when the agent may use the tool; otherwise what the person reads. A key that is no connector tool is not ours to refuse. */
const refusalFor = (connectors, key) => {
    const tool = connectorTools.get(key);
    if (!tool || isTicked(connectors, tool.key)) return '';
    const name = tool.definition.name;
    const providerTicked = (Array.isArray(connectors) ? connectors : []).some((entry) => entry && entry.provider === tool.provider);
    return providerTicked
        ? `This agent may use ${name}, but not this tool. Tick it in the agent's settings.`
        : `This agent is not allowed to use ${name}. Tick it in the agent's settings.`;
};

const listOf = (value) => (Array.isArray(value) ? value : []);

/* The connector tools a skill reads or proposes, from a stored document or a compiled built-in skill. */
const keysOfSkill = (doc) => [
    ...listOf(doc && doc.gather).map((step) => step && step.reader),
    ...listOf(doc && doc.reads),
    ...listOf(doc && doc.emit).map((mapping) => mapping && mapping.action),
    ...listOf(doc && doc.emits),
].filter(Boolean).map(String).filter((key) => connectorTools.get(key));

const ticksForSkills = (docs) => grouped([...new Set((docs || []).flatMap(keysOfSkill))]);

const toolView = (tool) => ({ key: tool.key, label: tool.label, kind: tool.kind, product: tool.product, description: String(tool.input.description) });

/* The apps this workspace offers (named in CONNECTORS, with an instance or company app), each with its turned-on tools. */
const offered = async (companyId) => {
    const companyApps = await require('../Connectors/apps').companyProviders(companyId);
    return require('../Connectors/registry').offered({ companyApps })
        .map((definition) => ({ provider: definition.id, name: definition.name, tools: toolsOf(definition.id).filter(connectorTools.isOn).map(toolView) }))
        .filter((provider) => provider.tools.length)
        .sort((a, b) => a.name.localeCompare(b.name));
};

module.exports = { toStore, isTicked, refusalFor, keysOfSkill, ticksForSkills, offered };
