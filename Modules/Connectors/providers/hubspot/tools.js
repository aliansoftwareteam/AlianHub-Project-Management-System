const { mcpTool } = require('../../mcpTools');

const objectType = { type: 'string', enum: ['contacts', 'companies', 'deals', 'tickets'], maxLength: 20, description: 'Which kind of CRM record.' };

/* Shapes are pinned with scripts/connector-tool-shapes.js and a test account; until then each tool stays off. */
module.exports = [
    mcpTool({
        key: 'hubspot.crm.search',
        label: 'Connectors.tool.hubspotCrmSearch',
        kind: 'read',
        product: 'crm',
        input: {
            type: 'object',
            description: 'Searches the HubSpot contacts, companies, deals or tickets the person can see, by words.',
            properties: { objectType, query: { type: 'string', maxLength: 200, description: 'Words to look for.' } },
            required: ['objectType', 'query'],
            additionalProperties: false,
        },
        caps: { maxItems: 20, maxChars: 8000 },
        tool: 'search_crm_objects',
        shape: null,
    }),
    mcpTool({
        key: 'hubspot.crm.read',
        label: 'Connectors.tool.hubspotCrmRead',
        kind: 'read',
        product: 'crm',
        input: {
            type: 'object',
            description: 'Reads one HubSpot contact, company, deal or ticket the person can see, by its id.',
            properties: { objectType, id: { type: 'string', maxLength: 40, description: 'The record id.' } },
            required: ['objectType', 'id'],
            additionalProperties: false,
        },
        caps: { maxItems: 1, maxChars: 8000 },
        tool: 'get_crm_objects',
        shape: null,
        args: (input) => ({ objectType: input.objectType, objectIds: [input.id] }),
    }),
];
