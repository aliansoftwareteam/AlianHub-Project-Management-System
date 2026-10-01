/* The rules of a task's extra lists, with nothing required, so the web app can share them.
 * A task has one home (ProjectID, sprintId); an extra list is another list it also shows in. */

const MAX_EXTRA_LISTS = 10;

/* Each is one switch. `scrumLists: true` lets a Scrum sprint or a backlog be an extra list.
 * `personalLists: true` lets a personal list be one, and a task that lives in one have others; who may
 * open a personal list is not decided here, and stays its owner alone. */
const POLICY = Object.freeze({ scrumLists: false, personalLists: false });

const REFUSALS = Object.freeze({
    CHAT_ROW: 'A chat conversation cannot be added to a list.',
    SUBTASK: 'Only a top-level task can be added to another list; a subtask shows under its parent.',
    TASK_NOT_LIVE: 'Only a task that is not archived or closed can be added to a list.',
    HOME_PROJECT_NOT_OPEN: 'A task in a closed or archived project cannot be added to a list.',
    HOME_PERSONAL_LIST: 'A task in a personal list cannot be added to another list.',
    PERSONAL_LIST: 'A task cannot be added to a personal list.',
    SCRUM_LIST: 'A task cannot be added to a Scrum sprint or a backlog.',
    LIST_NOT_LIVE: 'That list is archived or closed.',
    PROJECT_NOT_OPEN: 'That project is closed or archived.',
    HOME_LIST: 'The task already lives in that list.',
    ALREADY_IN_LIST: 'The task is already in that list.',
    TOO_MANY_LISTS: `A task can be in at most ${MAX_EXTRA_LISTS} extra lists.`,
});

const refusal = (code) => ({ ok: false, code, reason: REFUSALS[code] });
const ALLOWED = Object.freeze({ ok: true });

const sameId = (a, b) => String(a) === String(b);

/* A row written before the field existed has none. */
const extraListsOf = (task) => (task && Array.isArray(task.extraLists) ? task.extraLists : []);

const entryFor = (task, sprintId) => extraListsOf(task).find((entry) => sameId(entry.sprintId, sprintId)) || null;

const isOpenProject = (project) => project.statusType !== 'close' && !project.deletedStatusKey;

const isScrumList = (list) => list.isScrum === true || list.isBacklog === true;

/* Whether the task may be in any extra list at all. `home` is its stored project. */
const canHoldExtraLists = (task, home, policy = POLICY) => {
    if (task.mainChat === true || !home) return refusal('CHAT_ROW');
    if (task.ParentTaskId) return refusal('SUBTASK');
    if (task.deletedStatusKey) return refusal('TASK_NOT_LIVE');
    if (!policy.personalLists && home.isPersonal === true) return refusal('HOME_PERSONAL_LIST');
    if (!isOpenProject(home)) return refusal('HOME_PROJECT_NOT_OPEN');
    return ALLOWED;
};

/* Whether the stored list, in its stored project, may be anybody's extra list. */
const canBeExtraList = (list, project, policy = POLICY) => {
    if (!policy.personalLists && project.isPersonal === true) return refusal('PERSONAL_LIST');
    if (!policy.scrumLists && isScrumList(list)) return refusal('SCRUM_LIST');
    if (list.deletedStatusKey) return refusal('LIST_NOT_LIVE');
    if (!isOpenProject(project)) return refusal('PROJECT_NOT_OPEN');
    return ALLOWED;
};

/* Whether this task may gain this list: its home is never one of its extra lists, a list holds it once, and the cap. */
const canAddToList = (task, sprintId) => {
    if (sameId(task.sprintId, sprintId)) return refusal('HOME_LIST');
    if (entryFor(task, sprintId)) return refusal('ALREADY_IN_LIST');
    if (extraListsOf(task).length >= MAX_EXTRA_LISTS) return refusal('TOO_MANY_LISTS');
    return ALLOWED;
};

module.exports = {
    MAX_EXTRA_LISTS, POLICY, REFUSALS,
    extraListsOf, entryFor, isScrumList, canHoldExtraLists, canBeExtraList, canAddToList,
};
