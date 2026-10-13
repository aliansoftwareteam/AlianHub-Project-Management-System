/* What only the server writes on a comment: its id and timestamps, the agent or automation it is
 * attributed to, the id an importer gave it, and its reactions, which change through /api/v2/reactions
 * alone. A client posting or editing a comment never carries them. */
const SERVER_OWNED_FIELDS = Object.freeze([
    '_id', '__v', 'createdAt', 'updatedAt',
    'isAgent', 'agentName', 'actorType', 'agentId', 'viaAccount', 'runId', 'automationName',
    'legacyId', 'reactions',
]);

const withoutServerOwnedFields = (data) => {
    if (!data || typeof data !== 'object') return data;
    const kept = { ...data };
    SERVER_OWNED_FIELDS.forEach((field) => { delete kept[field]; });
    return kept;
};

module.exports = { SERVER_OWNED_FIELDS, withoutServerOwnedFields };
