/* Task 110 replaced a connection's `toolsOff` list with a permission per tool. Every key a member had turned off becomes
 * an Off permission on the same connection. A REST app's tool reads it from there directly; an MCP app's tool takes it
 * when its server first lists a tool of that name. The old field is removed, so a second run finds nothing to do. */

const ID = '088-connector-tool-permissions';
const OFF = 'off';

const permissionsOf = (row) => {
    const kept = (Array.isArray(row.toolPermissions) ? row.toolPermissions : []).filter((entry) => entry && entry.key);
    const chosen = new Set(kept.map((entry) => String(entry.key)));
    const turnedOff = [...new Set((row.toolsOff || []).map(String))].filter((key) => !chosen.has(key));
    return [...kept, ...turnedOff.map((key) => ({ key, permission: OFF }))];
};

async function moveCompany(ctx, companyId) {
    const type = ctx.SCHEMA_TYPE.CONNECTOR_CONNECTIONS;
    const rows = (await ctx.company(companyId, { type, data: [{ toolsOff: { $exists: true } }] }, 'find')) || [];
    let moved = 0;
    for (const row of rows) {
        // eslint-disable-next-line no-await-in-loop
        await ctx.company(companyId, { type, data: [{ _id: row._id }, { $set: { toolPermissions: permissionsOf(row) }, $unset: { toolsOff: 1 } }] }, 'updateOne');
        moved += (row.toolsOff || []).length ? 1 : 0;
    }
    return { moved };
}

module.exports = {
    id: ID,
    scope: 'company',
    moveCompany,
    async up(ctx) {
        await ctx.forEachCompany(async (companyId) => {
            const done = await moveCompany(ctx, companyId);
            if (done.moved) ctx.logger.info(`[migrations] 088 ${companyId}: ${done.moved} connections had tools turned off, now Off permissions`);
            return done;
        });
    },
};
