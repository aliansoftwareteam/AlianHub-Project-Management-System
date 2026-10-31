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
}, {
    key: 'fake.notes.create',
    label: 'Connectors.tool.fakeNotesCreate',
    kind: 'write',
    product: 'notes',
    scope: 'notes.write',
    input: {
        type: 'object',
        description: 'Adds a note to the person\'s own Fake Notes.',
        properties: {
            folder: { type: 'string', maxLength: 60 },
            title: { type: 'string', maxLength: 120 },
            body: { type: 'string', maxLength: 30000 },
        },
        required: ['title', 'body'],
        additionalProperties: false,
    },
    caps: { maxItems: 1, maxChars: 500 },
    card: (input) => ({ target: input.folder || 'Notes', title: input.title, text: input.body }),
    run: async ({ input, connection }) => {
        const res = await connection.request('https://api.fake.test/notes', { method: 'post', json: { folder: input.folder || 'Notes', title: input.title, body: input.body } });
        return `Saved as note ${JSON.parse(res.body).id}`;
    },
}];
