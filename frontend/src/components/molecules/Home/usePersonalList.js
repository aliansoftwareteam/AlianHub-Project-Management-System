import { reactive } from "vue";
import { useStore } from "vuex";
import { apiRequest } from "@/services";
import * as env from "@/config/env";
import taskClass from "@/utils/TaskOperations";
import { useGetterFunctions } from "@/composable";

const personal = reactive({ project: null, sprint: null, loading: false, error: null });
let pending = null;

const doneTypes = ["done", "close"];

export function usePersonalList({ companyId, userId }) {
    const { getters, commit } = useStore();
    const { getUser } = useGetterFunctions();

    function userData() {
        const user = getUser(userId.value);
        return {
            id: user.id,
            Employee_Name: user.Employee_Name,
            companyOwnerId: getters["settings/companyOwnerDetail"]?.userId
        };
    }

    function projectData(project = personal.project) {
        return {
            _id: project._id,
            CompanyId: project.CompanyId,
            lastTaskId: project.lastTaskId || 0,
            ProjectName: project.ProjectName,
            ProjectCode: project.ProjectCode || ""
        };
    }

    function ensure() {
        if (personal.project && personal.sprint) return Promise.resolve(personal);
        if (pending) return pending;
        personal.loading = true;
        personal.error = null;
        pending = apiRequest("post", env.PERSONAL_PROJECT, {})
            .then((response) => {
                const body = response?.data;
                if (!body?.status || !body.data?.project) {
                    throw new Error(body?.message || "personal list unavailable");
                }
                personal.project = body.data.project;
                personal.sprint = body.data.sprint;
                const known = (getters["projectData/allProjects"]?.data || []).some((p) => p._id === personal.project._id);
                if (!known) {
                    commit("projectData/mutateProjects", [{ op: "added", snap: null, privateSnap: true, data: { ...personal.project, isExpanded: false } }]);
                }
                return personal;
            })
            .catch((error) => {
                personal.error = error?.message || String(error);
                throw error;
            })
            .finally(() => {
                personal.loading = false;
                pending = null;
            });
        return pending;
    }

    async function fetchTasks() {
        await ensure();
        const pid = personal.project._id;
        const response = await apiRequest("post", `${env.TASK}/find`, {
            findQuery: {
                $match: {
                    $or: [{ objId: { ProjectID: pid } }, { ProjectID: pid }],
                    deletedStatusKey: 0,
                    mainChat: { $ne: true }
                }
            }
        });
        return Array.isArray(response?.data) ? response.data : [];
    }

    function defaultStatus(project = personal.project) {
        const statuses = project?.taskStatusData || [];
        return statuses.find((s) => s.type === "default_active") || statuses[0];
    }

    function doneStatus(project = personal.project) {
        const statuses = project?.taskStatusData || [];
        return statuses.find((s) => s.type === "done") || statuses.find((s) => s.type === "close");
    }

    async function createTask(name, dueDate = null) {
        await ensure();
        const project = personal.project;
        const sprint = personal.sprint;
        const status = defaultStatus(project);
        const taskType = (project.taskTypeCounts || [])[0] || {};
        if (!sprint || !status) throw new Error("personal list not ready");
        const due = dueDate ? new Date(dueDate) : "";
        const obj = {
            TaskName: name,
            TaskKey: "--",
            AssigneeUserId: [userId.value],
            watchers: [userId.value],
            DueDate: due,
            dueDateDeadLine: due ? [{ date: due }] : [],
            TaskType: taskType.value || taskType.name || "",
            TaskTypeKey: taskType.key,
            ParentTaskId: "",
            ProjectID: project._id,
            CompanyId: companyId.value,
            status: { text: status.name, key: status.key, value: status.value, type: status.type },
            isParentTask: true,
            Task_Leader: userId.value,
            sprintArray: { id: sprint._id, name: sprint.name, value: sprint.value },
            Task_Priority: "MEDIUM",
            deletedStatusKey: 0,
            sprintId: sprint._id,
            statusType: status.type,
            statusKey: status.key
        };
        const indexObj = { indexName: "groupByStatusIndex", searchKey: "statusKey", searchValue: status.key };
        const result = await taskClass.create({ data: obj, user: userData(), projectData: projectData(project), indexObj });
        if (!result?.status) throw new Error(result?.error || "create failed");
        return { ...obj, _id: result.id, createdAt: new Date().toISOString() };
    }

    function setStatus(task, status, project) {
        const proj = project || personal.project;
        const current = (proj.taskStatusData || []).find((s) => s.key === task.statusKey) || {};
        const newStatus = {
            status: { text: status.name, key: status.key, type: status.type, value: status.value },
            statusType: status.type,
            statusKey: status.key
        };
        const prevStatus = {
            backColor: current.bgColor,
            color: current.textColor,
            statusName: current.name,
            taskName: task.TaskName,
            bgColor: status.bgColor,
            textColor: status.textColor,
            taskId: task._id,
            updatedTaskName: status.name
        };
        return taskClass.updateStatus({ newStatus, prevStatus, projectData: projectData(proj), task, userData: userData() });
    }

    const isDone = (task) => doneTypes.includes(task.statusType);

    return { personal, ensure, fetchTasks, createTask, setStatus, defaultStatus, doneStatus, isDone, userData, projectData };
}
