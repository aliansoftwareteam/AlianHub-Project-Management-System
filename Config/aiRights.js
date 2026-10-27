/*
 * The AI rows of Security & Permissions (section `artificial_intelligence`) and how they are read.
 * Owners and admins hold every row. Agents and tokens are judged as the person behind them.
 *
 * These checks are made in the handler and are always enforced, whatever PERMISSION_ENFORCEMENT_MODE
 * says for browser sessions: they replace owner/admin checks that were always enforced.
 */
const { evaluatePermission, isWritable, isReadable } = require('./permissionGuard');
const logger = require('./loggerConfig');

const SECTION = 'artificial_intelligence';

const AI_RIGHT = Object.freeze({
    ASSISTANT: 'ai_assistant',
    AGENT_USE: 'ai_agent_use',
    AGENTS: 'ai_agents',
    SKILLS: 'ai_skills',
    SKILL_RISK: 'ai_skill_risk',
    CONNECTORS: 'ai_connectors',
    EXTERNAL_CLIENTS: 'ai_external_clients',
});

/* The matrix stores the highest skill risk as a number; owners and admins evaluate to true. */
const SKILL_RISK_LEVELS = Object.freeze({ 1: 'low', 2: 'medium', 3: 'high' });
const RISK_ORDER = Object.freeze(['low', 'medium', 'high']);

const aiPath = (key) => `${SECTION}.${key}`;

const REFUSAL = Object.freeze({
    [AI_RIGHT.ASSISTANT]: 'Your role does not include Ask AI and writing help. Ask an Owner or an Admin to turn it on in Security & Permissions.',
    [AI_RIGHT.AGENT_USE]: 'Your role does not include working with agents. Ask an Owner or an Admin to turn it on in Security & Permissions.',
    [AI_RIGHT.AGENTS]: 'Your role does not include building agents. Ask an Owner or an Admin to turn it on in Security & Permissions.',
    [AI_RIGHT.SKILLS]: 'Your role does not include writing skills. Ask an Owner or an Admin to turn it on in Security & Permissions.',
    [AI_RIGHT.CONNECTORS]: 'Your role does not include connecting apps for AI. Ask an Owner or an Admin to turn it on in Security & Permissions.',
    [AI_RIGHT.EXTERNAL_CLIENTS]: 'Your role does not include connecting your own AI. Ask an Owner or an Admin to turn it on in Security & Permissions.',
});
const UNCHECKED = 'Your AI access could not be checked just now. Try again.';

/* The stored value: null, false (Read), true (Read & Write), or a number for the skill risk. Throws when unreadable. */
const aiRight = (companyId, uid, key) => evaluatePermission(companyId, uid, aiPath(key), { strict: true });

const mayUse = async (companyId, uid, key) => isWritable(await aiRight(companyId, uid, key));

const maySee = async (companyId, uid, key) => isReadable(await aiRight(companyId, uid, key));

/* 'low' | 'medium' | 'high', or null when the person's agents may use no skill at all. */
const skillRiskCap = async (companyId, uid) => {
    const value = await aiRight(companyId, uid, AI_RIGHT.SKILL_RISK);
    if (value === true) return 'high';
    return SKILL_RISK_LEVELS[value] || null;
};

const riskWithin = (cap, risk) => Boolean(cap) && RISK_ORDER.indexOf(risk || 'low') <= RISK_ORDER.indexOf(cap);

/* Route guard: the caller must hold `key` (Read & Write, or Read with { write: false }). */
const requireAiRight = (key, { write = true } = {}) => Object.assign(async (req, res, next) => {
    const companyId = req.headers.companyid || '';
    try {
        const value = await aiRight(companyId, req.uid, key);
        if (write ? isWritable(value) : isReadable(value)) return next();
        const message = REFUSAL[key] || REFUSAL[AI_RIGHT.ASSISTANT];
        return res.status(403).json({ status: false, statusText: message, message, permission: aiPath(key) });
    } catch (error) {
        logger.error(`requireAiRight ${key}: ${error.message || error}`);
        return res.status(403).json({ status: false, statusText: UNCHECKED, message: UNCHECKED, permission: aiPath(key) });
    }
}, { permission: aiPath(key) });

module.exports = {
    SECTION, AI_RIGHT, SKILL_RISK_LEVELS, REFUSAL, UNCHECKED,
    aiPath, aiRight, mayUse, maySee, skillRiskCap, riskWithin, requireAiRight,
};
