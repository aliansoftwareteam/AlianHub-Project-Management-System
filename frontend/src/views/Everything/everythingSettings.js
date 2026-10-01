import { cleanSettings } from './everythingRequest';

/* The working state of the page in this browser: the settings on screen and which saved view they
   came from. Saved views themselves live on the server; this only keeps what was not saved yet, so
   coming back to the page shows it as it was left. The search is not kept. */
const storageKey = (companyId, userId) => `ah.everything.${companyId}.${userId}`;

export function readWorkingState(companyId, userId) {
    try {
        const raw = localStorage.getItem(storageKey(companyId, userId));
        if (!raw) return null;
        const saved = JSON.parse(raw);
        return { settings: cleanSettings(saved), viewId: typeof saved?.viewId === 'string' ? saved.viewId : '' };
    } catch (error) {
        return null;
    }
}

export function writeWorkingState(companyId, userId, settings, viewId = '') {
    try {
        localStorage.setItem(storageKey(companyId, userId), JSON.stringify({ ...cleanSettings(settings), search: '', viewId }));
    } catch (error) {
        // Private mode or a full store: the page works without remembering.
    }
}
