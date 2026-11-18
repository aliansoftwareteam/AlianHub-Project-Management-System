import isEqual from 'lodash/isEqual';
import { cleanViewSettings, DEFAULT_VIEW_SETTINGS, VIEW_DENSITIES } from '@viewSettings';

export { cleanViewSettings, DEFAULT_VIEW_SETTINGS, VIEW_DENSITIES };

export const FILTERABLE_VIEWS = Object.freeze(['ProjectListView', 'ProjectKanban', 'TableView', 'Calendar']);
export const SAVED_SETTINGS_VIEWS = Object.freeze([...FILTERABLE_VIEWS, 'Workload']);

/* A private view copies the catalogue row's `_id`, so its own `id` is what tells it apart. */
export const viewKeyOf = (view) => {
    if (!view) return '';
    const key = view.isPrivate ? (view.id || view._id) : (view._id || view.id);
    return key === undefined || key === null ? '' : String(key);
};

export function resolveActiveView(views, tab, requestedKey) {
    const candidates = (Array.isArray(views) ? views : []).filter((view) => view && view.keyName === tab);
    if (!candidates.length) return null;
    return candidates.find((view) => requestedKey && viewKeyOf(view) === String(requestedKey))
        || candidates.find((view) => view.setAsDefault && !view.isPrivate)
        || candidates.find((view) => !view.isPrivate)
        || candidates[0];
}

export const sameSettings = (a, b) => isEqual(cleanViewSettings(a), cleanViewSettings(b));

export const settingsFromPrefs = (prefs) => cleanViewSettings({
    groupBy: prefs?.groupBy,
    me: prefs?.me,
    search: prefs?.search,
    doneBy: prefs?.doneBy,
});

export const viewLabelOf = (view, t, te) => {
    if (view?.title) return view.title;
    const key = `ViewList.${view?.name}`;
    return view?.name && te(key) ? t(key) : (view?.name || '');
};
