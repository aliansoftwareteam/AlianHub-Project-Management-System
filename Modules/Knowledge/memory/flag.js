const indexerFlag = require('../flag').indexer;

// KNOWLEDGE_AGENT_MEMORY rides on the indexer's switch: an agent's memories are indexed and
// retrieved only for a company whose indexer is on, and only while this is "on" as well.

const MODES = ['off', 'on'];

const mode = () => {
    const raw = String(process.env.KNOWLEDGE_AGENT_MEMORY || 'off').trim().toLowerCase();
    return MODES.includes(raw) ? raw : 'off';
};

const installed = () => mode() === 'on' && indexerFlag.mode() !== 'off';

const enabledFor = async (companyId) => installed() && indexerFlag.enabledFor(companyId);

module.exports = { MODES, mode, installed, enabledFor };
