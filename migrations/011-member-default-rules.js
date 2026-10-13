const { MEMBER_ROLE_TYPE, MEMBER_DEFAULT_PERMISSIONS } = require('../Modules/settings/securityPermissions/memberDefaults');

/* Companies seeded before the Member defaults shipped (PR #506) hold rules with no Member entry at
 * all, and a missing entry reads as "None" everywhere: the settings matrix, the web app and the
 * API. Their members could do almost nothing. 003 cannot help, it only looks for missing keys.
 *
 * Only a company where no global rule has a Member entry is touched, because any entry means an
 * owner has used the matrix for that role and a gap there is their choice. Each added entry carries
 * SEEDED_BY so down() removes exactly those, and only while the value is still the default. */

const ID = '011-member-default-rules';
const SEEDED_BY = ID;

const hasMember = (rule) => (rule.roles || []).some((role) => role && role.key === MEMBER_ROLE_TYPE);

async function memberRoleExists(ctx, companyId) {
    const roles = await ctx.company(companyId, { type: ctx.SCHEMA_TYPE.SETTINGS, data: [{ name: ctx.settingsCollectionDocs.ROLES }] }, 'findOne');
    return Array.isArray(roles && roles.settings) && roles.settings.some((role) => role && role.key === MEMBER_ROLE_TYPE);
}

async function backfillCompany(ctx, companyId) {
    const type = ctx.SCHEMA_TYPE.RULES;
    const rules = await ctx.company(companyId, { type, data: [{ projectId: { $exists: false } }] }, 'find') || [];
    if (!rules.length) return { added: 0, skipped: 'unseeded' };
    if (rules.some(hasMember)) return { added: 0, skipped: 'configured' };
    if (!(await memberRoleExists(ctx, companyId))) return { added: 0, skipped: 'no-member-role' };

    let added = 0;
    for (const rule of rules) {
        const permission = MEMBER_DEFAULT_PERMISSIONS[rule.key];
        if (permission === undefined) continue;
        const result = await ctx.company(companyId, {
            type,
            data: [
                { _id: rule._id, 'roles.key': { $ne: MEMBER_ROLE_TYPE } },
                { $push: { roles: { key: MEMBER_ROLE_TYPE, permission, seededBy: SEEDED_BY } } },
            ],
        }, 'updateOne');
        added += result && result.modifiedCount ? 1 : 0;
    }
    return { added, rules: rules.length };
}

async function revertCompany(ctx, companyId) {
    const type = ctx.SCHEMA_TYPE.RULES;
    const rules = await ctx.company(companyId, { type, data: [{ projectId: { $exists: false } }] }, 'find') || [];
    let removed = 0;
    let keptChanged = 0;
    for (const rule of rules) {
        const roles = rule.roles || [];
        const seeded = roles.filter((role) => role && role.seededBy === SEEDED_BY);
        if (!seeded.length) continue;
        const untouched = (role) => role.seededBy === SEEDED_BY && role.key === MEMBER_ROLE_TYPE && role.permission === MEMBER_DEFAULT_PERMISSIONS[rule.key];
        const kept = roles.filter((role) => !(role && untouched(role)));
        keptChanged += seeded.length - (roles.length - kept.length);
        if (kept.length === roles.length) continue;
        await ctx.company(companyId, { type, data: [{ _id: rule._id }, { $set: { roles: kept } }] }, 'updateOne');
        removed += roles.length - kept.length;
    }
    return { removed, keptChanged };
}

module.exports = {
    id: ID,
    scope: 'company',
    SEEDED_BY,
    backfillCompany,
    async up(ctx) {
        const { removeCache } = require('../utils/commonFunctions');
        await ctx.forEachCompany(async (companyId) => {
            const counts = await backfillCompany(ctx, companyId);
            if (counts.added) removeCache(`rules:${companyId}`);
            ctx.logger.info(`[migrations] 011 ${companyId}: ${JSON.stringify(counts)}`);
            return counts;
        });
    },
    async down(ctx) {
        const { removeCache } = require('../utils/commonFunctions');
        await ctx.forEachCompany(async (companyId) => {
            const counts = await revertCompany(ctx, companyId);
            if (counts.removed) removeCache(`rules:${companyId}`);
            ctx.logger.info(`[migrations] 011 down ${companyId}: ${JSON.stringify(counts)}`);
            return counts;
        });
    },
};
