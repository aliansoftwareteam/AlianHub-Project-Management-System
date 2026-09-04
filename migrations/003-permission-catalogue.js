/* Brings every company's permission list up to date with the catalogue in
 * utils/data.js. The repair clears and rewrites the rules collection, which is
 * only safe while nobody is served: the runner executes before the server
 * listens, which is exactly that window. */
module.exports = {
    id: '003-permission-catalogue',
    scope: 'company',
    async up(ctx) {
        const { repairCompanyRules } = require('../Modules/settings/securityPermissions/reconcileRules');
        await ctx.forEachCompany((companyId) => repairCompanyRules(companyId));
    },
};
