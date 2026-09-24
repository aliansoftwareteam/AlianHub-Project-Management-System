const GROUP_BY_IDS = [0, 1, 2, 3];
const MAX_SEARCH = 200;
const DEFAULTS = Object.freeze({ groupBy: 0, me: false, search: '' });

export const viewPrefsKey = ({ companyId, userId, projectId }) => `ah.projectView.${companyId}.${userId}.${projectId}`;

const hasIds = (ids) => Boolean(ids?.companyId && ids?.userId && ids?.projectId);

const defaultStorage = () => {
    try {
        return window.localStorage;
    } catch {
        return null;
    }
};

export function loadViewPrefs(ids, storage = defaultStorage()) {
    if (!hasIds(ids) || !storage) return { ...DEFAULTS };
    try {
        const saved = JSON.parse(storage.getItem(viewPrefsKey(ids)) || 'null') || {};
        return {
            groupBy: GROUP_BY_IDS.includes(saved.groupBy) ? saved.groupBy : DEFAULTS.groupBy,
            me: saved.me === true,
            search: typeof saved.search === 'string' ? saved.search.slice(0, MAX_SEARCH) : DEFAULTS.search,
        };
    } catch {
        return { ...DEFAULTS };
    }
}

export function saveViewPrefs(ids, prefs, storage = defaultStorage()) {
    if (!hasIds(ids) || !storage) return;
    const value = {
        groupBy: GROUP_BY_IDS.includes(prefs.groupBy) ? prefs.groupBy : DEFAULTS.groupBy,
        me: prefs.me === true,
        search: String(prefs.search || '').slice(0, MAX_SEARCH),
    };
    try {
        if (value.groupBy === DEFAULTS.groupBy && !value.me && !value.search) {
            storage.removeItem(viewPrefsKey(ids));
        } else {
            storage.setItem(viewPrefsKey(ids), JSON.stringify(value));
        }
    } catch {
        // Private windows and blocked site data refuse writes; the view still works unsaved.
    }
}
