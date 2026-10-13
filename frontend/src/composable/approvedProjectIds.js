const MAKES_A_PROJECT = ["project.create", "project.duplicate"];

const listOf = (value) => (Array.isArray(value) ? value : []);

export const distinct = (ids) => [...new Set(listOf(ids).map((id) => String(id || "")).filter(Boolean))];

export const madeProjectIds = (approvalAnswer) => distinct(listOf(approvalAnswer?.applied)
    .filter((change) => change && change.ok === true && MAKES_A_PROJECT.includes(change.action))
    .map((change) => change.result?.projectId));

/* An undo that could not trash the project (it holds work by then) answers ok: false for that part, and the project stays listed. */
export const trashedProjectIds = (undoAnswer) => distinct(listOf(undoAnswer?.results)
    .filter((part) => part && part.ok === true && part.result?.trashed === true)
    .map((part) => part.result.projectId));
