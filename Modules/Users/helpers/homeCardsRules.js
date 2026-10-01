// Must list every id in HOME_CARDS and HOME_CATALOG_KEYS of frontend/src/components/molecules/Home/homeCards.js; tests/user-home-cards.test.js checks it.
const HOME_CARD_IDS = Object.freeze([
    'waiting', 'standup', 'assigned_comments', 'recents',
    'DueSoonCard', 'MyTimeCard', 'AtRiskTodayCard', 'TasksByStatusCard', 'ProjectPulseCard',
]);
const MAX_LAYOUT = 40;

const refuse = (error) => ({ ok: false, error });

const sanitizeHidden = (hidden) => {
    if (!Array.isArray(hidden)) return refuse('hidden must be a list.');
    if (!hidden.every((id) => typeof id === 'string' && HOME_CARD_IDS.includes(id))) return refuse('hidden names an unknown card.');
    if (new Set(hidden).size !== hidden.length) return refuse('hidden lists a card twice.');
    return { ok: true, field: 'hidden', update: { $set: { 'homeCards.hidden': [...hidden] } } };
};

// A layout saved by an older or newer page may name a card this server does not offer; it is dropped, not refused.
const sanitizeLayout = (layout) => {
    if (!Array.isArray(layout)) return refuse('layout must be a list.');
    if (layout.length > MAX_LAYOUT) return refuse(`layout holds at most ${MAX_LAYOUT} cards.`);
    if (!layout.every((id) => typeof id === 'string')) return refuse('layout lists card names only.');
    const kept = [...new Set(layout.filter((id) => HOME_CARD_IDS.includes(id)))];
    return { ok: true, field: 'layout', update: { $set: { 'homeCards.layout': kept }, $unset: { 'homeCards.hidden': '' } } };
};

const sanitizeHomeCards = (body) => {
    if (!body || typeof body !== 'object' || Array.isArray(body)) return refuse('The body must be an object.');
    const keys = Object.keys(body);
    if (keys.length !== 1 || !['hidden', 'layout'].includes(keys[0])) return refuse('Send either layout or hidden.');
    return keys[0] === 'layout' ? sanitizeLayout(body.layout) : sanitizeHidden(body.hidden);
};

module.exports = { HOME_CARD_IDS, MAX_LAYOUT, sanitizeHomeCards };
