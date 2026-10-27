const { ROLE_GUEST, ROLE_OWNER, ROLE_ADMIN } = require('../Config/roleTypes');

/* Adds the AI rows of Security & Permissions (Config/aiRights.js) to every company, then gives each existing
 * role the everyday AI it could use before the rows existed: Ask AI and Connect your own AI were open to every
 * seat, guests included; working with agents and app connectors to every seat but a guest's. Building agents,
 * writing skills and seeing every agent were owner/admin only and stay off.
 *
 * The catalogue repair rewrites the rules collection, which is safe only before the server listens, as here.
 * An entry this adds carries SEEDED_BY, so down() removes exactly those while they still hold the value given. */

const ID = '078-ai-access-rules';
const SEEDED_BY = ID;
const SECTION = 'artificial_intelligence';

const EVERY_SEAT = Object.freeze(['ai_assistant', 'ai_external_clients']);
const MEMBERS_ONLY = Object.freeze(['ai_agent_use', 'ai_connectors']);

const grantsFor = (roleKey) => (roleKey === ROLE_GUEST ? EVERY_SEAT : [...EVERY_SEAT, ...MEMBERS_ONLY]);

/* A role's entry is still the seeded one when it is missing or None and nobody marked it. */
const unset = (entry) => !entry || (entry.permission === null && !entry.seededBy);

const grant = (rule, roleKey) => {
    const roles = [...(rule.roles || [])];
    const at = roles.findIndex((role) => role && role.key === roleKey);
    if (!unset(roles[at])) return null;
    const entry = { key: roleKey, permission: true, seededBy: SEEDED_BY };
    if (at === -1) roles.push(entry);
    else roles[at] = entry;
    return roles;
};

async function companyRoles(ctx, companyId) {
    const doc = await ctx.company(companyId, { type: ctx.SCHEMA_TYPE.SETTINGS, data: [{ name: ctx.settingsCollectionDocs.ROLES }] }, 'findOne');
    return (Array.isArray(doc && doc.settings) ? doc.settings : [])
        .map((role) => role && role.key)
        .filter((key) => typeof key === 'number' && key !== ROLE_OWNER && key !== ROLE_ADMIN);
}

async function grantCompany(ctx, companyId) {
    const type = ctx.SCHEMA_TYPE.RULES;
    const rules = await ctx.company(companyId, { type, data: [{ projectId: { $exists: false } }] }, 'find') || [];
    if (!rules.length) return { granted: 0, skipped: 'unseeded' };
    const byKey = new Map(rules.map((rule) => [rule.key, rule]));
    let granted = 0;
    const save = async (rule, roles) => {
        await ctx.company(companyId, { type, data: [{ _id: rule._id }, { $set: { roles } }] }, 'updateOne');
        rule.roles = roles;
        granted += 1;
    };
    for (const roleKey of await companyRoles(ctx, companyId)) {
        let any = false;
        for (const key of grantsFor(roleKey)) {
            const rule = byKey.get(key);
            if (!rule) continue;
            const roles = grant(rule, roleKey);
            // eslint-disable-next-line no-await-in-loop
            if (roles) await save(rule, roles);
            any = true;
        }
        const section = byKey.get(SECTION);
        const sectionRoles = any && section ? grant(section, roleKey) : null;
        // eslint-disable-next-line no-await-in-loop
        if (sectionRoles) await save(section, sectionRoles);
    }
    return { granted };
}

async function upCompany(ctx, companyId) {
    const { repairCompanyRules } = require('../Modules/settings/securityPermissions/reconcileRules');
    const repair = await repairCompanyRules(companyId);
    if (repair.skipped) return { repaired: false, granted: 0, skipped: repair.skipped };
    return { repaired: Boolean(repair.repaired), ...(await grantCompany(ctx, companyId)) };
}

async function revertCompany(ctx, companyId) {
    const type = ctx.SCHEMA_TYPE.RULES;
    const rules = await ctx.company(companyId, { type, data: [{ projectId: { $exists: false } }] }, 'find') || [];
    let removed = 0;
    for (const rule of rules) {
        const roles = rule.roles || [];
        const kept = roles.filter((role) => !(role && role.seededBy === SEEDED_BY && role.permission === true));
        if (kept.length === roles.length) continue;
        // eslint-disable-next-line no-await-in-loop
        await ctx.company(companyId, { type, data: [{ _id: rule._id }, { $set: { roles: kept } }] }, 'updateOne');
        removed += roles.length - kept.length;
    }
    return { removed };
}

module.exports = {
    id: ID,
    scope: 'company',
    SEEDED_BY,
    grantCompany,
    revertCompany,
    async up(ctx) {
        const { removeCache } = require('../utils/commonFunctions');
        await ctx.forEachCompany(async (companyId) => {
            const counts = await upCompany(ctx, companyId);
            removeCache(`rules:${companyId}`);
            ctx.logger.info(`[migrations] ${ID} ${companyId}: ${JSON.stringify(counts)}`);
            return counts;
        });
    },
    async down(ctx) {
        const { removeCache } = require('../utils/commonFunctions');
        await ctx.forEachCompany(async (companyId) => {
            const counts = await revertCompany(ctx, companyId);
            if (counts.removed) removeCache(`rules:${companyId}`);
            ctx.logger.info(`[migrations] ${ID} down ${companyId}: ${JSON.stringify(counts)}`);
            return counts;
        });
    },
};
