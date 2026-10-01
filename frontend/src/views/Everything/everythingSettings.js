import { DEFAULT_SETTINGS, cleanSettings } from './everythingRequest';

/* Kept in this browser for now: a private view is tied to a project and its settings pass a cleaner
   that knows only a project view's keys, so a view with no project needs a server change. */
const storageKey = (companyId, userId) => `ah.everything.${companyId}.${userId}`;

export function readSettings(companyId, userId) {
    try {
        const raw = localStorage.getItem(storageKey(companyId, userId));
        return raw ? cleanSettings(JSON.parse(raw)) : { ...DEFAULT_SETTINGS };
    } catch (error) {
        return { ...DEFAULT_SETTINGS };
    }
}

export function writeSettings(companyId, userId, settings) {
    try {
        localStorage.setItem(storageKey(companyId, userId), JSON.stringify({ ...cleanSettings(settings), search: '' }));
    } catch (error) {
        // Private mode or a full store: the page works without remembering.
    }
}
