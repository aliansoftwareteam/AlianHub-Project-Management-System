/* Collapsed sprints are never fetched, so the store can only answer for what is open; the sprint counters cover
   the rest. Only the rows the open view draws count: live ones, or archived ones while Show Archive is on. */
export function visibleTaskCount({ stored, sprints = [], archive = false }) {
    const shown = (task) => (archive ? task?.deletedStatusKey === 2 : !task?.deletedStatusKey);
    const loaded = (stored?.sprints || []).reduce((total, id) => total + (stored?.[id]?.tasks || []).filter(shown).length, 0);
    return loaded || sprints.reduce((total, sprint) => total + (archive ? (sprint.archiveTaskCount || 0) : (sprint.tasks || 0)), 0);
}
