// Must list every `id` in frontend/src/components/molecules/Home/homeCards.js; tests/user-home-cards.test.js checks it.
const HOME_CARD_IDS = Object.freeze(['waiting', 'standup']);

const refuse = (error) => ({ ok: false, error });

const sanitizeHomeCards = (body) => {
    if (!body || typeof body !== 'object' || Array.isArray(body)) return refuse('The body must be an object.');
    const keys = Object.keys(body);
    if (keys.length !== 1 || keys[0] !== 'hidden') return refuse('Only hidden can be changed here.');

    const { hidden } = body;
    if (!Array.isArray(hidden)) return refuse('hidden must be a list.');
    if (!hidden.every((id) => typeof id === 'string' && HOME_CARD_IDS.includes(id))) return refuse('hidden names an unknown card.');
    if (new Set(hidden).size !== hidden.length) return refuse('hidden lists a card twice.');

    return { ok: true, update: { $set: { 'homeCards.hidden': [...hidden] } } };
};

module.exports = { HOME_CARD_IDS, sanitizeHomeCards };
