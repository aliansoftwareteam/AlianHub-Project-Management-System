const { mcpTool } = require('../../mcpTools');

/* Wispr Flow's tool names are not published; these are placeholders for scripts/connector-tool-shapes.js to correct
 * and pin with a test account. Until a shape is pinned, each tool stays off. */
module.exports = [
    mcpTool({
        key: 'wisprflow.meetings.search',
        label: 'Connectors.tool.wisprflowMeetingsSearch',
        kind: 'read',
        product: 'meetings',
        input: {
            type: 'object',
            description: 'Searches the person\'s Wispr Flow meeting notes by words, newest first.',
            properties: { query: { type: 'string', maxLength: 200, description: 'Words to look for.' } },
            required: ['query'],
            additionalProperties: false,
        },
        caps: { maxItems: 20, maxChars: 8000 },
        tool: 'search_meetings',
        shape: null,
    }),
    mcpTool({
        key: 'wisprflow.meeting.read',
        label: 'Connectors.tool.wisprflowMeetingRead',
        kind: 'read',
        product: 'meetings',
        input: {
            type: 'object',
            description: 'Reads the notes and transcript of one of the person\'s Wispr Flow meetings.',
            properties: { meetingId: { type: 'string', maxLength: 100, description: 'The meeting id from a search.' } },
            required: ['meetingId'],
            additionalProperties: false,
        },
        caps: { maxItems: 1, maxChars: 16000 },
        tool: 'get_meeting',
        shape: null,
        args: (input) => ({ id: input.meetingId }),
    }),
];
