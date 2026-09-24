import { computed, inject, nextTick, ref, unref } from "vue";
import { useStore } from "vuex";
import { useRouter } from "vue-router";
import { useI18n } from "vue-i18n";
import { useToast } from "vue-toast-notification";
import moment from "moment";
import taskClass from "@/utils/TaskOperations";
import { useCustomComposable, useGetterFunctions } from "@/composable";
import { isBundledPriorityImage } from "@/composable/commonFunction";
import { showUndoToast } from "@/composable/useUndoToast";
import { taskDueDateAdd, taskDueDateChange } from "@/utils/NotificationTemplate";
import { permittedAssignees, sprintOf } from "@/utils/assigneeOptions";
import {
    assigneeInverse, dueChange, dueRestore, dueSnapshot, nextAssignees, priorityAppOn, projectHasApp, rowEditRights
} from "./listRowEdit";

const ASSIGNEE_OPERATION = { add: "assigneeAdd", remove: "assigneRemove", replace: "replace" };
const TOAST = { position: "top-right" };

/* The same taskClass calls, payloads and undo the task panel makes (TaskDetailRightSide),
 * so history, notifications, socket events and caches behave identically. */
export function useListInlineEdit(projectRef) {
    const { getters, commit } = useStore();
    const { t } = useI18n();
    const $toast = useToast();
    const { getUser } = useGetterFunctions();
    const { getWasabiImageLink } = useCustomComposable();
    const userId = inject("$userId", ref(""));
    const dateFormat = inject("$dateFormat", ref("DD/MM/YYYY"));
    const searched = inject("searchedTask", ref(false));
    const refreshSearch = inject("refreshTaskSearch", null);

    const project = () => unref(projectRef) || {};

    function actor() {
        const user = getUser(userId.value) || {};
        return { id: user.id || userId.value, Employee_Name: user.Employee_Name, companyOwnerId: getters["settings/companyOwnerDetail"]?.userId };
    }

    function projectSlice() {
        const p = project();
        return { _id: p._id, CompanyId: p.CompanyId, lastTaskId: p.lastTaskId, ProjectName: p.ProjectName, ProjectCode: p.ProjectCode };
    }

    const formatDate = (date) => (date ? moment(date).format(dateFormat.value) : null);

    /* taskClass writes the change into the sprint's tasks; a filtered List reads the
     * searched copy instead, and only the server can say whether the task still matches. */
    function reflectSearch(task, fields) {
        if (!searched.value) return;
        const stored = (getters["projectData/searchedTasks"] || []).find((x) => x._id === task._id);
        if (stored) commit("projectData/mutateSearchTask", { op: "modified", data: [{ ...stored, ...fields }] });
        if (typeof refreshSearch === "function") refreshSearch();
    }

    function writeTasks(task, fields) {
        commit("projectData/mutateUpdateFirebaseTasks", {
            snap: null, op: "modified", pid: String(task.ProjectID), sprintId: String(task.sprintId), data: { ...task, ...fields }, updatedFields: fields
        });
    }

    /* A change can move the row into another group or out of the filter; focus then goes to
     * the row that took its place rather than to the page. */
    function keepFocus(row) {
        if (!row || typeof document === "undefined") return;
        const group = row.closest(".lv2__group");
        const rows = group ? [...group.querySelectorAll(".lv2__row:not(.is-sub)")] : [];
        const index = rows.indexOf(row);
        nextTick(() => setTimeout(() => {
            if (row.isConnected) return;
            const active = document.activeElement;
            if (active && active !== document.body && active.isConnected) return;
            const left = group && group.isConnected ? [...group.querySelectorAll(".lv2__row:not(.is-sub)")] : [];
            const next = left[Math.min(index, left.length - 1)];
            const target = next?.querySelector(".lv2__status, .lv2__name") || (group?.isConnected ? group.querySelector(".lv2__group-head") : null);
            target?.focus({ preventScroll: false });
        }, 0));
    }

    function settle(promise, { task, fields, before, undoing, message, undo, failure }) {
        return promise.then(() => {
            reflectSearch(task, fields);
            if (undoing) $toast.success(t("TaskPanel.change_undone"), TOAST);
            else if (undo) showUndoToast({ message, undo });
            else $toast.success(message, TOAST);
        }).catch((error) => {
            console.error("ERROR in list inline edit: ", error);
            if (before) writeTasks({ ...task, ...fields }, before);
            $toast.error(t(failure), TOAST);
        });
    }

    function setStatus(task, next, { row = null, undoing = false } = {}) {
        const statuses = project().taskStatusData || [];
        const current = statuses.find((s) => s.key === task.statusKey) || {};
        if (!next || next.key === current.key) return Promise.resolve();
        const fields = { status: { text: next.name, key: next.key, type: next.type, value: next.value }, statusType: next.type, statusKey: next.key };
        const promise = taskClass.updateStatus({
            newStatus: fields,
            prevStatus: {
                backColor: current.bgColor, color: current.textColor, statusName: current.name,
                taskName: task.TaskName, bgColor: next.bgColor, textColor: next.textColor,
                taskId: task._id, updatedTaskName: next.name
            },
            projectData: projectSlice(),
            task: { ...task },
            userData: actor()
        });
        keepFocus(row);
        return settle(promise, {
            task, fields, undoing,
            before: current.key !== undefined ? { status: { text: current.name, key: current.key, type: current.type, value: current.value }, statusType: current.type, statusKey: current.key } : null,
            message: t("Toast.Status_updated_successfully"),
            undo: current.key !== undefined ? () => setStatus({ ...task, ...fields }, current, { undoing: true }) : null,
            failure: "Toast.Status_not_updated"
        });
    }

    function setAssignee(task, { type, uid }, { row = null, undoing = false } = {}) {
        const before = [...(task.AssigneeUserId || [])];
        const after = nextAssignees(before, type, uid);
        const promise = taskClass.updateAssignee({
            firebaseObj: { AssigneeUserId: uid },
            projectData: projectSlice(),
            taskData: { ...task, AssigneeUserId: [...before] },
            employeeName: getUser(uid)?.Employee_Name,
            type: ASSIGNEE_OPERATION[type] || "",
            userData: actor()
        });
        // taskClass drops the picked person on a replace; the list must show who the server will hold.
        writeTasks(task, { AssigneeUserId: after });
        keepFocus(row);
        const inverse = assigneeInverse(type, uid, before);
        return settle(promise, {
            task, fields: { AssigneeUserId: after }, before: { AssigneeUserId: before }, undoing,
            message: t(`Toast.Assignee ${type === "remove" ? "removed" : "added"} successfully`),
            undo: () => setAssignee({ ...task, AssigneeUserId: after }, inverse, { undoing: true }),
            failure: "Toast.Assignee_not_updated"
        });
    }

    function dueNotification(task, from, to) {
        if (!to) return {};
        const base = { key: "task_due_date", projectId: task.ProjectID, taskId: task._id, sprintId: task.sprintId };
        const names = { ProjectName: project().ProjectName, TaskName: task.TaskName };
        return {
            ...base,
            message: from
                ? taskDueDateChange({ ...names, previousDate: formatDate(from), changedDate: formatDate(to) })
                : taskDueDateAdd({ ...names, lastDate: formatDate(to) })
        };
    }

    function writeDue(task, fields, previous) {
        return taskClass.updateDueDate({
            commonDateFormatString: dateFormat.value,
            firebaseObj: fields,
            project: projectSlice(),
            task: { ...task },
            obj: dueNotification(task, previous, fields.DueDate),
            userData: actor()
        });
    }

    function setDue(task, date, { row = null } = {}) {
        const snapshot = dueSnapshot(task);
        const fields = dueChange(task, date);
        const promise = writeDue(task, fields, task.DueDate || null);
        keepFocus(row);
        return settle(promise, {
            task, fields, before: dueRestore(snapshot),
            message: t("Toast.Due_date_updated_successfully"),
            undo: () => {
                const restored = dueRestore(snapshot);
                return settle(writeDue({ ...task, ...fields }, restored, date), {
                    task, fields: restored, undoing: true, failure: "Toast.Due_date_not_updated"
                });
            },
            failure: "Toast.Due_date_not_updated"
        });
    }

    function priorityMeta(value) {
        const found = (getters["settings/companyPriority"] || []).find((x) => x.value === value);
        return { value: value || "", name: found?.name || "N/A", image: found && !isBundledPriorityImage(found.statusImage) ? found.statusImage : "" };
    }

    const imageLink = (image) => getWasabiImageLink(project().CompanyId, image).catch(() => "");

    async function setPriority(task, option, { row = null, undoing = false } = {}) {
        const previous = priorityMeta(task.Task_Priority);
        const next = priorityMeta(option?.value);
        if (next.value === previous.value) return;
        const user = actor();
        const fields = { Task_Priority: next.value };
        const priorityObj = {
            statusImage: await imageLink(previous.image),
            priorityName: previous.name,
            taskId: task._id,
            taskName: task.TaskName,
            userName: user.Employee_Name,
            newStatusImage: await imageLink(next.image),
            newPriorityName: next.name
        };
        const promise = taskClass.updatePriority({
            firebaseObj: fields,
            projectData: { _id: project()._id || "", ProjectName: project().ProjectName, CompanyId: project().CompanyId },
            taskData: { ...task },
            priorityObj,
            userData: user
        });
        keepFocus(row);
        return settle(promise, {
            task, fields, before: { Task_Priority: task.Task_Priority || "" }, undoing,
            message: t("Toast.Priority_updated_successfully"),
            undo: () => setPriority({ ...task, ...fields }, { value: previous.value }, { undoing: true }),
            failure: "Toast.Priority_not_updated"
        });
    }

    function rename(task, name, { undoing = false } = {}) {
        const next = String(name || "").trim();
        if (!next.length || next === task.TaskName) return Promise.resolve();
        const user = actor();
        const fields = { TaskName: next };
        const promise = taskClass.updateTaskName({
            firebaseObj: fields,
            projectData: projectSlice(),
            taskData: { ...task },
            obj: { previousTaskName: task.TaskName, userName: user.Employee_Name },
            userData: user
        });
        return settle(promise, {
            task, fields, before: { TaskName: task.TaskName }, undoing,
            message: t("Toast.Task_name_updated_successfully"),
            undo: () => rename({ ...task, ...fields }, task.TaskName, { undoing: true }),
            failure: "Toast.something_went_wrong"
        });
    }

    return { setStatus, setAssignee, setDue, setPriority, rename };
}

