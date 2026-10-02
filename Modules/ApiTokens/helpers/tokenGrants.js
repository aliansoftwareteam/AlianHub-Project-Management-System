const manageFlag = require('../../Mcp/manageFlag');
const dataFlag = require('../../Mcp/dataFlag');
const { CHAT_SCOPE } = require('../../../Config/mcpOAuth');

/* What an agent token can be created to do beyond read and write. Each is asked for by name when the token is
 * made, and none is part of another: a token that reads does not read chat, and one that manages tasks does not. */
const GRANTS = Object.freeze([...manageFlag.GRANTS, CHAT_SCOPE]);

const REFUSALS = Object.freeze({
    unknown: `grants must be a list drawn from: ${GRANTS.join(', ')}.`,
    off: 'The management tools are not switched on for this server (MCP_TOOLS_MANAGE).',
    readOnly: 'A token can be given a grant only when it has the write scope.',
    chatOff: 'The read tools are not switched on for this server (MCP_TOOLS_DATA).',
    chatNeedsRead: 'A token can read chat only when it has the read scope.',
});

/* A grant is named only while its tools are on. */
const offered = () => [...(manageFlag.enabled() ? manageFlag.GRANTS : []), ...(dataFlag.enabled() ? [CHAT_SCOPE] : [])];

/* The grants a new agent token is created with, or why the request is refused. */
const grantsFor = (asked, scopes) => {
    if (asked === undefined || asked === null) return { grants: [] };
    if (!Array.isArray(asked) || asked.some((grant) => !GRANTS.includes(grant))) return { refusal: REFUSALS.unknown };
    if (asked.some((grant) => manageFlag.GRANTS.includes(grant))) {
        if (!manageFlag.enabled()) return { refusal: REFUSALS.off };
        if (!scopes.includes('write')) return { refusal: REFUSALS.readOnly };
    }
    if (asked.includes(CHAT_SCOPE)) {
        if (!dataFlag.enabled()) return { refusal: REFUSALS.chatOff };
        if (!scopes.includes('read')) return { refusal: REFUSALS.chatNeedsRead };
    }
    return { grants: GRANTS.filter((grant) => asked.includes(grant)) };
};

module.exports = { GRANTS, offered, grantsFor };
