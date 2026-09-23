import { ref } from 'vue';
import { useStore } from 'vuex';
import { useToast } from 'vue-toast-notification';
import * as env from '@/config/env';
import { apiRequest } from '@/services';

export function useProjectAssignee(projectData) {
    const { commit } = useStore();
    const $toast = useToast();

    const assigneeInProgress = ref({});

    async function changeAssignee(type, user) {
        if (assigneeInProgress.value[user.id] && assigneeInProgress.value[user.id] === type) return;
        assigneeInProgress.value[user.id] = type;

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
        } catch (error) {
            console.error('Error in update project', error);
        }
    }

    return {
        assigneeInProgress,
        changeAssignee,
    };
}
