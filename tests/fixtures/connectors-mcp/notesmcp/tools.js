const { mcpTool } = require('../../../../Modules/Connectors/mcpTools');
const { shapeOfTool } = require('../../fakeMcpServer');

const query = { type: 'string', maxLength: 200, description: 'Words to look for.' };

module.exports = [
    mcpTool({
        key: 'notesmcp.notes.search',
        label: 'Connectors.tool.notesmcpNotesSearch',
        kind: 'read',
        product: 'notes',
        input: { type: 'object', description: 'Searches the person\'s own notes in Notes.', properties: { query }, required: ['query'], additionalProperties: false },
        caps: { maxItems: 10, maxChars: 40 },
        tool: 'search_notes',
        shape: shapeOfTool('search_notes'),
    }),
    mcpTool({
        key: 'notesmcp.notes.archive',
        label: 'Connectors.tool.notesmcpNotesArchive',
        kind: 'read',
        product: 'notes',
        input: { type: 'object', description: 'A tool nobody has reviewed yet, so it is never offered.', properties: {}, additionalProperties: false },
        caps: { maxItems: 1, maxChars: 100 },
        tool: 'archive_notes',
        shape: null,
    }),
    mcpTool({
        key: 'notesmcp.note.create',
        label: 'Connectors.tool.notesmcpNoteCreate',
        kind: 'write',
        product: 'notes',
        input: {
            type: 'object',
            description: 'Adds a note to the person\'s own Notes.',
            properties: { title: { type: 'string', maxLength: 120 }, body: { type: 'string', maxLength: 5000 } },
            required: ['title', 'body'],
            additionalProperties: false,
        },
        caps: { maxItems: 1, maxChars: 200 },
        card: (input) => ({ target: 'Notes', title: input.title, text: input.body }),
        tool: 'create_note',
        shape: shapeOfTool('create_note'),
    }),
];
