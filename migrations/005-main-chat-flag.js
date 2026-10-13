const mongoose = require('mongoose');

/* One-to-one chats are tasks in the hidden "default" chat project, found only by
 * mainChat:true. The task schema went strict before that field was declared, so
 * conversations created in between were saved without it and vanished from the
 * list. Deleted conversations stay deleted: flagging them would resurrect them. */
module.exports = {
    id: '005-main-chat-flag',
    scope: 'company',
    async up(ctx) {
        const { SCHEMA_TYPE } = ctx;
        await ctx.forEachCompany(async (companyId) => {
            const chatProjects = await ctx.company(companyId, { type: SCHEMA_TYPE.MAIN_CHATS, data: [{ default: true }] }, 'find');
            let repaired = 0;
            for (const project of chatProjects || []) {
                const filter = { ProjectID: new mongoose.Types.ObjectId(String(project._id)), mainChat: { $ne: true }, deletedStatusKey: 0 };
                const result = await ctx.company(companyId, { type: SCHEMA_TYPE.TASKS, data: [filter, { $set: { mainChat: true } }] }, 'updateMany');
                repaired += (result && result.modifiedCount) || 0;
            }
            return { repaired };
        });
    },
};
