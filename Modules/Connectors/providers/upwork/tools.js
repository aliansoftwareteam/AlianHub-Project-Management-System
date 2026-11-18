const { mcpTool } = require('../../mcpTools');

/* Upwork's tool names are not published; these are placeholders for scripts/connector-tool-shapes.js to correct and
 * pin with a test account. Until a shape is pinned, each tool stays off. */
module.exports = [
    mcpTool({
        key: 'upwork.contracts.list',
        label: 'Connectors.tool.upworkContractsList',
        kind: 'read',
        product: 'work',
        input: { type: 'object', description: 'Lists the person\'s active Upwork contracts, with client, title and status.', properties: {}, additionalProperties: false },
        caps: { maxItems: 50, maxChars: 8000 },
        tool: 'list_contracts',
        shape: null,
    }),
    mcpTool({
        key: 'upwork.jobs.search',
        label: 'Connectors.tool.upworkJobsSearch',
        kind: 'read',
        product: 'work',
        input: {
            type: 'object',
            description: 'Searches Upwork jobs the person can see, by words.',
            properties: { query: { type: 'string', maxLength: 200, description: 'Words to look for.' } },
            required: ['query'],
            additionalProperties: false,
        },
        caps: { maxItems: 20, maxChars: 8000 },
        tool: 'search_jobs',
        shape: null,
    }),
];
