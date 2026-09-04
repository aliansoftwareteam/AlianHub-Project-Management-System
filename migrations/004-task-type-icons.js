const { applyTaskTypeIcons } = require('./lib/taskTypeIcons');

module.exports = {
    id: '004-task-type-icons',
    scope: 'company',
    async up(ctx) {
        const { removeCache } = require('../utils/commonFunctions');
        await ctx.forEachCompany(async (companyId) => {
            const summary = await applyTaskTypeIcons(ctx, companyId);
            removeCache(`tasktype:${companyId}`, true);
            removeCache(`taskTypeTemplate:${companyId}`);
            removeCache(`UserProjectData:${companyId}:`, true);
            return summary;
        });
    },
};
