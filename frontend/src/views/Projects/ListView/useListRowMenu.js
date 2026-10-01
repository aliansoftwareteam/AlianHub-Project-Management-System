import { computed, inject, ref, unref } from "vue";
import { useStore } from "vuex";
import { useI18n } from "vue-i18n";
import { useToast } from "vue-toast-notification";
import { apiRequest } from "@/services";
import * as env from "@/config/env";
import { useCustomComposable, useGetterFunctions } from "@/composable";
import { showUndoToast } from "@/composable/useUndoToast";
import { sprintOf } from "@/utils/assigneeOptions";
import { snapshotTasks, undoRequests } from "./bulkUndo.js";
import { taskMenuRights } from "@/views/Projects/composables/taskMenu";
import { placedSprint } from "@/views/Projects/composables/taskPlacement";
import { peopleCarried } from "@/utils/duplicatePeople";

const TOAST = { position: "top-right" };
const DUPLICATE_PARTS = ["Checklists", "Due Date", "Copy Assignees", "Copy Watchers"];

const projectRef = (project) => ({ id: project?._id, ProjectCode: project?.ProjectCode, ProjectName: project?.ProjectName });

/* Row menu actions through the same /tasks/bulk calls ListBulkBar makes, one task at a time,
 * so history, notifications, sockets and server permission checks are shared. */
export function useListRowMenu(projectSource, showArchived) {
    const { getters } = useStore();
    const { t } = useI18n();
    const $toast = useToast();
    const { getUser } = useGetterFunctions();
    const { checkPermission } = useCustomComposable();
    const userId = inject("$userId", ref(""));

    const project = computed(() => unref(projectSource) || {});
    const rights = computed(() => taskMenuRights((path) => checkPermission(path, project.value?.isGlobalPermission), { archived: Boolean(unref(showArchived)) }));
    const moving = ref(null);
    const sidebar = ref(null);
    const working = ref(false);

    function userData() {
        const me = getUser(userId.value);
        return {
            id: me?.id || String(userId.value || ""),
            Employee_Name: me?.Employee_Name || "",
            companyOwnerId: getters["settings/companyOwnerDetail"]?.userId || ""
        };
    }

    async function send(body) {
        const response = await apiRequest("post", env.V2_TASKS_BULK, { ...body, userData: userData() });
        if (response?.data?.status === false) throw new Error(response.data.statusText || t("List.bulk_failed"));
        return response?.data?.data || {};
    }

    function offerUndo(message, requests) {
        if (!requests.length) {
            $toast.success(message, TOAST);
            return;
        }
        showUndoToast({
            message,
            undo: async () => {
                try {
                    for (const request of requests) await send(request);
                    $toast.success(t("List.bulk_undone"), TOAST);
                } catch (error) {
                    $toast.error(t("List.bulk_undo_failed"), TOAST);
                }
            }
        });
    }

    async function perform(body, { task, message, undo }) {
        if (working.value) return;
        working.value = true;
        const before = snapshotTasks({ searchedTasks: [task] }, [task._id]);
        try {
            const result = await send({ ...body, taskIds: [String(task._id)] });
            offerUndo(message, undo(result, before));
        } catch (error) {
            $toast.error(error?.message || t("List.bulk_failed"), TOAST);
        } finally {
            working.value = false;
        }
    }

    const updated = (result, task) => (Array.isArray(result.updated) ? result.updated.map(String) : [String(task._id)]);

    function undoBulk(action, payload, task) {
        return (result, before) => undoRequests({ action, payload, before, updatedIds: updated(result, task), project: project.value });
    }

    function archive(task) {
        if (!rights.value.archive) return Promise.resolve();
        return perform({ action: "bulkArchive" }, { task, message: t("List.row_archived"), undo: undoBulk("bulkArchive", {}, task) });
    }

    /* bulkRestore always returns a task to the open list, so a task deleted out of the
     * archive is archived again after it. */
    function remove(task) {
        if (!rights.value.delete) return Promise.resolve();
        const backToArchive = (result) => [{ action: "bulkRestore", taskIds: updated(result, task) }, { action: "bulkArchive", taskIds: updated(result, task) }];
        return perform({ action: "bulkTrash" }, {
            task,
            message: t("List.row_deleted"),
            undo: task.deletedStatusKey === 2 ? backToArchive : undoBulk("bulkTrash", {}, task)
        });
    }

    function restore(task) {
        if (!rights.value.restore) return Promise.resolve();
        return perform({ action: "bulkRestore" }, {
            task,
            message: t("List.row_restored"),
            undo: (result) => [{ action: "bulkArchive", taskIds: updated(result, task) }]
        });
    }

    function openSidebar(mode, task) {
        sidebar.value = { mode, task };
    }

    function closeSidebar() {
        sidebar.value = null;
    }

    function startMove(task) {
        if (rights.value.move) moving.value = task;
    }

    function cancelMove() {
        moving.value = null;
    }

    function confirmMove({ project: destination, sprint } = {}) {
        const task = moving.value;
        moving.value = null;
        if (!task || !destination?._id || !sprint?.id) return Promise.resolve();
        const payload = { sprintObj: placedSprint(sprint), projectData: projectRef(destination) };
        return perform({ action: "bulkMove", ...payload }, {
            task,
            message: t("List.row_moved", { project: destination.ProjectName || "" }),
            undo: undoBulk("bulkMove", payload, task)
        });
    }

    function duplicate(task, { withSubtasks = false } = {}) {
        if (!rights.value.duplicate) return Promise.resolve();
        const source = project.value;
        const sprint = sprintOf(source, task) || { ...(task.sprintArray || {}), id: task.sprintId };
        const name = t("List.copy_of", { name: task.TaskName || "" });
        const place = { project: source, sprint, seats: getters["settings/companyUsers"], teams: getters["settings/teams"], rules: getters["settings/rules"] };
        return perform({
            action: "bulkDuplicate",
            sprintObj: placedSprint(sprint),
            projectData: projectRef(source),
            oldProject: { id: source._id, ProjectName: source.ProjectName, taskStatusData: source.taskStatusData, taskTypeCounts: source.taskTypeCounts },
            oldSprintObj: { folderId: task.folderObjId || null, name: task.sprintArray?.name || sprint.name || "", folderName: task.sprintArray?.folderName || "" },
            isSubTask: withSubtasks && Number(task.subTasks || 0) > 0,
            duplicateData: DUPLICATE_PARTS,
            assignee: peopleCarried(task.AssigneeUserId, place),
            watcher: peopleCarried(task.watchers, place),
            taskName: name
        }, {
            task,
            message: t("List.row_duplicated", { name }),
            undo: (result) => (rights.value.delete && result.newTaskIds?.length
                ? [{ action: "bulkTrash", taskIds: result.newTaskIds.map(String) }]
                : [])
        });
    }

    return { rights, moving, sidebar, archive, remove, restore, startMove, cancelMove, confirmMove, duplicate, openSidebar, closeSidebar };
}