/* Everything a row needs to edit itself, built once per List and handed down by provide. */
export function useListRowEdit(projectRef, showArchived) {
    const { getters } = useStore();
    const { t } = useI18n();
    const $toast = useToast();
    const router = useRouter();
    const { checkPermission } = useCustomComposable();
    const companyId = inject("$companyId", ref(""));
    const edits = useListInlineEdit(projectRef);

    const project = computed(() => unref(projectRef) || {});
    const check = (path) => checkPermission(path, project.value?.isGlobalPermission);

    const rights = computed(() => rowEditRights(check, { archived: Boolean(unref(showArchived)) }));
    const showPriority = computed(() => priorityAppOn(project.value, getters["settings/selectedCompany"]?.planFeature)
        && check("task.task_priority") !== null);
    const statuses = computed(() => project.value?.taskStatusData || []);
    const multipleAssignees = computed(() => projectHasApp(project.value, "MultipleAssignees"));
    const companyUsers = computed(() => (getters["settings/companyUsers"] || []).map((x) => x.userId));

    const assigneeOptions = (task) => permittedAssignees({
        task, sprint: sprintOf(project.value, task), project: project.value, companyUsers: companyUsers.value
    });

    function taskHref(task) {
        const folderId = task.folderObjId || "";
        const params = { cid: companyId.value || project.value.CompanyId, id: project.value._id, sprintId: task.sprintId, taskId: task._id };
        if (folderId) params.folderId = folderId;
        try {
            const { href } = router.resolve({ name: folderId ? "ProjectFolderSprintTask" : "ProjectSprintTask", params });
            return new URL(href, window.location.href).toString();
        } catch (error) {
            return "";
        }
    }

    async function copy(text, successKey) {
        try {
            await navigator.clipboard.writeText(text);
            $toast.success(t(successKey), TOAST);
        } catch (error) {
            console.error("ERROR copying to the clipboard: ", error);
            $toast.error(t("Toast.something_went_wrong"), TOAST);
        }
    }

    return {
        ...edits,
        rights,
        showPriority,
        statuses,
        multipleAssignees,
        assigneeOptions,
        taskHref,
        copyLink: (task) => copy(taskHref(task), "Toast.Link_is_Copied_to_clipboard"),
        copyKey: (task) => copy(task.TaskKey, "Toast.Task_Key_is_Copied_to_clipboard")
    };
}
