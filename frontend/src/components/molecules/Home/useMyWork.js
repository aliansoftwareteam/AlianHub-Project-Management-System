import { computed, ref } from "vue";
import moment from "moment";
import { useStore } from "vuex";
import { apiRequest } from "@/services";
import * as env from "@/config/env";
import taskClass from "@/utils/TaskOperations";
import { taskDueDateAdd, taskDueDateChange } from "@/utils/NotificationTemplate";
import { useMoment } from "@/composable";
import { usePersonalList } from "./usePersonalList";
import { compareTasks, dueBucket } from "./homeFormat";

const DONE_TYPES = ["done", "close"];

export function useMyWork({ companyId, userId, dateFormat }) {
    const { getters } = useStore();
    const { changeDateFormate } = useMoment();
    const personalList = usePersonalList({ companyId, userId });

    const openTasks = ref([]);
    const doneTasks = ref([]);
    const loading = ref(false);
    const loaded = ref(false);
    const doneLoaded = ref(false);
    const sortBy = ref(localStorage.getItem("ah.home.sort") || "priority");

    const projectsById = computed(() => {
        const list = getters["projectData/allProjects"]?.data || [];
        return Object.fromEntries(list.map((p) => [p._id, p]));
    });

    const projectOf = (task) => projectsById.value[task.ProjectID];
    const isLiveProject = (task) => {
        const p = projectOf(task);
        return !!p && p.statusType !== "close" && !p.deletedStatusKey;
    };
    const isMine = (task) => Array.isArray(task.AssigneeUserId) && task.AssigneeUserId.includes(userId.value);

    async function fetchOpen() {
        loading.value = true;
        try {
            const response = await apiRequest("post", `${env.TASK}/find`, {
                findQuery: {
                    $match: {
                        deletedStatusKey: 0,
                        mainChat: { $ne: true },
                        statusType: { $nin: DONE_TYPES },
                        $or: [{ AssigneeUserId: userId.value }, { Task_Leader: userId.value }]
                    }
                }
            });
            openTasks.value = Array.isArray(response?.data) ? response.data : [];
            loaded.value = true;
        } finally {
            loading.value = false;
        }
    }

    async function fetchDone() {
        const response = await apiRequest("post", `${env.TASK}/find`, {
            findQuery: {
                $match: {
                    deletedStatusKey: 0,
                    mainChat: { $ne: true },
                    statusType: { $in: DONE_TYPES },
                    $or: [{ AssigneeUserId: userId.value }, { Task_Leader: userId.value }],
                    updatedAt: { dbDate: { $gte: moment().subtract(30, "days").toISOString() } }
                }
            }
        });
        doneTasks.value = Array.isArray(response?.data) ? response.data : [];
        doneLoaded.value = true;
    }

    const visibleOpen = computed(() => openTasks.value.filter(isLiveProject));
    const mine = computed(() => visibleOpen.value.filter(isMine));
    const delegated = computed(() => visibleOpen.value.filter((t) => !isMine(t) && t.Task_Leader === userId.value));
    const done = computed(() => doneTasks.value.filter(isLiveProject).sort((a, b) => new Date(b.updatedAt || 0) - new Date(a.updatedAt || 0)));

    const groups = computed(() => {
        const buckets = { today: [], overdue: [], next: [], unscheduled: [] };
        mine.value.forEach((task) => buckets[dueBucket(task)].push(task));
        Object.keys(buckets).forEach((key) => buckets[key].sort((a, b) => compareTasks(a, b, sortBy.value)));
        return buckets;
    });

    const unscheduled = computed(() => groups.value.unscheduled);
    const assignedCount = computed(() => mine.value.length);

    function setSort(value) {
        sortBy.value = value;
        localStorage.setItem("ah.home.sort", value);
    }

    function removeLocal(task) {
        openTasks.value = openTasks.value.filter((t) => t._id !== task._id);
    }

    function patchLocal(task, patch) {
        const apply = (list) => list.map((t) => (t._id === task._id ? { ...t, ...patch } : t));
        openTasks.value = apply(openTasks.value);
        doneTasks.value = apply(doneTasks.value);
    }

    async function complete(task) {
        const project = projectOf(task);
        const target = personalList.doneStatus(project);
        if (!project || !target) throw new Error("no done status");
        removeLocal(task);
        try {
            await personalList.setStatus(task, target, project);
            doneTasks.value = [{ ...task, statusType: target.type, statusKey: target.key, updatedAt: new Date().toISOString() }, ...doneTasks.value];
        } catch (error) {
            openTasks.value = [task, ...openTasks.value];
            throw error;
        }
    }

    async function reopen(task) {
        const project = projectOf(task);
        const target = personalList.defaultStatus(project);
        if (!project || !target) throw new Error("no open status");
        doneTasks.value = doneTasks.value.filter((t) => t._id !== task._id);
        try {
            await personalList.setStatus(task, target, project);
            openTasks.value = [{ ...task, statusType: target.type, statusKey: target.key }, ...openTasks.value];
        } catch (error) {
            doneTasks.value = [task, ...doneTasks.value];
            throw error;
        }
    }

    async function addPersonalTask(name, dueDate) {
        const created = await personalList.createTask(name, dueDate);
        openTasks.value = [created, ...openTasks.value];
        return created;
    }

    function dueNotification(task, project, date) {
        const obj = { ProjectName: project.ProjectName, TaskName: task.TaskName };
        const notification = { key: "task_due_date", projectId: task.ProjectID, taskId: task._id, sprintId: task.sprintId };
        const deadline = task.dueDateDeadLine || [];
        if (deadline.length) {
            obj.previousDate = changeDateFormate(new Date(deadline[deadline.length - 1].date || deadline[deadline.length - 1]));
            obj.changedDate = changeDateFormate(date);
            notification.message = taskDueDateChange(obj);
        } else {
            obj.lastDate = changeDateFormate(date);
            notification.message = taskDueDateAdd(obj);
        }
        return notification;
    }

    async function setDueDate(task, date) {
        const project = projectOf(task);
        if (!project) throw new Error("project missing");
        const due = date ? new Date(date) : null;
        const deadline = [...(task.dueDateDeadLine || []).map((x) => ({ date: x.date || x }))];
        if (due) deadline.push({ date: due });
        const firebaseObj = { DueDate: due, dueDateDeadLine: due ? deadline : [] };
        patchLocal(task, firebaseObj);
        await taskClass.updateDueDate({
            commonDateFormatString: dateFormat?.value,
            firebaseObj,
            project: personalList.projectData(project),
            task,
            obj: due ? dueNotification(task, project, due) : {},
            userData: personalList.userData(),
            isUpdateTask: true
        });
    }

    async function schedule(task, start, end) {
        const project = projectOf(task);
        if (!project) throw new Error("project missing");
        const startDate = new Date(start);
        patchLocal(task, { startDate });
        await taskClass.updateStartDate({
            commonDateFormatString: dateFormat?.value,
            firebaseObj: { startDate },
            project: personalList.projectData(project),
            task,
            obj: {},
            userData: personalList.userData(),
            isUpdateTask: true
        });
        await setDueDate({ ...task, startDate }, end);
    }

    return {
        openTasks, doneTasks, loading, loaded, doneLoaded, sortBy,
        projectOf, mine, delegated, done, groups, unscheduled, assignedCount,
        fetchOpen, fetchDone, setSort, complete, reopen, addPersonalTask, setDueDate, schedule,
        personalList
    };
}
