const { SCHEMA_TYPE } = require('../../Config/schemaType');
const { MEMBER_DEFAULT_PERMISSIONS } = require('../../Modules/settings/securityPermissions/memberDefaults');
const { AI_RIGHT } = require('../../Config/aiRights');

/* The AI rows of Security & Permissions as a new workspace seeds them: members get the everyday AI, guests none.
 * `members` overrides what role 3 holds on a key, for example { ai_agents: true }. */
const seedAiRules = (mockDb, { members = {} } = {}) => {
    const seed = (row) => mockDb.seed(SCHEMA_TYPE.RULES, row);
    const section = seed({ key: 'artificial_intelligence', name: 'Artificial Intelligence', isParent: true, roles: [{ key: 3, permission: true }] });
    Object.values(AI_RIGHT).forEach((key) => {
        const permission = key in members ? members[key] : MEMBER_DEFAULT_PERMISSIONS[key];
        seed({ key, name: key, isParent: false, parentId: String(section._id), roles: permission === undefined ? [] : [{ key: 3, permission }] });
    });
};

module.exports = { seedAiRules };
