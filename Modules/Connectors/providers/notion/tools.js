const { mcpTool } = require('../../mcpTools');

/* Shapes are pinned with scripts/connector-tool-shapes.js and a test account; until then each tool stays off. */
module.exports = [
    mcpTool({
        key: 'notion.pages.search',
        label: 'Connectors.tool.notionPagesSearch',
        kind: 'read',
        product: 'workspace',
        input: {
            type: 'object',
            description: 'Searches the pages and databases the person can open in their own Notion workspace.',
            properties: { query: { type: 'string', maxLength: 300, description: 'Words to look for.' } },
            required: ['query'],
            additionalProperties: false,
        },
        caps: { maxItems: 20, maxChars: 8000 },
        tool: 'notion-search',
        shape: null,
    }),
    mcpTool({
        key: 'notion.page.read',
        label: 'Connectors.tool.notionPageRead',
        kind: 'read',
        product: 'workspace',
        input: {
            type: 'object',
            description: 'Reads one Notion page or database the person can open, by its link or id.',
            properties: { page: { type: 'string', maxLength: 400, description: 'The page\'s Notion link or id.' } },
            required: ['page'],
            additionalProperties: false,
        },
        caps: { maxItems: 1, maxChars: 12000 },
        tool: 'notion-fetch',
        shape: null,
        args: (input) => ({ id: input.page }),
    }),
    mcpTool({
        key: 'notion.page.create',
        label: 'Connectors.tool.notionPageCreate',
        kind: 'write',
        product: 'workspace',
        input: {
            type: 'object',
            description: 'Creates a page in the person\'s own Notion, under a page they choose or at the top of their workspace.',
            properties: {
                title: { type: 'string', maxLength: 200, description: 'The page title.' },
                content: { type: 'string', maxLength: 20000, description: 'The page text, in Markdown.' },
                parent: { type: 'string', maxLength: 400, description: 'The link or id of the page to put it under.' },
            },
            required: ['title', 'content'],
            additionalProperties: false,
        },
        caps: { maxItems: 1, maxChars: 500 },
        card: (input) => ({ target: input.parent || 'Notion', title: input.title, text: input.content }),
        tool: 'notion-create-pages',
        shape: null,
        args: (input) => ({ pages: [{ properties: { title: input.title }, content: input.content }], ...(input.parent ? { parent: { page_id: input.parent } } : {}) }),
    }),
];
