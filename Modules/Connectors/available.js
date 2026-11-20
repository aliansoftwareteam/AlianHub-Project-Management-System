const registry = require('./registry');
const tools = require('./tools');
const connections = require('./resolveConnection');
const connectionTools = require('./connectionTools');
const toolPermissions = require('./toolPermissions');

/* The one place AI chat and agents learn which connector tools a person can use right now (task 111): their own
 * connection of each app, REST or MCP, after the workspace switch and the tool's permission. */

const PURPOSE = Object.freeze({ ASK: 'ask', AGENT: 'agent' });
const LEFT_OUT = Object.freeze({ OFF: 'off', CHANGED: 'changed', GONE: 'gone', UNUSABLE: 'unusable', APPROVAL: 'approval' });
const { STATUS, PERMISSION } = connectionTools;

const catalogOf = (provider) => tools.all().filter((tool) => tool.provider === provider);

/* An app that has catalog tools keeps them; a built-in MCP app without any lists its tools from its server. */
const isLive = (provider) => !catalogOf(provider).length && Boolean(connectionTools.liveDefinition(provider));

/* Every app a person could name, switched on or not, with the name a person reads. */
const known = () => {
    const names = new Map(tools.all().map((tool) => [tool.provider, tool.definition.name]));
    registry.list().filter((definition) => isLive(definition.id)).forEach((definition) => names.set(definition.id, definition.name));
    return names;
};

const isOn = (provider) => (isLive(provider) ? tools.providerOn(provider) : catalogOf(provider).some(tools.isOn));

const appOf = (provider, name, status, extra = {}) => ({ provider, name, status, connectionId: '', tools: [], leftOut: [], ...extra });

/* AI chat answers from what it reads at once, and a read that waits for its owner's card brings nothing back to the
 * answer, so the chat leaves it out and says so; an agent run still files it. */
const waitsForOwner = (kind, permission, purpose) => purpose === PURPOSE.ASK && kind === tools.KIND.READ && permission === PERMISSION.APPROVAL;

const catalogApp = async ({ companyId, userId, provider, name, purpose }) => {
    let connection;
    try {
        connection = await connections.resolveConnection({ companyId: String(companyId), userId: String(userId), provider });
    } catch (error) {
        if (error && error.name === 'ConnectorError') return appOf(provider, name, error.code || STATUS.NOT_CONNECTED);
        throw error;
    }
    const usable = [];
    const leftOut = [];
    catalogOf(provider).filter(tools.isOn).forEach((tool) => {
        const permission = toolPermissions.permissionOf(tool, connection);
        if (permission === PERMISSION.OFF) leftOut.push({ key: tool.key, kind: tool.kind, reason: LEFT_OUT.OFF });
        else if (waitsForOwner(tool.kind, permission, purpose)) leftOut.push({ key: tool.key, kind: tool.kind, reason: LEFT_OUT.APPROVAL });
        else usable.push(Object.freeze({ ...tool, permission }));
    });
    return appOf(provider, name, STATUS.OK, { connectionId: String(connection.connectionId), tools: usable, leftOut });
};

const reasonLeftOut = (view, purpose) => {
    if (view.gone) return LEFT_OUT.GONE;
    if (!view.usable) return LEFT_OUT.UNUSABLE;
    if (view.permission === PERMISSION.OFF) return LEFT_OUT.OFF;
    if (purpose === PURPOSE.AGENT && view.changed) return LEFT_OUT.CHANGED;
    if (waitsForOwner(view.access, view.permission, purpose)) return LEFT_OUT.APPROVAL;
    return '';
};

const liveApp = async ({ companyId, userId, provider, name, purpose, timeoutMs }) => {
    const [listing] = await connectionTools.listMine({ companyId, userId, providers: [provider], timeoutMs });
    if (listing.status !== STATUS.OK) return appOf(provider, name, listing.status);
    const definition = connectionTools.liveDefinition(provider);
    const usable = [];
    const leftOut = [];
    listing.tools.forEach((view) => {
        const reason = reasonLeftOut(view, purpose);
        if (reason) leftOut.push({ key: view.key, kind: view.access, reason });
        else usable.push(connectionTools.runnableOfView(definition, view));
    });
    return appOf(provider, name, STATUS.OK, { connectionId: String(listing.connectionId), tools: usable, leftOut });
};

const fits = ({ kind, product }) => (entry) => (!kind || entry.kind === kind) && (!product || entry.product === undefined || entry.product === product);

const providersAsked = (provider, names) => {
    if (provider === undefined || provider === null || provider === '') return [...names.keys()].filter(isOn).sort();
    return [...new Set((Array.isArray(provider) ? provider : [provider]).map(String))].filter((id) => names.has(id));
};

/* `provider` is one app or a list of them; left out, every app switched on here. Each app says its status, so an
 * app that is unreachable, not connected or turned off is reported as that, never as having no tools. `leftOut`
 * names the tools held back and why (Off, changed for an agent, gone from the server, not checkable, or a read that
 * waits for approval, which AI chat cannot answer from). */
const available = async ({ companyId, userId, kind, provider, product, purpose = PURPOSE.ASK, timeoutMs = connectionTools.LIST_TIMEOUT_MS } = {}) => {
    const names = known();
    const apps = await Promise.all(providersAsked(provider, names).map((id) => {
        const name = names.get(id);
        if (!isOn(id)) return appOf(id, name, STATUS.OFF);
        if (!userId) return appOf(id, name, STATUS.NOT_CONNECTED);
        return isLive(id)
            ? liveApp({ companyId, userId, provider: id, name, purpose, timeoutMs })
            : catalogApp({ companyId, userId, provider: id, name, purpose });
    }));
    const keep = fits({ kind, product });
    const narrowed = apps.map((app) => ({ ...app, tools: app.tools.filter(keep), leftOut: app.leftOut.filter((entry) => !kind || entry.kind === kind) }));
    return {
        apps: narrowed,
        tools: narrowed.flatMap((app) => app.tools),
        unavailable: narrowed.filter((app) => app.status !== STATUS.OK).map(({ provider: id, name, status }) => ({ provider: id, name, status })),
    };
};

module.exports = { PURPOSE, LEFT_OUT, STATUS, available, known, isLive };
