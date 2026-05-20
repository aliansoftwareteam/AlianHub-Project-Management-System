import { ref, inject } from 'vue';
import { useToast } from 'vue-toast-notification';
import { useI18n } from 'vue-i18n';
import { useRouter, useRoute } from 'vue-router';
import taskClass from '@/utils/TaskOperations';

export function useTaskActions({ projectData, task, props }) {
    const $toast = useToast();
    const { t } = useI18n();
    const router = useRouter();
    const route = useRoute();

    const userId = inject('$userId');
    const companyId = inject('$companyId');

    const openConvertSubTaskSidebar = ref(false);
    const converrtToListSidebar = ref(false);
    const openMoveSubTask = ref(false);
    const openMoveSidebar = ref(false);
    const openMergeTask = ref(false);
    const duplicateTaskSidebar = ref(false);
    const openSubTaskSideabr = ref(false);
    const openConvertToTask = ref(false);

    function changeRoute() {
        const paramsObj = {
            cid: companyId.value,
            id: projectData.value._id,
            sprintId: task.value.sprintId,
            taskId: task.value._id,
        };
        if (task.value.folderObjId) paramsObj.folderId = task.value.folderObjId;
        router.push({
            name: task.value.folderObjId ? 'ProjectFolderSprintTask' : 'ProjectSprintTask',
            params: paramsObj,
            query: { ...route.query, detailTab: 'comment' },
        });
    }

    const copyTaskLink = () => {
        let path;
        const navigation = window.location.href;
        let modifiedUrl;
        const newnavigation = navigation.replace(/\?tab.*$/, '');

        if (route.name === 'Project') {
            if (task.value.folderObjId) {
                modifiedUrl = newnavigation.slice(0, -2);
                path = `${modifiedUrl}/fs/${task.value.folderObjId}/${task.value.sprintId}/${task.value._id}`;
            } else {
                modifiedUrl = newnavigation.slice(0, -2);
                path = `${modifiedUrl}/s/${task.value.sprintId}/${task.value._id}`;
            }
        }
        if (route.name === 'ProjectSprint' || route.name === 'ProjectFolderSprint') {
            path = `${newnavigation}/${task.value._id}`;
        }
        if (route.name === 'ProjectFolder') {
            modifiedUrl = newnavigation.replace(/\/f(.*)/, '');
            path = `${modifiedUrl}/fs/${task.value.folderObjId}/${task.value.sprintId}/${task.value._id}`;
        }

        const tabParamIndex = navigation.indexOf('?tab');
        if (tabParamIndex !== -1) {
            const tabParam = navigation.slice(tabParamIndex);
            path += tabParam;
        }

        navigator.clipboard.writeText(path);
        $toast.success(t('Toast.Link_is_Copied_to_clipboard'), { position: 'top-right' });
    };

    const copyTaskKey = () => {
        navigator.clipboard.writeText(task.value.TaskKey);
        $toast.success(t('Toast.Task_Key_is_Copied_to_clipboard'), { position: 'top-right' });
    };

    const convertToSubTask = () => {
        openConvertSubTaskSidebar.value = true;
        openSubTaskSideabr.value = true;
    };

    const sidebarOPen = (val) => {
        openConvertSubTaskSidebar.value = val;
        openMoveSubTask.value = false;
        openMoveSidebar.value = false;
        duplicateTaskSidebar.value = false;
        openConvertToTask.value = false;
        openMergeTask.value = false;
        converrtToListSidebar.value = false;
        openSubTaskSideabr.value = false;
    };

    const convertToList = () => {
        converrtToListSidebar.value = true;
    };

    const moveTask = () => {
        if (props.data.isParentTask === true) {
            openMoveSidebar.value = true;
        } else if (props.data.isParentTask === false) {
            openMoveSubTask.value = true;
        }
        openConvertSubTaskSidebar.value = true;
    };

    const mergeTask = () => {
        openConvertSubTaskSidebar.value = true;
        openMergeTask.value = true;
    };

    const duplicateTask = () => {
        openConvertSubTaskSidebar.value = true;
        duplicateTaskSidebar.value = true;
    };

    const convertToTask = () => {
        openConvertToTask.value = true;
        openConvertSubTaskSidebar.value = true;
    };

    const addToQueue = (action) => {
        try {
            taskClass.updateQueueList({
                CompanyId: projectData.value.CompanyId,
                projectId: projectData.value._id,
                sprintId: props.data.sprintId,
                taskId: props.data._id,
                userId: userId.value,
                actionType: action,
                queueListArray: props.data.queueListArray,
            }).then(() => {
                $toast.success(t(`Toast.Queue list ${action == 'add' ? 'added' : 'removed'} successfully`), { position: 'top-right' });
            }).catch((error) => {
                console.error('ERROR in update addToQueue: ', error);
                $toast.error(t('Toast.Queue_list_not_updated'), { position: 'top-right' });
            });
        } catch (error) {
            console.error('ERROR in update addToQueue: ', error);
        }
    };

    return {
        openConvertSubTaskSidebar,
        converrtToListSidebar,
        openMoveSubTask,
        openMoveSidebar,
        openMergeTask,
        duplicateTaskSidebar,
        openSubTaskSideabr,
        openConvertToTask,
        changeRoute,
        copyTaskLink,
        copyTaskKey,
        convertToSubTask,
        sidebarOPen,
        convertToList,
        moveTask,
        mergeTask,
        duplicateTask,
        convertToTask,
        addToQueue,
    };
}
