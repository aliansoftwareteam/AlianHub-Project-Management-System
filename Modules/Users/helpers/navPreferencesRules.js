// Must list every `key` in frontend/src/components/organisms/Shell/navItems.js; tests/user-nav-preferences.test.js checks it.
const NAV_ITEM_IDS = [
    'home', 'everything', 'goals', 'projects', 'inbox', 'planner', 'chat', 'ai', 'docs', 'appConnections', 'dash', 'time',
    'portfolio', 'automations', 'approvals', 'integrations', 'connections', 'externalData',
    'milestone', 'variance', 'custom', 'capacity', 'audit',
    'notepad', 'clips', 'reminders', 'talk', 'tour',
    'members', 'settings', 'trash', 'help', 'changelog',
];
const MAX_PINNED = NAV_ITEM_IDS.length;

const NAV_MODES = ['simple', 'full'];
const FIELDS = ['pinned', 'mode'];

const refuse = (error) => ({ ok: false, error });

const pinnedProblem = (pinned) => {
    if (!Array.isArray(pinned)) return 'pinned must be a list.';
    if (pinned.length > MAX_PINNED) return `At most ${MAX_PINNED} items can be pinned.`;
    if (!pinned.every((id) => typeof id === 'string' && NAV_ITEM_IDS.includes(id))) return 'pinned names an unknown nav item.';
    if (new Set(pinned).size !== pinned.length) return 'pinned lists an item twice.';
    return '';
};

const sanitizeNavPreferences = (body) => {
    if (!body || typeof body !== 'object' || Array.isArray(body)) return refuse('The body must be an object.');
    const keys = Object.keys(body);
    if (!keys.length || !keys.every((key) => FIELDS.includes(key))) return refuse('Only pinned and mode can be changed here.');

    const $set = {};
    if (keys.includes('pinned')) {
        const problem = pinnedProblem(body.pinned);
        if (problem) return refuse(problem);
        $set['navPreferences.pinned'] = [...body.pinned];
    }
    if (keys.includes('mode')) {
        if (!NAV_MODES.includes(body.mode)) return refuse('mode must be simple or full.');
        $set['navPreferences.mode'] = body.mode;
    }
    return { ok: true, update: { $set } };
};

/* Only a new account is given a mode. An account made before the choice existed has none, and
 * the app reads that as Full, so nobody's rail changes on upgrade and no migration is needed. */
const newAccountNavPreferences = () => ({ mode: 'simple' });

module.exports = { NAV_ITEM_IDS, MAX_PINNED, NAV_MODES, sanitizeNavPreferences, newAccountNavPreferences };
