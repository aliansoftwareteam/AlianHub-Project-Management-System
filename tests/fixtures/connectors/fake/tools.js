module.exports = [{
    key: 'fake.notes.list',
    label: 'Connectors.tool.fakeNotesList',
    kind: 'read',
    product: 'notes',
    scope: 'notes.read',
    input: {
        type: 'object',
        description: 'The latest notes of the person in Fake Notes.',
        properties: { limit: { type: 'integer', minimum: 1, maximum: 20, default: 5 } },
        additionalProperties: false,
    },
    caps: { maxItems: 20, maxChars: 2000 },
    run: async ({ input, connection, caps }) => {
        const res = await connection.request('https://api.fake.test/notes', { query: { limit: Math.min(input.limit || 5, caps.maxItems) } });
        return JSON.parse(res.body).notes.map((note) => `- ${note.title}`).join('\n');
    },
}];
