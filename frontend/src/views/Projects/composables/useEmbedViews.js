import { inject } from 'vue';
import { useStore } from 'vuex';
import { useToast } from 'vue-toast-notification';
import { useI18n } from 'vue-i18n';
import { useGetterFunctions } from '@/composable';
import { deleteView, editView } from '@/components/molecules/EmbedView/helper.js';
import { deletePrivateView, editPrivateName } from '@/components/molecules/ProjectViews/helper.js';
import * as env from '@/config/env';
import { apiRequest } from '@/services';

/**
 * Embed-view CRUD helpers.
 *
 * @param projectData ref to the current project
 * @param embedViews ref to the array of embed views (used for duplicate-name check)
 * @param companyUser ref to the current company user (used for private-view edits)
 * @param renameValue ref shared with the parent template (in-progress rename)
 * @param openDelete ref shared with the parent template (delete-confirmation state)
 * @param selectedEmbedView ref shared with the parent (currently-active embed view)
 */
export function useEmbedViews(projectData, embedViews, companyUser, renameValue, openDelete, selectedEmbedView) {
    const { commit, getters } = useStore();
    const $toast = useToast();
    const { t } = useI18n();
    const { getUser } = useGetterFunctions();

    const userId = inject('$userId');
    const companyId = inject('$companyId');

    const copyToClipboard = (id) => {
        let link = window.location.href.split('?')[0];
        link = link + `?tab=EmbedView&eid=${id}`;
        navigator.clipboard.writeText(link);
        $toast.success(t('Toast.Link_copied_to_clipboard_successfully'), { position: 'top-right' });
    };

    const editViewName = (element) => {
        const user = getUser(userId.value);
        const userData = {
            id: user.id,
            Employee_Name: user.Employee_Name,
            companyOwnerId: getters['settings/companyOwnerDetail'].userId,
        };

        if (renameValue.value.name.trim() == element.name.trim()) {
            renameValue.value = { name: '', id: '' };
            return;
        }
        if (!renameValue.value.name.trim()) {
            $toast.error(t('Toast.View_name_is_required'), { position: 'top-right' });
            return;
        }
        if ((renameValue.value.name.trim().length) < 3) {
            $toast.error(t('Toast.name_should_be_at_least_3_characters_long'), { position: 'top-right' });
            return;
        }
        const duplicate = embedViews.value.filter((item) => item.id !== element.id && item.name.trim() === renameValue.value.name.trim());
        if (duplicate.length) {
            $toast.error(t('Toast.View_name_already_exists'), { position: 'top-right' });
            return;
        }
        if (element.isPrivate) {
            editPrivateName({ cid: companyId.value, uid: companyUser.value._id, uniqueId: element.id }, element, renameValue.value.name.trim());
        } else {
            editView({ cid: companyId.value, pid: projectData.value._id }, element, renameValue.value.name.trim(), 'name').then((res) => {
                commit('projectData/projectLocalUpdate', { itemData: res.data, projectId: projectData.value._id, key: 'ProjectView', subKey: 'edit', userId: '' });
            }).catch((error) => {
                console.error(error);
            });
            if (selectedEmbedView.value && selectedEmbedView.value.id == element.id) {
                selectedEmbedView.value.name = renameValue.value.name;
            }
        }
        const historyObj = {
            message: `<b>${userData.Employee_Name}</b> has changed the  <b> Embed View name </b> as <b> ${renameValue.value.name.trim()} </b>  from <b>${element?.name} </b>`,
            key: 'Project_Name',
        };
        apiRequest('post', env.HANDLE_HISTORY, {
            type: 'project',
            companyId: companyId.value,
            projectId: projectData.value._id,
            taskId: null,
            object: historyObj,
            userData,
        }).catch((error) => {
            console.error('ERROR in update project history: ', error);
        });
        renameValue.value = { name: '', id: '' };
    };

    const deleteEmbedView = () => {
        const user = getUser(userId.value);
        const userData = {
            id: user.id,
            Employee_Name: user.Employee_Name,
            companyOwnerId: getters['settings/companyOwnerDetail'].userId,
        };
        const historyObj = {
            message: `<b> ${userData.Employee_Name} </b> has deleted the  <b> Embed View ${openDelete.value.data.name} </b>`,
            key: 'Project_Name',
        };

        if (openDelete.value.data.isPrivate) {
            deletePrivateView({ cid: companyId.value, uid: companyUser.value._id, uniqueId: openDelete.value.data.id }).then(() => {
                $toast.success(t('Toast.View_Deleted_Successfully'), { position: 'top-right' });
            }).catch((err) => {
                console.error(err.statusText);
            });
            openDelete.value.flag = false;
            apiRequest('post', env.HANDLE_HISTORY, {
                type: 'project',
                companyId: companyId.value,
                projectId: projectData.value._id,
                taskId: null,
                object: historyObj,
                userData,
            }).catch((error) => {
                console.error('ERROR in update project history: ', error);
            });
            return;
        }

        deleteView({ cid: companyId.value, pid: projectData.value._id }, openDelete.value.data).then((res) => {
            commit('projectData/projectLocalUpdate', { itemData: res.data, projectId: projectData.value._id, key: 'ProjectView', subKey: 'delete', userId: '' });
        }).catch((err) => {
            console.error(err.statusText);
        });
        openDelete.value.flag = false;
        apiRequest('post', env.HANDLE_HISTORY, {
            type: 'project',
            companyId: companyId.value,
            projectId: projectData.value._id,
            taskId: null,
            object: historyObj,
            userData,
        }).catch((error) => {
            console.error('ERROR in update project history: ', error);
        });
        $toast.success(t('Toast.View_Deleted_Successfully'), { position: 'top-right' });
    };

    return {
        copyToClipboard,
        editViewName,
        deleteEmbedView,
    };
}
