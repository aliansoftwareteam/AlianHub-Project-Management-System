import { inject, ref } from 'vue';
import { useStore } from 'vuex';
import { useToast } from 'vue-toast-notification';
import { useI18n } from 'vue-i18n';
import { useGetterFunctions } from '@/composable';
import { useUpdateTasks } from '@/views/Projects/helper';
import taskClass from '@/utils/TaskOperations';

export function useTaskMutations({ projectData, task, props }) {
    const { commit, getters } = useStore();
    const $toast = useToast();
    const { t } = useI18n();
    const { getUser } = useGetterFunctions();
    const { updateTaskByGroup } = useUpdateTasks();

    const userId = inject('$userId');
    const companyId = inject('$companyId');

    const assigneeInProgress = ref({});

    const companyOwner = () => getters['settings/companyOwnerDetail'];

    function getUserData() {
        const user = getUser(userId.value);
        return {
            id: user.id,
            Employee_Name: user.Employee_Name,
            companyOwnerId: companyOwner().userId,
        };
    }

    function getProjectStub() {
        return {
            _id: projectData.value._id,
            CompanyId: projectData.value.CompanyId,
            lastTaskId: projectData.value.lastTaskId,
            ProjectName: projectData.value.ProjectName,
            ProjectCode: projectData.value.ProjectCode,
        };
    }

    function updateTask(value = null, archiveFlag) {
        const deletedStatusKey = value !== null ? value : archiveFlag ? 2 : 1;
        const userData = getUserData();

        taskClass.updateArchiveDelete({
            companyId: companyId.value,
            projectData: getProjectStub(),
            sprintId: task.value.sprintId,
            task: task.value,
            folderId: task.value.folderObjId ? task.value.folderObjId : '',
            userData,
            deletedStatusKey,
        }).then((res) => {
            let sprint = {};
            if (task.value.folderObjId) {
                sprint = projectData.value.sprintsfolders[task.value.folderObjId].sprintsObj[task.value.sprintId];
            } else {
                sprint = projectData.value.sprintsObj[task.value.sprintId];
            }
            sprint.tasks = sprint.tasks - (task.value.isParentTask ? ((task.value.subTasks || 0) + 1) : 1);
            commit('projectData/mutateSprints', { op: 'modified', data: { ...sprint } });
            if (res.status) {
                $toast.success(t(`Toast.Task_${value !== null ? 'restored' : archiveFlag ? 'archived' : 'deleted'}_successfully`), { position: 'top-right' });
            }
        }).catch((err) => {
            console.error(err);
        });
    }

    function updateTaskName(taskName) {
        if (taskName.trim().length < 3 || taskName.trim().length > 250) return;

        const userData = getUserData();

        const firebaseObj = { TaskName: taskName };
        const obj = {
            previousTaskName: props.data.TaskName,
            userName: userData.Employee_Name,
        };

        taskClass.updateTaskName({ firebaseObj, projectData: getProjectStub(), taskData: props.data, obj, userData })
            .then(() => {
                $toast.success(t('Toast.Task_name_updated_successfully'), { position: 'top-right' });
            })
            .catch((err) => {
                console.error(err);
            });
    }

    function changeStatus(status) {
        const statusIndex = projectData.value.taskStatusData.findIndex((x) => x.key === props.data.statusKey);
        if (statusIndex === -1) return;
        updateTaskByGroup(props.data, status, 0);
    }
    function changeTaskType(status) {
        const statusIndex = projectData.value.taskTypeCounts.findIndex((x) => x.key === props.data.TaskTypeKey);
        if (statusIndex === -1) return;
        updateTaskByGroup(props.data, status, 4);
    }

    function changeAssignee(type, value) {
        if (!value?.id) return;
        if (assigneeInProgress.value[value?.id] && assigneeInProgress.value[value?.id] === type) return;
        assigneeInProgress.value[value?.id] = type;

        const userData = getUserData();

        let operation = '';
        if (type === 'add') operation = 'assigneeAdd';
        else if (type === 'remove') operation = 'assigneRemove';
        else if (type === 'replace') operation = 'replace';

        const updateObject = { AssigneeUserId: value.id };

        taskClass.updateAssignee({
            firebaseObj: updateObject,
            projectData: getProjectStub(),
            taskData: props.data,
            employeeName: getUser(value.id).Employee_Name,
            type: operation,
            userData,
        }).then(() => {
            if (operation === 'assigneRemove') {
                const index = task.value.AssigneeUserId.findIndex((x) => x === value.id);
                task.value.AssigneeUserId.splice(index, 1);
                commit('projectData/mutateSearchTask', { op: 'modified', data: [task.value] });
            }
            delete assigneeInProgress.value[value?.id];
            $toast.success(t(`Toast.Assignee ${type === 'add' || type === 'replace' ? 'added' : 'removed'} successfully`), { position: 'top-right' });
        }).catch((error) => {
            delete assigneeInProgress.value[value?.id];
            console.error('ERROR in changeAssignee: ', error);
        });
    }

    const updateDueDate = (event) => {
        try {
            if (!event?.dateVal) return;
            updateTaskByGroup(props.data, { seconds: new Date(event.dateVal).getTime() / 1000 }, 3);
        } catch (error) {
            console.error('ERROR in updateDueDate: ', error);
        }
    };

    function updatePriority(val = null) {
        if (!val) return;
        updateTaskByGroup(props.data, val, 2);
    }

    return {
        getUserData,
        updateTask,
        updateTaskName,
        changeStatus,
        changeTaskType,
        changeAssignee,
        updateDueDate,
        updatePriority,
    };
}
