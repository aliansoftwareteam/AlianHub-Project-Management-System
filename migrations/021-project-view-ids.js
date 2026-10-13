const { withViewIds, isMissingViewId } = require('../Modules/createProject/viewEntries');

/* Projects created from a template view the company's project_tab_components catalogue does
 * not carry stored that entry with no `_id` — Board, on every workspace whose catalogue was
 * pruned. The project view bar reads `_id.length` to tell a view from an embed, so the entry
 * threw there and left the project with no view bar and no task list at all.
 *
 * Only an entry with no id is given one, from the company's catalogue row for that keyName
 * when there is one. An entry that already has an id keeps it: that id is what a rename, pin
 * or delete matches on, so renumbering would orphan those writes. */

const ID = '021-project-view-ids';

async function repairCompany(ctx, companyId) {
    const type = ctx.SCHEMA_TYPE.PROJECTS;
    const catalogue = await ctx.company(companyId, { type: ctx.SCHEMA_TYPE.PROJECT_TAB_COMPONENTS, data: [{}] }, 'find') || [];
    const projects = await ctx.company(companyId, { type, data: [{}, { _id: 1, ProjectRequiredComponent: 1 }] }, 'find') || [];
    let repaired = 0;
    let entries = 0;
    for (const project of projects) {
        const views = Array.isArray(project.ProjectRequiredComponent) ? project.ProjectRequiredComponent : [];
        const missing = views.filter(isMissingViewId).length;
        if (!missing) continue;
        await ctx.company(companyId, {
            type,
            data: [{ _id: project._id }, { $set: { ProjectRequiredComponent: withViewIds(views, catalogue) } }],
        }, 'updateOne');
        repaired += 1;
        entries += missing;
    }
    return { projects: projects.length, repaired, entries };
}

module.exports = {
    id: ID,
    scope: 'company',
    repairCompany,
    async up(ctx) {
        const { removeCache } = require('../utils/commonFunctions');
        await ctx.forEachCompany(async (companyId) => {
            const counts = await repairCompany(ctx, companyId);
            if (counts.repaired) removeCache(`UserProjectData:${companyId}:`, true);
            ctx.logger.info(`[migrations] 021 ${companyId}: ${JSON.stringify(counts)}`);
            return counts;
        });
    },
};
