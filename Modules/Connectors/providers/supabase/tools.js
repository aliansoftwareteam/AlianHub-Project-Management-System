const { mcpTool } = require('../../mcpTools');

const projectId = { type: 'string', maxLength: 64, description: 'The Supabase project id.' };

/* Shapes are pinned with scripts/connector-tool-shapes.js and a test account; until then each tool stays off. */
module.exports = [
    mcpTool({
        key: 'supabase.projects.list',
        label: 'Connectors.tool.supabaseProjectsList',
        kind: 'read',
        product: 'projects',
        scope: 'projects:read',
        input: { type: 'object', description: 'Lists the Supabase projects the person can open, with their ids and status.', properties: {}, additionalProperties: false },
        caps: { maxItems: 50, maxChars: 6000 },
        tool: 'list_projects',
        shape: null,
    }),
    mcpTool({
        key: 'supabase.project.read',
        label: 'Connectors.tool.supabaseProjectRead',
        kind: 'read',
        product: 'projects',
        scope: 'projects:read',
        input: { type: 'object', description: 'Reads one Supabase project the person can open: its status, region and database version.', properties: { projectId }, required: ['projectId'], additionalProperties: false },
        caps: { maxItems: 1, maxChars: 4000 },
        tool: 'get_project',
        shape: null,
        args: (input) => ({ id: input.projectId }),
    }),
    mcpTool({
        key: 'supabase.tables.list',
        label: 'Connectors.tool.supabaseTablesList',
        kind: 'read',
        product: 'projects',
        scope: 'database:read',
        input: { type: 'object', description: 'Lists the tables of one Supabase project\'s database, with their columns.', properties: { projectId }, required: ['projectId'], additionalProperties: false },
        caps: { maxItems: 200, maxChars: 12000 },
        tool: 'list_tables',
        shape: null,
        args: (input) => ({ project_id: input.projectId }),
    }),
];
