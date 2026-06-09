import { ref, inject } from 'vue';
import { useStore } from 'vuex';
import { useToast } from 'vue-toast-notification';
import { useI18n } from 'vue-i18n';
import { useGetterFunctions } from '@/composable';
import { storageQueryBuilder, generateFileName } from '@/utils/storageQueryBuild.js';
import * as env from '@/config/env';
import { apiRequest, apiRequestWithoutCompnay } from '@/services';

export function useProjectAvatar(projectData) {
    const { commit } = useStore();
    const $toast = useToast();
    const { t } = useI18n();
    const { getUser } = useGetterFunctions();

    const userId = inject('$userId');
    const companyId = inject('$companyId');

    const showColorAvatar = ref(false);
    const savingAvatar = ref(false);
    const previewImage = ref(null);

    const formData = ref({
        projectName: '',
        projectId: '',
        projectProfileField: {
            selectedColor: { value: '', rules: 'required', name: 'selectedColor', error: '' },
            uploadedImage: { value: '', rules: 'required', name: 'Choose an Image to Upload', error: '' },
            previewImage: { value: '', rules: 'required', name: 'previewImage', error: '' },
        },
    });

    const resetFormData = () => {
        formData.value = {
            projectName: '',
            projectId: '',
            projectProfileField: {
                selectedColor: { value: '', rules: 'required', name: 'selectedColor', error: '' },
                uploadedImage: { value: '', rules: 'required', name: 'Choose an Image to Upload', error: '' },
                previewImage: { value: '', rules: 'required', name: 'previewImage', error: '' },
            },
        };
    };

    function assignAvatarData(data) {
        formData.value.projectName = data.name;
        formData.value.projectId = data.id;
        formData.value.icon = data?.icon || '';

        if (data.icon.type === 'image') {
            formData.value.projectProfileField.previewImage.value = data?.icon?.data || '';
        } else {
            formData.value.projectProfileField.selectedColor.value = data?.icon?.data || '';
        }
    }

    function updateImageValue(ele) {
        previewImage.value = ele[0];
    }

    async function saveProjectAvatar() {
        const updateObject = { type: 'color', data: '' };
        const prevIcon = formData?.value?.icon || '';
        savingAvatar.value = true;

        const deleteWasabiImage = () => {
            try {
                const axiousObject = storageQueryBuilder('delete', companyId.value, ((env.STORAGE_TYPE && env.STORAGE_TYPE === 'server') ? (prevIcon.data + '&thubmkey=projectIcon') : prevIcon.data));
                apiRequest(axiousObject.method, axiousObject.route, axiousObject.data).then((response) => {
                    if (!response.data.status) {
                        console.error('ERROR in delete wasabi image: ', response.data.statusText);
                    }
                }).catch((error) => {
                    console.error('ERROR in upload image: ', error);
                });
            } catch (error) {
                console.error('ERROR in upload image: ', error);
            }
        };

        if (formData.value.projectProfileField.previewImage.value !== '') {
            const name = generateFileName(previewImage.value.name, env.STORAGE_TYPE);
            const filePath = `Project/${projectData.value._id}/Settings/ProjectIcon/${name}`;
            updateObject.type = 'image';

            const apiFormData = new FormData();
            apiFormData.append('companyId', companyId.value);
            apiFormData.append('path', filePath);
            apiFormData.append('key', 'projectIcon');
            apiFormData.append('file', previewImage.value);

            if (prevIcon.type === 'image' && !prevIcon.data.includes('http')) {
                deleteWasabiImage();
            }

            updateObject.data = await apiRequestWithoutCompnay('post', storageQueryBuilder('upload').route, apiFormData, 'form').then((response) => {
                if (response.data.status) {
                    const imageUrlPath = env.STORAGE_TYPE && env.STORAGE_TYPE === 'server' ? response.data.statusText : response.data.statusText[0];
                    return imageUrlPath;
                } else {
                    return '';
                }
            }).catch((error) => {
                console.error('ERROR in upload image: ', error);
            });
        } else {
            if (prevIcon.type === 'image' && !prevIcon.data.includes('http')) {
                deleteWasabiImage();
            }

            updateObject.data = formData.value.projectProfileField.selectedColor.value;
        }

        if (!updateObject.data?.length) {
            $toast.error(t('Toast.something went worng'), { position: 'top-right' });
            savingAvatar.value = false;
            return;
        }
        try {
            await apiRequest('put', `/api/v1/${env.PROJECTACTIONS}/${projectData.value._id}`, { updateObject: { projectIcon: { ...updateObject } } });
            resetFormData();
            savingAvatar.value = false;
            showColorAvatar.value = false;
            const user = getUser(userId.value);
            const userData = {
                id: user.id,
                Employee_Name: user.Employee_Name,
                companyOwnerId: user.companyOwnerId,
            };
            const historyObj = {
                key: 'Project_EndDate',
                message: `<b>${userData.Employee_Name}</b> has changed <b> ${updateObject.type === 'color' ? 'color' : 'avatar'} </b> </b>.`,
            };
            apiRequest('post', env.HANDLE_HISTORY, {
                type: 'project',
                companyId: companyId.value,
                projectId: projectData.value._id,
                taskId: null,
                object: historyObj,
                userData,
            });
            commit('projectData/projectLocalUpdate', { itemData: { ...updateObject }, projectId: projectData.value._id, key: 'ProjectIcon', subKey: '', userId: '' });
            $toast.success(t('Toast.Project_avatar_updated_successfully'), { position: 'top-right' });
        } catch (error) {
            resetFormData();
            savingAvatar.value = false;
            $toast.error(t('Toast.something_went_wrong'), { position: 'top-right' });
            console.error('Error while change avatar of project:', error);
        }
    }

    return {
        showColorAvatar,
        savingAvatar,
        previewImage,
        formData,
        resetFormData,
        assignAvatarData,
        updateImageValue,
        saveProjectAvatar,
    };
}
