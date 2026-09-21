const mcpOAuth = require('../../Config/mcpOAuth');
const { hasScope } = require('../ApiTokens/helpers/apiTokenRules');

const TOOL_SCOPES = Object.freeze({
    'tasks.next': 'tasks:read',
    'tasks.search': 'tasks:read',
    'task.get': 'tasks:read',
    'task.comment': 'tasks:write',
    'task.status.set': 'tasks:write',
    'task.link': 'tasks:write',
    'task.create': 'tasks:write',
    'subtask.create': 'tasks:write',
    'timelog.start': 'time:write',
    'timelog.stop': 'time:write',
    'docs.read': 'docs:read',
    'performance.read': 'time:read',
});

const DISCOVERY_SCOPES = mcpOAuth.READ_SCOPES;

const scopeForTool = (name) => {
    if (Object.prototype.hasOwnProperty.call(TOOL_SCOPES, name)) return TOOL_SCOPES[name];
    const sessionTools = require('./sessionTools');
    return sessionTools.owns(name) ? sessionTools.SCOPES[name] : null;
};

/* An OAuth token holds exactly what was granted. A personal access token only
 * knows read and write. hasScope keeps its rules (empty scopes, API_TOKEN_STRICT),
 * so each maps onto every *:read or *:write and no token that works today loses a
 * tool; an OAuth token must never take that path, where empty would mean everything. */
const grantedScopes = (tokenDoc) => {
    if (tokenDoc && tokenDoc.oauth) return mcpOAuth.SCOPES.filter((scope) => (tokenDoc.scopes || []).includes(scope));
    const granted = new Set((tokenDoc?.scopes || []).filter((scope) => mcpOAuth.SCOPES.includes(scope)));
    if (hasScope(tokenDoc, 'read')) mcpOAuth.READ_SCOPES.forEach((scope) => granted.add(scope));
    if (hasScope(tokenDoc, 'write')) mcpOAuth.WRITE_SCOPES.forEach((scope) => granted.add(scope));
    return mcpOAuth.SCOPES.filter((scope) => granted.has(scope));
};

const toolCallsOf = (messages) => messages
    .filter((message) => message && message.method === 'tools/call')
    .map((message) => String((message.params && message.params.name) || ''));

const scopesFor = (messages) => {
    const needed = new Set(toolCallsOf(messages).map(scopeForTool).filter(Boolean));
    return mcpOAuth.SCOPES.filter((scope) => needed.has(scope));
};

const missingScopes = (tokenDoc, messages) => {
    const granted = grantedScopes(tokenDoc);
    return scopesFor(messages).filter((scope) => !granted.includes(scope));
};

const quoted = (value) => String(value).replace(/["\\]/g, '');

const challenge = (params) => `Bearer ${Object.entries(params)
    .filter(([, value]) => value)
    .map(([key, value]) => `${key}="${quoted(value)}"`)
    .join(', ')}`;

module.exports = { TOOL_SCOPES, DISCOVERY_SCOPES, scopeForTool, grantedScopes, scopesFor, missingScopes, challenge };
