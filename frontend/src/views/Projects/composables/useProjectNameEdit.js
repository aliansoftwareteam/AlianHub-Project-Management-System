import { ref, inject } from 'vue';
import { useStore } from 'vuex';
import { useToast } from 'vue-toast-notification';
import { useI18n } from 'vue-i18n';
import { useValidation } from '@/composable/Validation';
import * as env from '@/config/env';
import { apiRequest } from '@/services';

export function useProjectNameEdit(projectData) {
    const { commit } = useStore();
    const $toast = useToast();
    const { t } = useI18n();
    const { checkAllFields } = useValidation();

    const userId = inject('$userId');

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
                if (!valid) return;

                editProject.value = false;
                editProject2.value = false;
                try {
                    const updateObj = { ProjectName: projectName.value.value };
                    await apiRequest('put', `/api/v1/${env.PROJECTACTIONS}/${projectData.value._id}`, { updateObject: updateObj });
                    $toast.success(t('Toast.Project_name_updated_successfully'), { position: 'top-right' });
                    const updatedPr = { ...projectData.value, ProjectName: projectName.value.value };
                    commit('projectData/projectLocalUpdate', { itemData: updatedPr, key: 'ProjectName', subKey: '', userId: userId.value });
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
