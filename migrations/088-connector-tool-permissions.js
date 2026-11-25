/* Task 110 replaced a connection's `toolsOff` list with a permission per tool. Every key a member had turned off becomes
 * an Off permission on the same connection. A REST app's tool reads it from there directly; an MCP app's tool takes it
 * when its server first lists a tool of that name. The old field is removed, so a second run finds nothing to do.
 * An MCP app's built-in tools were deleted for the ones its server lists, under new keys, so an old key is written
 * out here as the server tool it called: kept as it was, it could never match a listed tool. */

const ID = '088-connector-tool-permissions';
const OFF = 'off';

const RENAMED = Object.freeze({
    'canva.designs.search': 'canva.search-designs',
    'canva.design.read': 'canva.get-design-content',
    'dropbox.files.search': 'dropbox.search',
    'dropbox.file.read': 'dropbox.fetch',
    'github.pull_request.read': 'github.pull_request_read',
    'github.pull_request.checks': 'github.pull_request_read',
    'github.pull_requests.search': 'github.search_pull_requests',
    'github.issue.read': 'github.issue_read',
    'github.issue.comment': 'github.add_issue_comment',
    'hubspot.crm.search': 'hubspot.search_crm_objects',
    'hubspot.crm.read': 'hubspot.get_crm_objects',
    'notion.pages.search': 'notion.notion-search',
    'notion.page.read': 'notion.notion-fetch',
    'notion.page.create': 'notion.notion-create-pages',
    'supabase.projects.list': 'supabase.list_projects',
    'supabase.project.read': 'supabase.get_project',
    'supabase.tables.list': 'supabase.list_tables',
    'upwork.contracts.list': 'upwork.list_contracts',
    'upwork.jobs.search': 'upwork.search_jobs',
    'wisprflow.meetings.search': 'wisprflow.search_meetings',
    'wisprflow.meeting.read': 'wisprflow.get_meeting',
});

const permissionsOf = (row) => {
    const kept = (Array.isArray(row.toolPermissions) ? row.toolPermissions : []).filter((entry) => entry && entry.key);
    const chosen = new Set(kept.map((entry) => String(entry.key)));
    const turnedOff = [...new Set((row.toolsOff || []).map((key) => RENAMED[String(key)] || String(key)))].filter((key) => !chosen.has(key));
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
    RENAMED,
    moveCompany,
    async up(ctx) {
        await ctx.forEachCompany(async (companyId) => {
            const done = await moveCompany(ctx, companyId);
            if (done.moved) ctx.logger.info(`[migrations] 088 ${companyId}: ${done.moved} connections had tools turned off, now Off permissions`);
            return done;
        });
    },
};
