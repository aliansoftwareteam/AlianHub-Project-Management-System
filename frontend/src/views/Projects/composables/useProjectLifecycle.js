import { ref, inject } from 'vue';
import { useStore } from 'vuex';
import { useToast } from 'vue-toast-notification';
import { useI18n } from 'vue-i18n';
import { useCustomComposable, useGetterFunctions, useHistoryNotification } from '@/composable';
import { useProjects } from '@/composable/projects';
import * as env from '@/config/env';
import { apiRequest } from '@/services';

export function useProjectLifecycle(projectData) {
    const { commit } = useStore();
    const $toast = useToast();
    const { t } = useI18n();
    const { sanitizeInput } = useCustomComposable();
    const { getUser } = useGetterFunctions();
    const { addHistory, addNotification } = useHistoryNotification();
    const { markFavourite } = useProjects();

    const userId = inject('$userId');
    const companyId = inject('$companyId');

    const archive = ref(0);
    const showSidebar = ref(false);
    const showSpinner = ref(false);

    function updateChildTasks(restore = false, ProjectId = '') {
        try {
            const dsk = archive.value;
            let taskDeleteStatusKey = 0;
            let deletedStatusKey;
            if (restore) {
                deletedStatusKey = dsk ? 8 : 7;
                taskDeleteStatusKey = 0;
            } else {
                deletedStatusKey = 0;
                if (dsk === 1 || dsk === 0) {
                    taskDeleteStatusKey = (dsk === 0 ? 8 : 7);
                } else if (dsk === 2) {
                    taskDeleteStatusKey = 1;
                }
            }
            try {
                const object = {
                    firstParameter: {
                        objId: { ProjectID: ProjectId },
                        deletedStatusKey,
                    },
                    secondParameter: { $set: { deletedStatusKey: taskDeleteStatusKey } },
                    key: 'updateMany',
                    isConvertFirstParameter: true,
                    isConvertSecondParameter: false,
                };

                apiRequest('put', env.TASK, object).catch((error) => {
                    console.error(error);
                });
            } catch (error) {
                console.error(error);
            }
        } catch (error) {
            console.error('ERROR in update tasks: ', error);
        }
    }

    async function updateProject(value = null) {
        showSpinner.value = true;
        const updateObject = {};
        if (value !== null || archive.value !== 0) {
            updateObject.deletedStatusKey = value !== null ? value : archive.value === 1 ? 2 : 1;
        } else {
            const status = projectData.value.projectStatusData.find((x) => x.type === 'close');
            updateObject.status = status.value;
            updateObject.statusType = status.type;
        }
        try {
            await apiRequest('put', `/api/v1/${env.PROJECTACTIONS}/${projectData.value._id}`, { updateObject: { ...updateObject } });
            showSidebar.value = false;
            showSpinner.value = false;
            const ProjectId = JSON.parse(JSON.stringify(projectData.value._id));
            updateChildTasks(value !== null, ProjectId);
            const user = getUser(userId.value);
            const userData = {
                id: user.id,
                Employee_Name: user.Employee_Name,
                companyOwnerId: user.companyOwnerId,
            };

            const type = `${value !== null ? 'restored' : archive.value === 0 ? 'closed' : archive.value === 1 ? 'archived' : 'deleted'}`;

            $toast.success(t(`Toast.Project ${type} successfully`), { position: 'top-right' });

            const notificationObject = {
                message: `<p><strong>${userData.Employee_Name}</strong> has ${type} the <strong>${sanitizeInput(projectData.value.ProjectName)}</strong> Project</p>`,
                key: 'project_close',
                projectId: projectData.value._id,
            };
            const historyObj = {
                message: `<b>${userData.Employee_Name}</b> has ${type} the <b>${sanitizeInput(projectData.value.ProjectName)}</b> Project`,
                key: 'Project_Name',
            };
            addHistory({
                type: 'project',
                companyId: companyId.value,
                projectId: projectData.value._id,
                taskId: null,
                object: historyObj,
                userData,
            });
            addNotification({
                type: 'project',
                companyId: companyId.value,
                projectId: projectData.value._id,
                object: notificationObject,
                userData,
            });
            commit('projectData/projectLocalUpdate', { itemData: { ...projectData.value, ...updateObject }, projectId: projectData.value._id, key: value === null ? 'RemoveProject' : 'AddProject', subKey: '', userId: '' });
        } catch (error) {
            showSidebar.value = false;
            showSpinner.value = false;
            $toast.error(t('Toast.something_went_wrong'), { position: 'top-right' });
            console.error('ERROR in update project: ', error);
        }
    }

    function markProjectFavourite() {
        if (!projectData.value.favouriteTasks || !projectData.value.favouriteTasks.find((x) => x.userId === userId.value)) {
            markFavourite({
                cid: companyId.value,
                projectId: projectData.value._id,
                userId: userId.value,
            }).then((msg) => {
                commit('projectData/projectLocalUpdate', { itemData: { ...projectData.value }, projectId: projectData.value._id, key: 'MarkAsFavourite', subKey: 'add', userId: userId.value });
                $toast.success(msg, { position: 'top-right' });
            }).catch((error) => {
                console.error('ERROR in mark project fav: ', error);
            });
        } else {
            markFavourite({
                cid: companyId.value,
                projectId: projectData.value._id,
                userId: userId.value,
                data: projectData.value.favouriteTasks.find((x) => x.userId === userId.value),
            }).then((msg) => {
                commit('projectData/projectLocalUpdate', { itemData: { ...projectData.value }, projectId: projectData.value._id, key: 'MarkAsFavourite', subKey: 'remove', userId: userId.value });
                $toast.success(msg, { position: 'top-right' });
            }).catch((error) => {
                console.error('ERROR in mark project fav: ', error);
            });
        }
    }

    return {
        archive,
        showSidebar,
        showSpinner,
        updateProject,
        markProjectFavourite,
    };
}
