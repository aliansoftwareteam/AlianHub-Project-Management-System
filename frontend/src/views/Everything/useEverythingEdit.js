import { inject, ref } from "vue";
import { useStore } from "vuex";
import { useI18n } from "vue-i18n";
import { useToast } from "vue-toast-notification";
import taskClass from "@/utils/TaskOperations";
import { useCustomComposable, useGetterFunctions } from "@/composable";
import { isBundledPriorityImage } from "@/composable/commonFunction";

const TOAST = { position: "top-right" };

/* The same taskClass calls and payloads the project List makes (useListInlineEdit), with the
 * project read from the row's own card: rows here come from many projects. */
export function useEverythingEdit({ onChanged = () => {} } = {}) {
    const store = useStore();
    const { t } = useI18n();
    const $toast = useToast();
    const { getUser } = useGetterFunctions();
    const { getWasabiImageLink } = useCustomComposable();
    const userId = inject("$userId", ref(""));
    const companyId = inject("$companyId", ref(""));

    const cardOf = (task) => store.getters["everything/projects"][String(task.ProjectID)] || null;

    function actor() {
        const user = getUser(userId.value) || {};
        return { id: user.id || userId.value, Employee_Name: user.Employee_Name, companyOwnerId: store.getters["settings/companyOwnerDetail"]?.userId };
    }

    const projectSlice = (card) => ({ _id: card._id, CompanyId: companyId.value, ProjectName: card.ProjectName, ProjectCode: card.ProjectCode });

    async function write(task, fields, before, call, messages) {
        store.commit("everything/patchRow", { taskId: task._id, fields });
        try {
            await call();
            $toast.success(t(messages.done), TOAST);
            onChanged();
        } catch (error) {
            console.error("ERROR in everything inline edit: ", error);
            store.commit("everything/patchRow", { taskId: task._id, fields: before });
            $toast.error(t(messages.failed), TOAST);
        }
    }

    function setStatus(task, next) {
        const card = cardOf(task);
        const current = (card?.taskStatusData || []).find((status) => status.key === task.statusKey) || {};
        if (!card?.edit?.status || !next || next.key === current.key) return Promise.resolve();
        const fields = { status: { text: next.name, key: next.key, type: next.type, value: next.value }, statusType: next.type, statusKey: next.key };
        return write(task, fields, { status: task.status, statusType: task.statusType, statusKey: task.statusKey }, () => taskClass.updateStatus({
            newStatus: fields,
            prevStatus: {
                backColor: current.bgColor, color: current.textColor, statusName: current.name,
                taskName: task.TaskName, bgColor: next.bgColor, textColor: next.textColor,
                taskId: task._id, updatedTaskName: next.name
            },
            projectData: projectSlice(card),
            task: { ...task },
            userData: actor()
        }), { done: "Toast.Status_updated_successfully", failed: "Toast.Status_not_updated" });
    }

    function priorityMeta(value) {
        const found = (store.getters["settings/companyPriority"] || []).find((priority) => priority.value === value);
        return { value: value || "", name: found?.name || "N/A", image: found && !isBundledPriorityImage(found.statusImage) ? found.statusImage : "" };
    }

    const imageLink = (image) => getWasabiImageLink(companyId.value, image).catch(() => "");

    async function setPriority(task, option) {
        const card = cardOf(task);
        const previous = priorityMeta(task.Task_Priority);
        const next = priorityMeta(option?.value);
        if (!card?.edit?.priority || next.value === previous.value) return;
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
        await write(task, fields, { Task_Priority: task.Task_Priority || "" }, () => taskClass.updatePriority({
            firebaseObj: fields,
            projectData: { _id: card._id, ProjectName: card.ProjectName, CompanyId: companyId.value },
            taskData: { ...task },
            priorityObj,
            userData: user
        }), { done: "Toast.Priority_updated_successfully", failed: "Toast.Priority_not_updated" });
    }

    return { setStatus, setPriority };
}
