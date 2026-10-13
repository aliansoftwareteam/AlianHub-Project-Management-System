/* Which status groups a sprint actually draws.
 *
 * helper.js seeds every group `isExpanded: true`, so a status nobody has used still
 * printed a bordered card, an empty sentence and an add button — roughly 137px per
 * status per sprint, and a project with nine statuses across six sprints is a page of
 * nothing. An empty group renders as a one-line chip until someone opens it by hand.
 *
 * Counts come from the store's `found` map for the sprint. A sprint whose map has not
 * landed yet cannot be called empty, so nothing collapses and nothing is hidden. */

export const groupRef = (sprint, item) => `${sprint?.id}_${item?.searchKey}_${item?.searchValue}`;

export const groupCount = (counts, item) => counts?.[`${item?.searchKey}_${item?.searchValue}`] ?? 0;

export function isGroupOpen(counts, item, openedEmpty, ref) {
    if (!item?.isExpanded) return false;
    if (!counts) return true;
    return groupCount(counts, item) > 0 || Boolean(openedEmpty?.has(ref));
}

export function sprintTotal(sprint, counts) {
    const reported = Number(sprint?.tasks);
    if (reported > 0) return reported;
    return counts ? Object.values(counts).reduce((sum, value) => sum + (Number(value) || 0), 0) : 0;
}
