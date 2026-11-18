const { mcpTool } = require('../../mcpTools');

/* Dropbox's tool names are not published; these are placeholders for scripts/connector-tool-shapes.js to correct and
 * pin with a test account. Until a shape is pinned, each tool stays off. */
module.exports = [
    mcpTool({
        key: 'dropbox.files.search',
        label: 'Connectors.tool.dropboxFilesSearch',
        kind: 'read',
        product: 'files',
        scope: 'files.metadata.read',
        input: {
            type: 'object',
            description: 'Searches the files and folders in the person\'s own Dropbox by name and words.',
            properties: { query: { type: 'string', maxLength: 200, description: 'Words to look for.' } },
            required: ['query'],
            additionalProperties: false,
        },
        caps: { maxItems: 25, maxChars: 6000 },
        tool: 'search',
        shape: null,
    }),
    mcpTool({
        key: 'dropbox.file.read',
        label: 'Connectors.tool.dropboxFileRead',
        kind: 'read',
        product: 'files',
        scope: 'files.content.read',
        input: {
            type: 'object',
            description: 'Reads the text of one file in the person\'s own Dropbox, by its path.',
            properties: { path: { type: 'string', maxLength: 500, description: 'The file\'s path in Dropbox.' } },
            required: ['path'],
            additionalProperties: false,
        },
        caps: { maxItems: 1, maxChars: 12000 },
        tool: 'fetch',
        shape: null,
        args: (input) => ({ path: input.path }),
    }),
];
