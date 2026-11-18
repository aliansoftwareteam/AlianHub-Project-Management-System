const VIEW_ID_LENGTH = 6;

// getView() has no case for the dead 'Gantt'/'Timeline' keyNames (replaced by 'GanttView'
// and 'TimelineView') so they render NotFound; older projects may still carry the stale
// entry. The "+ View" catalog already hides them, so the tab bar mirrors that filter.
const LEGACY_KEY_NAMES = ['Timeline', 'Gantt'];

const idOf = (entry, key) => (entry && entry[key] !== undefined && entry[key] !== null ? String(entry[key]) : '');

const label = (entry) => String((entry && entry.name) || '').toLowerCase();

const byPin = (a, b) => (!(a.isPin) ? 0 : (a.isPin == b.isPin ? 0 : (((!a.isPin && b.isPin) ? 1 : -1))));
const byName = (a, b) => (label(a) < label(b) ? -1 : (label(b) < label(a) ? 1 : 0));

/* Shared views keep the project's order, pinned ones first. A private view sits right after the
 * shared view it was made from, so a copy never pushes its source along the bar; one with no
 * shared view of its own on the same side of the pin line goes last on that side. */
function arrangeTabs(shared, mine) {
    const sourceOf = (tab) => shared.find((view) => idOf(view, '_id') === idOf(tab, 'sourceViewId'))
        || shared.find((view) => idOf(view, '_id') === idOf(tab, '_id'));
    const side = (pinned) => {
        const views = shared.filter((view) => Boolean(view.isPin) === pinned);
        const tabs = mine.filter((tab) => Boolean(tab.isPin) === pinned);
        return [
            ...views.flatMap((view) => [view, ...tabs.filter((tab) => sourceOf(tab) === view)]),
            ...tabs.filter((tab) => !views.includes(sourceOf(tab))),
        ];
    };
    return [...side(true), ...side(false)];
}

/* Splits a project's views into the tab bar and the embed menu. An entry's id length is what
 * separates the two: a project view carries the 24-character id of the company's view-catalogue
 * row, an embed a 6-character one of its own.
 *
 * An entry saved without an id is neither, and is left out of both rather than repaired here:
 * only the server can mint an id that the later rename, pin and delete writes — which match on
 * it — will still find. Reading `.length` straight off the missing id used to throw, which left
 * the project with no view bar and no task list at all. */
export function splitProjectViews(projectViews, userTabs = []) {
    const views = Array.isArray(projectViews) ? projectViews : [];
    const tabs = Array.isArray(userTabs) ? userTabs : [];
    const takenIds = views.map((item) => idOf(item, '_id'));
    const isView = (id) => id.length > VIEW_ID_LENGTH;
    const isEmbed = (id) => id.length === VIEW_ID_LENGTH;

    return {
        views: arrangeTabs(
            views.filter((item) => isView(idOf(item, '_id'))),
            tabs.filter((tab) => isView(idOf(tab, 'id')) && !takenIds.includes(idOf(tab, 'id'))),
        ).filter((item) => !LEGACY_KEY_NAMES.includes(item.keyName)),
        embeds: [
            ...views.filter((item) => isEmbed(idOf(item, '_id'))),
            ...tabs.filter((tab) => isEmbed(idOf(tab, 'id'))),
        ].sort(byName).sort(byPin),
    };
}
