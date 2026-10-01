import { nestedFolders } from "@/utils/folderTree";
import { treeRoute } from "@/components/molecules/ProjectTree/projectTreeModel";

const ARCHIVED = 2;

const RENAME = "project.project_sprint_name_edit";
const SCRUM = "project.project_sprint_create";
/* The server takes any one of these for a move (Modules/Sprints/routes.js SPRINT_EDIT), SCRUM alone
   for the sprint lifecycle, and one key per status for archive, restore and delete. */
const MOVE = [RENAME, "project.sprint_type_change", SCRUM];
const ARCHIVE = "project.sprint_archive";
const RESTORE = "project.sprint_restore";
const DELETE = "project.sprint_delete";

/* Mirrors deriveState in Modules/Sprints/scrumRules.js; "none" is a plain list. */
export function sprintState(list, now = Date.now()) {
    if (list?.isScrum !== true) return "none";
    const stored = String(list.state || "");
    if (stored === "closed") return "closed";
    if (stored !== "active") return "planned";
    const end = list.endDate ? new Date(list.endDate).getTime() : NaN;
    return Number.isFinite(end) && end < now ? "overdue" : "active";
}

const running = (state) => state === "active" || state === "overdue";

/* The menu of a list, wherever a list is shown: every entry once, in the order shown, with the
   rule that decides whether this list gets it. A place supplies only how it draws the entries. */
export const LIST_MENU = Object.freeze([
    { id: "rename", labelKey: "Projects.rename", icon: "edit", group: "list", shown: ({ rights }) => rights.rename },
    { id: "copy-link", labelKey: "Projects.copy_list_link", icon: "link", group: "list" },
    { id: "move", labelKey: "Projects.move_to_folder_menu", icon: "arrowRight", group: "place", shown: ({ rights, list, hasFolders }) => rights.move && (Boolean(list.folderId) || hasFolders) },
    { id: "start-sprint", labelKey: "Scrum.start_sprint", icon: "play", group: "sprint", shown: ({ rights, state }) => rights.scrum && state === "planned" },
    { id: "complete-sprint", labelKey: "Scrum.complete_sprint", icon: "checkSquare", group: "sprint", shown: ({ rights, state }) => rights.scrum && running(state) },
    { id: "sprint-settings", labelKey: ({ state }) => (state === "none" ? "Scrum.make_it_a_sprint" : "Scrum.sprint_settings"), icon: "settings", group: "sprint", shown: ({ rights }) => rights.scrum },
    { id: "plain-list", labelKey: "Scrum.make_it_a_plain_list", icon: "layout", group: "sprint", shown: ({ rights, state }) => rights.scrum && state === "planned" },
    { id: "archive", labelKey: "Projects.archive", icon: "book", group: "remove", shown: ({ rights }) => rights.archive },
    { id: "restore", labelKey: "Projects.restore", icon: "restore", group: "remove", shown: ({ rights }) => rights.restore },
    { id: "delete", labelKey: "Projects.delete", icon: "trash", group: "remove", danger: true, shown: ({ rights }) => rights.delete }
]);

/* `check` takes a full permission path and answers for the project the list is in. Only `=== true`
   grants. A closed project, an archived list and the view of archived lists leave only what does
   not change a live list. A chat channel and the backlog are not sprints. */
export function listMenuRights({ project, list, check, archivedView = false }) {
    const yes = (path) => check(path) === true;
    const open = project?.status !== "close";
    const archived = Number(list?.deletedStatusKey) === ARCHIVED;
    const live = open && !archived && !archivedView;
    const state = sprintState(list);
    return {
        rename: live && yes(RENAME),
        move: live && MOVE.some(yes),
        scrum: live && list?.mainChat !== true && !list?.isBacklog && state !== "closed" && yes(SCRUM),
        archive: live && yes(ARCHIVE),
        restore: open && archived && yes(RESTORE),
        delete: open && yes(DELETE)
    };
}

/* `folders` is the project's folders, as the list of documents or the map the project carries. */
export function listMenuEntries({ project, list, folders = [], check, archivedView = false }) {
    const context = {
        list: list || {},
        state: sprintState(list),
        hasFolders: nestedFolders(folders).length > 0,
        rights: listMenuRights({ project, list, check, archivedView })
    };
    let group = null;
    return LIST_MENU
        .filter((entry) => !entry.shown || entry.shown(context))
        .map(({ id, labelKey, icon, group: entryGroup, danger }) => {
            const separated = group !== null && entryGroup !== group;
            group = entryGroup;
            return { id, labelKey: typeof labelKey === "function" ? labelKey(context) : labelKey, icon, danger: Boolean(danger), separated };
        });
}

/* The address of a list's own page, resolved through the router so it follows the route table. */
export function listUrl(router, { companyId, projectId, list }) {
    try {
        const { href } = router.resolve(treeRoute("sprint", { cid: companyId, projectId, folderId: list.folderId ? String(list.folderId) : "", id: String(list.id || list._id) }));
        return new URL(href, window.location.href).toString();
    } catch (error) {
        return "";
    }
}
