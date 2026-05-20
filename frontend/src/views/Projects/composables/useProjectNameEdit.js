import { ref, inject } from 'vue';
import { useStore } from 'vuex';
import { useToast } from 'vue-toast-notification';
import { useI18n } from 'vue-i18n';
import { useCustomComposable, useGetterFunctions } from '@/composable';
import { useValidation } from '@/composable/Validation';
import { EditProjectName } from '@/utils/NotificationTemplate';
import * as env from '@/config/env';
import { apiRequest } from '@/services';

export function useProjectNameEdit(projectData) {
    const { commit, getters } = useStore();
    const $toast = useToast();
    const { t } = useI18n();
    const { sanitizeInput } = useCustomComposable();
    const { checkAllFields } = useValidation();
    const { getUser } = useGetterFunctions();

    const userId = inject('$userId');
    const companyId = inject('$companyId');
    const companyOwner = () => getters['settings/companyOwnerDetail'];

    const editProject = ref(false);
    const editProject2 = ref(false);
    const projectName = ref({
        value: '',
        rules: 'required | min: 3',
        name: 'name',
        error: '',
    });

    function resetProjectName() {
        projectName.value.value = '';
        projectName.value.error = '';
    }

    function updateProjectName() {
        checkAllFields({ projectName: projectName.value })
            .then(async (valid) => {
                const prevName = sanitizeInput(projectData.value.ProjectName);
                const newName = sanitizeInput(projectName.value.value);
                if (!valid) return;

                editProject.value = false;
                editProject2.value = false;
                try {
                    const updateObj = { ProjectName: projectName.value.value };
                    await apiRequest('put', `/api/v1/${env.PROJECTACTIONS}/${projectData.value._id}`, { updateObject: updateObj });
                    $toast.success(t('Toast.Project_name_updated_successfully'), { position: 'top-right' });
                    const user = getUser(userId.value);
                    const userData = {
                        id: user.id,
                        Employee_Name: user.Employee_Name,
                        companyOwnerId: companyOwner().userId,
                    };

                    const axiosData = {
                        type: 'project',
                        companyId: companyId.value,
                        projectId: projectData.value._id,
                        taskId: null,
                        object: {
                            sprintId: null,
                            key: 'Project_Name',
                            message: `<b>${userData.Employee_Name}</b> has changed the name of <b>${prevName}</b> to <b>${newName}</b>`,
                        },
                        userData,
                    };
                    apiRequest('post', env.HANDLE_HISTORY, axiosData).then((result) => {
                        if (result.data.status) {
                            console.info(result.data.statusText);
                        }
                    });
                    const updatedPr = { ...projectData.value, ProjectName: projectName.value.value };
                    commit('projectData/projectLocalUpdate', { itemData: updatedPr, key: 'ProjectName', subKey: '', userId: userId.value });
                    const notifyObj = { TaskName: newName, previousTaskName: prevName };
                    const notificationObject = {
                        message: EditProjectName(notifyObj),
                        key: 'project_name',
                    };

                    apiRequest('post', env.HANDLE_NOTIFICATION, {
                        type: 'project',
                        companyId: companyId.value,
                        projectId: projectData.value._id,
                        object: notificationObject,
                        userData,
                        changeType: 'name',
                        changeData: notifyObj,
                    }).catch((error) => {
                        console.error('ERROR in update notification', error);
                    });
                    resetProjectName();
                } catch (error) {
                    console.error(error);
                }
            })
            .catch((error) => {
                console.error('ERROR in validation: ', error);
            });
    }

    return {
        editProject,
        editProject2,
        projectName,
        resetProjectName,
        updateProjectName,
    };
}
