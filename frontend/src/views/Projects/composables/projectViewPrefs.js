import { ALL, cleanDoneBy } from '@/components/molecules/Provenance/doneByQuery';

const GROUP_BY_IDS = [0, 1, 2, 3];
const MAX_SEARCH = 200;
/* Read only: task 042 moved these onto the saved view, and a project's entry is cleared once its view is saved or reset. */
const DEFAULTS = Object.freeze({ groupBy: 0, me: false, search: '', doneBy: ALL });

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
            doneBy: cleanDoneBy(saved.doneBy),
        };
    } catch {
        return { ...DEFAULTS };
    }
}

export function clearViewPrefs(ids, storage = defaultStorage()) {
    if (!hasIds(ids) || !storage) return;
    try {
        storage.removeItem(viewPrefsKey(ids));
    } catch {
        return;
    }
}
