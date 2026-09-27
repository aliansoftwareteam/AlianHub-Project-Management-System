// Must list every `key` in frontend/src/components/organisms/Shell/navItems.js; tests/user-nav-preferences.test.js checks it.
const NAV_ITEM_IDS = [
    'home', 'projects', 'inbox', 'planner', 'chat', 'ai', 'docs', 'dash', 'time',
    'portfolio', 'automations', 'integrations', 'connections', 'externalData',
    'milestone', 'variance', 'custom', 'capacity', 'audit',
    'notepad', 'clips', 'reminders', 'talk', 'tour',
    'members', 'settings', 'trash', 'help', 'changelog',
];
const MAX_PINNED = NAV_ITEM_IDS.length;

const refuse = (error) => ({ ok: false, error });

const sanitizeNavPreferences = (body) => {
    if (!body || typeof body !== 'object' || Array.isArray(body)) return refuse('The body must be an object.');
    const keys = Object.keys(body);
    if (keys.length !== 1 || keys[0] !== 'pinned') return refuse('Only pinned can be changed here.');

    const { pinned } = body;
    if (!Array.isArray(pinned)) return refuse('pinned must be a list.');
    if (pinned.length > MAX_PINNED) return refuse(`At most ${MAX_PINNED} items can be pinned.`);
    if (!pinned.every((id) => typeof id === 'string' && NAV_ITEM_IDS.includes(id))) return refuse('pinned names an unknown nav item.');
    if (new Set(pinned).size !== pinned.length) return refuse('pinned lists an item twice.');

    return { ok: true, update: { $set: { 'navPreferences.pinned': [...pinned] } } };
};

module.exports = { NAV_ITEM_IDS, MAX_PINNED, sanitizeNavPreferences };
