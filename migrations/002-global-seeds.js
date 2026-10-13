/* The global seeds (restricted extensions, custom-field types, tours) used to be
 * written only by the installer. A database created by hand or restored without
 * them gets them here; one that has them is left alone, because the seed
 * functions clear their collection before writing. */
module.exports = {
    id: '002-global-seeds',
    scope: 'global',
    async up(ctx) {
        const count = await ctx.global({ type: ctx.SCHEMA_TYPE.GLOBAL_CUSTOM_FIELDS, data: [{}] }, 'countDocuments');
        if (count > 0) return;
        const { startInitialization } = require('../Modules/Setup/initalizations');
        await startInitialization();
    },
};
