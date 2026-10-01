/* The AI answers in threads under this author id. It is no member id, so the AI can never be a comment's assignee,
 * a mention recipient or someone a notification is about. */
const AI_ACTOR = 'ai';

const AI_FIELDS = ['aiAsk', 'aiAskerId', 'aiQuestionId', 'aiCitations', 'agentAsk', 'agentCitations', 'agentChanges'];

const isAiAuthored = (row) => Boolean(row) && (row.actorType === AI_ACTOR || String(row.userId || '') === AI_ACTOR);

/* Only the server writes AI rows and the answering state; a client posting or editing a comment never carries them. */
const withoutAiFields = (data) => {
    if (!data || typeof data !== 'object') return data;
    const kept = { ...data };
    AI_FIELDS.forEach((field) => { delete kept[field]; });
    if (kept.actorType === AI_ACTOR) delete kept.actorType;
    return kept;
};

module.exports = { AI_ACTOR, AI_FIELDS, isAiAuthored, withoutAiFields };
