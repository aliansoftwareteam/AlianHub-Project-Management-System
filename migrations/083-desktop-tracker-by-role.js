const { ROLE_GUEST, ROLE_OWNER, ROLE_ADMIN } = require('../Config/roleTypes');

/* Adds Time tracking > Desktop time tracker to every company's Security & Permissions and switches it on
 * for Member and every custom role, so access to the desktop tracker follows the role instead of a
 * per-member flag. Guests stay off; owners and admins hold every right anyway.
 *
 * The catalogue repair rewrites the rules collection, which is safe only before the server listens, as here.
 * An entry this adds carries SEEDED_BY, so down() removes exactly those while they still hold the value given. */

const ID = '083-desktop-tracker-by-role';
const SEEDED_BY = ID;
const SECTION = 'time_tracking';
const RIGHT = 'desktop_tracker';

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

async function trackedRoles(ctx, companyId) {
    const doc = await ctx.company(companyId, { type: ctx.SCHEMA_TYPE.SETTINGS, data: [{ name: ctx.settingsCollectionDocs.ROLES }] }, 'findOne');
    return (Array.isArray(doc && doc.settings) ? doc.settings : [])
        .map((role) => role && role.key)
        .filter((key) => typeof key === 'number' && ![ROLE_GUEST, ROLE_OWNER, ROLE_ADMIN].includes(key));
}

async function grantCompany(ctx, companyId) {
    const type = ctx.SCHEMA_TYPE.RULES;
    const rules = await ctx.company(companyId, { type, data: [{ key: { $in: [SECTION, RIGHT] }, projectId: { $exists: false } }] }, 'find') || [];
    if (!rules.length) return { granted: 0, skipped: 'unseeded' };
    const roleKeys = await trackedRoles(ctx, companyId);
    let granted = 0;
    for (const rule of rules) {
        let roles = rule.roles || [];
        let changed = false;
        for (const roleKey of roleKeys) {
            const next = grant({ roles }, roleKey);
            if (next) { roles = next; changed = true; granted += 1; }
        }
        // eslint-disable-next-line no-await-in-loop
        if (changed) await ctx.company(companyId, { type, data: [{ _id: rule._id }, { $set: { roles } }] }, 'updateOne');
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
    const rules = await ctx.company(companyId, { type, data: [{ key: { $in: [SECTION, RIGHT] }, projectId: { $exists: false } }] }, 'find') || [];
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
