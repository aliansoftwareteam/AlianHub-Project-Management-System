const { mcpTool } = require('../../mcpTools');

/* Canva's tool names are not published; these are placeholders for scripts/connector-tool-shapes.js to correct and
 * pin with a test account. Until a shape is pinned, each tool stays off. */
module.exports = [
    mcpTool({
        key: 'canva.designs.search',
        label: 'Connectors.tool.canvaDesignsSearch',
        kind: 'read',
        product: 'designs',
        scope: 'design:meta:read',
        input: {
            type: 'object',
            description: 'Searches the person\'s Canva designs by words, with their titles and links.',
            properties: { query: { type: 'string', maxLength: 200, description: 'Words to look for.' } },
            required: ['query'],
            additionalProperties: false,
        },
        caps: { maxItems: 20, maxChars: 6000 },
        tool: 'search-designs',
        shape: null,
    }),
    mcpTool({
        key: 'canva.design.read',
        label: 'Connectors.tool.canvaDesignRead',
        kind: 'read',
        product: 'designs',
        scope: 'design:content:read',
        input: {
            type: 'object',
            description: 'Reads the text of one of the person\'s Canva designs, page by page.',
            properties: { designId: { type: 'string', maxLength: 64, description: 'The design id from a search.' } },
            required: ['designId'],
            additionalProperties: false,
        },
        caps: { maxItems: 1, maxChars: 12000 },
        tool: 'get-design-content',
        shape: null,
        args: (input) => ({ design_id: input.designId }),
    }),
];
