import { ref, inject } from 'vue';
import { useStore } from 'vuex';
import { useToast } from 'vue-toast-notification';
import { useGetterFunctions } from '@/composable';
import { projectAssignee, projectAssigneeRemove } from '@/utils/NotificationTemplate';
import * as env from '@/config/env';
import { apiRequest } from '@/services';

export function useProjectAssignee(projectData) {
    const { commit, getters } = useStore();
    const $toast = useToast();
    const { getUser } = useGetterFunctions();

    const userId = inject('$userId');
    const companyId = inject('$companyId');

    const assigneeInProgress = ref({});

    async function changeAssignee(type, user) {
        if (assigneeInProgress.value[user.id] && assigneeInProgress.value[user.id] === type) return;
        assigneeInProgress.value[user.id] = type;

        const usr = getUser(userId.value);
        const userData = {
            id: usr.id,
            Employee_Name: usr.Employee_Name,
            companyOwnerId: getters['settings/companyOwnerDetail'].userId,
        };

        let obj;
        let key;
        if (type === 'add') {
            if (projectData.value.AssigneeUserId.includes(user.id)) return;
            obj = { AssigneeUserId: user.id };
            key = '$addToSet';
        } else {
            if (!projectData.value.AssigneeUserId.includes(user.id)) return;
            obj = {
                AssigneeUserId: user.id,
                ...(projectData.value.LeadUserId.includes(user.id) && { LeadUserId: user.id }),
            };
            key = '$pull';
        }
        try {
            await apiRequest('put', `/api/v1/${env.PROJECTACTIONS}/${projectData.value._id}`, { updateObject: obj, key });

            commit('projectData/projectLocalUpdate', {
                itemData: { ...projectData.value },
                projectId: projectData.value._id,
                key: 'AssigneeChange',
                subKey: key === '$addToSet' ? 'add' : 'remove',
                userId: user.id,
            });

            delete assigneeInProgress.value[user.id];

            const msg = `Assignee ${type === 'add' ? 'added' : 'removed'} successfully`;
            $toast.success(msg, { position: 'top-right' });

            const historyObj = {
                message: `<b>${userData.Employee_Name}</b> ${type === 'add' ? 'added' : 'removed'} the <b>Assignee</b> to <b>${user.label}</b>`,
                key: 'Assignee_Changed',
            };
            const notifyObj = {
                projectName: projectData.value.ProjectName,
                Employee_Name: user.label,
            };
            const notificationObject = {
                message: type === 'add' ? projectAssignee(notifyObj) : projectAssigneeRemove(notifyObj),
                key: 'project_assignee',
            };
            apiRequest('post', env.HANDLE_HISTORY, {
                type: 'project',
                companyId: companyId.value,
                projectId: projectData.value._id,
                taskId: null,
                object: historyObj,
                userData,
            }).catch((error) => {
                console.error('ERROR in update history', error);
            });
            apiRequest('post', env.HANDLE_NOTIFICATION, {
                type: 'project',
                companyId: companyId.value,
                projectId: projectData.value._id,
                object: notificationObject,
                userData,
                mentionUserId: [user.id],
            }).catch((error) => {
                console.error('ERROR in update notification', error);
            });
        } catch (error) {
            console.error('Error in update project', error);
        }
    }

    return {
        assigneeInProgress,
        changeAssignee,
    };
}
